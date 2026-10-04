"""Large projects (whole cities up to 5 000 km²): the baseline is split in 2 km tiles so that the
workstation loads only the «zona di lavoro», plus a light overview of every road for the whole area.

projects/<id>/tiles/index.json          {"cellDeg": [dx, dy], "bbox": [...], "cells": {"i_j": n}}
projects/<id>/tiles/<i>_<j>.json.gz     subset of the baseline whose objects fall in that cell
projects/<id>/overview.json.gz          GeoJSON lines of all roads (simplified), class and name
"""
from __future__ import annotations

import math
from pathlib import Path

from app.storage import atomic_write_json, read_json

#: Above this area (or this many roads) a project is «large»: tiled loading and a work area.
LARGE_KM2 = 40.0
LARGE_ROADS = 15000
CELL_KM = 2.0
#: Largest work area loaded at once in the workstation.
MAX_WORK_KM2 = 36.0


def area_km2(b: list[float]) -> float:
    w, s, e, n = b
    lat = math.radians((s + n) / 2)
    return abs(e - w) * 111.32 * math.cos(lat) * abs(n - s) * 110.57


def is_large(baseline: dict) -> bool:
    return area_km2(baseline["bbox"]) > LARGE_KM2 or len(baseline.get("roads") or {}) > LARGE_ROADS


def _cell_deg(bbox: list[float]) -> tuple[float, float]:
    lat = math.radians((bbox[1] + bbox[3]) / 2)
    return CELL_KM / (111.32 * math.cos(lat)), CELL_KM / 110.57


def _cell(lon: float, lat: float, bbox: list[float], cd: tuple[float, float]) -> str:
    return f"{int((lon - bbox[0]) // cd[0])}_{int((lat - bbox[1]) // cd[1])}"


def _mid(pts: list) -> tuple[float, float]:
    p = pts[len(pts) // 2]
    return float(p[0]), float(p[1])


def _centroid(pts: list) -> tuple[float, float]:
    return sum(float(p[0]) for p in pts) / len(pts), sum(float(p[1]) for p in pts) / len(pts)


def _simplify(pts: list, tol: float) -> list:
    """Douglas–Peucker on lon/lat (tol in degrees), iterative."""
    if len(pts) <= 2:
        return [[round(p[0], 6), round(p[1], 6)] for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a][0], pts[a][1]
        bx, by = pts[b][0], pts[b][1]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-12
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol and bi > 0:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [[round(p[0], 6), round(p[1], 6)] for p, k in zip(pts, keep) if k]


def build_tiles(d: Path, baseline: dict) -> dict:
    """Writes tiles, index and overview for a large baseline; returns the index."""
    bbox = [float(x) for x in baseline["bbox"]]
    cd = _cell_deg(bbox)
    cells: dict[str, dict] = {}

    def cell(key: str) -> dict:
        return cells.setdefault(key, {"roads": {}, "nodes": {}, "buildings": {}, "features": {}, "assets": {}})

    nodes = baseline.get("nodes") or {}
    for rid, r in (baseline.get("roads") or {}).items():
        c = cell(_cell(*_mid(r["axis"]), bbox, cd))
        c["roads"][rid] = r
        for nid in (r.get("from"), r.get("to")):
            if nid in nodes:
                c["nodes"][nid] = nodes[nid]
    for bid, b in (baseline.get("buildings") or {}).items():
        if b.get("footprint"):
            cell(_cell(*_centroid(b["footprint"]), bbox, cd))["buildings"][bid] = b
    for fid, f in (baseline.get("features") or {}).items():
        pts = f.get("coords") or ([f["at"]] if f.get("at") else None)
        if pts:
            cell(_cell(*_centroid(pts), bbox, cd))["features"][fid] = f
    for aid, a in (baseline.get("assets") or {}).items():
        if a.get("at"):
            cell(_cell(float(a["at"][0]), float(a["at"][1]), bbox, cd))["assets"][aid] = a
    t = d / "tiles"
    t.mkdir(parents=True, exist_ok=True)
    for old in t.glob("*.json.gz"):
        old.unlink()
    for key, c in cells.items():
        atomic_write_json(t / f"{key}.json.gz", c, gz=True)
    index = {"cellDeg": list(cd), "bbox": bbox, "cells": {k: len(v["roads"]) + len(v["buildings"]) for k, v in cells.items()},
             "roads": len(baseline.get("roads") or {}), "buildings": len(baseline.get("buildings") or {})}
    atomic_write_json(t / "index.json", index)
    # Overview: every road as a light line (≈ 1 m tolerance), for the whole-city view at low zoom.
    tol = 1.0 / 111000
    feats = [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": _simplify(r["axis"], tol)},
              "properties": {"c": r.get("roadClass") or "", "n": r.get("name") or ""}}
             for r in (baseline.get("roads") or {}).values() if len(r.get("axis") or []) >= 2]
    atomic_write_json(d / "overview.json.gz", {"type": "FeatureCollection", "features": feats}, gz=True)
    return index


def clamp_work_area(bbox: list[float], full: list[float]) -> list[float]:
    """Work area inside the project and at most MAX_WORK_KM2 (shrunk around its centre)."""
    w, s, e, n = max(bbox[0], full[0]), max(bbox[1], full[1]), min(bbox[2], full[2]), min(bbox[3], full[3])
    if w >= e or s >= n:
        cx, cy = (full[0] + full[2]) / 2, (full[1] + full[3]) / 2
        w, s, e, n = cx - 0.01, cy - 0.01, cx + 0.01, cy + 0.01
    a = area_km2([w, s, e, n])
    if a > MAX_WORK_KM2:
        k = math.sqrt(MAX_WORK_KM2 / a)
        cx, cy, hw, hh = (w + e) / 2, (s + n) / 2, (e - w) / 2 * k, (n - s) / 2 * k
        w, s, e, n = cx - hw, cy - hh, cx + hw, cy + hh
    return [w, s, e, n]


def default_work_area(full: list[float]) -> list[float]:
    cx, cy = (full[0] + full[2]) / 2, (full[1] + full[3]) / 2
    lat = math.radians(cy)
    hw, hh = 1.5 / (111.32 * math.cos(lat)), 1.5 / 110.57
    return clamp_work_area([cx - hw, cy - hh, cx + hw, cy + hh], full)


def subset(d: Path, base_meta: dict, bbox: list[float]) -> dict:
    """Baseline restricted to the work area: the tiles it touches, plus one ring of neighbours for
    roads that start outside it. Origin at the work-area centre."""
    index = read_json(d / "tiles" / "index.json")
    if not index:
        raise FileNotFoundError("Indice dei tasselli mancante")
    full, cd = index["bbox"], index["cellDeg"]
    i0, j0 = int((bbox[0] - full[0]) // cd[0]) - 1, int((bbox[1] - full[1]) // cd[1]) - 1
    i1, j1 = int((bbox[2] - full[0]) // cd[0]) + 1, int((bbox[3] - full[1]) // cd[1]) + 1
    out = {"roads": {}, "nodes": {}, "buildings": {}, "features": {}, "assets": {}}
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            c = read_json(d / "tiles" / f"{i}_{j}.json.gz")
            if c:
                for k in out:
                    out[k].update(c.get(k) or {})
    # Keep only what touches the work area (+150 m), so the loaded network stays light.
    lat = math.radians((bbox[1] + bbox[3]) / 2)
    mx, my = 0.15 / (111.32 * math.cos(lat)), 0.15 / 110.57
    W, S, E, N = bbox[0] - mx, bbox[1] - my, bbox[2] + mx, bbox[3] + my

    def inside(p) -> bool:
        return W <= p[0] <= E and S <= p[1] <= N
    roads = {k: r for k, r in out["roads"].items() if any(inside(p) for p in r["axis"])}
    nodes = {k: n for k, n in out["nodes"].items() if any(r.get("from") == k or r.get("to") == k for r in roads.values())}
    return {
        **{k: v for k, v in base_meta.items() if k not in ("roads", "nodes", "buildings", "features", "assets")},
        "bbox": bbox, "origin": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], "fullBbox": full,
        "roads": roads, "nodes": nodes,
        "buildings": {k: b for k, b in out["buildings"].items() if any(inside(p) for p in b["footprint"])},
        "features": {k: f for k, f in out["features"].items() if any(inside(p) for p in (f.get("coords") or [f.get("at")]) if p)},
        "assets": {k: a for k, a in out["assets"].items() if inside(a["at"])},
    }
