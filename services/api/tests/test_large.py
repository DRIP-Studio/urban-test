"""Large projects (whole cities): tiled baseline, work area subsets, whole-city overview."""
import gzip
import json

import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("large"), "open")


def _city():
    # 10 × 10 km grid of roads every 250 m (≈ 1 600 roads), buildings at every block.
    w, s = 12.40, 41.80
    dx, dy = 0.0030, 0.00225  # ≈ 250 m
    nodes, roads, buildings = {}, {}, {}
    for i in range(41):
        for j in range(41):
            nodes[f"n{i}_{j}"] = {"id": f"n{i}_{j}", "at": [w + i * dx, s + j * dy]}
    for i in range(40):
        for j in range(41):
            for rid, a, b in ((f"h{i}_{j}", f"n{i}_{j}", f"n{i + 1}_{j}"), (f"v{j}_{i}", f"n{j}_{i}", f"n{j}_{i + 1}")):
                roads[rid] = {"id": rid, "from": a, "to": b, "name": rid, "roadClass": "residential", "axis": [nodes[a]["at"], nodes[b]["at"]],
                              "oneway": "no", "speedKmh": 50, "lanes": [], "section": {"elements": []}, "provenance": {}}
    for i in range(40):
        for j in range(40):
            x, y = w + i * dx + dx / 3, s + j * dy + dy / 3
            buildings[f"b{i}_{j}"] = {"id": f"b{i}_{j}", "footprint": [[x, y], [x + dx / 3, y], [x + dx / 3, y + dy / 3], [x, y + dy / 3]], "heightM": 12, "minHeightM": 0, "provenance": {"kind": "osm", "source": "t"}}
    return {"id": "big", "name": "Città grande", "bbox": [w, s, w + 40 * dx, s + 40 * dy], "origin": [w + 20 * dx, s + 20 * dy],
            "nodes": nodes, "roads": roads, "buildings": buildings, "features": {}, "assets": {}, "sources": []}


def test_large_project_loads_a_work_area_and_an_overview(client):
    from app.projects import service as ps
    meta = ps.create_project(name="Roma test", kind="district", author="t", baseline=_city(), source_label="test")
    pid = meta["id"]
    assert meta["large"] is True and len(meta["workArea"]) == 4
    full = client.get(f"/api/projects/{pid}").json()
    assert full["large"] is True
    wa = full["workArea"]
    r = client.get(f"/api/projects/{pid}/baseline", params={"bbox": ",".join(str(x) for x in wa)})
    assert r.status_code == 200
    sub = r.json()
    total = len(_city()["roads"])
    assert 0 < len(sub["roads"]) < total / 5  # 3 × 3 km of 10 × 10 km (+150 m)
    assert all(n in sub["nodes"] for rd in sub["roads"].values() for n in (rd["from"], rd["to"]))
    assert sub["fullBbox"] == _city()["bbox"] and sub["buildings"]
    ov = client.get(f"/api/projects/{pid}/overview").json()
    assert len(ov["features"]) == total
    # The work area is clamped to 36 km² and to the project.
    big = client.patch(f"/api/projects/{pid}", json={"workArea": [12.0, 41.0, 13.0, 42.0]}).json()
    from app.projects.tiles import area_km2
    assert area_km2(big["workArea"]) <= 36.5
    assert big["workArea"][0] >= _city()["bbox"][0] - 1e-9


def test_import_limit_is_5000_km2(client):
    r = client.post("/api/projects", json={"template": "osm_area", "name": "Troppo", "bbox": [10.0, 40.0, 11.5, 41.0]})
    assert r.status_code == 400 and "5000" in r.text.replace(".", "")
