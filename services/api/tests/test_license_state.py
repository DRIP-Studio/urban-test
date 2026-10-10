from datetime import datetime, timedelta, timezone

import pytest


@pytest.mark.parametrize("state", ["revoked", "suspended", "expired", "unlicensed"])
def test_inactive_license_never_becomes_active_during_offline_grace(monkeypatch, state):
    from app.platform import license
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    monkeypatch.setattr(license, "_now", lambda: now)
    monkeypatch.setattr(license.config, "load", lambda: {"licenseEnforcement": "strict", "platformUrl": "https://example.test"})
    monkeypatch.setattr(license.config, "device_id", lambda: "test")
    monkeypatch.setattr(license, "_load", lambda: {"response": {"plan": "pro", "status": state, "features": ["api", "elios"]}, "checkedAt": (now - timedelta(days=4)).isoformat()})
    result = license.status()
    assert result["status"] == state
    assert "api" not in result["features"]
    assert license.allows("api") is False


@pytest.mark.parametrize("features", [[], "api", {"api": True}])
def test_explicit_empty_or_invalid_features_never_expand_to_paid_plan(monkeypatch, features):
    from app.platform import license
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(license.config, "load", lambda: {"licenseEnforcement": "strict", "platformUrl": "https://example.test"})
    monkeypatch.setattr(license.config, "device_id", lambda: "test")
    monkeypatch.setattr(license, "_load", lambda: {"response": {"plan": "pro", "status": "active", "features": features}, "checkedAt": now.isoformat()})
    assert license.status()["features"] == []


@pytest.mark.parametrize("date", ["invalid", "2026-10-08T10:00:00"])
def test_bad_entitlement_dates_fail_closed_without_a_server_error(monkeypatch, date):
    from app.platform import license
    monkeypatch.setattr(license.config, "load", lambda: {"licenseEnforcement": "strict", "platformUrl": "https://example.test"})
    monkeypatch.setattr(license.config, "device_id", lambda: "test")
    monkeypatch.setattr(license, "_load", lambda: {"response": {"plan": "pro", "status": "active", "validUntil": date}, "checkedAt": datetime.now(timezone.utc).isoformat()})
    assert license.status()["status"] == "expired"
