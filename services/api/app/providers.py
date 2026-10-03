"""External data providers. Keys come only from the local settings file — never from code.

Every response carries its provenance. Without a key the endpoint answers
``{"status": "not_configured"}`` and the UI falls back to an *estimate* that is
labelled as such — never presented as live data.
"""
from __future__ import annotations

import json
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
    return val


def here_flow(bbox: list[float]) -> dict:
    key = provider_secret("here")
    if not key:
        return {"status": "not_configured", "provider": "HERE", "features": []}
    w, s, e, n = bbox

    def fetch():
        r = httpx.get("https://data.traffic.hereapi.com/v7/flow", timeout=20,
                      params={"in": f"bbox:{w},{s},{e},{n}", "locationReferencing": "shape", "apiKey": key})
        r.raise_for_status()
        data = r.json()
        feats = []
        for res in data.get("results", []):
            cur = res.get("currentFlow") or {}
            for link in ((res.get("location") or {}).get("shape") or {}).get("links", []):
                pts = [[p["lng"], p["lat"]] for p in link.get("points", [])]
                if len(pts) >= 2:
                    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": pts}, "properties": {
                        "speedKmh": round((cur.get("speed") or 0) * 3.6, 1), "freeFlowKmh": round((cur.get("freeFlow") or 0) * 3.6, 1),
                        "jamFactor": cur.get("jamFactor"), "confidence": cur.get("confidence"), "traversability": cur.get("traversability")}})
        return {"status": "ok", "provider": "HERE Traffic API v7", "provenance": "live", "capturedAt": data.get("sourceUpdated") or datetime.now(timezone.utc).isoformat(),
                "features": feats}

    try:
        return _cached(f"here:{w:.4f},{s:.4f},{e:.4f},{n:.4f}", 120, fetch)
    except httpx.HTTPError as exc:
        return {"status": "error", "provider": "HERE", "message": redact(str(exc))[:300], "features": []}


def weather_and_air(lat: float, lon: float) -> dict:
    """Open-Meteo forecast + CAMS air quality (modelled, not measured at street level)."""

    def fetch():
        with httpx.Client(timeout=15, headers={"User-Agent": SETTINGS.user_agent}) as c:
            w = c.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": lat, "longitude": lon, "timezone": "Europe/Rome",
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,precipitation",
                "hourly": "temperature_2m", "forecast_days": 1}).json()
            a = c.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={
                "latitude": lat, "longitude": lon, "timezone": "Europe/Rome",
                "current": "pm10,pm2_5,nitrogen_dioxide,ozone,european_aqi"}).json()
        return {
            "status": "ok",
            "weather": {"values": w.get("current"), "units": w.get("current_units"), "provenance": "modelled",
                        "source": "Open-Meteo (modelli meteorologici nazionali ed ECMWF)", "url": "https://open-meteo.com"},
            "air": {"values": a.get("current"), "units": a.get("current_units"), "provenance": "modelled",
                    "source": "Copernicus CAMS European air quality forecast via Open-Meteo", "url": "https://atmosphere.copernicus.eu",
                    "resolutionKm": 11, "note": "Modello a ~11 km: valore di fondo urbano, non misura a livello strada"},
        }

    try:
        return _cached(f"env:{lat:.3f},{lon:.3f}", 900, fetch)
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        return {"status": "error", "message": f"Servizio meteo/aria non raggiungibile: {exc}"[:300]}


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
