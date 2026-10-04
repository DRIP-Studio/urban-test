"""Project persistence. One folder per project:

    projects/<id>/project.json        metadata (ProjectMeta)
    projects/<id>/baseline.json.gz    immutable city baseline (1.0 schema)
    projects/<id>/scenarios/<sid>.json
    projects/<id>/docs/<name>.json    presentation, civic, transit, safety, traffic…
    projects/<id>/thumbnail.png
    projects/<id>/snapshots/<stamp>/  manual + automatic snapshots
    projects/<id>/audit.jsonl         append-only change log
"""
from __future__ import annotations

import io
import json
import shutil
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.settings import SETTINGS
from app.projects import tiles
from app.storage import atomic_write_bytes, atomic_write_json, read_json, safe_id

DOC_NAMES = {"presentation", "civic", "transit", "safety", "traffic", "settings", "notes", "layers", "migration", "sidewalks", "mobility", "models", "elios", "terrain", "pricelist", "wms", "urbanplan", "trafficplan", "drainage"}
SCENARIO_KEYS = {"id", "name", "description", "isBaseline", "locked", "archived", "createdAt", "operations", "revision", "updatedAt", "author"}
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _lock(pid: str) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(pid, threading.RLock())


class NotFound(Exception):
    pass


class Conflict(Exception):
    def __init__(self, message: str, current: Any = None):
        super().__init__(message)
        self.current = current


def project_dir(pid: str) -> Path:
    return SETTINGS.projects_dir / safe_id(pid, "project id")


def _meta_path(pid: str) -> Path:
    return project_dir(pid) / "project.json"


def list_projects(include_archived: bool = True) -> list[dict]:
    out = []
    if not SETTINGS.projects_dir.exists():
        return out
    for d in SETTINGS.projects_dir.iterdir():
        meta = read_json(d / "project.json") if d.is_dir() else None
        if not meta or (not include_archived and meta.get("status") == "archived"):
            continue
        scen = [read_json(p) for p in sorted((d / "scenarios").glob("*.json"))]
        meta = {**meta, "scenarioCount": sum(1 for s in scen if s and not s.get("isBaseline") and not s.get("archived")),
                "hasThumbnail": (d / "thumbnail.png").exists(),
                "opCount": sum(len(s.get("operations") or []) for s in scen if s)}
        out.append(meta)
    return sorted(out, key=lambda m: m.get("updatedAt") or "", reverse=True)


def get_meta(pid: str) -> dict:
    meta = read_json(_meta_path(pid))
    if not meta:
        raise NotFound(f"Progetto {pid} inesistente")
    return meta


def _touch(pid: str, **changes: Any) -> dict:
    meta = {**get_meta(pid), **changes, "updatedAt": now_iso()}
    atomic_write_json(_meta_path(pid), meta)
    return meta


def update_meta(pid: str, changes: dict) -> dict:
    allowed = {k: v for k, v in changes.items() if k in {"name", "description", "status", "kind", "activeScenarioId", "author"}}
    if isinstance(changes.get("workArea"), list) and len(changes["workArea"]) == 4:
        meta = get_meta(pid)
        if meta.get("large"):
            allowed["workArea"] = tiles.clamp_work_area([float(x) for x in changes["workArea"]], meta["bbox"])
    if "name" in allowed and not (2 <= len(str(allowed["name"]).strip()) <= 120):
        raise ValueError("Il nome deve avere 2–120 caratteri")
    with _lock(pid):
        return _touch(pid, **allowed)


def create_project(*, name: str, kind: str, author: str, baseline: dict, description: str | None = None,
                   source_label: str, scenarios: list[dict] | None = None) -> dict:
    if not (2 <= len(name.strip()) <= 120):
        raise ValueError("Il nome deve avere 2–120 caratteri")
    pid = "p-" + uuid.uuid4().hex[:12]
    d = project_dir(pid)
    d.mkdir(parents=True, exist_ok=False)
    created = now_iso()
    atomic_write_json(d / "baseline.json.gz", baseline, gz=True)
    large = tiles.is_large(baseline)
    if large:
        tiles.build_tiles(d, baseline)
    base = {"id": "baseline", "name": "Stato attuale", "description": f"Città com'è oggi · {source_label}",
            "isBaseline": True, "locked": True, "archived": False, "createdAt": created, "operations": [], "revision": 0}
    first = {"id": "scenario-a", "name": "Scenario A", "isBaseline": False, "locked": False, "archived": False,
             "createdAt": created, "operations": [], "revision": 0}
    rows = [base, *(scenarios or [first])]
    for s in rows:
        atomic_write_json(d / "scenarios" / f"{safe_id(s['id'], 'scenario id')}.json", s)
    meta = {
        "id": pid, "schemaVersion": 1, "name": name.strip(), "city": baseline.get("name") or name,
        "kind": kind, "status": "draft", "author": author, "createdAt": created, "updatedAt": created,
        "bbox": baseline["bbox"], "crs": "EPSG:4326", "timezone": "Europe/Rome",
        "baselineId": baseline["id"], "scenarioIds": [s["id"] for s in rows], "activeScenarioId": rows[1]["id"] if len(rows) > 1 else "baseline",
        "source": source_label,
        **({"large": True, "workArea": tiles.default_work_area([float(x) for x in baseline["bbox"]])} if large else {}),
        **({"description": description} if description else {}),
    }
    atomic_write_json(d / "project.json", meta)
    audit(pid, author, "project.create", {"source": source_label})
    return meta


def baseline_subset_bytes(pid: str, bbox: list[float]) -> bytes:
    """Work-area baseline of a large project (gzip JSON)."""
    import gzip
    import json as _json
    meta = get_meta(pid)
    d = project_dir(pid)
    if not meta.get("large"):
        return baseline_bytes(pid)
    head = {"id": meta.get("baselineId"), "name": meta.get("city"), "sources": [{"kind": "osm", "source": meta.get("source", "")}]}
    sub = tiles.subset(d, head, tiles.clamp_work_area(bbox, meta["bbox"]))
    return gzip.compress(_json.dumps(sub, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), compresslevel=5)


def overview_bytes(pid: str) -> bytes:
    p = project_dir(pid) / "overview.json.gz"
    if not p.exists():
        raise NotFound("Vista d'insieme non disponibile (progetto non grande)")
    return p.read_bytes()


def baseline_bytes(pid: str) -> bytes:
    p = project_dir(pid) / "baseline.json.gz"
    if not p.exists():
        raise NotFound("Baseline mancante")
    return p.read_bytes()


def read_baseline(pid: str) -> dict:
    return read_json(project_dir(pid) / "baseline.json.gz")


def list_scenarios(pid: str) -> list[dict]:
    get_meta(pid)
    rows = [read_json(p) for p in sorted((project_dir(pid) / "scenarios").glob("*.json"))]
    return [{k: v for k, v in s.items() if k != "operations"} | {"opCount": len(s.get("operations") or [])} for s in rows if s]


def get_scenario(pid: str, sid: str) -> dict:
    s = read_json(project_dir(pid) / "scenarios" / f"{safe_id(sid, 'scenario id')}.json")
    if not s:
        raise NotFound(f"Scenario {sid} inesistente")
    return s


def save_scenario(pid: str, sid: str, body: dict, base_revision: int | None, author: str) -> dict:
    with _lock(pid):
        path = project_dir(pid) / "scenarios" / f"{safe_id(sid, 'scenario id')}.json"
        current = read_json(path)
        if current is None:
            raise NotFound(f"Scenario {sid} inesistente")
        if current.get("isBaseline"):
            raise Conflict("Lo stato attuale non è modificabile")
        if base_revision is not None and base_revision != current.get("revision", 0):
            raise Conflict("Lo scenario è stato modificato altrove", current)
        if current.get("locked") and body.get("operations") != current.get("operations"):
            raise Conflict("Scenario bloccato")
        ops = body.get("operations")
        if not isinstance(ops, list):
            raise ValueError("operations deve essere una lista")
        for op in ops:
            if not isinstance(op, dict) or not {"id", "type", "payload"} <= op.keys():
                raise ValueError("Operazione non valida")
        nxt = {k: v for k, v in {**current, **body}.items() if k in SCENARIO_KEYS}
        nxt.update(id=sid, isBaseline=False, revision=current.get("revision", 0) + 1, updatedAt=now_iso())
        atomic_write_json(path, nxt)
        prev_ids = {o["id"] for o in current.get("operations") or []}
        new_ids = {o["id"] for o in ops}
        added = [o for o in ops if o["id"] not in prev_ids]
        removed = len(prev_ids - new_ids)
        if added or removed or body.get("name") != current.get("name"):
            audit(pid, author, "scenario.save", {"scenarioId": sid, "revision": nxt["revision"],
                                                  "added": [o["type"] for o in added][:50], "removed": removed})
        _touch(pid)
        return {k: v for k, v in nxt.items() if k != "operations"} | {"opCount": len(ops)}


def create_scenario(pid: str, name: str, author: str, copy_from: str | None = None, description: str | None = None) -> dict:
    with _lock(pid):
        meta = get_meta(pid)
        base_ops: list = []
        if copy_from:
            base_ops = get_scenario(pid, copy_from).get("operations") or []
        sid = "s-" + uuid.uuid4().hex[:8]
        s = {"id": sid, "name": name.strip() or "Nuovo scenario", "isBaseline": False, "locked": False, "archived": False,
             "createdAt": now_iso(), "operations": base_ops, "revision": 0, "author": author,
             **({"description": description} if description else {})}
        atomic_write_json(project_dir(pid) / "scenarios" / f"{sid}.json", s)
        _touch(pid, scenarioIds=[*meta.get("scenarioIds", []), sid])
        audit(pid, author, "scenario.create", {"scenarioId": sid, "copyFrom": copy_from})
        return {k: v for k, v in s.items() if k != "operations"} | {"opCount": len(base_ops)}


def patch_scenario(pid: str, sid: str, changes: dict, author: str) -> dict:
    with _lock(pid):
        path = project_dir(pid) / "scenarios" / f"{safe_id(sid, 'scenario id')}.json"
        cur = read_json(path)
        if not cur:
            raise NotFound("Scenario inesistente")
        if cur.get("isBaseline"):
            raise Conflict("Lo stato attuale non è modificabile")
        allowed = {k: v for k, v in changes.items() if k in {"name", "description", "locked", "archived"}}
        nxt = {**cur, **allowed, "updatedAt": now_iso()}
        atomic_write_json(path, nxt)
        audit(pid, author, "scenario.update", {"scenarioId": sid, **allowed})
        return {k: v for k, v in nxt.items() if k != "operations"} | {"opCount": len(nxt.get("operations") or [])}


def delete_scenario(pid: str, sid: str, author: str) -> None:
    with _lock(pid):
        meta = get_meta(pid)
        path = project_dir(pid) / "scenarios" / f"{safe_id(sid, 'scenario id')}.json"
        cur = read_json(path)
        if not cur:
            raise NotFound("Scenario inesistente")
        if cur.get("isBaseline"):
            raise Conflict("Lo stato attuale non si elimina")
        snapshot(pid, author, f"Prima di eliminare {cur.get('name')}", automatic=True)
        path.unlink()
        ids = [x for x in meta.get("scenarioIds", []) if x != sid]
        active = meta.get("activeScenarioId")
        _touch(pid, scenarioIds=ids, activeScenarioId=active if active != sid else (ids[1] if len(ids) > 1 else "baseline"))
        audit(pid, author, "scenario.delete", {"scenarioId": sid})


def get_doc(pid: str, name: str) -> Any:
    if name not in DOC_NAMES:
        raise NotFound("Documento sconosciuto")
    get_meta(pid)
    return read_json(project_dir(pid) / "docs" / f"{name}.json")


def put_doc(pid: str, name: str, data: Any, author: str) -> None:
    if name not in DOC_NAMES:
        raise NotFound("Documento sconosciuto")
    raw = json.dumps(data)
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("Documento troppo grande (> 20 MB)")
    with _lock(pid):
        atomic_write_json(project_dir(pid) / "docs" / f"{name}.json", data)
        _touch(pid)
        audit(pid, author, "doc.save", {"doc": name})


def put_thumbnail(pid: str, png: bytes) -> None:
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > 3 * 1024 * 1024:
        raise ValueError("Miniatura non valida (PNG ≤ 3 MB)")
    get_meta(pid)
    atomic_write_bytes(project_dir(pid) / "thumbnail.png", png)


def audit(pid: str, author: str, action: str, details: dict) -> None:
    line = json.dumps({"id": uuid.uuid4().hex[:12], "at": now_iso(), "author": author, "action": action, "details": details}, ensure_ascii=False)
    p = project_dir(pid) / "audit.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    event = _WEBHOOK_EVENTS.get(action)
    if event:
        from app.platform import integrations
        integrations.emit(event, {"projectId": pid, "author": author, **details})


_WEBHOOK_EVENTS = {
    "project.create": "project.created", "project.duplicate": "project.created", "project.import": "project.created",
    "project.archive": "project.archived", "baseline.patch": "project.updated", "doc.save": "project.updated",
    "scenario.save": "scenario.saved", "scenario.create": "scenario.created", "scenario.update": "scenario.saved",
    "scenario.delete": "scenario.deleted", "snapshot.create": "snapshot.created", "civic.publish": "publication.created",
}


def read_audit(pid: str, limit: int = 200) -> list[dict]:
    p = project_dir(pid) / "audit.jsonl"
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()[-limit:]
    return [json.loads(x) for x in reversed(lines) if x.strip()]


def snapshot(pid: str, author: str, label: str, automatic: bool = False) -> dict:
    with _lock(pid):
        d = project_dir(pid)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        target = d / "snapshots" / stamp
        target.mkdir(parents=True)
        shutil.copy2(d / "project.json", target / "project.json")
        shutil.copytree(d / "scenarios", target / "scenarios")
        if (d / "docs").exists():
            shutil.copytree(d / "docs", target / "docs")
        info = {"id": stamp, "label": label[:160], "author": author, "at": now_iso(), "automatic": automatic}
        atomic_write_json(target / "snapshot.json", info)
        # Keep the 30 most recent automatic snapshots.
        autos = sorted(p for p in (d / "snapshots").iterdir() if (read_json(p / "snapshot.json") or {}).get("automatic"))
        for old in autos[:-30]:
            shutil.rmtree(old, ignore_errors=True)
        audit(pid, author, "snapshot.create", {"snapshot": stamp, "label": label, "automatic": automatic})
        return info


def list_snapshots(pid: str) -> list[dict]:
    d = project_dir(pid) / "snapshots"
    if not d.exists():
        return []
    return sorted((read_json(p / "snapshot.json") for p in d.iterdir() if (p / "snapshot.json").exists()), key=lambda x: x["at"], reverse=True)


def restore_snapshot(pid: str, snap_id: str, author: str) -> dict:
    with _lock(pid):
        d = project_dir(pid)
        src = d / "snapshots" / safe_id(snap_id, "snapshot id")
        if not (src / "snapshot.json").exists():
            raise NotFound("Snapshot inesistente")
        snapshot(pid, author, "Prima del ripristino", automatic=True)
        shutil.rmtree(d / "scenarios")
        shutil.copytree(src / "scenarios", d / "scenarios")
        if (src / "docs").exists():
            shutil.rmtree(d / "docs", ignore_errors=True)
            shutil.copytree(src / "docs", d / "docs")
        meta = read_json(src / "project.json")
        # The baseline is versioned (existing-state imports): bring back the revision the snapshot used.
        rev = int(meta.get("baselineRevision") or 0)
        current = int(read_json(d / "project.json").get("baselineRevision") or 0)
        if rev != current:
            archived = d / "baselines" / f"rev-{rev}.json.gz"
            if archived.exists():
                _archive_baseline(d, current)
                shutil.copy2(archived, d / "baseline.json.gz")
        atomic_write_json(d / "project.json", {**meta, "updatedAt": now_iso()})
        audit(pid, author, "snapshot.restore", {"snapshot": snap_id})
        return get_meta(pid)


SECTION_KINDS = {"sidewalk", "furniture", "parking", "cycle", "bus", "lane", "median", "green", "shoulder", "curb"}
PROV_KINDS = {"existing", "osm", "measured", "derived", "estimated"}


def _archive_baseline(d: Path, rev: int) -> None:
    target = d / "baselines" / f"rev-{rev}.json.gz"
    if not target.exists():
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(d / "baseline.json.gz", target)


def _valid_section(road: dict, section: Any) -> dict:
    els = section.get("elements") if isinstance(section, dict) else None
    if not isinstance(els, list) or not els or len(els) > 40:
        raise ValueError("Sezione non valida")
    lane_ids = {lane["id"] for lane in road.get("lanes") or []}
    out = []
    for e in els:
        if not isinstance(e, dict) or e.get("kind") not in SECTION_KINDS:
            raise ValueError("Elemento di sezione non valido")
        w = e.get("widthM")
        if not isinstance(w, (int, float)) or not 0.1 <= w <= 30:
            raise ValueError("Larghezza fuori intervallo (0,1–30 m)")
        if not isinstance(e.get("id"), str) or len(e["id"]) > 160:
            raise ValueError("Id elemento non valido")
        if e.get("laneId") is not None and e["laneId"] not in lane_ids:
            raise ValueError("Corsia inesistente nella sezione")
        out.append({k: e[k] for k in ("id", "kind", "widthM", "laneId", "material") if k in e})
    return {"elements": out}


def patch_baseline_roads(pid: str, roads: Any, label: str, provenance_key: str, provenance: Any, author: str) -> dict:
    """Update the existing state (cross sections only) of baseline roads, e.g. imported sidewalks.

    Operations keep working: they reference road ids, which do not change. A snapshot is taken first and
    the previous baseline revision is archived, so the update can always be undone from Cronologia.
    """
    if not isinstance(roads, dict) or not roads or len(roads) > 20000:
        raise ValueError("Nessuna strada da aggiornare")
    if not isinstance(provenance, dict) or provenance.get("kind") not in PROV_KINDS or not str(provenance.get("source") or "").strip():
        raise ValueError("Provenienza obbligatoria (stato esistente)")
    if provenance_key not in {"sidewalks", "width"}:
        raise ValueError("Chiave di provenienza non ammessa")
    prov = {"kind": provenance["kind"], "source": str(provenance["source"])[:300]}
    with _lock(pid):
        d = project_dir(pid)
        meta = get_meta(pid)
        base = read_baseline(pid)
        for rid, sec in roads.items():
            if rid not in base["roads"]:
                raise NotFound(f"Strada inesistente nella baseline: {rid}")
            road = base["roads"][rid]
            road["section"] = _valid_section(road, sec)
            road["provenance"] = {**(road.get("provenance") or {}), provenance_key: prov}
        snapshot(pid, author, f"Prima di: {label}"[:160], automatic=True)
        rev = int(meta.get("baselineRevision") or 0)
        _archive_baseline(d, rev)
        atomic_write_json(d / "baseline.json.gz", base, gz=True)
        if meta.get("large"):
            tiles.build_tiles(d, base)
        meta = {**read_json(d / "project.json"), "baselineRevision": rev + 1, "updatedAt": now_iso()}
        atomic_write_json(d / "project.json", meta)
        audit(pid, author, "baseline.patch", {"label": label[:160], "roads": len(roads), "provenance": prov, "revision": rev + 1})
        return get_meta(pid)


def duplicate_project(pid: str, author: str) -> dict:
    src = project_dir(pid)
    meta = get_meta(pid)
    new_id = "p-" + uuid.uuid4().hex[:12]
    dst = project_dir(new_id)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("snapshots", "audit.jsonl"))
    created = now_iso()
    atomic_write_json(dst / "project.json", {**meta, "id": new_id, "name": f"{meta['name']} (copia)", "createdAt": created, "updatedAt": created, "status": "draft", "author": author})
    audit(new_id, author, "project.duplicate", {"from": pid})
    return get_meta(new_id)


def export_package(pid: str) -> bytes:
    d = project_dir(pid)
    get_meta(pid)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in d.rglob("*"):
            if p.is_file() and "snapshots" not in p.relative_to(d).parts:
                z.write(p, p.relative_to(d).as_posix())
        z.writestr("PACKAGE.json", json.dumps({"format": "drip-urban-project", "schemaVersion": 1, "exportedAt": now_iso()}))
    return buf.getvalue()


def import_package(data: bytes, author: str) -> dict:
    if len(data) > SETTINGS.max_upload_bytes:
        raise ValueError("Pacchetto troppo grande")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("Il file non è un pacchetto DRIP Urban (.zip)") from exc
    names = z.namelist()
    if "PACKAGE.json" not in names or "project.json" not in names or "baseline.json.gz" not in names:
        raise ValueError("Pacchetto incompleto: servono PACKAGE.json, project.json, baseline.json.gz")
    total = 0
    for info in z.infolist():
        p = Path(info.filename)
        if p.is_absolute() or ".." in p.parts or info.filename.startswith(("/", "\\")):
            raise ValueError(f"Percorso non ammesso nel pacchetto: {info.filename}")
        if p.parts and p.parts[0] not in {"project.json", "baseline.json.gz", "scenarios", "docs", "thumbnail.png", "PACKAGE.json", "audit.jsonl"}:
            raise ValueError(f"Voce non ammessa nel pacchetto: {info.filename}")
        total += info.file_size
    if total > 400 * 1024 * 1024:
        raise ValueError("Pacchetto troppo grande una volta estratto")
    meta = json.loads(z.read("project.json"))
    new_id = "p-" + uuid.uuid4().hex[:12]
    dst = project_dir(new_id)
    dst.mkdir(parents=True)
    for info in z.infolist():
        if info.is_dir() or info.filename == "PACKAGE.json":
            continue
        out = dst / Path(info.filename)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(z.read(info))
    for s in (dst / "scenarios").glob("*.json"):
        safe_id(s.stem, "scenario id")
    atomic_write_json(dst / "project.json", {**meta, "id": new_id, "updatedAt": now_iso(), "importedAt": now_iso()})
    audit(new_id, author, "project.import", {"originalId": meta.get("id")})
    return get_meta(new_id)


def archive_project(pid: str, author: str) -> dict:
    with _lock(pid):
        audit(pid, author, "project.archive", {})
        return _touch(pid, status="archived")
