"""Official technical maps (WMS): tile maths, configuration validation, SSRF-safe proxy."""
import pytest

from tests.test_api import fresh_app

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
O = 20037508.342789244


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("wms"), "open")


def test_tile_bbox_mercator(client):
    from app import wms
    assert wms.tile_bbox_3857(0, 0, 0) == pytest.approx((-O, -O, O, O))
    assert wms.tile_bbox_3857(1, 1, 0) == pytest.approx((0, 0, 20037508.34, 20037508.34))
    assert wms.tile_bbox_3857(1, 0, 1) == pytest.approx((-O, -O, 0, 0))


def test_tile_bbox_4326_axis_order(client):
    from app import wms
    w, s, e, n = wms.tile_bbox(1, 1, 0, "EPSG:4326", "1.1.1")
    assert (w, s, e) == pytest.approx((0, 0, 180)) and n == pytest.approx(85.0511, abs=1e-3)
    # WMS 1.3.0 with EPSG:4326 is latitude first.
    assert wms.tile_bbox(1, 1, 0, "EPSG:4326", "1.3.0") == pytest.approx((s, w, n, e))
    p = wms.getmap_params({"layers": "L", "version": "1.1.1", "crs": "EPSG:3857", "format": "image/jpeg", "transparent": True}, 0, 0, 0)
    assert p["SRS"] == "EPSG:3857" and "CRS" not in p and p["TRANSPARENT"] == "FALSE" and p["WIDTH"] == "256"


def test_defaults_ship_catasto_preset(client):
    cfg = client.get("/api/platform/config").json()
    cat = next(s for s in cfg["wms"] if s["id"] == "catasto")
    assert cat["enabled"] and cat["kind"] == "overlay" and cat["layers"] == "CP.CadastralParcel"
    assert cat["url"].startswith("https://wms.cartografia.agenziaentrate.gov.it/")
    ctr = next(s for s in cfg["wms"] if s["id"] == "ctr")
    assert not ctr["enabled"] and ctr["url"] == ""
    assert [s["id"] for s in client.get("/api/tiles/wms").json()] == ["catasto"]


def test_validation_rejects_http_and_too_many(client):
    base = {"id": "x", "label": "X", "url": "http://example.org/wms", "layers": "a", "enabled": False}
    r = client.put("/api/platform/config", json={"wms": [base]})
    assert r.status_code == 400 and "https://" in r.json()["detail"]
    many = [{**base, "id": f"s{i}", "url": "https://example.org/wms"} for i in range(21)]
    assert client.put("/api/platform/config", json={"wms": many}).status_code == 400
    bad_fmt = {**base, "url": "https://example.org/wms", "format": "image/gif"}
    assert client.put("/api/platform/config", json={"wms": [bad_fmt]}).status_code == 400
    enabled_without_url = {**base, "url": "", "enabled": True}
    assert client.put("/api/platform/config", json={"wms": [enabled_without_url]}).status_code == 400


def test_unknown_or_disabled_id_is_404_never_proxied(client, monkeypatch):
    import httpx
    calls = []
    monkeypatch.setattr(httpx, "get", lambda *a, **k: calls.append(a) or None)
    assert client.get("/api/tiles/wms/nope/1/0/0.png").status_code == 404
    assert client.get("/api/tiles/wms/ctr/1/0/0.png").status_code == 404  # preset without URL, disabled
    # A URL passed by the caller is never used.
    assert client.get("/api/tiles/wms/https%3A%2F%2Fevil.example/1/0/0.png").status_code == 404
    assert calls == []
    assert client.get("/api/tiles/wms/nope/test").json()["ok"] is False


def test_proxy_happy_path_cache_and_upstream_error(client, monkeypatch):
    import httpx
    from app import wms
    wms.clear_cache()
    seen = []

    def fake_get(url, params=None, timeout=None, headers=None, **kw):
        seen.append((url, params, timeout, headers))
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    monkeypatch.setattr(httpx, "get", fake_get)
    r = client.get("/api/tiles/wms/catasto/17/70000/48000.png")
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
    assert "max-age=86400" in r.headers["cache-control"]
    url, params, timeout, headers = seen[0]
    assert url == "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php"
    assert params["REQUEST"] == "GetMap" and params["LAYERS"] == "CP.CadastralParcel" and params["CRS"] == "EPSG:3857"
    assert params["TRANSPARENT"] == "TRUE" and timeout == 15 and headers["User-Agent"].startswith("DRIP-Urban/")
    # Second request is served from the in-memory cache.
    assert client.get("/api/tiles/wms/catasto/17/70000/48000.png").status_code == 200
    assert len(seen) == 1
    assert client.get("/api/tiles/wms/catasto/6/34/23/test").status_code == 404  # not a route
    t = client.get("/api/tiles/wms/catasto/test").json()
    assert t["ok"] and t["contentType"] == "image/png"

    # Upstream answers with a ServiceExceptionReport (XML, status 200) → 502 with the reason.
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, text="<ServiceExceptionReport>Layer non valido</ServiceExceptionReport>", headers={"content-type": "application/vnd.ogc.se_xml"}))
    r = client.get("/api/tiles/wms/catasto/17/70001/48000.png")
    assert r.status_code == 502 and "immagine" in r.json()["detail"]

    def boom(*a, **k):
        raise httpx.ConnectTimeout("timeout")
    monkeypatch.setattr(httpx, "get", boom)
    r = client.get("/api/tiles/wms/catasto/17/70002/48000.png")
    assert r.status_code == 502 and "non raggiungibile" in r.json()["detail"]
    assert client.get("/api/tiles/wms/catasto/2/9/0.png").status_code == 400  # x out of range


def test_cache_is_bounded(client, monkeypatch):
    import httpx
    from app import wms
    wms.clear_cache()
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, content=PNG, headers={"content-type": "image/png"}))
    for x in range(wms.CACHE_SIZE + 20):
        wms.tile("catasto", 12, x, 1500)
    assert len(wms._cache) == wms.CACHE_SIZE


def test_tiles_accessible_to_logged_in_viewer(tmp_path):
    c = fresh_app(tmp_path, "protected")
    assert c.get("/api/tiles/wms").status_code == 401
    c.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    c.post("/api/auth/password", json={"old": "admin", "new": "Frattamaggiore2026"})
    assert c.put("/api/auth/users", json={"username": "lettore", "name": "Lettore", "role": "viewer", "password": "Lettore-2026-xyz"}).status_code == 200
    c.post("/api/auth/logout")
    c.post("/api/auth/login", json={"username": "lettore", "password": "Lettore-2026-xyz"})
    c.post("/api/auth/password", json={"old": "Lettore-2026-xyz", "new": "Lettore-2026-nuova"})
    assert c.get("/api/tiles/wms").status_code == 200
    assert c.get("/api/tiles/wms/nope/1/0/0.png").status_code == 404
    # Configuration stays admin-only.
    assert c.put("/api/platform/config", json={"wms": []}).status_code == 403
