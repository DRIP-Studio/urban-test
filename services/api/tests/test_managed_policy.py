import json
import pytest
from tests.test_api import fresh_app

def test_central_locks_survive_offline_and_reject_admin_http_edits(tmp_path,monkeypatch):
    path=tmp_path/"agent-policy.json";document={"schema":"drip-urban-policy","version":1,"revision":1,"organisation":"Comune QA","locked":{"updates":{"autoCheck":False,"channel":"stable"}},"denyActions":["keys.manage","updates.manage"]};path.write_text(json.dumps(document),encoding="utf-8");monkeypatch.setenv("DRIP_URBAN_POLICY_FILE",str(path));client=fresh_app(tmp_path/"data","open")
    from app.platform import config
    cfg=client.get("/api/platform/config").json();assert cfg["management"]["managed"] and cfg["management"]["organisation"]=="Comune QA"
    assert client.put("/api/platform/config",json={"updates":{"autoCheck":True,"channel":"beta"}}).status_code==403
    assert client.post("/api/platform/keys",json={"name":"blocked","role":"viewer"}).status_code==403
    assert client.post("/api/update/apply").status_code==403
    path.unlink();assert config.load()["updates"]==document["locked"]["updates"]
    assert client.put("/api/platform/config",json={"updates":{"autoCheck":True,"channel":"beta"}}).status_code==403

def test_managed_policy_revisions_and_invalid_values_fail_closed(tmp_path,monkeypatch):
    fresh_app(tmp_path/"data","open")
    from app.platform import policy
    with pytest.raises(ValueError):policy.validate({"schema":"drip-urban-policy","version":1,"revision":1,"organisation":"QA","locked":{"identityProviders":[{"id":"x","issuer":"http://attacker.test"}]}})
    path=tmp_path/"policy.json";monkeypatch.setenv("DRIP_URBAN_POLICY_FILE",str(path));base={"schema":"drip-urban-policy","version":1,"revision":2,"organisation":"QA","locked":{},"denyActions":[]};path.write_text(json.dumps(base),encoding="utf-8");assert policy.current()["revision"]==2
    path.write_text(json.dumps({**base,"revision":1}),encoding="utf-8")
    with pytest.raises(PermissionError):policy.current()


def test_configured_missing_policy_never_enables_open_access(tmp_path,monkeypatch):
    client=fresh_app(tmp_path/"data","open")
    monkeypatch.setenv("DRIP_URBAN_POLICY_FILE",str(tmp_path/"missing-policy.json"))
    response=client.get("/api/platform/config")
    assert response.status_code==503 and response.json()["detail"]["code"]=="central_policy_unavailable"
