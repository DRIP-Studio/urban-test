from __future__ import annotations

from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app import civic, jobs, providers, transit
from app.city.legacy_city import convert_city
from app.projects import service as ps
from app.projects.migrate53 import legacy_summary, load_seed, migrate
from app.settings import SETTINGS, VERSION

app = FastAPI(title="DRIP Urban", version=VERSION)

TEMPLATES = [
    {"id": "frattamaggiore", "label": "Frattamaggiore", "kind": "municipality", "description": "Città intera da OpenStreetMap (acquisizione 17/09/2026): 2.922 strade, 4.053 edifici.", "baseline": "seed"},
    {"id": "traffic_study", "label": "Studio del traffico", "kind": "mobility_plan", "description": "Frattamaggiore con scenari prima/dopo per circolazione e sensi di marcia.", "baseline": "seed"},
    {"id": "junction_study", "label": "Studio di un incrocio", "kind": "junction", "description": "Analisi di un nodo: corsie, svolte, conflitti, piano semaforico.", "baseline": "seed"},
    {"id": "public_space", "label": "Spazio pubblico", "kind": "regeneration", "description": "Piazze, verde, arredo e materiali su base reale.", "baseline": "seed"},
    {"id": "transit_network", "label": "Rete TPL", "kind": "transit", "description": "Linee, fermate, frequenze e accessibilità a piedi.", "baseline": "seed"},
    {"id": "osm_area", "label": "Importa area da OSM", "kind": "district", "description": "Qualsiasi area: scarica strade, edifici e contesto da OpenStreetMap.", "baseline": "osm"},
    {"id": "empty", "label": "Area vuota", "kind": "neighbourhood", "description": "Nessuna rete esistente: progetto da zero su una porzione di territorio.", "baseline": "empty"},
]


def _author() -> str:
    return civic.user()["name"]


def _err(exc: Exception) -> HTTPException:
    if isinstance(exc, ps.NotFound):
        return HTTPException(404, str(exc))
    if isinstance(exc, ps.Conflict):
        return HTTPException(409, {"message": str(exc), "current": exc.current})
    if isinstance(exc, PermissionError):
        return HTTPException(403, str(exc))
    if isinstance(exc, (ValueError, FileNotFoundError)):
        return HTTPException(400, str(exc))
    raise exc


# ------------------------------------------------------------------ system

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "product": "DRIP Urban", "version": VERSION, "dataDir": str(SETTINGS.data_dir)}


@app.get("/api/user")
def get_user() -> dict:
    return {**civic.user(), "canPublish": civic.can_publish()}


@app.put("/api/user")
def put_user(body: dict = Body(...)) -> dict:
    try:
        return civic.set_user(str(body.get("name") or ""), str(body.get("role") or ""))
    except ValueError as exc:
        raise _err(exc) from exc


@app.get("/api/templates")
def templates() -> list[dict]:
    return TEMPLATES


# ------------------------------------------------------------------ projects

@app.get("/api/projects")
def projects(archived: bool = True) -> list[dict]:
    return ps.list_projects(include_archived=archived)


@app.post("/api/projects")
def create_project(body: dict = Body(...)) -> dict:
    tpl = next((t for t in TEMPLATES if t["id"] == body.get("template")), None)
    if not tpl:
        raise HTTPException(400, "Template sconosciuto")
    name = str(body.get("name") or tpl["label"])
    try:
        if tpl["baseline"] == "seed":
            baseline, _ = load_seed()
            return ps.create_project(name=name, kind=tpl["kind"], author=_author(), baseline=baseline,
                                     description=body.get("description"), source_label="OpenStreetMap contributors (ODbL), acquisizione 17/09/2026")
        if tpl["baseline"] == "empty":
            bbox = body.get("bbox")
            if not (isinstance(bbox, list) and len(bbox) == 4 and bbox[0] < bbox[2] and bbox[1] < bbox[3]):
                raise ValueError("Indica l'area (bbox ovest, sud, est, nord)")
            baseline = {"id": "empty", "name": str(body.get("city") or name), "bbox": bbox, "origin": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
                        "nodes": {}, "roads": {}, "buildings": {}, "features": {}, "assets": {}, "sources": [{"kind": "project", "source": "Area vuota"}]}
            return ps.create_project(name=name, kind=tpl["kind"], author=_author(), baseline=baseline, description=body.get("description"), source_label="Area vuota")
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc
    # OSM import runs as a job.
    bbox = body.get("bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4):
        raise HTTPException(400, "Indica l'area da importare")
    w, s, e, n = (float(x) for x in bbox)
    if (e - w) * (n - s) > 0.02:
        raise HTTPException(400, "Area troppo grande (massimo circa 4 × 5 km)")
    author = _author()

    def run(report):
        from app.osm.overpass import import_bbox
        report(0.05, "Download dati OpenStreetMap")
        nodes, edges, buildings, features, source, meta = import_bbox(s, w, n, e, True, include_context=True, return_meta=True,
                                                                     progress=lambda p, *a: report(0.05 + 0.75 * float(p), str(a[0]) if a else "Import"))
        report(0.85, "Conversione nel modello DRIP Urban")
        city = {"nodes": [x.model_dump(mode="json") for x in nodes.values()], "edges": [x.model_dump(mode="json") for x in edges.values()],
                "buildings": [x.model_dump(mode="json") for x in buildings.values()], "features": [x.model_dump(mode="json") for x in features.values()]}
        baseline, _ = convert_city(city, "osm-" + str(abs(hash((w, s, e, n))))[:10], str(body.get("city") or name), [w, s, e, n])
        if not baseline["roads"]:
            raise RuntimeError("Nessuna strada trovata nell'area scelta")
        meta_p = ps.create_project(name=name, kind=tpl["kind"], author=author, baseline=baseline, description=body.get("description"),
                                   source_label=f"OpenStreetMap contributors (ODbL), {source}")
        if meta.get("warnings"):
            ps.put_doc(meta_p["id"], "notes", {"importWarnings": meta["warnings"]}, author)
        return meta_p

    return {"job": jobs.start("osm_import", f"Import OSM · {name}", run)}


@app.get("/api/jobs/{jid}")
def job(jid: str) -> dict:
    j = jobs.get(jid)
    if not j:
        raise HTTPException(404, "Job inesistente")
    return j


@app.get("/api/projects/{pid}")
def get_project(pid: str) -> dict:
    try:
        return {**ps.get_meta(pid), "scenarios": ps.list_scenarios(pid)}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, body: dict = Body(...)) -> dict:
    try:
        return ps.update_meta(pid, body)
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.post("/api/projects/{pid}/archive")
def archive(pid: str) -> dict:
    try:
        return ps.archive_project(pid, _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.post("/api/projects/{pid}/duplicate")
def duplicate(pid: str) -> dict:
    try:
        return ps.duplicate_project(pid, _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/projects/{pid}/package")
def package(pid: str) -> Response:
    try:
        data = ps.export_package(pid)
        name = ps.get_meta(pid)["name"]
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in name)[:60]
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{safe}.drip-urban.zip"'})


@app.post("/api/projects/import")
async def import_package(file: UploadFile = File(...)) -> dict:
    data = await file.read(SETTINGS.max_upload_bytes + 1)
    try:
        return ps.import_package(data, _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/projects/{pid}/baseline")
def baseline(pid: str) -> Response:
    try:
        data = ps.baseline_bytes(pid)
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc
    return Response(data, media_type="application/json", headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=31536000, immutable"})


@app.get("/api/projects/{pid}/scenarios/{sid}")
def scenario(pid: str, sid: str) -> dict:
    try:
        return ps.get_scenario(pid, sid)
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.put("/api/projects/{pid}/scenarios/{sid}")
def save_scenario(pid: str, sid: str, body: dict = Body(...)) -> dict:
    try:
        return ps.save_scenario(pid, sid, body.get("scenario") or {}, body.get("baseRevision"), _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.post("/api/projects/{pid}/scenarios")
def new_scenario(pid: str, body: dict = Body(...)) -> dict:
    try:
        return ps.create_scenario(pid, str(body.get("name") or "Nuovo scenario"), _author(), body.get("copyFrom"), body.get("description"))
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.patch("/api/projects/{pid}/scenarios/{sid}")
def patch_scenario(pid: str, sid: str, body: dict = Body(...)) -> dict:
    try:
        return ps.patch_scenario(pid, sid, body, _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.delete("/api/projects/{pid}/scenarios/{sid}")
def delete_scenario(pid: str, sid: str) -> dict:
    try:
        ps.delete_scenario(pid, sid, _author())
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/projects/{pid}/docs/{name}")
def get_doc(pid: str, name: str) -> Any:
    try:
        return ps.get_doc(pid, name)
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.put("/api/projects/{pid}/docs/{name}")
def put_doc(pid: str, name: str, body: Any = Body(...)) -> dict:
    try:
        ps.put_doc(pid, name, body, _author())
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.put("/api/projects/{pid}/thumbnail")
async def put_thumb(pid: str, request: Request) -> dict:
    try:
        ps.put_thumbnail(pid, await request.body())
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/projects/{pid}/thumbnail")
def get_thumb(pid: str) -> FileResponse:
    p = ps.project_dir(pid) / "thumbnail.png"
    if not p.exists():
        raise HTTPException(404, "Nessuna miniatura")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/projects/{pid}/snapshots")
def snapshots(pid: str) -> list[dict]:
    return ps.list_snapshots(pid)


@app.post("/api/projects/{pid}/snapshots")
def make_snapshot(pid: str, body: dict = Body(default={})) -> dict:
    try:
        return ps.snapshot(pid, _author(), str(body.get("label") or "Salvataggio manuale"))
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.post("/api/projects/{pid}/snapshots/{snap}/restore")
def restore(pid: str, snap: str) -> dict:
    try:
        return ps.restore_snapshot(pid, snap, _author())
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/projects/{pid}/audit")
def audit(pid: str, limit: int = 200) -> list[dict]:
    return ps.read_audit(pid, min(1000, max(1, limit)))


# ------------------------------------------------------------------ migration from 53.x

@app.get("/api/migration/legacy")
def migration_status() -> dict:
    s = legacy_summary()
    done = [p for p in ps.list_projects() if p.get("source", "").startswith("Migrazione DRIP Urban 53")]
    return {"available": bool(s), "summary": s, "migratedProjects": [p["id"] for p in done]}


@app.post("/api/migration/legacy")
def run_migration() -> dict:
    try:
        baseline, _, scenarios, report = migrate()
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc
    if not scenarios:
        raise HTTPException(400, "Nessuno scenario con modifiche da migrare")
    meta = ps.create_project(name="Frattamaggiore · progetto 53.0", kind="municipality", author=_author(), baseline=baseline,
                             description="Lavoro migrato da DRIP Urban Planning Studio 53.0. Il report elenca ciò che non è stato convertito.",
                             source_label="Migrazione DRIP Urban 53.0 · OpenStreetMap contributors (ODbL)", scenarios=scenarios)
    ps.put_doc(meta["id"], "migration", {"from": str(SETTINGS.legacy_data_dir), "report": report}, _author())
    return {"project": meta, "report": report}


# ------------------------------------------------------------------ providers / data

@app.get("/api/providers")
def provider_status() -> list[dict]:
    return providers.status()


@app.put("/api/providers/{name}")
def provider_save(name: str, body: dict = Body(...)) -> list[dict]:
    try:
        providers.save(name, body.get("value"))
    except ValueError as exc:
        raise _err(exc) from exc
    return providers.status()


@app.post("/api/providers/{name}/test")
def provider_test(name: str) -> dict:
    return providers.test(name)


@app.get("/api/traffic/live")
def traffic_live(bbox: str) -> dict:
    try:
        b = [float(x) for x in bbox.split(",")]
        assert len(b) == 4 and (b[2] - b[0]) * (b[3] - b[1]) < 0.05
    except (ValueError, AssertionError) as exc:
        raise HTTPException(400, "bbox non valido o troppo grande") from exc
    return providers.here_flow(b)


@app.get("/api/environment")
def environment(lat: float, lon: float) -> dict:
    return providers.weather_and_air(lat, lon)


@app.get("/api/geocode")
def geocode(q: str, bbox: str | None = None) -> list[dict]:
    if not (2 <= len(q) <= 200):
        raise HTTPException(400, "Ricerca 2–200 caratteri")
    try:
        return providers.geocode(q, [float(x) for x in bbox.split(",")] if bbox else None)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Geocoder non raggiungibile: {exc}") from exc


@app.get("/api/tiles/google/{map_type}/{z}/{x}/{y}")
def google_tile(map_type: str, z: int, x: int, y: int) -> Response:
    if map_type not in {"satellite", "roadmap", "terrain"}:
        raise HTTPException(400, "Tipo mappa non valido")
    t = providers.google_tile(map_type, z, x, y)
    if not t:
        raise HTTPException(404, "Google Map Tiles non configurato o non disponibile")
    return Response(t[0], media_type=t[1], headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/projects/{pid}/gtfs")
async def gtfs_upload(pid: str, file: UploadFile | None = File(None), url: str | None = None) -> dict:
    try:
        if file is not None:
            feed = transit.import_gtfs(await file.read(SETTINGS.max_upload_bytes + 1), file.filename or "GTFS caricato")
        elif url:
            feed = transit.import_gtfs_url(url)
        else:
            raise ValueError("Carica un file GTFS o indica un URL")
        doc = ps.get_doc(pid, "transit") or {}
        doc["gtfs"] = feed
        ps.put_doc(pid, "transit", doc, _author())
        return {"routes": len(feed["routes"]), "stops": len(feed["stops"]), "agencies": feed["agencies"]}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/transit/realtime")
def gtfs_rt() -> dict:
    url = providers.provider_secret("gtfs_rt")
    if not url:
        return {"status": "not_configured", "vehicles": []}
    try:
        return transit.realtime_vehicles(url)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "message": str(exc)[:300], "vehicles": []}


# ------------------------------------------------------------------ civic

@app.get("/api/civic/fst/{kind}")
def fst_public(kind: str) -> dict:
    try:
        return civic.fst_public(kind)
    except ValueError as exc:
        raise _err(exc) from exc


@app.get("/api/civic/publications")
def publications(projectId: str | None = None) -> list[dict]:
    return [p for p in civic.list_publications(projectId)]


@app.post("/api/projects/{pid}/publish")
def publish(pid: str, body: dict = Body(...)) -> dict:
    try:
        ps.get_meta(pid)
        rec = civic.publish(pid, body)
        ps.audit(pid, _author(), "civic.publish", {"publication": rec["id"], "scenarioId": rec["scenarioId"]})
        return {k: v for k, v in rec.items() if k != "geometry"}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


@app.get("/api/civic/publications/{pub}")
def publication(pub: str) -> dict:
    rec = civic.get_publication(pub)
    if not rec:
        raise HTTPException(404, "Pubblicazione inesistente")
    if rec.get("withdrawnAt"):
        raise HTTPException(410, {"message": "Pubblicazione ritirata", "withdrawnAt": rec["withdrawnAt"]})
    return rec


@app.post("/api/civic/publications/{pub}/withdraw")
def withdraw(pub: str) -> dict:
    try:
        civic.withdraw(pub)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise _err(exc) from exc


# ------------------------------------------------------------------ static assets & web app

@app.get("/catalog/signs.json")
def signs_catalog() -> FileResponse:
    return FileResponse(SETTINGS.signs_dir / "catalog.json", media_type="application/json")


@app.get("/catalog/{name}.json")
def catalog(name: str) -> FileResponse:
    if name not in {"furniture", "materials"}:
        raise HTTPException(404)
    return FileResponse(SETTINGS.signs_dir.parents[1] / name / "catalog.json", media_type="application/json")


app.mount("/signs", StaticFiles(directory=SETTINGS.signs_dir / "clean"), name="signs")
app.mount("/brand", StaticFiles(directory=SETTINGS.brand_dir), name="brand")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str) -> Response:
    dist = SETTINGS.web_dist
    if path.startswith("api/"):
        raise HTTPException(404)
    target = (dist / path).resolve()
    if path and target.is_file() and dist.resolve() in target.parents:
        cache = "public, max-age=31536000, immutable" if "/assets/" in f"/{path}" else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    index = dist / "index.html"
    if not index.exists():
        return JSONResponse({"error": "Interfaccia non compilata: eseguire npm run build"}, status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
