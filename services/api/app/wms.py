"""Official technical maps (WMS: regional CTR/DBT, Agenzia delle Entrate cadastre) served as XYZ tiles.

The services are configured by the administrator in the platform config (key ``wms``). The proxy only
ever contacts URLs from that list, looked up by id: a caller can never make the server fetch an
arbitrary address (SSRF). Each 256×256 tile becomes one GetMap request; responses are kept in a small
in-memory LRU cache.
"""
from __future__ import annotations

import math
import threading
from collections import OrderedDict
from typing import Any

import httpx

from app.platform import config
from app.settings import SETTINGS

# Half the side of the EPSG:3857 square (metres).
ORIGIN = 20037508.342789244
TILE = 256
CACHE_SIZE = 500
TIMEOUT_S = 15.0

FORMATS = {"image/png", "image/jpeg"}
VERSIONS = {"1.3.0", "1.1.1"}
CRSS = {"EPSG:3857", "EPSG:4326"}
KINDS = {"basemap", "overlay"}
MAX_SERVICES = 20


class WmsError(Exception):
    """Upstream service unreachable or answering with something that is not an image."""


def tile_bbox_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) of an XYZ tile in Web Mercator metres."""
    size = 2 * ORIGIN / (2 ** z)
    minx = -ORIGIN + x * size
    maxy = ORIGIN - y * size
    return (minx, maxy - size, minx + size, maxy)


def _lon(x: float) -> float:
    return x / ORIGIN * 180.0


def _lat(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y / ORIGIN * math.pi)) - math.pi / 2)


def tile_bbox(z: int, x: int, y: int, crs: str, version: str) -> tuple[float, float, float, float]:
    """BBOX parameter in the axis order the WMS version expects for the CRS.

    EPSG:3857 is always easting, northing. EPSG:4326 is lon,lat in WMS 1.1.1 and lat,lon in 1.3.0.
    """
    minx, miny, maxx, maxy = tile_bbox_3857(z, x, y)
    if crs == "EPSG:3857":
        return (minx, miny, maxx, maxy)
    w, s, e, n = _lon(minx), _lat(miny), _lon(maxx), _lat(maxy)
    return (s, w, n, e) if version == "1.3.0" else (w, s, e, n)


def getmap_params(svc: dict, z: int, x: int, y: int) -> dict[str, str]:
    version = svc.get("version") or "1.3.0"
    crs = svc.get("crs") or "EPSG:3857"
    fmt = svc.get("format") or "image/png"
    bbox = tile_bbox(z, x, y, crs, version)
    p = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": version, "LAYERS": svc["layers"], "STYLES": "",
        "FORMAT": fmt, "TRANSPARENT": "TRUE" if svc.get("transparent") and fmt == "image/png" else "FALSE",
        "WIDTH": str(TILE), "HEIGHT": str(TILE), "BBOX": ",".join(f"{v:.6f}" for v in bbox),
    }
    p["CRS" if version == "1.3.0" else "SRS"] = crs
    return p


def validate(entries: Any) -> list[dict]:
    """Normalises the ``wms`` list of the platform config; raises ValueError with an Italian message."""
    if not isinstance(entries, list):
        raise ValueError("Elenco WMS non valido")
    if len(entries) > MAX_SERVICES:
        raise ValueError(f"Al massimo {MAX_SERVICES} servizi WMS")
    out: list[dict] = []
    seen: set[str] = set()
    for e in entries:
        if not isinstance(e, dict):
            raise ValueError("Servizio WMS non valido")
        wid = str(e.get("id") or "").strip()
        if not wid or len(wid) > 40 or not all(c.isalnum() or c in "-_" for c in wid):
            raise ValueError("Identificativo WMS non valido (lettere, cifre, - e _)")
        if wid in seen:
            raise ValueError(f"Identificativo WMS duplicato: {wid}")
        seen.add(wid)
        label = str(e.get("label") or wid).strip()[:120]
        url = str(e.get("url") or "").strip()
        enabled = bool(e.get("enabled"))
        if url and not url.startswith("https://"):
            raise ValueError(f"{label}: il servizio WMS richiede un indirizzo https://")
        if enabled and not url:
            raise ValueError(f"{label}: indica l'indirizzo del servizio prima di attivarlo")
        layers = str(e.get("layers") or "").strip()[:500]
        if enabled and not layers:
            raise ValueError(f"{label}: indica almeno un layer")
        fmt = e.get("format") or "image/png"
        version = e.get("version") or "1.3.0"
        crs = e.get("crs") or "EPSG:3857"
        kind = e.get("kind") or "overlay"
        if fmt not in FORMATS:
            raise ValueError(f"{label}: formato non supportato ({fmt})")
        if version not in VERSIONS:
            raise ValueError(f"{label}: versione WMS non supportata ({version})")
        if crs not in CRSS:
            raise ValueError(f"{label}: sistema di riferimento non supportato ({crs})")
        if kind not in KINDS:
            raise ValueError(f"{label}: tipo non valido ({kind})")
        try:
            minzoom = max(0, min(22, int(e.get("minzoom") or 0)))
        except (TypeError, ValueError):
            raise ValueError(f"{label}: zoom minimo non valido") from None
        out.append({"id": wid, "label": label, "url": url, "layers": layers, "format": fmt, "version": version, "crs": crs,
                    "transparent": bool(e.get("transparent")), "kind": kind, "attribution": str(e.get("attribution") or "").strip()[:300],
                    "minzoom": minzoom, "enabled": enabled})
    return out


def services() -> list[dict]:
    return [s for s in config.load().get("wms") or [] if isinstance(s, dict)]


def find(wms_id: str) -> dict | None:
    """The configured, enabled service with this id, or None. Never builds a URL from caller input."""
    svc = next((s for s in services() if s.get("id") == wms_id), None)
    if not svc or not svc.get("enabled") or not str(svc.get("url") or "").startswith("https://") or not svc.get("layers"):
        return None
    return svc


def public_list() -> list[dict]:
    """Enabled services for the map (no upstream URL needed by the browser)."""
    return [{k: s.get(k) for k in ("id", "label", "kind", "attribution", "transparent", "minzoom", "format")}
            for s in services() if find(str(s.get("id"))) is not None]


_cache: OrderedDict[tuple, tuple[bytes, str]] = OrderedDict()
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _fetch(svc: dict, z: int, x: int, y: int) -> tuple[bytes, str]:
    try:
        r = httpx.get(svc["url"], params=getmap_params(svc, z, x, y), timeout=TIMEOUT_S,
                      headers={"User-Agent": SETTINGS.user_agent}, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise WmsError(f"Servizio WMS non raggiungibile: {type(exc).__name__}") from exc
    ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if r.status_code >= 400:
        raise WmsError(f"Il servizio WMS ha risposto {r.status_code}")
    if not ctype.startswith("image/"):
        # WMS errors come back as XML ServiceExceptionReport with status 200.
        text = r.text[:300] if "xml" in ctype or "text" in ctype else ""
        raise WmsError("Il servizio WMS non ha restituito un'immagine" + (f": {text}" if text else ""))
    return r.content, ctype


def tile(wms_id: str, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    """Image bytes and content type; None when the id is not configured or disabled. Raises WmsError."""
    svc = find(wms_id)
    if svc is None:
        return None
    if not (0 <= z <= 24 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise ValueError("Tassello fuori dai limiti")
    # The key carries the request-shaping fields so editing a service never serves stale tiles.
    key = (svc["id"], svc["url"], svc["layers"], svc.get("format"), svc.get("version"), svc.get("crs"), bool(svc.get("transparent")), z, x, y)
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    out = _fetch(svc, z, x, y)
    with _cache_lock:
        _cache[key] = out
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return out


def test(wms_id: str) -> dict:
    """One GetMap over Italy (z=6) to check the service answers with an image."""
    svc = find(wms_id)
    if svc is None:
        return {"ok": False, "message": "Servizio WMS non configurato o disattivato"}
    try:
        data, ctype = _fetch(svc, 6, 34, 23)
    except WmsError as exc:
        return {"ok": False, "message": str(exc)}
    return {"ok": True, "contentType": ctype, "bytes": len(data), "message": f"Risposta corretta ({ctype}, {len(data)} byte)"}
