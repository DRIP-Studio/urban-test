"""External data providers. Keys come only from the local settings file — never from code.

Every response carries its provenance. Without a key the endpoint answers
``{"status": "not_configured"}`` and the UI falls back to an *estimate* that is
labelled as such — never presented as live data.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.settings import SETTINGS
from app.storage import atomic_write_json, read_json

PROVIDERS = {
    "here": {"label": "HERE Traffic API v7", "kind": "key", "use": "Traffico in tempo reale (flow + incidenti)"},
    "google": {"label": "Google Maps Platform", "kind": "key", "use": "Map Tiles API: basemap Google Satellite nella mappa 2D"},
    "gtfs_rt": {"label": "GTFS-Realtime", "kind": "url", "use": "Posizioni veicoli TPL in tempo reale"},
    "gemini": {"label": "Google Gemini", "kind": "key", "use": "Elios, l'assistente AI: capisce le richieste e modifica il progetto"},
}
_cache: dict[str, tuple[float, Any]] = {}
_health: dict[str, dict] = {}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _capture_time(value: Any) -> str | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def _number(value: Any, maximum: float) -> float | None:
    return float(value) if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= maximum else None


def _provider_get(name: str, url: str, **kwargs) -> httpx.Response:
    """Bounded retries for idempotent reads; rate-limit cooldown is not bypassed by UI refresh."""
    health = _health.setdefault(name, {})
    if health.get("retryAfterEpoch", 0) > time.time():
        raise ValueError("Limite richieste del provider: attendere il termine indicato")
    started = time.monotonic()
    for attempt in range(2):
        try:
            response = httpx.get(url, timeout=12, **kwargs)
            if response.status_code == 429:
                try:
                    delay = max(1, min(3600, float(response.headers.get("Retry-After", 60))))
                except ValueError:
                    delay = 60
                health["retryAfterEpoch"] = time.time() + delay
            response.raise_for_status()
            health.update(connected=True, lastSuccess=_utc_now(), lastError=None, latencyMs=round((time.monotonic()-started)*1000), rateLimited=False)
            return response
        except httpx.HTTPError as exc:
            code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            health.update(connected=False, lastError={"at": _utc_now(), "message": redact(str(exc))[:300]}, latencyMs=round((time.monotonic()-started)*1000), rateLimited=code == 429)
            if attempt == 0 and (code is None or code in (502,503,504)):
                time.sleep(.15)
                continue
            raise
    raise RuntimeError("Provider request incomplete")


def _path():
    return SETTINGS.settings_dir / "providers.json"


def _load() -> dict:
    return read_json(_path(), {}) or {}


def provider_secret(name: str) -> str | None:
    v = (_load().get(name) or {}).get("value")
    return v or None


def redact(text: str) -> str:
    """Removes every configured secret from a message (httpx errors echo the request URL, keys included)."""
    for key, meta in PROVIDERS.items():
        v = provider_secret(key)
        if v and meta["kind"] != "url" and len(v) >= 6:
            text = text.replace(v, "[chiave]")
    return text


def status() -> list[dict]:
    data = _load()
    out = []
    for key, meta in PROVIDERS.items():
        v = (data.get(key) or {}).get("value") or ""
        out.append({
            "id": key, **meta, "configured": bool(v),
            "hint": (v[:3] + "…" + v[-4:]) if len(v) > 10 and meta["kind"] != "url" else (v if meta["kind"] == "url" else ""),
            "lastTest": (data.get(key) or {}).get("lastTest"),
            "health": _health.get(key, {}),
        })
    return out


def save(name: str, value: str | None) -> None:
    if name not in PROVIDERS:
        raise ValueError("Provider sconosciuto")
    value = (value or "").strip()
    if len(value) > 2000 or any(c in value for c in "\r\n\t"):
        raise ValueError("Valore non valido")
    data = _load()
    if value:
        data[name] = {"value": value, "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    else:
        data.pop(name, None)
    atomic_write_json(_path(), data)
    _cache.clear()


def _record_test(name: str, ok: bool, message: str) -> dict:
    data = _load()
    entry = data.get(name) or {}
    entry["lastTest"] = {"ok": ok, "message": message[:300], "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    data[name] = entry
    atomic_write_json(_path(), data)
    return entry["lastTest"]


def test(name: str) -> dict:
    key = provider_secret(name)
    if not key:
        return {"ok": False, "message": "Chiave non configurata"}
    try:
        if name == "here":
            r = httpx.get("https://data.traffic.hereapi.com/v7/flow", params={"in": "circle:40.9416,14.2745;r=200", "locationReferencing": "shape", "apiKey": key}, timeout=12)
        elif name == "google":
            # The same call the satellite basemap makes, so a passing test means the basemap works.
            r = httpx.post("https://tile.googleapis.com/v1/createSession", params={"key": key}, timeout=12,
                           json={"mapType": "satellite", "language": "it-IT", "region": "IT"})
        elif name == "gtfs_rt":
            r = httpx.get(key, timeout=12)
        elif name == "gemini":
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": key}, timeout=12)
        else:
            return {"ok": False, "message": "Provider sconosciuto"}
        ok = r.status_code < 400
        return _record_test(name, ok, "Connessione riuscita" if ok else redact(f"HTTP {r.status_code}: {r.text[:160]}"))
    except httpx.HTTPError as exc:
        return _record_test(name, False, redact(f"Rete: {exc}"))


def _cached(key: str, ttl: float, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    while len(_cache) > 128:
        _cache.pop(next(iter(_cache)))
    return val


def here_flow(bbox: list[float]) -> dict:
    key = provider_secret("here")
    if not key:
        return {"status": "not_configured", "provider": "HERE", "features": []}
    w, s, e, n = bbox

    def fetch():
        r = _provider_get("here", "https://data.traffic.hereapi.com/v7/flow",
                      params={"in": f"bbox:{w},{s},{e},{n}", "locationReferencing": "shape", "apiKey": key})
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise ValueError("Risposta traffico priva dell’elenco delle osservazioni")
        captured_at = _capture_time(data.get("sourceUpdated"))
        retrieved_at = _utc_now()
        feats = []
        for ri, res in enumerate(data["results"]):
            cur = res.get("currentFlow") or {}
            speed, free = _number(cur.get("speed"), 90), _number(cur.get("freeFlow"), 90)
            if speed is None and cur.get("traversability") != "closed":
                continue
            for li, link in enumerate(((res.get("location") or {}).get("shape") or {}).get("links", [])):
                pts = [[p.get("lng"), p.get("lat")] for p in link.get("points", [])]
                if any(not all(isinstance(v, (int,float)) and math.isfinite(v) for v in p) or abs(p[0])>180 or abs(p[1])>90 for p in pts):
                    continue
                if len(pts) >= 2:
                    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": pts}, "properties": {
                        "id": f"here:{ri}:{li}", "capturedAt": captured_at, "retrievedAt": retrieved_at,
                        "speedKmh": round(speed * 3.6, 1) if speed is not None else None, "freeFlowKmh": round(free*3.6,1) if free is not None else None,
                        "flowVph": None, "densityVehKm": None, "jamFactor": _number(cur.get("jamFactor"), 10), "confidence": _number(cur.get("confidence"), 1), "traversability": cur.get("traversability")}})
        age = (datetime.now(timezone.utc)-datetime.fromisoformat(captured_at)).total_seconds() if captured_at else None
        return {"status": "ok", "provider": "HERE Traffic API v7", "provenance": "live", "capturedAt": captured_at, "retrievedAt": retrieved_at,
                "freshness": "unknown" if age is None else "fresh" if -30 <= age <= 300 else "stale", "features": feats}

    try:
        return _cached(f"here:{w:.4f},{s:.4f},{e:.4f},{n:.4f}", 120, fetch)
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError) as exc:
        _health.setdefault("here", {}).update(connected=False,lastError={"at":_utc_now(),"message":redact(str(exc))[:300]})
        return {"status": "error", "provider": "HERE", "message": redact(str(exc))[:300], "features": []}


INCIDENT_IT = {"accident": "Incidente", "congestion": "Coda", "construction": "Lavori", "disabledVehicle": "Veicolo in panne",
               "massTransit": "Trasporto pubblico", "plannedEvent": "Evento programmato", "roadHazard": "Pericolo",
               "roadClosure": "Strada chiusa", "laneRestriction": "Corsia chiusa", "weather": "Meteo", "other": "Altro"}


def here_incidents(bbox: list[float]) -> dict:
    """HERE Traffic v7 incidents (accidents, closures, works) with their shape; same key as the flow."""
    key = provider_secret("here")
    if not key:
        return {"status": "not_configured", "provider": "HERE", "features": []}
    w, s, e, n = bbox

    def fetch():
        r = _provider_get("here", "https://data.traffic.hereapi.com/v7/incidents",
                      params={"in": f"bbox:{w},{s},{e},{n}", "locationReferencing": "shape", "apiKey": key})
        r.raise_for_status()
        feats = []
        data = r.json()
        if not isinstance(data,dict) or not isinstance(data.get("results"),list):
            raise ValueError("Risposta incidenti priva dell’elenco atteso")
        for res in data["results"]:
            d = res.get("incidentDetails") or {}
            pts = [[p["lng"], p["lat"]] for link in ((res.get("location") or {}).get("shape") or {}).get("links", []) for p in link.get("points", [])]
            if not pts:
                continue
            kind = d.get("type") or "other"
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": pts} if len(pts) > 1 else {"type": "Point", "coordinates": pts[0]},
                          "properties": {"id": str(d.get("id") or len(feats)), "kind": kind, "label": INCIDENT_IT.get(kind, kind),
                                         "description": ((d.get("description") or {}).get("value") or (d.get("summary") or {}).get("value") or "")[:300],
                                         "criticality": d.get("criticality"), "roadClosed": bool(d.get("roadClosed")),
                                         "start": d.get("startTime"), "end": d.get("endTime"), "capturedAt": _capture_time(d.get("lastUpdated") or data.get("sourceUpdated")), "retrievedAt": _utc_now()}})
        return {"status": "ok", "provider": "HERE Traffic API v7 (incidents)", "provenance": "live", "retrievedAt": datetime.now(timezone.utc).isoformat(), "features": feats}

    try:
        return _cached(f"herei:{w:.4f},{s:.4f},{e:.4f},{n:.4f}", 120, fetch)
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError) as exc:
        return {"status": "error", "provider": "HERE", "message": redact(str(exc))[:300], "features": []}


def weather_and_air(lat: float, lon: float) -> dict:
    """Independent model products: an unavailable CAMS service does not erase usable weather."""
    if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
        return {"status": "error", "message": "Coordinate meteo non valide"}

    def product(kind: str) -> dict:
        weather = kind == "weather"
        url = "https://api.open-meteo.com/v1/forecast" if weather else "https://air-quality-api.open-meteo.com/v1/air-quality"
        variables = "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code,cloud_cover" if weather else "pm10,pm2_5,nitrogen_dioxide,ozone,european_aqi"
        response = _provider_get(kind, url, params={"latitude": lat, "longitude": lon, "timezone": "UTC", "timeformat": "unixtime", "current": variables})
        payload = response.json()
        values = payload.get("current") if isinstance(payload, dict) else None
        if not isinstance(values, dict):
            raise ValueError("Risposta ambientale priva dei valori attesi")
        raw_time = values.get("time")
        valid_at = datetime.fromtimestamp(raw_time, timezone.utc).isoformat() if isinstance(raw_time, (int, float)) and not isinstance(raw_time, bool) and math.isfinite(raw_time) and 0 < raw_time < 253402300799 else _capture_time(raw_time)
        source = "Open-Meteo (modelli meteorologici nazionali ed ECMWF)" if weather else "Copernicus CAMS via Open-Meteo"
        return {"values": values, "units": payload.get("current_units") or {}, "provenance": "modelled", "source": source,
                "url": "https://open-meteo.com/en/docs" if weather else "https://atmosphere.copernicus.eu",
                "validAt": valid_at, "retrievedAt": _utc_now(),
                **({} if weather else {"resolutionKm": 11, "note": "Modello di fondo urbano, non misura a livello strada"})}

    def fetch():
        from concurrent.futures import ThreadPoolExecutor
        result: dict[str, Any] = {}
        errors = {}
        with ThreadPoolExecutor(max_workers=2) as executor:
            jobs = {kind: executor.submit(product, kind) for kind in ("weather", "air")}
            for kind, job in jobs.items():
                try:
                    result[kind] = job.result()
                except (httpx.HTTPError, ValueError, TypeError, AttributeError, OverflowError) as exc:
                    errors[kind] = redact(str(exc))[:300]
                    _health.setdefault(kind, {}).update(connected=False, lastError={"at": _utc_now(), "message": errors[kind]})
        result["status"] = "ok" if not errors else "partial" if result else "error"
        result["errors"] = errors
        result["message"] = " · ".join(f"{kind}: {message}" for kind, message in errors.items())
        result["health"] = {kind: dict(_health.get(kind, {})) for kind in ("weather", "air")}
        return result

    cache_key = f"env:{lat:.3f},{lon:.3f}"
    result = _cached(cache_key, 900, fetch)
    # Failed products can recover immediately; successful full responses retain their TTL.
    if result.get("status") != "ok":
        _cache.pop(cache_key, None)
    return result


def geocode(q: str, bbox: list[float] | None) -> list[dict]:
    params: dict[str, Any] = {"q": q, "format": "jsonv2", "limit": 8, "addressdetails": 0}
    if bbox:
        w, s, e, n = bbox
        params.update(viewbox=f"{w},{n},{e},{s}", bounded=0)
    r = httpx.get("https://nominatim.openstreetmap.org/search", params=params, timeout=12, headers={"User-Agent": SETTINGS.user_agent})
    r.raise_for_status()
    return [{"name": x.get("display_name"), "at": [float(x["lon"]), float(x["lat"])], "type": x.get("type"),
             "bbox": [float(x["boundingbox"][2]), float(x["boundingbox"][0]), float(x["boundingbox"][3]), float(x["boundingbox"][1])]}
            for x in r.json()]


def google_tile_session(map_type: str) -> dict:
    key = provider_secret("google")
    if not key:
        return {"status": "not_configured"}

    def fetch():
        r = httpx.post(f"https://tile.googleapis.com/v1/createSession?key={key}", timeout=12,
                       json={"mapType": map_type, "language": "it-IT", "region": "IT", **({"layerTypes": ["layerRoadmap"]} if map_type == "satellite" else {})})
        r.raise_for_status()
        return {"status": "ok", **r.json()}

    try:
        return _cached(f"gsession:{map_type}", 3600 * 6, fetch)
    except httpx.HTTPError as exc:
        return {"status": "error", "message": redact(str(exc))[:300]}


def google_tile(map_type: str, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    key = provider_secret("google")
    sess = google_tile_session(map_type)
    if not key or sess.get("status") != "ok":
        return None
    r = httpx.get(f"https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}", params={"session": sess["session"], "key": key}, timeout=15)
    if r.status_code >= 400:
        return None
    return r.content, r.headers.get("content-type", "image/png")
