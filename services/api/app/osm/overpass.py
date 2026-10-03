"""OSM importer carried over unchanged from DRIP Urban 53.x (legacy adapter, see MIGRATION.md).

It returns 53.x-shaped pydantic objects; app.city.legacy_city converts them to the 1.0 baseline.

Imports real street morphology, lane-aware attributes, buildings and urban context.
Never fabricates a synthetic grid. Missing values are estimated explicitly and keep
provenance/accuracy metadata so the UI can distinguish data from assumptions.
"""
from __future__ import annotations
import hashlib
import json
import gzip
import re
import time
import math
from contextvars import ContextVar
from concurrent.futures import CancelledError
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote_plus
import httpx
from app.settings import SETTINGS
from .legacy_models import polyline_length_m
from .legacy_models import (
    Accuracy, Point, Provenance, RoadEdge, RoadNode, TravelMode,
    BuildingFeature, CityFeature,
)

DEFAULT_ENDPOINTS=[
    SETTINGS.overpass_url,
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
HEADERS={
    "User-Agent":"DRIP-Urban/23.0 (City CAD GIS/Civil workstation; studiodrip.it)",
    "Accept":"application/json,text/plain;q=0.9,*/*;q=0.5",
}
CACHE_DIR = SETTINGS.data_dir / "cache" / "overpass"
CACHE_TTL_S = 7 * 24 * 3600


def _cache_path(query: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(query.encode("utf-8")).hexdigest() + ".json")


def _read_cache(query: str, ttl_s: int = CACHE_TTL_S):
    path = _cache_path(query)
    try:
        if path.exists() and (time.time() - path.stat().st_mtime) <= ttl_s:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "elements" in data:
                return data
    except Exception:
        pass
    return None


def _write_cache(query: str, data: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = _cache_path(query)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def _retry_after_seconds(response) -> float:
    raw = (response.headers.get("Retry-After") or "").strip() if getattr(response, "headers", None) else ""
    try:
        return max(0.0, min(float(raw), 20.0))
    except Exception:
        return 0.0


def _fetch_overpass(query: str, *, use_cache: bool = True) -> tuple[dict, str]:
    """Fetch a bounded Overpass query without hammering public instances.

    One request is made per endpoint. 429 immediately fails over to the next
    mirror instead of re-sending the same query as POST/GET three times.
    Successful responses are cached locally so repeated imports do not consume
    Overpass quota.
    """
    cache_enabled = use_cache and str(getattr(httpx.Client, "__module__", "")).startswith("httpx")
    if cache_enabled:
        cached = _read_cache(query)
        if cached is not None:
            return cached, "cache:overpass"

    endpoints = []
    for ep in DEFAULT_ENDPOINTS:
        ep = (ep or "").strip()
        if ep and ep not in endpoints:
            endpoints.append(ep)

    errors = []
    encoded = "data=" + quote_plus(query)
    timeout = httpx.Timeout(10.0, connect=4.0)
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=HEADERS) as client:
        for endpoint in endpoints[:2]:
            _report(.30, "Overpass", "Verifico la sorgente alternativa")
            if _remaining() <= 0: break
            try:
                r = client.post(
                    endpoint,
                    content=encoded,
                    timeout=max(.1,min(10,_remaining())),
                    headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
                )
                if r.status_code == 429:
                    wait = _retry_after_seconds(r)
                    errors.append(f"{endpoint}: HTTP 429 limite/quota" + (f" Retry-After={wait:g}s" if wait else ""))
                    continue
                if r.status_code in {408, 425, 500, 502, 503, 504}:
                    errors.append(f"{endpoint}: HTTP {r.status_code}")
                    continue
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and "elements" in data:
                    if cache_enabled:
                        _write_cache(query, data)
                    return data, endpoint
                errors.append(f"{endpoint}: JSON senza elements")
            except Exception as exc:
                errors.append(f"{endpoint}: {type(exc).__name__}: {exc}")

    raise RuntimeError("Overpass temporaneamente non disponibile o in quota. " + " | ".join(errors[-8:]))


def _as_float(v):
    if v is None:return None
    m=re.search(r"-?\d+(?:[\.,]\d+)?",str(v))
    if not m:return None
    try:return float(m.group(0).replace(",","."))
    except ValueError:return None


def _as_int(v):
    f=_as_float(v)
    return int(round(f)) if f is not None else None


def _speed_kmh(v,default=50.0):
    if v is None:return default
    s=str(v).strip().lower();n=_as_float(s)
    if n is None:return default
    return n*1.609344 if "mph" in s else n


def _split_values(v):
    if v is None:return []
    return [x.strip() for x in str(v).split("|")]


def _split_widths(v):
    out=[]
    for x in _split_values(v):
        n=_as_float(x)
        out.append(n if n and n>0 else None)
    return out


def _height(tags):
    h=_as_float(tags.get("height"))
    if h and h>0:return min(h,600.0)
    levels=_as_float(tags.get("building:levels"))
    if levels and levels>0:return min(levels*3.15,600.0)
    return 10.5


def _yes(v): return str(v or "").lower() in {"yes","1","true","designated","permissive"}
def _no(v): return str(v or "").lower() in {"no","0","false","none"}


def _sidewalk_width(tags,side):
    # Exact side width tags are uncommon but respected when present.
    for key in (f"sidewalk:{side}:width",f"sidewalk:{side}.width"):
        n=_as_float(tags.get(key))
        if n and n>0:return n,"osm"
    sw=str(tags.get("sidewalk","")).lower()
    sidev=str(tags.get(f"sidewalk:{side}","")).lower()
    if sidev in {"yes","both","separate"} or sw=="both" or sw==side:
        return 1.8,"estimated"
    return 0.0,"none"


def _cycle_width(tags,side):
    n=_as_float(tags.get(f"cycleway:{side}:width"))
    if n and n>0:return n,"osm"
    vals={str(tags.get("cycleway","")).lower(),str(tags.get(f"cycleway:{side}","")).lower()}
    if vals & {"lane","track","shared_lane","share_busway","opposite_lane","opposite_track"}:
        return 1.7,"estimated"
    return 0.0,"none"


def _parking_width(tags,side):
    # Modern schema parking:left/right/both plus legacy parking:lane:*.
    vals=[tags.get(f"parking:{side}"),tags.get(f"parking:lane:{side}")]
    if side in {"left","right"}: vals.append(tags.get("parking:both"))
    v=" ".join(str(x or "").lower() for x in vals)
    if any(x in v for x in ("parallel","marked","street_side","lane","yes")):
        return 2.05,"estimated"
    if any(x in v for x in ("diagonal","perpendicular")):
        return 4.8,"estimated"
    return 0.0,"none"


def _lane_profile(tags,lanes,oneway,carriage_width):
    lf=_as_int(tags.get("lanes:forward")); lb=_as_int(tags.get("lanes:backward")); both=_as_int(tags.get("lanes:both_ways")) or 0
    if oneway:
        lf=lanes;lb=0
    elif lf is None and lb is None:
        if lanes==1: lf=1;lb=0
        else:
            lf=(lanes+1)//2;lb=lanes-lf
    elif lf is None: lf=max(0,lanes-(lb or 0)-both)
    elif lb is None: lb=max(0,lanes-lf-both)
    lf=max(0,lf or 0);lb=max(0,lb or 0)

    wf=_split_widths(tags.get("width:lanes:forward")); wb=_split_widths(tags.get("width:lanes:backward")); wa=_split_widths(tags.get("width:lanes"))
    if wa and not (wf or wb):
        wf=wa[:lf];wb=wa[lf:lf+lb]
    avg=(carriage_width/max(lanes,1)) if carriage_width else 3.1
    turn_f=_split_values(tags.get("turn:lanes:forward") or (tags.get("turn:lanes") if oneway else None))
    turn_b=_split_values(tags.get("turn:lanes:backward"))
    psv_f=_split_values(tags.get("psv:lanes:forward") or (tags.get("psv:lanes") if oneway else None))
    psv_b=_split_values(tags.get("psv:lanes:backward"))
    bus_f=_split_values(tags.get("bus:lanes:forward") or (tags.get("bus:lanes") if oneway else None))
    bus_b=_split_values(tags.get("bus:lanes:backward"))
    speed_f=_split_values(tags.get("maxspeed:lanes:forward") or (tags.get("maxspeed:lanes") if oneway else None))
    speed_b=_split_values(tags.get("maxspeed:lanes:backward"))
    prof=[]
    def emit(direction,count,widths,turns,psvs,buses,speeds):
        for i in range(count):
            w=widths[i] if i<len(widths) and widths[i] else avg
            psv=(psvs[i] if i<len(psvs) else "").lower(); bus=(buses[i] if i<len(buses) else "").lower()
            exclusive_bus=psv in {"designated","yes"} or bus in {"designated","yes"}
            prof.append({
                "index":len(prof),"direction":direction,"width_m":round(float(w),2),
                "width_accuracy":"derived" if i<len(widths) and widths[i] else "estimated",
                "turn":turns[i] if i<len(turns) and turns[i] else None,
                "bus_only":exclusive_bus,
                "speed_kmh":round(_speed_kmh(speeds[i],0),1) if i<len(speeds) and speeds[i] else None,
            })
    emit("forward",lf,wf,turn_f,psv_f,bus_f,speed_f);emit("backward",lb,wb,turn_b,psv_b,bus_b,speed_b)
    while len(prof)<lanes:
        prof.append({"index":len(prof),"direction":"both" if lanes==1 else "unknown","width_m":round(float(avg),2),"width_accuracy":"estimated","turn":None,"bus_only":False,"speed_kmh":None})
    return prof,lf,lb


def _road_section(tags,lanes,oneway):
    swl,swla=_sidewalk_width(tags,"left");swr,swra=_sidewalk_width(tags,"right")
    cyl,cyla=_cycle_width(tags,"left");cyr,cyra=_cycle_width(tags,"right")
    pkl,pkla=_parking_width(tags,"left");pkr,pkra=_parking_width(tags,"right")
    median=_as_float(tags.get("median:width")) or (1.6 if _yes(tags.get("median")) else 0.0)
    explicit=_as_float(tags.get("width"))
    lane_widths=_split_widths(tags.get("width:lanes"))
    if not lane_widths:
        lane_widths=_split_widths(tags.get("width:lanes:forward"))+_split_widths(tags.get("width:lanes:backward"))
    known_lane=sum(x for x in lane_widths if x)
    if explicit:
        carriage=explicit
        carriage_accuracy="derived"
    elif len(lane_widths)>=lanes and known_lane>0:
        carriage=known_lane+pkl+pkr+cyl+cyr+median
        carriage_accuracy="derived"
    else:
        base_lane=3.0 if str(tags.get("highway")) in {"residential","living_street","service"} else 3.2
        carriage=lanes*base_lane+pkl+pkr+cyl+cyr+median
        carriage_accuracy="estimated"
    total=max(2.5,carriage+swl+swr)
    prof,lf,lb=_lane_profile(tags,lanes,oneway,max(2.5,carriage-pkl-pkr-cyl-cyr-median))
    # If lane-specific widths exist, make the total consistent with them.
    prof_sum=sum(float(x["width_m"]) for x in prof)
    if prof_sum>0 and (len(lane_widths)>=lanes):
        carriage=prof_sum+pkl+pkr+cyl+cyr+median;total=carriage+swl+swr
    return {
        "total_width_m":round(total,2),"carriageway_width_m":round(carriage,2),
        "lanes":lanes,"lanes_forward":lf,"lanes_backward":lb,"lane_profile":prof,
        "sidewalk_left_m":swl,"sidewalk_right_m":swr,"cycle_left_m":cyl,"cycle_right_m":cyr,
        "parking_left_m":pkl,"parking_right_m":pkr,"median_m":median,
        "data_quality":{
            "width":carriage_accuracy,"sidewalk_left":swla,"sidewalk_right":swra,
            "cycle_left":cyla,"cycle_right":cyra,"parking_left":pkla,"parking_right":pkra,
        },
    }


SOFT_HIGHWAYS={"footway","path","steps","cycleway","bridleway","corridor","pedestrian"}

def _is_area_highway(tags, refs):
    return len(refs)>=4 and refs[0]==refs[-1] and ("area:highway" in tags or (str(tags.get("area","")).lower()=="yes" and "highway" in tags))

def _soft_section(tags, highway):
    explicit=_as_float(tags.get("width"))
    if explicit and explicit>0: width=explicit; acc="derived"
    else:
        width={"steps":2.0,"footway":2.2,"path":2.4,"cycleway":2.8,"bridleway":3.0,"corridor":2.2,"pedestrian":5.5}.get(highway,2.5);acc="estimated"
    return {"total_width_m":round(width,2),"carriageway_width_m":round(width,2),"lanes":1,"lanes_forward":1,"lanes_backward":0,
            "lane_profile":[{"index":0,"direction":"forward","width_m":round(width,2),"width_accuracy":acc,"turn":None,"bus_only":False,"speed_kmh":None}],
            "sidewalk_left_m":0.0,"sidewalk_right_m":0.0,"cycle_left_m":0.0,"cycle_right_m":0.0,"parking_left_m":0.0,"parking_right_m":0.0,"median_m":0.0,
            "data_quality":{"width":acc,"sidewalk_left":"none","sidewalk_right":"none","cycle_left":"none","cycle_right":"none","parking_left":"none","parking_right":"none"}}

def _feature_kind(tags):
    if tags.get("barrier")=="kerb": return "kerb","Cordolo"
    if tags.get("area:highway") or (str(tags.get("area","")).lower()=="yes" and tags.get("highway")): return "road_surface",tags.get("area:highway") or tags.get("highway")
    if tags.get("highway")=="traffic_signals": return "traffic_signal","Semaforo"
    if tags.get("traffic_sign") or tags.get("highway") in {"stop","give_way"}: return "traffic_sign",tags.get("traffic_sign") or tags.get("highway")
    if tags.get("highway")=="crossing": return "crossing","Attraversamento"
    if tags.get("highway")=="bus_stop" or tags.get("public_transport") in {"platform","stop_position"}: return "transit_stop","Fermata TPL"
    if tags.get("amenity")=="parking" or tags.get("parking"): return "parking","Parcheggio"
    if tags.get("place")=="square": return "square","Piazza"
    if tags.get("leisure") in {"park","garden","playground","pitch","sports_centre"}: return "green" if tags.get("leisure") in {"park","garden"} else "leisure",tags.get("leisure")
    if tags.get("landuse") in {"grass","forest","recreation_ground","cemetery","allotments"}: return "green",tags.get("landuse")
    if tags.get("amenity"): return "amenity",tags.get("amenity")
    if tags.get("shop"): return "shop",tags.get("shop")
    if tags.get("office"): return "office",tags.get("office")
    if tags.get("tourism"): return "tourism",tags.get("tourism")
    if tags.get("historic"): return "historic",tags.get("historic")
    if tags.get("natural"): return "natural",tags.get("natural")
    if tags.get("railway"): return "railway",tags.get("railway")
    return None,None


def _parse(data:dict,source_endpoint:str):
    raw_nodes={str(x["id"]):x for x in data.get("elements",[]) if x.get("type")=="node"}
    ways=[x for x in data.get("elements",[]) if x.get("type")=="way"]
    nodes={};edges={};buildings={};features={}
    geom_prov=Provenance(source="OpenStreetMap geometry via Overpass",accuracy=Accuracy.derived,source_url=source_endpoint)
    poi_prov=Provenance(source="OpenStreetMap urban context via Overpass",accuracy=Accuracy.derived,source_url=source_endpoint)

    # Point urban context first.
    for nid,n in raw_nodes.items():
        tags=n.get("tags",{}) or {}; kind,cat=_feature_kind(tags)
        if not kind: continue
        features[f"osm-node:{nid}"]=CityFeature(id=f"osm-node:{nid}",kind=kind,geometry_type="point",points=[Point(lon=n["lon"],lat=n["lat"])],name=tags.get("name"),category=cat,properties=tags,provenance=poi_prov)

    for way in ways:
        tags=way.get("tags",{}) or {};refs=[str(n) for n in way.get("nodes",[]) if str(n) in raw_nodes]
        if "highway" in tags and len(refs)>=2 and not _is_area_highway(tags,refs):
            highway=str(tags.get("highway") or "road")
            reverse_oneway=str(tags.get("oneway","")).lower()=="-1"
            implied_oneway=str(tags.get("junction","")).lower() in {"roundabout","circular"}
            soft=highway in SOFT_HIGHWAYS
            oneway=reverse_oneway or implied_oneway or str(tags.get("oneway","")).lower() in {"yes","1","true"}
            if reverse_oneway:refs.reverse()
            for nid in refs:
                n=raw_nodes[nid];nodes.setdefault(nid,RoadNode(id=nid,point=Point(lon=n["lon"],lat=n["lat"])))
            if soft:
                lanes=1; section=_soft_section(tags,highway)
            else:
                total_lanes=_as_int(tags.get("lanes"))
                if total_lanes is None:
                    lf=_as_int(tags.get("lanes:forward")) or 0;lb=_as_int(tags.get("lanes:backward")) or 0
                    total_lanes=lf+lb if (lf+lb)>0 else (1 if oneway else 2)
                lanes=max(1,min(total_lanes,12)); section=_road_section(tags,lanes,oneway)
            width=section["total_width_m"]
            width_accuracy=Accuracy.derived if section["data_quality"]["width"]=="derived" else Accuracy.estimated
            source="OSM width/lane tags + DRIP section reconstruction" if width_accuracy==Accuracy.derived else "DRIP section estimate from OSM road class/lanes"
            width_prov=Provenance(source=source,accuracy=width_accuracy,source_url="https://www.openstreetmap.org")
            soft_default={"steps":5.0,"footway":6.0,"path":8.0,"cycleway":20.0,"bridleway":12.0,"corridor":6.0,"pedestrian":10.0}.get(highway)
            speed=min(max(_speed_kmh(tags.get("maxspeed"),soft_default if soft else (30.0 if highway in {"residential","living_street"} else 50.0)),3.0),200.0)
            foot=tags.get("foot")!="no";bike=tags.get("bicycle")!="no";motor=(not soft) and tags.get("motor_vehicle")!="no" and tags.get("vehicle")!="no" and tags.get("access") not in {"no","private"}
            modes={TravelMode.emergency}
            if foot:modes.add(TravelMode.walk)
            if bike:modes.add(TravelMode.bike)
            if motor:modes.update({TravelMode.car,TravelMode.bus})
            rc=highway;cap_lane=0.0 if soft else (1350.0 if rc in {"residential","living_street","service"} else 1700.0)
            for i,(u,v) in enumerate(zip(refs,refs[1:])):
                geom=[nodes[u].point,nodes[v].point];length=polyline_length_m(geom)
                if length<=0.05:continue
                eid=f"osm:{way['id']}:{i}"
                edge_tags=dict(tags)
                edge_tags.update({
                    "drip_osm_way_id":str(way["id"]),
                    "drip_osm_segment_index":i,
                    "drip_osm_from_node":u,
                    "drip_osm_to_node":v,
                    "drip_real_alignment":True,
                })
                edges[eid]=RoadEdge(id=eid,u=u,v=v,name=tags.get("name","Strada senza nome"),geometry=geom,length_m=length,width_m=width,lanes=lanes,speed_kmh=speed,oneway=oneway,modes=modes,road_class=rc,capacity_vph=cap_lane*max(lanes,1),width_provenance=width_prov,geometry_provenance=geom_prov,tags=edge_tags,lane_profile=section["lane_profile"],section=section)
        if "building" in tags and len(refs)>=4 and refs[0]==refs[-1]:
            pts=[Point(lon=raw_nodes[n]["lon"],lat=raw_nodes[n]["lat"]) for n in refs[:-1]]
            if len(pts)>=3:
                bid=f"osm-building:{way['id']}";levels=_as_float(tags.get("building:levels"))
                buildings[bid]=BuildingFeature(id=bid,footprint=pts,height_m=_height(tags),levels=int(levels) if levels else None,name=tags.get("name"),building_class=tags.get("building"),provenance=geom_prov,tags=tags)
        kind,cat=_feature_kind(tags)
        if kind and len(refs)>=2 and "building" not in tags:
            pts=[Point(lon=raw_nodes[n]["lon"],lat=raw_nodes[n]["lat"]) for n in refs]
            closed=len(pts)>=4 and refs[0]==refs[-1]
            if closed: pts=pts[:-1]
            features[f"osm-way:{way['id']}"]=CityFeature(id=f"osm-way:{way['id']}",kind=kind,geometry_type="polygon" if closed else "line",points=pts,name=tags.get("name"),category=cat,properties=tags,provenance=poi_prov)
    return nodes,edges,buildings,features,source_endpoint


def _merge_element_sets(*payloads: dict) -> dict:
    merged = {}
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        for el in payload.get("elements", []) or []:
            et, eid = el.get("type"), el.get("id")
            if et and eid is not None:
                merged[(str(et), str(eid))] = el
    return {"elements": list(merged.values())}


def _bbox_text(south: float, west: float, north: float, east: float) -> str:
    return f"{south:.7f},{west:.7f},{north:.7f},{east:.7f}"


def _query_roads(south: float, west: float, north: float, east: float, detailed: bool = True) -> str:
    b = _bbox_text(south, west, north, east)
    if detailed:
        body = f'''\n          way["highway"]({b});\n          way["area:highway"]({b});\n          way["barrier"="kerb"]({b});\n          node["highway"~"traffic_signals|crossing|bus_stop|stop|give_way"]({b});\n          node["traffic_sign"]({b});\n          node["public_transport"]({b});\n          way["public_transport"]({b});\n        '''
    else:
        body = f'''way["highway"]({b});'''
    return f'''[out:json][timeout:65];({body});(._;>;);out body qt;'''


def _query_buildings(south: float, west: float, north: float, east: float) -> str:
    b = _bbox_text(south, west, north, east)
    return f'''[out:json][timeout:70];way["building"]({b});(._;>;);out body qt;'''


def _query_context(south: float, west: float, north: float, east: float) -> str:
    b = _bbox_text(south, west, north, east)
    return f'''[out:json][timeout:60];(\n      node["amenity"]({b}); way["amenity"]({b});\n      node["shop"]({b}); way["shop"]({b});\n      node["office"]({b}); way["office"]({b});\n      node["tourism"]({b}); way["tourism"]({b});\n      node["leisure"]({b}); way["leisure"]({b});\n      node["railway"]({b}); way["railway"]({b});\n      node["place"="square"]({b}); way["place"="square"]({b});\n      way["landuse"~"grass|forest|recreation_ground|cemetery|allotments"]({b});\n    );(._;>;);out body qt;'''


def _osm_xml_payload(xml_bytes: bytes) -> dict:
    root = ET.fromstring(xml_bytes)
    elements = []
    for node in root.findall("node"):
        tags = {t.attrib.get("k"): t.attrib.get("v", "") for t in node.findall("tag") if t.attrib.get("k")}
        item = {
            "type": "node",
            "id": int(node.attrib["id"]),
            "lat": float(node.attrib["lat"]),
            "lon": float(node.attrib["lon"]),
        }
        if tags:
            item["tags"] = tags
        elements.append(item)
    for way in root.findall("way"):
        tags = {t.attrib.get("k"): t.attrib.get("v", "") for t in way.findall("tag") if t.attrib.get("k")}
        refs = [int(nd.attrib["ref"]) for nd in way.findall("nd") if nd.attrib.get("ref")]
        elements.append({"type": "way", "id": int(way.attrib["id"]), "nodes": refs, "tags": tags})
    return {"elements": elements}


def _osm_map_cache_path(south: float, west: float, north: float, east: float) -> Path:
    key = f"{south:.7f},{west:.7f},{north:.7f},{east:.7f}"
    return CACHE_DIR / ("osm-map-" + hashlib.sha256(key.encode("utf-8")).hexdigest() + ".json")


_IMPORT_PROGRESS = ContextVar("import_progress", default=None)
_IMPORT_DEADLINE = ContextVar("import_deadline", default=None)

def _report(progress, stage, message):
    callback = _IMPORT_PROGRESS.get()
    if callback: callback(progress, stage, message)

def _remaining():
    deadline = _IMPORT_DEADLINE.get()
    return max(0, deadline - time.monotonic()) if deadline else 100

def _fetch_osm_map_bbox(south, west, north, east, *, depth=0):
    """Bounded tile queue. Subdivide only an OSM object-limit response (400).

    Network/auth/rate failures never fan out into hundreds of requests. Successful
    leaf tiles are cached independently; incomplete aggregates are never cached.
    """
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError("Coordinate o area OSM non valide")
    ny=max(1, math.ceil((north-south)/.015)); nx=max(1, math.ceil((east-west)/.015))
    if nx*ny>64:
        raise ValueError("Area troppo grande: ingrandisci la mappa o importa un estratto OSM locale (massimo 64 riquadri).")
    queue=[(south+(north-south)*y/ny,west+(east-west)*x/nx,
            south+(north-south)*(y+1)/ny,west+(east-west)*(x+1)/nx,0)
           for y in range(ny) for x in range(nx)]
    payloads=[];warnings=[];done=0;failed=0;consecutive=0;total=len(queue)
    deadline=time.monotonic()+min(100,_remaining())
    with httpx.Client(timeout=httpx.Timeout(20,connect=5),follow_redirects=True,
                      headers={**HEADERS,"Accept":"application/xml,text/xml;q=0.9"}) as client:
        while queue:
            _report(.18+.55*done/max(total,1),"OSM",f"Riquadro {done+1}/{total} · {len(payloads)} acquisiti · {failed} non disponibili")
            if time.monotonic()>=deadline:
                warnings.append(f"Tempo limite raggiunto; {len(queue)} riquadri non scaricati")
                break
            s,w,n,e,level=queue.pop(0);cache=_osm_map_cache_path(s,w,n,e)
            try:
                if cache.exists() and time.time()-cache.stat().st_mtime<=CACHE_TTL_S:
                    data=json.loads(cache.read_text(encoding="utf-8"))
                    if isinstance(data.get("elements"),list):
                        payloads.append(data);done+=1;consecutive=0;continue
            except (OSError,ValueError): pass
            try:
                response=client.get("https://api.openstreetmap.org/api/0.6/map",
                    params={"bbox":f"{w:.7f},{s:.7f},{e:.7f},{n:.7f}"},
                    timeout=max(.1,min(20,deadline-time.monotonic())))
                if response.status_code==400 and level<2 and total+3<=64:
                    mlat=(s+n)/2;mlon=(w+e)/2
                    queue[:0]=[(s,w,mlat,mlon,level+1),(s,mlon,mlat,e,level+1),
                               (mlat,w,n,mlon,level+1),(mlat,mlon,n,e,level+1)]
                    total+=3;continue
                response.raise_for_status()
                data=_osm_xml_payload(response.content)
                payloads.append(data);consecutive=0
                _write_cache_file(cache,data)
            except (httpx.HTTPError,ET.ParseError,ValueError) as exc:
                failed+=1;consecutive+=1
                status=getattr(getattr(exc,"response",None),"status_code",None)
                warnings.append(f"Riquadro {done+1}: HTTP {status}" if status else f"Riquadro {done+1}: {type(exc).__name__}")
                if status in {401,403,406,429,509} or consecutive>=2:
                    warnings.append(f"Servizio non disponibile; interrotti {len(queue)} riquadri rimanenti")
                    break
            done+=1
    if not payloads:
        raise RuntimeError("OSM Map API non disponibile. "+"; ".join(warnings))
    result=_merge_element_sets(*payloads)
    result["_import_warnings"]=warnings
    result["_tiles"]={"completed":len(payloads),"total":total,"failed":failed}
    _report(.74,"OSM",f"{len(payloads)}/{total} riquadri acquisiti · {len(result['elements'])} elementi")
    return result

def _write_cache_file(path,data):
    from app.storage import atomic_write_json
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(path,data)
    except OSError: pass


def import_osm_payload(payload:dict, source:str="OSM file locale"):
    """Parse an already downloaded Overpass-style JSON payload."""
    return _parse(payload,source)


def import_osm_xml_bytes(blob:bytes, source:str="OSM XML locale"):
    return _parse(_osm_xml_payload(blob),source)

def _import_layered_bbox(
    south: float,
    west: float,
    north: float,
    east: float,
    include_buildings: bool = True,
    include_context: bool = True,
    *,
    enrich_overpass: bool = False,
):
    warnings=[];sources=[]
    # Primary path: official OSM Map API, split into deliberately small tiles.
    # If that service rejects the area or is unreachable, fall back to bounded
    # Overpass queries.  The UI always keeps the raster basemap visible, so a
    # vector import failure never leaves the workspace blank.
    try:
        raw=_fetch_osm_map_bbox(south,west,north,east)
        warnings.extend(raw.get("_import_warnings",[]))
        sources.append("https://api.openstreetmap.org/api/0.6/map")
        strategy="osm-map-tiled"
        fallback=None
    except (CancelledError,ValueError):
        raise
    except Exception as primary_exc:
        warnings.append(f"OSM Map API: {primary_exc}")
        payloads=[]
        for label,query in (("rete stradale",_query_roads(south,west,north,east,True)),("edifici",_query_buildings(south,west,north,east)),("contesto",_query_context(south,west,north,east))):
            if label=="edifici" and not include_buildings: continue
            if label=="contesto" and not include_context: continue
            try:
                p,src=_fetch_overpass(query);payloads.append(p);sources.append(src)
            except CancelledError: raise
            except Exception as exc:
                warnings.append(f"Overpass {label}: {exc}")
                if label=="rete stradale": break
        if not payloads:
            raise RuntimeError("Nessuna sorgente vettoriale OSM disponibile. "+" | ".join(warnings[-8:])) from primary_exc
        raw=_merge_element_sets(*payloads)
        strategy="overpass-fallback"
        fallback="overpass"
    if enrich_overpass and strategy=="osm-map-tiled":
        payloads=[raw]
        for label,query in (("dettagli stradali",_query_roads(south,west,north,east,True)),("edifici",_query_buildings(south,west,north,east)),("contesto",_query_context(south,west,north,east))):
            if label=="edifici" and not include_buildings: continue
            if label=="contesto" and not include_context: continue
            try:
                p,src=_fetch_overpass(query);payloads.append(p);sources.append(src)
            except Exception as exc: warnings.append(f"Overpass {label} opzionale: {exc}")
        raw=_merge_element_sets(*payloads)
    _report(.77,"Normalizzazione","Ricostruisco nodi condivisi, strade, edifici e contesto")
    nodes,edges,buildings,features,_=_parse(raw,", ".join(dict.fromkeys(sources)))
    if not include_buildings: buildings={}
    if not include_context:
        features={k:v for k,v in features.items() if v.kind in {"road_surface","kerb","traffic_signal","traffic_sign","crossing","transit_stop"}}
    return nodes,edges,buildings,features,", ".join(dict.fromkeys(sources)),{
        "partial":bool(warnings),"fallback":fallback,"warnings":warnings,"sources":list(dict.fromkeys(sources)),"strategy":strategy
    }

def import_bbox(
    south: float,
    west: float,
    north: float,
    east: float,
    include_buildings: bool = True,
    *,
    include_context: bool = True,
    return_meta: bool = False,
    enrich_overpass: bool = False,
    progress=None,
):
    token=_IMPORT_PROGRESS.set(progress); deadline=_IMPORT_DEADLINE.set(time.monotonic()+100)
    try:
        result = _import_layered_bbox(south, west, north, east, include_buildings, include_context, enrich_overpass=enrich_overpass)
    finally:
        _IMPORT_PROGRESS.reset(token); _IMPORT_DEADLINE.reset(deadline)
    return result if return_meta else result[:5]


def _nominatim_bbox(name: str):
    headers = {"User-Agent": "DRIP-Urban/23.0 (place resolver; studiodrip.it)"}
    with httpx.Client(timeout=15.0, follow_redirects=True, headers=headers) as client:
        r = client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": name, "format": "jsonv2", "limit": 1, "addressdetails": 1},
        )
        r.raise_for_status()
        rows = r.json()
    if not rows:
        raise RuntimeError("località non trovata")
    bb = [float(v) for v in rows[0].get("boundingbox", [])]
    if len(bb) != 4:
        raise RuntimeError("bounding box non disponibile")
    south, north, west, east = bb
    return south, west, north, east


