"""Terrain (DTM): grid sizing, ESRI ASCII Grid import in UTM, Open-Meteo sampling, API routes."""
import math

import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("terrain"), "open")


def _plane_asc(bbox, zone=33, cell=10.0, nodata_corner=False):
    """A UTM ASCII grid covering bbox with z = 100 + 0.01·E' + 0.02·N' (E', N' from the lower-left corner)."""
    from app.terrain import to_utm
    w, s, e, n = bbox
    xs = [to_utm(lon, lat, zone)[0] for lon in (w, e) for lat in (s, n)]
    ys = [to_utm(lon, lat, zone)[1] for lon in (w, e) for lat in (s, n)]
    x0, y0 = min(xs) - 50, min(ys) - 50
    ncols, nrows = int((max(xs) + 50 - x0) / cell) + 1, int((max(ys) + 50 - y0) / cell) + 1
    rows = []
    for r in range(nrows):
        y = y0 + (nrows - 1 - r) * cell
        rows.append(" ".join("-9999" if nodata_corner and r == 0 and c == 0 else f"{100 + 0.01 * (x0 + c * cell - x0) + 0.02 * (y - y0):.3f}" for c in range(ncols)))
    head = f"ncols {ncols}\nnrows {nrows}\nxllcenter {x0}\nyllcenter {y0}\ncellsize {cell}\nNODATA_value -9999\n"
    return head + "\n".join(rows) + "\n", (x0, y0)


def test_grid_shape_is_capped():
    from app.terrain import MAX_CELLS, grid_shape
    nx, ny = grid_shape([14.0, 40.0, 15.0, 41.0], 10)
    assert nx * ny <= MAX_CELLS and nx > 100 and ny > 100
    assert grid_shape([14.27, 40.93, 14.28, 40.94], 60) == (15, 20)


def test_ascii_grid_in_utm_is_resampled_on_lonlat():
    from app.terrain import resample_ascii, to_utm
    bbox = [14.27, 40.93, 14.28, 40.94]
    text, (x0, y0) = _plane_asc(bbox, nodata_corner=True)
    g = resample_ascii(text, 32633, bbox)
    assert g["coverage"] == 1 and len(g["z"]) == g["nx"] * g["ny"]
    # Centre cell: the plane value at the UTM position of that lon/lat.
    i, j = g["nx"] // 2, g["ny"] // 2
    lon, lat = 14.27 + 0.01 * i / (g["nx"] - 1), 40.93 + 0.01 * j / (g["ny"] - 1)
    x, y = to_utm(lon, lat, 33)
    assert g["z"][j * g["nx"] + i] == pytest.approx(100 + 0.01 * (x - x0) + 0.02 * (y - y0), abs=0.05)
    with pytest.raises(ValueError):
        resample_ascii(text, 32632, bbox)  # wrong zone: grid falls outside the project
    with pytest.raises(ValueError):
        resample_ascii("ncols 2\nnrows 2\n1 2\n3 4\n", 4326, bbox)


def test_open_meteo_sampling_and_fill():
    from app.terrain import fetch_open_meteo
    calls = []

    class Resp:
        status_code = 200

        def __init__(self, n, lats):
            self._n, self._lats = n, lats

        def raise_for_status(self):
            pass

        def json(self):
            # Elevation = 50 + 1000·(lat − 40.93); one missing value to exercise the fill.
            vals = [50 + 1000 * (la - 40.93) for la in self._lats]
            if len(calls) == 1:
                vals[0] = None
            return {"elevation": vals}

    class Client:
        def get(self, url, params=None):
            lats = [float(v) for v in params["latitude"].split(",")]
            calls.append(len(lats))
            assert url.endswith("/v1/elevation") and len(lats) <= 100
            return Resp(len(lats), lats)

    g = fetch_open_meteo([14.27, 40.93, 14.28, 40.94], 60, client=Client())
    assert sum(calls) == g["nx"] * g["ny"] and len(calls) == math.ceil(g["nx"] * g["ny"] / 100)
    assert all(math.isfinite(v) for v in g["z"])
    assert g["z"][-1] == pytest.approx(60, abs=0.01) and "Copernicus" in g["source"]


def test_upload_route_saves_the_terrain_document(client):
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "DTM"}).json()["id"]
    bbox = client.get(f"/api/projects/{pid}").json()["bbox"]
    text, _ = _plane_asc(bbox, cell=25.0)
    r = client.post(f"/api/projects/{pid}/terrain/upload?epsg=32633", files={"file": ("dtm.asc", text.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    doc = client.get(f"/api/projects/{pid}/docs/terrain").json()
    assert doc["grid"]["nx"] == r.json()["nx"] and doc["grid"]["source"].startswith("DTM da file")
    bad = client.post(f"/api/projects/{pid}/terrain/upload?epsg=3003", files={"file": ("dtm.asc", text.encode(), "text/plain")})
    assert bad.status_code == 400
    assert client.post(f"/api/projects/{pid}/terrain/fetch", json={"spacingM": 5}).status_code == 400


def _las(points, fmt=1, ver=(1, 2)):
    """Minimal LAS: header 227 bytes, scale 0.01, points (x, y, z, class)."""
    import struct
    rec = {0: 20, 1: 28}[fmt]
    head = bytearray(227)
    head[0:4] = b"LASF"
    head[24], head[25] = ver
    struct.pack_into("<H", head, 94, 227)
    struct.pack_into("<I", head, 96, 227)
    head[104] = fmt
    struct.pack_into("<H", head, 105, rec)
    struct.pack_into("<I", head, 107, len(points))
    struct.pack_into("<6d", head, 131, 0.01, 0.01, 0.01, 0.0, 0.0, 0.0)
    body = bytearray()
    for x, y, z, c in points:
        r = bytearray(rec)
        struct.pack_into("<3i", r, 0, round(x / 0.01), round(y / 0.01), round(z / 0.01))
        r[15] = c
        body += r
    return bytes(head + body)


def _plane_points(bbox, step=8.0, zone=33):
    from app.terrain import to_utm
    w, s, e, n = bbox
    xs = [to_utm(lon, lat, zone)[0] for lon in (w, e) for lat in (s, n)]
    ys = [to_utm(lon, lat, zone)[1] for lon in (w, e) for lat in (s, n)]
    x0, y0 = min(xs) - 30, min(ys) - 30
    pts = []
    y = y0
    while y < max(ys) + 30:
        x = x0
        while x < max(xs) + 30:
            z = 50 + 0.01 * (x - x0) + 0.02 * (y - y0)
            pts.append((x, y, z, 2))
            pts.append((x + 1, y + 1, z + 10, 6))  # roof points (class 6) must be ignored
            x += step
        y += step
    return pts, (x0, y0)


@pytest.mark.parametrize("fmt", [0, 1])
def test_las_point_cloud_to_dtm_uses_ground_points(fmt):
    from app.terrain import grid_from_points, read_las, to_utm
    bbox = [14.27, 40.93, 14.275, 40.935]
    pts, (x0, y0) = _plane_points(bbox)
    g = grid_from_points(*read_las(_las(pts, fmt)), 32633, bbox, 8.0, label="LAS")
    i, j = g["nx"] // 2, g["ny"] // 2
    lon, lat = 14.27 + 0.005 * i / (g["nx"] - 1), 40.93 + 0.005 * j / (g["ny"] - 1)
    x, y = to_utm(lon, lat, 33)
    assert g["z"][j * g["nx"] + i] == pytest.approx(50 + 0.01 * (x - x0) + 0.02 * (y - y0), abs=0.35)
    assert "LAS" in g["source"] and "terreno" in g["source"]


def test_xyz_and_laz_and_upload_route(client):
    from app.terrain import grid_from_points, read_xyz
    bbox = [14.27, 40.93, 14.275, 40.935]
    pts, _ = _plane_points(bbox, 10.0)
    text = "x;y;z;class\n" + "\n".join(f"{x:.2f};{y:.2f};{z:.2f};{c}" for x, y, z, c in pts)
    g = grid_from_points(*read_xyz(text), 32633, bbox, 10.0)
    assert g["coverage"] > 0.9
    pid = client.post("/api/projects", json={"template": "frattamaggiore", "name": "LAS"}).json()["id"]
    pb = client.get(f"/api/projects/{pid}").json()["bbox"]
    pts2, _ = _plane_points(pb, 40.0)
    r = client.post(f"/api/projects/{pid}/terrain/upload?epsg=32633&spacing=40", files={"file": ("rilievo.las", _las(pts2), "application/octet-stream")})
    assert r.status_code == 200, r.text
    assert "LAS" in r.json()["source"]
    bad = client.post(f"/api/projects/{pid}/terrain/upload?epsg=32633", files={"file": ("x.laz", b"LASF", "application/octet-stream")})
    assert bad.status_code == 400 and "LAZ" in bad.text
