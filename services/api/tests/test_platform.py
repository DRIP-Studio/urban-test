"""Platform layer: protected mode, provisional admin, roles, API keys, licence trial, API v1."""
import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("platform"), "protected")


def _admin(client):
    """Signs in as the administrator, completing the first-login password change if a test runs alone."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "Frattamaggiore2026"})
    if r.status_code != 200:
        _login(client)
        client.post("/api/auth/password", json={"old": "admin", "new": "Frattamaggiore2026"})


def _login(client, user="admin", pw="admin"):
    r = client.post("/api/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_protected_mode_requires_login(client):
    assert client.get("/api/health").status_code == 200
    s = client.get("/api/auth/session").json()
    assert s["mode"] == "protected" and not s["authenticated"] and "admin" in (s["provisionalHint"] or "")
    r = client.get("/api/projects")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "auth_required"


def test_wrong_password_is_refused(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_provisional_admin_must_change_password(client):
    u = _login(client)
    assert u["provisional"] and u["mustChangePassword"]
    r = client.get("/api/projects")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "must_change_password"
    weak = client.post("/api/auth/password", json={"old": "admin", "new": "short"})
    assert weak.status_code == 400
    ok = client.post("/api/auth/password", json={"old": "admin", "new": "Frattamaggiore2026"})
    assert ok.status_code == 200, ok.text
    assert client.get("/api/projects").status_code == 200
    assert client.get("/api/auth/session").json()["user"]["mustChangePassword"] is False


def test_viewer_is_read_only_and_cannot_self_promote(client):
    _admin(client)
    r = client.put("/api/auth/users", json={"username": "lettore", "name": "Lettore", "role": "viewer", "password": "Lettore12345"})
    assert r.status_code == 200, r.text
    client.post("/api/auth/logout")
    _login(client, "lettore", "Lettore12345")
    client.post("/api/auth/password", json={"old": "Lettore12345", "new": "Lettore123456X"})
    assert client.get("/api/projects").status_code == 200
    r = client.post("/api/projects", json={"template": "empty", "name": "x", "bbox": [14, 40, 14.01, 40.01]})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "read_only"
    assert client.put("/api/user", json={"name": "Hacker", "role": "admin"}).status_code in (400, 403)
    assert client.get("/api/platform/keys").status_code == 403
    client.post("/api/auth/logout")


def test_api_key_and_v1(client):
    _admin(client)
    k = client.post("/api/platform/keys", json={"name": "Piattaforma DRIP", "role": "editor"}).json()
    assert k["key"].startswith("drip_") and "hash" not in k
    assert all("hash" not in x for x in client.get("/api/platform/keys").json())
    client.post("/api/auth/logout")
    client.cookies.clear()
    h = {"Authorization": f"Bearer {k['key']}"}
    info = client.get("/api/v1/info", headers=h).json()
    assert info["apiVersion"] == 1 and info["caller"]["role"] == "editor"
    pid = client.post("/api/projects", headers=h, json={"template": "empty", "name": "Da API", "bbox": [14.25, 40.93, 14.26, 40.94]}).json()["id"]
    r = client.post(f"/api/v1/projects/{pid}/scenarios/scenario-a/operations", headers=h,
                    json={"operations": [{"type": "zone.set", "payload": {"zone": {"id": "z1", "kind": "zone30", "name": "Zona 30", "polygon": [[14.251, 40.931], [14.252, 40.931], [14.252, 40.932]], "allowedModes": ["car"]}}}]})
    assert r.status_code == 200, r.text
    sc = client.get(f"/api/v1/projects/{pid}/scenarios/scenario-a", headers=h).json()
    assert sc["operations"][-1]["type"] == "zone.set" and sc["operations"][-1]["author"] == "API · Piattaforma DRIP"
    bad = client.post(f"/api/v1/projects/{pid}/scenarios/scenario-a/operations", headers=h, json={"operations": [{"type": "rm -rf", "payload": {}}]})
    assert bad.status_code == 400
    assert client.get("/api/v1/info", headers={"Authorization": "Bearer drip_ffff_wrong"}).status_code == 401


def test_license_trial_without_platform(client):
    _admin(client)
    st = client.get("/api/license").json()
    assert st["status"] == "trialing" and st["plan"] == "trial" and "elios" in st["features"] and st["daysLeft"] >= 29
    r = client.post("/api/license/activate", json={"key": "ABCD-EFGH-IJKL"})
    assert r.status_code == 400 and "Piattaforma DRIP" in r.json()["detail"]


def test_update_check_reports_unreachable_platform(client):
    _admin(client)
    st = client.post("/api/update/check").json()
    assert st["current"] == "2.0.0" and st["available"] is False and st["error"]
    assert client.post("/api/update/apply").status_code == 400


def test_platform_config_never_returns_secrets(client):
    _admin(client)
    cfg = client.put("/api/platform/config", json={"identityProviders": [{"id": "org", "label": "Comune", "issuer": "https://sso.comune.example/realms/ente", "clientId": "urban", "clientSecret": "s3cr3t", "enabled": True}]}).json()
    org = next(p for p in cfg["identityProviders"] if p["id"] == "org")
    assert org["hasClientSecret"] and "clientSecret" not in org
    assert client.put("/api/platform/config", json={"platformUrl": "http://evil.example"}).status_code == 400
    s = client.get("/api/auth/session").json()
    assert {"drip", "org"} <= {p["id"] for p in s["providers"]}


def test_elios_without_key_explains_setup(client):
    _admin(client)
    assert client.get("/api/elios/status").json()["configured"] is False
    r = client.post("/api/elios/chat", json={"contents": [{"role": "user", "parts": [{"text": "ciao"}]}]})
    assert r.status_code == 200 and r.json()["status"] == "not_configured"


def test_elios_forwards_tools_and_returns_function_calls(client, monkeypatch):
    _admin(client)
    import app.elios as elios
    import app.providers as providers
    monkeypatch.setattr(providers, "provider_secret", lambda name: "test-key" if name == "gemini" else None)
    seen = {}

    class Resp:
        status_code = 200

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "Fatto."}, {"functionCall": {"name": "set_speed_limit", "args": {"roadName": "Via Roma", "speedKmh": 30}}}]}}]}

    def fake_post(url, json=None, timeout=None, headers=None):  # noqa: A002
        seen.update(url=url, body=json, headers=headers)
        return Resp()

    monkeypatch.setattr(elios.httpx, "post", fake_post)
    r = client.post("/api/elios/chat", json={
        "contents": [{"role": "model", "parts": [{"text": "orphan"}]}, {"role": "user", "parts": [{"text": "Via Roma a 30"}]}],
        "tools": [{"name": "set_speed_limit", "description": "x", "parameters": {"type": "OBJECT", "properties": {"speedKmh": {"type": "NUMBER", "examples": [30]}}}}],
        "context": {"project": "Test"},
    }).json()
    assert r["status"] == "ok" and r["parts"][1]["functionCall"]["name"] == "set_speed_limit"
    assert seen["headers"]["x-goog-api-key"] == "test-key" and "key=" not in seen["url"]
    assert seen["body"]["contents"][0]["role"] == "user"  # leading model turn dropped
    decl = seen["body"]["tools"][0]["functionDeclarations"][0]
    assert "examples" not in decl["parameters"]["properties"]["speedKmh"]
    assert "Codice della Strada" in seen["body"]["systemInstruction"]["parts"][0]["text"]


def test_3d_model_upload_validates_and_serves(client):
    _admin(client)
    import struct
    pid = client.post("/api/projects", json={"template": "empty", "name": "Modelli", "bbox": [14.25, 40.93, 14.26, 40.94]}).json()["id"]
    bad = client.post(f"/api/projects/{pid}/models", files={"file": ("x.obj", b"v 0 0 0", "text/plain")})
    assert bad.status_code == 400
    fake = client.post(f"/api/projects/{pid}/models", files={"file": ("x.glb", b"nope", "model/gltf-binary")})
    assert fake.status_code == 400
    js = b'{"asset":{"version":"2.0"}}  '
    glb = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js)) + struct.pack("<I", len(js)) + b"JSON" + js
    r = client.post(f"/api/projects/{pid}/models", files={"file": ("chiosco.glb", glb, "model/gltf-binary")}, data={"w": "3", "d": "2", "h": "3.2", "name": "Chiosco"})
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["dims"] == {"w": 3.0, "d": 2.0, "h": 3.2} and rec["name"] == "Chiosco"
    assert client.get(f"/api/projects/{pid}/models").json()[0]["id"] == rec["id"]
    got = client.get(f"/api/projects/{pid}/models/{rec['id']}")
    assert got.status_code == 200 and got.content == glb
    assert client.delete(f"/api/projects/{pid}/models/{rec['id']}").json()["ok"]
    assert client.get(f"/api/projects/{pid}/models").json() == []


def test_fst_reports_filtered_to_project_area_and_configurable_portal(client, monkeypatch):
    _admin(client)
    import app.civic as civic
    seen = []

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"items": [
                {"id": 1, "title": "Buca", "geometry": {"type": "Point", "coordinates": [14.27, 40.94]}},
                {"id": 2, "title": "Lontano", "geometry": {"type": "Point", "coordinates": [12.5, 41.9]}},
                {"id": 3, "title": "Area", "geometry": {"type": "Polygon", "coordinates": [[[14.271, 40.941], [14.272, 40.941], [14.272, 40.942]]]}},
            ]}

    def fake_get(url, timeout=None, headers=None):
        seen.append(url)
        return Resp()

    monkeypatch.setattr(civic.httpx, "get", fake_get)
    civic._fst_cache.clear()
    r = client.get("/api/civic/fst/reports?bbox=14.2,40.9,14.3,41.0").json()
    assert r["status"] == "ok" and [x["id"] for x in r["items"]] == [1, 3] and r["total"] == 3
    assert seen[-1].startswith("https://frattamaggioresitrasforma.studiodrip.it/wp-json/fst-mobile/v1/maps/reports")
    assert client.put("/api/platform/config", json={"fstUrl": "http://insecure.example"}).status_code == 400
    assert client.put("/api/platform/config", json={"fstUrl": "https://comune.example.it"}).status_code == 200
    client.get("/api/civic/fst/reports")
    assert seen[-1].startswith("https://comune.example.it/")
    client.put("/api/platform/config", json={"fstUrl": "https://frattamaggioresitrasforma.studiodrip.it"})
