"""GTFS static import and GTFS-Realtime vehicle positions."""
from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

import httpx

from app.settings import SETTINGS

ROUTE_TYPES = {0: "tram", 1: "metro", 2: "train", 3: "bus", 4: "ferry", 7: "funicular", 11: "trolleybus", 12: "monorail"}


def _rows(z: zipfile.ZipFile, name: str):
    try:
        with z.open(name) as fh:
            yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", errors="replace"))
    except KeyError:
        return


def _secs(t: str) -> int | None:
    try:
        h, m, s = (int(x) for x in t.strip().split(":"))
        return h * 3600 + m * 60 + s
    except (ValueError, AttributeError):
        return None


def import_gtfs(blob: bytes, source: str) -> dict:
    if len(blob) > SETTINGS.max_upload_bytes:
        raise ValueError("Feed GTFS troppo grande")
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise ValueError("Il file non è uno ZIP GTFS") from exc
    names = set(z.namelist())
    for required in ("routes.txt", "stops.txt", "trips.txt"):
        if required not in names:
            raise ValueError(f"Feed GTFS incompleto: manca {required}")
    if sum(i.file_size for i in z.infolist()) > 1_500 * 1024 * 1024:
        raise ValueError("Feed GTFS troppo grande una volta estratto")

    agencies = [{"id": a.get("agency_id"), "name": a.get("agency_name"), "url": a.get("agency_url")} for a in _rows(z, "agency.txt")]
    stops = {}
    for s in _rows(z, "stops.txt"):
        try:
            stops[s["stop_id"]] = {"id": s["stop_id"], "name": s.get("stop_name") or s["stop_id"], "at": [float(s["stop_lon"]), float(s["stop_lat"])],
                                   "code": s.get("stop_code") or None, "wheelchair": s.get("wheelchair_boarding") == "1"}
        except (KeyError, ValueError):
            continue
    routes = {r["route_id"]: r for r in _rows(z, "routes.txt")}
    trips = {t["trip_id"]: t for t in _rows(z, "trips.txt")}
    shapes: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for p in _rows(z, "shapes.txt"):
        try:
            shapes[p["shape_id"]].append((int(p.get("shape_pt_sequence") or 0), float(p["shape_pt_lon"]), float(p["shape_pt_lat"])))
        except (KeyError, ValueError):
            continue

    # First departure of each trip + stop sequence (stop_times can be large: stream it).
    first_dep: dict[str, int] = {}
    seq: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for st in _rows(z, "stop_times.txt"):
        tid = st.get("trip_id")
        if tid not in trips:
            continue
        try:
            n = int(st.get("stop_sequence") or 0)
        except ValueError:
            continue
        seq[tid].append((n, st.get("stop_id") or ""))
        t = _secs(st.get("departure_time") or st.get("arrival_time") or "")
        if t is not None and (tid not in first_dep or n == 0 or t < first_dep[tid]):
            first_dep[tid] = min(t, first_dep.get(tid, t))

    by_route: dict[str, list[str]] = defaultdict(list)
    for tid, t in trips.items():
        by_route[t["route_id"]].append(tid)

    out_routes = []
    for rid, r in routes.items():
        tids = by_route.get(rid, [])
        shape_id = Counter(trips[t].get("shape_id") for t in tids if trips[t].get("shape_id")).most_common(1)
        line = [[x, y] for _, x, y in sorted(shapes.get(shape_id[0][0], []))] if shape_id else []
        rep = max(tids, key=lambda t: len(seq.get(t, [])), default=None)
        stop_ids = [s for _, s in sorted(seq.get(rep, []))] if rep else []
        if not line:
            line = [stops[s]["at"] for s in stop_ids if s in stops]
        deps = sorted(first_dep[t] for t in tids if t in first_dep and trips[t].get("direction_id", "0") in ("0", ""))
        am = [d for d in deps if 7 * 3600 <= d < 9 * 3600]
        headway = round(120 / len(am), 1) if am else None
        try:
            rtype = ROUTE_TYPES.get(int(r.get("route_type") or 3), "bus")
        except ValueError:
            rtype = "bus"
        out_routes.append({
            "id": rid, "shortName": r.get("route_short_name") or "", "longName": r.get("route_long_name") or "",
            "mode": rtype, "color": "#" + (r.get("route_color") or "5587A2")[-6:], "line": line, "stopIds": stop_ids,
            "tripsPerDay": len(tids), "amPeakHeadwayMin": headway, "firstDeparture": deps[0] if deps else None, "lastDeparture": deps[-1] if deps else None,
        })
    used = {s for r in out_routes for s in r["stopIds"]}
    return {
        "source": source, "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "provenance": "existing",
        "agencies": agencies, "routes": out_routes, "stops": [s for sid, s in stops.items() if sid in used or not used],
    }


def import_gtfs_url(url: str) -> dict:
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("URL non valido")
    with httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": SETTINGS.user_agent}) as c:
        r = c.get(url)
        r.raise_for_status()
    return import_gtfs(r.content, url)


def realtime_vehicles(url: str) -> dict:
    from google.transit import gtfs_realtime_pb2

    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": SETTINGS.user_agent}) as c:
        with c.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > 16 * 1024 * 1024:
                    raise ValueError("Feed GTFS-RT oltre 16 MB")
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(bytes(data))
    if not feed.IsInitialized():
        raise ValueError("Feed GTFS-RT incompleto")
    vehicles = []
    for e in feed.entity:
        if e.HasField("vehicle") and e.vehicle.HasField("position"):
            v = e.vehicle
            import math
            if not math.isfinite(v.position.longitude) or not math.isfinite(v.position.latitude) or not -180 <= v.position.longitude <= 180 or not -90 <= v.position.latitude <= 90:
                continue
            vehicles.append({"id": e.id, "routeId": v.trip.route_id, "tripId": v.trip.trip_id, "label": v.vehicle.label,
                             "at": [v.position.longitude, v.position.latitude], "bearing": v.position.bearing, "speedMps": v.position.speed,
                             "timestamp": v.timestamp})
    from datetime import datetime, timezone
    retrieved = datetime.now(timezone.utc)
    timestamp = feed.header.timestamp if feed.header.HasField("timestamp") else None
    age = max(0, retrieved.timestamp() - timestamp) if timestamp is not None else None
    return {"status": "ok", "provenance": "live", "source": url, "feedTimestamp": timestamp, "retrievedAt": retrieved.isoformat(), "ageS": age, "freshness": "unknown" if age is None else "stale" if age > 300 else "recent", "vehicles": vehicles}
