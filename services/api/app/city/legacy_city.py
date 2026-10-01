"""Convert a DRIP Urban 53.x ``city.json`` into a 1.0 baseline.

53.x stored one edge per OSM node pair (6.409 segments, many ~5 m long). 1.0 roads
run junction-to-junction: chains through degree-2 nodes with identical attributes
are merged, so the physical model gets smooth axes and markings are placed once.

Every legacy edge id is mapped to (road id, reversed) so 53.x scenarios can be
migrated without losing references.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

PEDESTRIAN_CLASSES = {"footway", "path", "steps", "pedestrian", "corridor", "bridleway"}
OSM = {"kind": "osm", "source": "OpenStreetMap contributors (ODbL)", "url": "https://www.openstreetmap.org/copyright"}


def _ll(p: dict) -> list[float]:
    return [round(float(p["lon"]), 7), round(float(p["lat"]), 7)]


def _signature(e: dict) -> tuple:
    return (
        e.get("name") or "",
        e.get("road_class") or "",
        int(e.get("lanes") or 1),
        bool(e.get("oneway")),
        round(float(e.get("width_m") or 0), 1),
        round(float(e.get("speed_kmh") or 0)),
    )


@dataclass
class _Step:
    edge: dict
    reversed: bool  # traversed v -> u


def _provenance(p: dict | None, fallback_kind: str) -> dict:
    if not p:
        return {"kind": fallback_kind, "source": "DRIP Urban 53.x"}
    accuracy = (p.get("accuracy") or "").lower()
    kind = {"measured": "measured", "estimated": "estimated", "derived": "derived"}.get(accuracy, fallback_kind)
    if "openstreetmap" in (p.get("source") or "").lower() and kind == "derived":
        kind = "osm"
    out = {"kind": kind, "source": p.get("source") or "DRIP Urban 53.x"}
    if p.get("uncertainty_m") is not None:
        out["uncertaintyM"] = p["uncertainty_m"]
    return out


def _lanes_and_section(road_id: str, e: dict, reversed_: bool) -> tuple[list[dict], dict]:
    cls = e.get("road_class") or "residential"
    sec = e.get("section") or {}
    flip = {"forward": "backward", "backward": "forward"}
    if cls in PEDESTRIAN_CLASSES:
        width = float(e.get("width_m") or 2.0)
        lane = {"id": f"{road_id}:p0", "index": 0, "direction": "forward", "widthM": width,
                "modes": ["walk", "bike"] if cls == "path" else ["walk"], "turns": ["through"]}
        return [lane], {"elements": [{"id": f"{road_id}:s0", "kind": "sidewalk", "widthM": width, "laneId": lane["id"]}]}

    profile = list(e.get("lane_profile") or sec.get("lane_profile") or [])
    if not profile:
        n = max(1, int(e.get("lanes") or 1))
        w = float(e.get("width_m") or 3.0 * n) / n
        profile = [{"index": i, "direction": "forward" if (e.get("oneway") or i < (n + 1) // 2) else "backward", "width_m": w} for i in range(n)]
    lanes_fw = [p for p in profile if (flip.get(p.get("direction"), p.get("direction")) if reversed_ else p.get("direction")) != "backward"]
    lanes_bw = [p for p in profile if p not in lanes_fw]
    modes = sorted(set(e.get("modes") or ["car", "bus", "truck", "bike", "emergency"]) - {"walk"}) or ["car"]
    lanes: list[dict] = []
    # index 0 = rightmost lane looking along the axis (forward lanes first, then backward from the far side).
    for i, p in enumerate(lanes_fw):
        lanes.append({"id": f"{road_id}:f{i}", "direction": "forward", "src": p})
    for i, p in enumerate(lanes_bw):
        lanes.append({"id": f"{road_id}:b{i}", "direction": "backward", "src": p})
    # Right-to-left order across the carriageway: forward lanes (rightmost first), then backward lanes
    # from the median outwards — i.e. the last backward lane is the leftmost.
    ordered: list[dict] = []
    for i, l in enumerate(lanes):
        p = l.pop("src")
        turn = p.get("turn")
        l.update({
            "index": i,
            "widthM": round(float(p.get("width_m") or 3.0), 2),
            "modes": ["bus"] if p.get("bus_only") else modes,
            "turns": [t for t in str(turn).split(";") if t in ("left", "through", "right")] if turn else ["through"],
        })
        if p.get("bus_only"):
            l["restriction"] = "bus_only"
            l["priority"] = "transit"
        if p.get("speed_kmh"):
            l["speedKmh"] = float(p["speed_kmh"])
        ordered.append(l)

    def side(name: str) -> str:
        if not reversed_:
            return name
        return name.replace("left", "@").replace("right", "left").replace("@", "right")

    elements: list[dict] = []

    def add(kind: str, width: float, suffix: str, **extra: Any) -> None:
        if width and width > 0.05:
            elements.append({"id": f"{road_id}:{suffix}", "kind": kind, "widthM": round(float(width), 2), **extra})

    add("sidewalk", sec.get(side("sidewalk_left") + "_m") or 0, "swl")
    add("parking", sec.get(side("parking_left") + "_m") or 0, "pkl")
    add("cycle", sec.get(side("cycle_left") + "_m") or 0, "cyl")
    lanes_left_to_right = sorted(ordered, key=lambda l: -l["index"])
    median = float(sec.get("median_m") or 0)
    for l in lanes_left_to_right:
        if median and l["direction"] == "forward" and not any(x["kind"] == "median" for x in elements):
            add("median", median, "med")
        add("bus" if l.get("restriction") == "bus_only" else "lane", l["widthM"], f"e{l['id'].split(':')[-1]}", laneId=l["id"])
    add("cycle", sec.get(side("cycle_right") + "_m") or 0, "cyr")
    add("parking", sec.get(side("parking_right") + "_m") or 0, "pkr")
    add("sidewalk", sec.get(side("sidewalk_right") + "_m") or 0, "swr")
    return ordered, {"elements": elements}


def convert_city(city: dict, baseline_id: str, name: str, bbox: list[float] | None = None) -> tuple[dict, dict[str, dict]]:
    """Return (baseline, legacy_edge_map)."""
    nodes_src = {n["id"]: _ll(n["point"]) for n in city.get("nodes", [])}
    edges = [e for e in city.get("edges", []) if len(e.get("geometry") or []) >= 2]
    adj: dict[str, list[dict]] = defaultdict(list)
    for e in edges:
        adj[e["u"]].append(e)
        adj[e["v"]].append(e)

    def through(node: str) -> bool:
        inc = adj[node]
        if len(inc) != 2 or inc[0] is inc[1]:
            return False
        a, b = inc
        if _signature(a) != _signature(b):
            return False
        if a.get("oneway"):
            # Direction must chain: one edge enters, the other leaves.
            return (a["v"] == node) != (b["v"] == node)
        return True

    visited: set[str] = set()
    roads: dict[str, dict] = {}
    edge_map: dict[str, dict] = {}
    used_nodes: set[str] = set()

    def walk(start: str, first: dict) -> list[_Step]:
        steps: list[_Step] = []
        node, edge = start, first
        while True:
            rev = edge["v"] == node and edge["u"] != node
            steps.append(_Step(edge, rev))
            visited.add(edge["id"])
            node = edge["u"] if rev else edge["v"]
            if node == start or not through(node):
                return steps
            nxt = [x for x in adj[node] if x is not edge]
            if not nxt or nxt[0]["id"] in visited:
                return steps
            edge = nxt[0]

    starts = [n for n in adj if not through(n)]
    for start in starts + list(adj.keys()):
        for e in adj[start]:
            if e["id"] in visited:
                continue
            steps = walk(start, e)
            if all(s.reversed for s in steps) and steps[0].edge.get("oneway"):
                # Keep the axis along the legal direction of a one-way chain.
                steps = [_Step(s.edge, False) for s in reversed(steps)]
            first = steps[0]
            rid = "r:" + first.edge["id"].removeprefix("osm:")
            axis: list[list[float]] = []
            for s in steps:
                pts = [_ll(p) for p in s.edge["geometry"]]
                if s.reversed:
                    pts.reverse()
                axis.extend(pts if not axis else pts[1:])
            a_node = first.edge["v"] if first.reversed else first.edge["u"]
            last = steps[-1]
            b_node = last.edge["u"] if last.reversed else last.edge["v"]
            src = first.edge
            lanes, section = _lanes_and_section(rid, src, first.reversed)
            oneway = "no"
            if src.get("oneway"):
                oneway = "backward" if first.reversed else "forward"
            tags = {k: str(v) for k, v in (src.get("tags") or {}).items() if not k.startswith("drip_")}
            roads[rid] = {
                "id": rid,
                "from": a_node,
                "to": b_node,
                "name": src.get("name") or "",
                "roadClass": src.get("road_class") or "residential",
                "axis": axis,
                "oneway": oneway,
                "speedKmh": float(src.get("speed_kmh") or 50),
                "lanes": lanes,
                "section": section,
                "provenance": {
                    "geometry": _provenance(src.get("geometry_provenance"), "osm"),
                    "width": _provenance(src.get("width_provenance"), "estimated"),
                },
                "tags": tags,
            }
            used_nodes.update((a_node, b_node))
            for order, s in enumerate(steps):
                edge_map[s.edge["id"]] = {"roadId": rid, "reversed": s.reversed, "order": order}

    nodes = {nid: {"id": nid, "at": nodes_src[nid]} for nid in used_nodes if nid in nodes_src}

    buildings = {}
    for b in city.get("buildings", []):
        fp = [_ll(p) for p in b.get("footprint") or []]
        if len(fp) < 3:
            continue
        buildings[b["id"]] = {
            "id": b["id"], "footprint": fp,
            "heightM": float(b.get("height_m") or 10.5), "minHeightM": float(b.get("min_height_m") or 0),
            **({"name": b["name"]} if b.get("name") else {}),
            "provenance": _provenance(b.get("provenance"), "osm"),
        }

    features: dict[str, dict] = {}
    assets: dict[str, dict] = {}
    asset_types = {"traffic_signal": "signal.vehicle", "transit_stop": "transit.stop"}
    category_assets = {"tree": "vegetation.tree", "bench": "furniture.bench", "charging_station": "furniture.ev_charger"}
    for f in city.get("features", []):
        coords = [_ll(p) for p in f.get("points") or []]
        if not coords:
            continue
        prov = _provenance(f.get("provenance"), "osm")
        atype = asset_types.get(f.get("kind")) or (category_assets.get((f.get("properties") or {}).get("natural") or f.get("category") or "") if f.get("geometry_type") == "point" else None)
        if atype and f.get("geometry_type") == "point":
            assets[f["id"]] = {"id": f["id"], "type": atype, "at": coords[0], "rotationDeg": 0, "state": "existing",
                               "properties": {k: v for k, v in (f.get("properties") or {}).items()}, "provenance": prov,
                               **({"name": f["name"]} if f.get("name") else {})}
            continue
        features[f["id"]] = {
            "id": f["id"], "kind": f.get("kind") or "feature", "geometry": f.get("geometry_type") or "point",
            "coords": coords, "properties": f.get("properties") or {}, "provenance": prov,
            **({"category": f["category"]} if f.get("category") else {}),
            **({"name": f["name"]} if f.get("name") else {}),
        }

    if not bbox:
        xs = [p[0] for p in nodes_src.values()]
        ys = [p[1] for p in nodes_src.values()]
        bbox = [min(xs), min(ys), max(xs), max(ys)]
    baseline = {
        "id": baseline_id,
        "name": name,
        "bbox": bbox,
        "origin": [round((bbox[0] + bbox[2]) / 2, 7), round((bbox[1] + bbox[3]) / 2, 7)],
        "nodes": nodes,
        "roads": roads,
        "buildings": buildings,
        "features": features,
        "assets": assets,
        "sources": [OSM],
    }
    return baseline, edge_map
