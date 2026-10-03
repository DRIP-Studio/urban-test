"""Platform layer: protected mode, provisional admin, roles, API keys, licence trial, API v1."""
import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("platform"), "protected")


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
    _login(client, "admin", "Frattamaggiore2026")
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
    _login(client, "admin", "Frattamaggiore2026")
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
    _login(client, "admin", "Frattamaggiore2026")
    st = client.get("/api/license").json()
    assert st["status"] == "trialing" and st["plan"] == "trial" and "elios" in st["features"] and st["daysLeft"] >= 29
    r = client.post("/api/license/activate", json={"key": "ABCD-EFGH-IJKL"})
    assert r.status_code == 400 and "Piattaforma DRIP" in r.json()["detail"]


def test_update_check_reports_unreachable_platform(client):
    _login(client, "admin", "Frattamaggiore2026")
    st = client.post("/api/update/check").json()
    assert st["current"] == "1.0.0" and st["available"] is False and st["error"]
    assert client.post("/api/update/apply").status_code == 400


def test_platform_config_never_returns_secrets(client):
    _login(client, "admin", "Frattamaggiore2026")
    cfg = client.put("/api/platform/config", json={"identityProviders": [{"id": "org", "label": "Comune", "issuer": "https://sso.comune.example/realms/ente", "clientId": "urban", "clientSecret": "s3cr3t", "enabled": True}]}).json()
    org = next(p for p in cfg["identityProviders"] if p["id"] == "org")
    assert org["hasClientSecret"] and "clientSecret" not in org
    assert client.put("/api/platform/config", json={"platformUrl": "http://evil.example"}).status_code == 400
    s = client.get("/api/auth/session").json()
    assert {"drip", "org"} <= {p["id"] for p in s["providers"]}


def test_elios_without_key_explains_setup(client):
    _login(client, "admin", "Frattamaggiore2026")
    assert client.get("/api/elios/status").json()["configured"] is False
    r = client.post("/api/elios/chat", json={"contents": [{"role": "user", "parts": [{"text": "ciao"}]}]})
    assert r.status_code == 200 and r.json()["status"] == "not_configured"


def test_elios_forwards_tools_and_returns_function_calls(client, monkeypatch):
    _login(client, "admin", "Frattamaggiore2026")
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
