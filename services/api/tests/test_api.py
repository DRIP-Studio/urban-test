import io
import json
import os
import zipfile
from pathlib import Path

import pytest


def fresh_app(data: Path, auth_mode: str):
    """Imports the API from scratch against an isolated data folder (every module reads SETTINGS at import)."""
    import sys
    os.environ["DRIP_URBAN_DATA"] = str(data)
    os.environ["DRIP_URBAN_AUTH"] = auth_mode
    os.environ["DRIP_PLATFORM_URL"] = "http://127.0.0.1:9"  # unreachable: no network in tests
    for name in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[name]
    import app.main
    from fastapi.testclient import TestClient
    return TestClient(app.main.app)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("data"), "open")


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["version"] == "1.0.0"


def test_create_project_from_frattamaggiore_and_save_scenario(client):
    r = client.post("/api/projects", json={"template": "frattamaggiore", "name": "Test Fratta"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    p = client.get(f"/api/projects/{pid}").json()
    assert {s["id"] for s in p["scenarios"]} == {"baseline", "scenario-a"}
    base = client.get(f"/api/projects/{pid}/baseline")
    assert base.status_code == 200
    b = base.json()
    assert len(b["roads"]) == 2922 and len(b["buildings"]) == 4053

    op = {"id": "op1", "type": "road.update", "payload": {"roadId": next(iter(b["roads"])), "changes": {"speedKmh": 30}}, "author": "t", "at": "x"}
    r = client.put(f"/api/projects/{pid}/scenarios/scenario-a", json={"scenario": {"operations": [op]}, "baseRevision": 0})
    assert r.status_code == 200 and r.json()["revision"] == 1
    # Stale revision → conflict, nothing overwritten.
    r = client.put(f"/api/projects/{pid}/scenarios/scenario-a", json={"scenario": {"operations": []}, "baseRevision": 0})
    assert r.status_code == 409
    assert len(client.get(f"/api/projects/{pid}/scenarios/scenario-a").json()["operations"]) == 1
    # Baseline is read-only.
    r = client.put(f"/api/projects/{pid}/scenarios/baseline", json={"scenario": {"operations": [op]}})
    assert r.status_code == 409
    audit = client.get(f"/api/projects/{pid}/audit").json()
    assert any(a["action"] == "scenario.save" for a in audit)


def test_snapshot_restore_and_duplicate(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "Snap"}).json()["id"]
    snap = client.post(f"/api/projects/{pid}/snapshots", json={"label": "v1"}).json()
    client.put(f"/api/projects/{pid}/scenarios/scenario-a", json={"scenario": {"operations": [{"id": "a", "type": "x", "payload": {}}]}})
    client.post(f"/api/projects/{pid}/snapshots/{snap['id']}/restore")
    assert client.get(f"/api/projects/{pid}/scenarios/scenario-a").json()["operations"] == []
    dup = client.post(f"/api/projects/{pid}/duplicate").json()
    assert dup["id"] != pid and dup["name"].endswith("(copia)")


def test_package_roundtrip_and_traversal_rejected(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "Pkg"}).json()["id"]
    pkg = client.get(f"/api/projects/{pid}/package")
    assert pkg.status_code == 200
    r = client.post("/api/projects/import", files={"file": ("p.zip", pkg.content, "application/zip")})
    assert r.status_code == 200 and r.json()["id"] != pid
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("PACKAGE.json", "{}"); z.writestr("project.json", "{}"); z.writestr("baseline.json.gz", "")
        z.writestr("../evil.txt", "x")
    r = client.post("/api/projects/import", files={"file": ("p.zip", bad.getvalue(), "application/zip")})
    assert r.status_code == 400


def test_invalid_ids_rejected(client):
    assert client.get("/api/projects/..%2F..%2Fsettings").status_code in (400, 404)
    r = client.put("/api/projects/p-x/docs/../../x", json={})
    assert r.status_code in (400, 404, 405)


def test_civic_publish_requires_fields_and_role(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "Civic"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/publish", json={"title": "x"})
    assert r.status_code == 400
    body = {"title": "Via Roma più sicura", "summary": "Nuovi attraversamenti", "scenarioId": "scenario-a", "status": "proposta",
            "responsibleBody": "Comune di Frattamaggiore — Ufficio Tecnico", "geometry": {"after": {"type": "FeatureCollection", "features": []}}}
    rec = client.post(f"/api/projects/{pid}/publish", json=body).json()
    assert rec["publishedBy"] and rec["status"] == "proposta"
    client.put("/api/user", json={"name": "Ospite", "role": "viewer"})
    assert client.post(f"/api/projects/{pid}/publish", json=body).status_code == 403
    client.put("/api/user", json={"name": "Admin", "role": "admin"})
    client.post(f"/api/civic/publications/{rec['id']}/withdraw")
    assert client.get(f"/api/civic/publications/{rec['id']}").status_code == 410


def test_providers_never_return_secrets(client):
    client.put("/api/providers/here", json={"value": "SECRETKEY1234567890"})
    st = {p["id"]: p for p in client.get("/api/providers").json()}
    assert st["here"]["configured"] is True
    assert "SECRETKEY1234567890" not in json.dumps(st)
    client.put("/api/providers/here", json={"value": ""})
    assert client.get("/api/traffic/live", params={"bbox": "14.27,40.94,14.28,40.95"}).json()["status"] == "not_configured"


def test_migration_from_legacy_fixture(client, tmp_path):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    seed = json.loads(__import__("gzip").decompress((Path(__file__).parents[1] / "seed" / "frattamaggiore.legacy-map.json.gz").read_bytes()))
    some_edge = next(iter(seed))
    (legacy / "scenarios.json").write_text(json.dumps([
        {"id": "future", "name": "Scenario progetto", "operations": [{"id": "o1", "kind": "two_way", "edge_ids": [some_edge]}],
         "elements": [{"id": "e1", "kind": "tree", "geometry_type": "point", "points": [{"lon": 14.27, "lat": 40.94}], "properties": {"asset_type": "tree"}}],
         "added_nodes": [], "added_edges": [], "removed_edge_ids": [], "roundabouts": []},
        {"id": "v24-plan-test", "name": "V24", "elements": [{"id": "x"}]},
    ]), encoding="utf-8")
    from app.projects.migrate53 import migrate
    _, _, scenarios, report = migrate(legacy)
    assert len(scenarios) == 1
    types = [o["type"] for o in scenarios[0]["operations"]]
    assert "asset.add" in types
    assert any("collaudo" in r["reason"] for r in report)


def test_provider_keys_are_masked_and_redacted(client):
    import app.providers as providers
    secret = "AIzaTEST-secret-1234567890"
    assert client.put("/api/providers/google", json={"value": secret}).status_code == 200
    listed = client.get("/api/providers").json()
    google = next(p for p in listed if p["id"] == "google")
    assert google["configured"] and secret not in str(listed)
    # httpx errors echo the request URL, which carries the key: messages must not.
    msg = providers.redact(f"Client error for url https://tile.googleapis.com/v1/createSession?key={secret}")
    assert secret not in msg and "[chiave]" in msg
    # Only providers the product actually uses are offered.
    assert {p["id"] for p in listed} == {"here", "google", "gtfs_rt"}


def test_baseline_existing_state_patch_is_validated_versioned_and_restorable(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "Marciapiedi"}).json()["id"]
    base = client.get(f"/api/projects/{pid}/baseline").json()  # httpx undoes Content-Encoding: gzip
    rid, road = next((k, r) for k, r in base["roads"].items() if any(e["kind"] == "lane" for e in r["section"]["elements"]))
    lanes = [e for e in road["section"]["elements"] if e["kind"] == "lane"]
    new = {"elements": [{"id": f"{rid}:swl", "kind": "sidewalk", "widthM": 1.7}, *lanes, {"id": f"{rid}:swr", "kind": "sidewalk", "widthM": 2.1}]}
    prov = {"kind": "derived", "source": "test"}
    # Validation: unknown kinds, absurd widths and a "project" provenance are refused.
    assert client.patch(f"/api/projects/{pid}/baseline/roads", json={"roads": {rid: {"elements": [{"id": "x", "kind": "pool", "widthM": 1}]}}, "provenanceKey": "sidewalks", "provenance": prov}).status_code == 400
    assert client.patch(f"/api/projects/{pid}/baseline/roads", json={"roads": {rid: {"elements": [{"id": "x", "kind": "sidewalk", "widthM": 99}]}}, "provenanceKey": "sidewalks", "provenance": prov}).status_code == 400
    assert client.patch(f"/api/projects/{pid}/baseline/roads", json={"roads": {rid: new}, "provenanceKey": "sidewalks", "provenance": {"kind": "project", "source": "x"}}).status_code == 400
    r = client.patch(f"/api/projects/{pid}/baseline/roads", json={"roads": {rid: new}, "label": "Marciapiedi esistenti", "provenanceKey": "sidewalks", "provenance": prov})
    assert r.status_code == 200, r.text
    assert r.json()["baselineRevision"] == 1
    after = client.get(f"/api/projects/{pid}/baseline?rev=1").json()
    assert after["roads"][rid]["section"]["elements"][0]["widthM"] == 1.7
    assert after["roads"][rid]["provenance"]["sidewalks"]["kind"] == "derived"
    # The automatic snapshot taken before the update brings the original baseline back.
    snap = next(s for s in client.get(f"/api/projects/{pid}/snapshots").json() if s["label"].startswith("Prima di"))
    client.post(f"/api/projects/{pid}/snapshots/{snap['id']}/restore")
    restored = client.get(f"/api/projects/{pid}/baseline").json()
    assert restored["roads"][rid]["section"] == road["section"]
