"""Urban plan (PUC/PRG): zoning import from GeoJSON, DM 1444 class detection, project document."""
import json

import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("urbanplan"), "open")


def _layer(bbox):
    w, s, e, n = bbox
    cx, cy = (w + e) / 2, (s + n) / 2
    d = min(e - w, n - s) / 6

    def sq(x, y):
        return [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]

    feats = [
        {"type": "Feature", "properties": {"ZONA": "B1", "DESCR": "Completamento", "IF": "3,5"}, "geometry": {"type": "Polygon", "coordinates": sq(cx - d, cy - d)}},
        {"type": "Feature", "properties": {"ZONA": "Zona A centro storico", "DESCR": "Centro"}, "geometry": {"type": "Polygon", "coordinates": sq(cx, cy)}},
        {"type": "Feature", "properties": {"ZONA": "F2", "DESCR": "Attrezzature"}, "geometry": {"type": "MultiPolygon", "coordinates": [sq(cx - d, cy), sq(cx + d, cy + d)]}},
        {"type": "Feature", "properties": {"ZONA": "C"}, "geometry": {"type": "Polygon", "coordinates": sq(w - 1, s - 1)}},  # far away
    ]
    return json.dumps({"type": "FeatureCollection", "features": feats}).encode()


def test_preview_and_import_zones(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "PUC"}).json()["id"]
    bbox = client.get(f"/api/projects/{pid}").json()["bbox"]
    data = _layer(bbox)
    pv = client.post(f"/api/projects/{pid}/urbanplan/preview", files={"file": ("puc.geojson", data, "application/json")})
    assert pv.status_code == 200, pv.text
    p = pv.json()
    assert p["count"] == 4 and p["insideProject"] == 3
    assert p["suggested"]["codeField"] == "ZONA" and p["suggested"]["nameField"] == "DESCR"
    assert p["classes"]["B"] == 1 and p["classes"]["A"] == 1 and p["classes"]["F"] == 1

    opts = json.dumps({"codeField": "ZONA", "nameField": "DESCR", "indexField": "IF", "source": "PUC test"})
    r = client.post(f"/api/projects/{pid}/urbanplan/import", files={"file": ("puc.geojson", data, "application/json")}, data={"opts": opts})
    assert r.status_code == 200, r.text
    assert r.json()["zones"] == 4 and r.json()["skipped"] == 1  # multipolygon → 2 zones; far feature skipped
    doc = client.get(f"/api/projects/{pid}/docs/urbanplan").json()
    b = next(z for z in doc["zones"] if z["code"] == "B1")
    assert b["dm1444"] == "B" and b["rules"]["maxIndexFondiario"] == 3.5
    assert any("PUC test" in s for s in doc["sources"])

    bad = client.post(f"/api/projects/{pid}/urbanplan/preview", files={"file": ("puc.dwg", b"x", "application/octet-stream")})
    assert bad.status_code == 400
