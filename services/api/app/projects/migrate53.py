"""Migrate DRIP Urban 28–53 data (``scenarios.json``) into a 1.0 project.

Read-only on the legacy folder. Every legacy object is either converted into a
1.0 operation or listed in the migration report with the reason — nothing is
dropped silently. The resulting operations are validated again by the client
core when the scenario is opened (failed ops stay visible as issues).
"""
from __future__ import annotations

import gzip
import json
import math
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.city.legacy_city import _lanes_and_section
from app.settings import SETTINGS
from app.storage import read_json

STOCK_SCENARIOS = {"v25-integration", "v24-plan-test"}  # QA fixtures shipped by 24/25
NOW = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")  # noqa: E731

FURNITURE = {
    "tree": "vegetation.tree", "bike_station": "furniture.bike_station", "hydrant": "furniture.hydrant",
    "fountain_urban": "furniture.fountain", "green_shelter": "furniture.green_shelter", "digital_stop": "furniture.transit_display",
    "raised_planter": "furniture.planter_linear", "seat_module": "furniture.seat_module", "storm_inlet": "furniture.storm_inlet",
    "bench": "furniture.bench", "streetlight": "furniture.light_pole", "bollard": "furniture.bollard", "planter": "furniture.planter",
    "trash_bin": "furniture.bin", "bus_shelter": "furniture.bus_shelter", "bike_rack": "furniture.bike_rack", "ev_charger": "furniture.ev_charger",
    "kiosk": "furniture.kiosk", "smart_pole": "furniture.smart_pole", "fence": "furniture.fence", "jersey": "furniture.jersey",
}
SIGNAL = {"vehicle3": "signal.vehicle", "arrow_left": "signal.vehicle_left", "arrow_right": "signal.vehicle_right",
          "arrow_straight": "signal.vehicle_straight", "pedestrian": "signal.pedestrian", "pedestrian3": "signal.pedestrian",
          "cycle": "signal.cycle", "bus": "signal.bus"}
SIGN_CODES = {"II.36": "dare_precedenza", "II.37": "fermarsi_e_dare_precedenza_-_stop"}
AREA_KIND = {"plaza": ("plaza", "stone"), "green": ("green", "grass"), "parking": ("parking", "asphalt"), "parking_bay": ("parking", "asphalt"),
             "bus_platform": ("plaza", "concrete"), "raised_crossing": ("plaza", "porphyry"), "rain_garden": ("rain_garden", "grass"), "bioswale": ("bioswale", "grass")}


def _slug(name: str) -> str:
    return re.sub(r"[^\w.,()+-]", "_", unicodedata.normalize("NFKD", name))


def _ll(p: dict) -> list[float]:
    return [round(float(p["lon"]), 7), round(float(p["lat"]), 7)]


def _metric(origin: list[float]):
    lat0 = math.radians(origin[1])
    mx = 111_412.84 * math.cos(lat0) - 93.5 * math.cos(3 * lat0)
    my = 111_132.92 - 559.82 * math.cos(2 * lat0) + 1.175 * math.cos(4 * lat0)
    fwd = lambda p: ((p[0] - origin[0]) * mx, (p[1] - origin[1]) * my)  # noqa: E731
    inv = lambda q: [round(origin[0] + q[0] / mx, 7), round(origin[1] + q[1] / my, 7)]  # noqa: E731
    return fwd, inv


def _buffer_line(points: list[list[float]], width: float, origin: list[float]) -> list[list[float]]:
    fwd, inv = _metric(origin)
    m = [fwd(p) for p in points]
    left, right = [], []
    for i, p in enumerate(m):
        a = m[max(0, i - 1)]
        b = m[min(len(m) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * width / 2, dx / L * width / 2
        left.append(inv((p[0] + nx, p[1] + ny)))
        right.append(inv((p[0] - nx, p[1] - ny)))
    return left + right[::-1]


class Migration:
    def __init__(self, baseline: dict, edge_map: dict[str, dict], sign_ids: set[str]):
        self.baseline = baseline
        self.edge_map = edge_map
        self.sign_ids = sign_ids
        self.report: list[dict] = []
        self.seq = 0
        self.fragments: dict[str, list[list[float]]] = {rid: r["axis"] for rid, r in baseline["roads"].items()
                                                          if r["section"]["elements"] and any(e["kind"] == "lane" for e in r["section"]["elements"])}
        self.fragment_of: dict[str, list[str]] = {rid: [rid] for rid in self.fragments}
        self.road_segments: dict[str, int] = defaultdict(int)
        for m in edge_map.values():
            self.road_segments[m["roadId"]] += 1

    def op(self, type_: str, payload: Any) -> dict:
        self.seq += 1
        return {"id": f"m53-{self.seq:04d}", "type": type_, "payload": payload, "author": "Migrazione 53.0", "at": NOW()}

    def note(self, level: str, what: str, reason: str, legacy_id: str | None = None) -> None:
        self.report.append({"level": level, "what": what, "reason": reason, **({"legacyId": legacy_id} if legacy_id else {})})

    def _split_at(self, pos: list[float], node_id: str) -> dict | None:
        """Split the baseline road fragment passing within 1.5 m of `pos` (53.x split nodes)."""
        fwd, inv = _metric(self.baseline["origin"])
        p = fwd(pos)
        best = None
        for rid, axis in self.fragments.items():
            m = [fwd(q) for q in axis]
            acc = 0.0
            for a, b in zip(m, m[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                L2 = dx * dx + dy * dy or 1e-12
                t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
                q = (a[0] + dx * t, a[1] + dy * t)
                d = math.hypot(p[0] - q[0], p[1] - q[1])
                if d < 1.5 and (best is None or d < best[0]):
                    best = (d, rid, q, acc + math.sqrt(L2) * t, sum(math.hypot(y[0] - x[0], y[1] - x[1]) for x, y in zip(m, m[1:])))
                acc += math.sqrt(L2)
        if not best:
            return None
        _, rid, q, along, total = best
        if along < 0.8 or along > total - 0.8:
            return None
        at = inv(q)
        a_id, b_id = f"{rid}~a{self.seq}", f"{rid}~b{self.seq}"
        axis = self.fragments.pop(rid)
        for frags in self.fragment_of.values():
            if rid in frags:
                frags[frags.index(rid):frags.index(rid) + 1] = [a_id, b_id]
        # Keep fragment geometry approximately (used only for further splits).
        cut = min(range(len(axis)), key=lambda i: math.hypot(fwd(axis[i])[0] - q[0], fwd(axis[i])[1] - q[1]))
        self.fragments[a_id] = axis[: max(1, cut)] + [at]
        self.fragments[b_id] = [at] + axis[max(1, cut):]
        return self.op("road.split", {"roadId": rid, "at": at, "nodeId": node_id, "newRoadIds": [a_id, b_id]})

    def _roads_covered(self, edge_ids: list[str]) -> dict[str, list[dict]]:
        by_road: dict[str, list[dict]] = defaultdict(list)
        for eid in edge_ids:
            m = self.edge_map.get(eid)
            if m:
                by_road[m["roadId"]].append(m)
        return by_road

    def convert(self, sc: dict) -> list[dict]:
        ops: list[dict] = []
        rbs = sc.get("roundabouts") or []
        rb_nodes = {rb.get("source_node_id") for rb in rbs}
        rb_by_id = {rb["id"]: rb for rb in rbs}

        def ring_centre(nid: str) -> tuple[str | None, list[float]] | None:
            # 53.x ring nodes are named "<roundabout id>:n<index>".
            head, _, tail = nid.rpartition(":n")
            rb = rb_by_id.get(head)
            return (rb.get("source_node_id"), _ll(rb["center"])) if rb and tail.isdigit() else None

        # 1. Project roads (non-roundabout added edges).
        added_nodes = {n["id"]: _ll(n["point"]) for n in sc.get("added_nodes") or []}
        known_nodes = set(self.baseline["nodes"])
        created_nodes: set[str] = set()
        def has_baseline_arms(rb: dict) -> bool:
            return any(self.edge_map.get(a.get("source_edge_id") or "") for a in rb.get("arms") or [])

        for e in sc.get("added_edges") or []:
            rb_id = str(e["id"]).split(":approach:")[0] if ":approach:" in str(e["id"]) else None
            if rb_id and rb_id in rb_by_id and not has_baseline_arms(rb_by_id[rb_id]):
                pass  # the only connection of a roundabout built on project roads: keep as an arm road
            elif e.get("road_class") == "roundabout" or str(e["id"]).startswith("roundabout:"):
                continue  # regenerated by roundabout.add
            axis = [_ll(p) for p in e.get("geometry") or []]
            if len(axis) < 2:
                self.note("warning", f"Strada {e.get('name') or e['id']}", "geometria con meno di 2 punti", e["id"])
                continue
            ends = []
            nodes_payload = []
            for idx, nid in ((0, e["u"]), (-1, e["v"])):
                rc = ring_centre(nid)
                if rc:
                    src, centre = rc
                    nid = src or f"m53-rbc-{nid.split(':')[1]}"
                    axis[idx] = centre if not src or src not in self.baseline["nodes"] else self.baseline["nodes"][src]["at"]
                if nid in known_nodes or nid in created_nodes:
                    at = self.baseline["nodes"][nid]["at"] if nid in self.baseline["nodes"] else None
                    if at:
                        axis[idx] = at
                    ends.append(nid)
                    continue
                pos = added_nodes.get(nid) or axis[idx]
                split = None if nid in rb_nodes else self._split_at(pos, nid)
                if split:
                    ops.append(split)
                    pos = split["payload"]["at"]
                else:
                    nodes_payload.append({"id": nid, "at": pos})
                axis[idx] = pos
                created_nodes.add(nid)
                known_nodes.add(nid)
                ends.append(nid)
            if ends[0] == ends[1]:
                self.note("warning", f"Strada {e.get('name') or e['id']}", "inizio e fine coincidono", e["id"])
                continue
            rid = "m53:" + e["id"]
            lanes, section = _lanes_and_section(rid, e, False)
            ops.append(self.op("road.add", {"nodes": nodes_payload, "road": {
                "id": rid, "from": ends[0], "to": ends[1], "name": e.get("name") or "Strada di progetto",
                "roadClass": e.get("road_class") if e.get("road_class") not in ("project", None) else "residential",
                "axis": axis, "oneway": "forward" if e.get("oneway") else "no", "speedKmh": float(e.get("speed_kmh") or 30),
                "lanes": lanes, "section": section,
                "provenance": {"geometry": {"kind": "project", "source": "DRIP Urban 53.0"}, "width": {"kind": "project", "source": "DRIP Urban 53.0"}},
            }}))

        # 2. Direction changes.
        direction = {"one_way": "forward", "reverse_one_way": "backward", "two_way": "no"}
        for o in sc.get("operations") or []:
            kind = o.get("kind")
            if kind in direction:
                for rid, segs in self._roads_covered(o.get("edge_ids") or []).items():
                    total = self.road_segments[rid]
                    if len(segs) * 2 < total:
                        self.note("warning", f"Senso di marcia su {rid}", f"l'operazione 53.0 copriva {len(segs)}/{total} tratti della strada: non applicata per non estenderla", o.get("id"))
                        continue
                    want = direction[kind]
                    rev = sum(1 for s in segs if s["reversed"]) > len(segs) / 2
                    oneway = want if want == "no" or not rev else ("backward" if want == "forward" else "forward")
                    ops.append(self.op("road.setOneway", {"roadId": rid, "oneway": oneway}))
                missing = [x for x in o.get("edge_ids") or [] if x not in self.edge_map]
                if missing:
                    self.note("info", o.get("label") or kind, f"{len(missing)} tratti erano strade di progetto o rami di rotatoria: direzione gestita dalla geometria 1.0", o.get("id"))
            elif kind in ("give_way", "traffic_light"):
                continue  # roundabout controls, applied with the roundabout below
            else:
                self.note("warning", o.get("label") or str(kind), "tipo di operazione 53.0 non ancora mappato", o.get("id"))

        # 3. Removed roads (not those replaced by a roundabout).
        by_road = self._roads_covered(list(sc.get("removed_edge_ids") or []))
        for rid, segs in by_road.items():
            road = self.baseline["roads"].get(rid)
            if not road:
                continue
            if road["from"] in rb_nodes or road["to"] in rb_nodes:
                continue  # 53.0 removed arm segments when building a roundabout; 1.0 trims them instead
            if len(segs) == self.road_segments[rid]:
                ops.append(self.op("road.remove", {"roadIds": list(self.fragment_of.get(rid, [rid]))}))
            else:
                self.note("warning", f"Rimozione su {road.get('name') or rid}", f"rimossi {len(segs)}/{self.road_segments[rid]} tratti: rimozione parziale non riprodotta, da ridisegnare con Taglia + Elimina")

        # 4. Roundabouts.
        for rb in rbs:
            node = rb.get("source_node_id")
            D = float(rb.get("outer_diameter_m") or 26)
            rtype = "mini" if D < 25 else "compact" if D <= 40 else "standard"
            if D < 14:
                self.note("warning", rb.get("name") or rb["id"], f"diametro {D:g} m sotto il minimo DM 19/04/2006 per mini-rotatoria: portato a 14 m", rb["id"])
                D = 14.0
            control = {"priority": "yield", "signalized": "signalized", "part_time": "part_time", "metered": "metered"}.get(rb.get("control_mode") or "priority", "yield")
            circ = min(12.0, max(6.0, 4.5 * int(rb.get("lanes") or 1) + 1.5)) if rtype != "mini" else 6.0
            arms = []
            for a in rb.get("arms") or []:
                m = self.edge_map.get(a.get("source_edge_id") or "")
                if m:
                    arms.append({"roadId": m["roadId"], "entryRadiusM": max(6.0, D * 0.35), "exitRadiusM": max(8.0, D * 0.45),
                                 "splitter": bool(a.get("splitter")) and rtype != "mini", "splitterLengthM": float(a.get("splitter_length_m") or 10),
                                 "splitterWidthM": float(a.get("splitter_width_m") or 1.5), "crossing": False})
            if not node:
                self.note("error", rb.get("name") or rb["id"], "rotatoria 53.0 senza incrocio di origine: da reinserire", rb["id"])
                continue
            approaches = [e for e in sc.get("added_edges") or [] if str(e["id"]).startswith(rb["id"] + ":approach")]
            if not arms and not approaches:
                self.note("error", rb.get("name") or rb["id"], "nel 53.0 era un anello isolato senza bracci collegati alla rete: non è una rotatoria funzionante, va reinserita su un incrocio", rb["id"])
                continue
            ops.append(self.op("roundabout.add", {"roundabout": {
                "id": rb["id"].replace(":", "-"), "name": rb.get("name") or "Rotatoria", "type": rtype,
                "center": _ll(rb["center"]), "replacedNodeId": node, "outerDiameterM": D,
                "aspect": min(1.0, float(rb.get("minor_diameter_m") or D) / float(rb.get("outer_diameter_m") or D)),
                "orientationDeg": float(rb.get("orientation_deg") or 0), "circulatoryWidthM": circ,
                "lanes": 2 if int(rb.get("lanes") or 1) >= 2 else 1, "apronWidthM": 1.0 if rtype == "mini" else 1.5,
                "islandMaterial": "grass" if (rb.get("island_style") or "landscaped") == "landscaped" else "porphyry",
                "control": control, "speedKmh": float(rb.get("speed_kmh") or 25), "arms": arms,
            }}))

        # 5. Elements → assets / areas.
        assets: list[dict] = []
        origin = self.baseline["origin"]
        for el in sc.get("elements") or []:
            props = el.get("properties") or {}
            label = el.get("label") or el.get("kind")
            if props.get("generated"):
                self.note("info", label, "elemento generato automaticamente dalla rotatoria 53.0: la 1.0 rigenera segnaletica e isole dal modello", el.get("id"))
                continue
            pts = [_ll(p) for p in el.get("points") or []]
            gtype = el.get("geometry_type")
            kind = el.get("kind")
            base = {"id": "m53-" + str(el["id"]).replace(":", "-"), "rotationDeg": float(props.get("rotation_deg") or 0),
                    "state": "project", "provenance": {"kind": "project", "source": "DRIP Urban 53.0"}}
            if gtype == "point" and pts:
                atype = None
                extra: dict[str, Any] = {}
                if kind == "traffic_sign":
                    sid = (props.get("sign_id") or "").removeprefix("real:")
                    sid = SIGN_CODES.get(props.get("sign_code") or "", sid)
                    slug = _slug(sid)
                    if f"it.sign.{slug}" in self.sign_ids:
                        atype = f"it.sign.{slug}"
                        if props.get("pole_id"):
                            extra = {"poleId": props["pole_id"], "stackOrder": int(props.get("stack_order") or 0)}
                    else:
                        self.note("warning", label, f"segnale '{sid}' non presente nel catalogo CdS", el.get("id"))
                        continue
                elif kind == "signal":
                    atype = SIGNAL.get(props.get("profile") or "vehicle3", "signal.vehicle")
                else:
                    atype = FURNITURE.get(props.get("asset_type") or kind)
                if not atype:
                    self.note("warning", label, f"tipo '{props.get('asset_type') or kind}' senza corrispondente nel catalogo 1.0", el.get("id"))
                    continue
                assets.append({**base, "type": atype, "at": pts[0], "properties": {"label": label, **extra}})
            elif gtype in ("polygon", "line"):
                if kind == "crossing" and len(pts) >= 2:
                    ops.append(self.op("area.set", {"area": {**{k: base[k] for k in ("id", "state", "provenance")}, "kind": "crossing", "name": label,
                                                              "polygon": [pts[0], pts[-1]], "material": "road_marking_white", "depthM": 4.0, "properties": {}}}))
                    continue
                if kind == "curb" or props.get("asset_type") == "median_green":
                    ring = _buffer_line(pts, float(props.get("width_m") or 1.5), origin)
                    ops.append(self.op("area.set", {"area": {**{k: base[k] for k in ("id", "state", "provenance")}, "kind": "median_green", "name": label,
                                                              "polygon": ring, "material": "grass", "properties": {"widthM": float(props.get("width_m") or 1.5)}}}))
                    continue
                ak = AREA_KIND.get(props.get("asset_type") or "") or AREA_KIND.get(kind or "")
                if ak and len(pts) >= 3:
                    ops.append(self.op("area.set", {"area": {**{k: base[k] for k in ("id", "state", "provenance")}, "kind": ak[0], "name": label,
                                                              "polygon": pts, "material": ak[1], "properties": {}}}))
                else:
                    self.note("warning", label, f"superficie '{kind}' non migrabile", el.get("id"))
        if assets:
            ops.append(self.op("asset.add", {"assets": assets}))
        for key in ("traffic_controllers", "junction_signal_plans", "safety_events", "projects"):
            if sc.get(key):
                self.note("warning", key, f"{len(sc[key])} oggetti 53.0 di questo tipo da reinserire con gli strumenti 1.0")
        return ops


def load_seed() -> tuple[dict, dict]:
    with gzip.open(SETTINGS.seed_dir / "frattamaggiore.baseline.json.gz", "rt", encoding="utf-8") as fh:
        baseline = json.load(fh)
    with gzip.open(SETTINGS.seed_dir / "frattamaggiore.legacy-map.json.gz", "rt", encoding="utf-8") as fh:
        edge_map = json.load(fh)
    return baseline, edge_map


def sign_catalog_ids() -> set[str]:
    cat = json.loads((SETTINGS.signs_dir / "catalog.json").read_text(encoding="utf-8"))
    return {i["id"] for i in cat["items"]}


def legacy_summary(folder: Path | None = None) -> dict | None:
    folder = folder or SETTINGS.legacy_data_dir
    if not folder or not (folder / "scenarios.json").exists():
        return None
    rows = read_json(folder / "scenarios.json", []) or []
    out = []
    for r in rows:
        counts = {k: len(r.get(k) or []) for k in ("operations", "elements", "added_edges", "removed_edge_ids", "roundabouts")}
        if r.get("id") in STOCK_SCENARIOS or not any(counts.values()):
            continue
        out.append({"id": r["id"], "name": r.get("name"), "counts": counts})
    return {"folder": str(folder), "scenarios": out}


def migrate(folder: Path | None = None) -> tuple[dict, dict, list[dict], list[dict]]:
    """Returns (baseline, edge_map, scenarios[1.0], report)."""
    folder = folder or SETTINGS.legacy_data_dir
    if not folder or not (folder / "scenarios.json").exists():
        raise FileNotFoundError("Nessun dato DRIP Urban 53.x trovato")
    baseline, edge_map = load_seed()
    rows = read_json(folder / "scenarios.json", []) or []
    mig = Migration(baseline, edge_map, sign_catalog_ids())
    scenarios = []
    for r in rows:
        if r.get("id") in STOCK_SCENARIOS:
            mig.note("info", r.get("name") or r["id"], "scenario di collaudo della versione 24/25: non migrato")
            continue
        ops = mig.convert(r)
        if not ops:
            continue
        scenarios.append({"id": _slug(f"m53-{r['id']}")[:60], "name": r.get("name") or r["id"], "description": "Migrato da DRIP Urban 53.0",
                          "isBaseline": False, "locked": False, "archived": False, "createdAt": NOW(), "operations": ops, "revision": 0})
    return baseline, edge_map, scenarios, mig.report
