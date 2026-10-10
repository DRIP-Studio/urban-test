"""Subscription and licence, managed by the central DRIP platform.

Contract with the platform (see docs/PLATFORM.md):

* ``POST {platformUrl}/v1/licenses/activate``  {key, deviceId, product, version}
* ``POST {platformUrl}/v1/licenses/validate``  {token, deviceId, product, version, usage}
  Both answer ``{plan, status, validUntil, seats, features[], limits{}, token, customer}``.
* A DRIP ID login can also carry the subscription as ``drip_plan`` / ``drip_features`` /
  ``drip_valid_until`` claims; they are used when no licence key is activated.

The last valid answer is cached, so the program keeps working offline for ``GRACE_DAYS``.
Without any licence the installation runs a trial of ``trialDays`` from the first start.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.settings import SETTINGS, VERSION
from app.storage import atomic_write_json, read_json

from . import config

GRACE_DAYS = 14
FEATURES = {
    "design": "Progettazione stradale e spazio pubblico",
    "analyze": "Analisi, accessibilità, sicurezza",
    "traffic": "Traffico, simulazione, semafori",
    "transit": "Trasporto pubblico multimodale",
    "twin": "Digital twin 3D",
    "civic": "Pubblicazione civica FST",
    "elios": "Elios, assistente AI",
    "api": "API, webhook e integrazioni DRIP",
    "models3d": "Import modelli 3D",
    "largeCity": "Città grandi (import a tasselli, oltre 20 km²)",
    "liveTraffic": "Traffico e segnaletica in tempo reale",
    "multiUser": "Accesso multiutente con DRIP ID / Keycloak",
}
PLANS: dict[str, dict[str, Any]] = {
    "trial": {"label": "Prova", "features": list(FEATURES), "limits": {"projects": 5, "areaKm2": 400}},
    "base": {"label": "Base", "features": ["design", "analyze", "traffic", "twin", "civic"], "limits": {"projects": 10, "areaKm2": 25}},
    "pro": {"label": "Pro", "features": [f for f in FEATURES if f not in {"largeCity", "multiUser"}], "limits": {"projects": 100, "areaKm2": 400}},
    "enterprise": {"label": "Enterprise / Ente", "features": list(FEATURES), "limits": {"projects": None, "areaKm2": None}},
}
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _path():
    return SETTINGS.settings_dir / "license.json"


def _load() -> dict:
    return read_json(_path(), {}) or {}


def _save(data: dict) -> None:
    atomic_write_json(_path(), data)


def _usage() -> dict:
    try:
        projects = sum(1 for p in SETTINGS.projects_dir.iterdir() if (p / "project.json").exists())
    except OSError:
        projects = 0
    return {"projects": projects}


def _platform(path: str, body: dict) -> dict:
    url = config.load()["platformUrl"].rstrip("/") + path
    r = httpx.post(url, json=body, timeout=15, headers={"User-Agent": SETTINGS.user_agent})
    if r.status_code >= 400:
        try:
            msg = r.json().get("message") or r.text[:200]
        except ValueError:
            msg = r.text[:200]
        raise ValueError(f"Piattaforma DRIP: {msg} ({r.status_code})")
    return r.json()


def activate(key: str) -> dict:
    key = key.strip()
    if not (8 <= len(key) <= 200):
        raise ValueError("Chiave di licenza non valida")
    try:
        res = _platform("/v1/licenses/activate", {"key": key, "deviceId": config.device_id(), "product": "drip-urban", "version": VERSION, "usage": _usage()})
    except httpx.HTTPError as exc:
        raise ValueError(f"Piattaforma DRIP non raggiungibile: {exc}") from exc
    with _lock:
        data = _load()
        data.update(keyHint=key[:4] + "…" + key[-4:], response=res, checkedAt=_now().isoformat(timespec="seconds"), error=None)
        _save(data)
    return status()


def refresh() -> dict:
    data = _load()
    token = (data.get("response") or {}).get("token")
    if not token:
        return status()
    try:
        res = _platform("/v1/licenses/validate", {"token": token, "deviceId": config.device_id(), "product": "drip-urban", "version": VERSION, "usage": _usage()})
        with _lock:
            data.update(response=res, checkedAt=_now().isoformat(timespec="seconds"), error=None)
            _save(data)
    except (httpx.HTTPError, ValueError) as exc:
        with _lock:
            data["error"] = str(exc)[:300]
            _save(data)
    return status()


def deactivate() -> dict:
    with _lock:
        _save({})
    return status()


def apply_identity_entitlement(claims: dict) -> None:
    """Stores the subscription published on the DRIP ID token (used when no key is activated)."""
    if not claims.get("drip_plan"):
        return
    with _lock:
        data = _load()
        data["identity"] = {
            "plan": claims.get("drip_plan"), "features": claims.get("drip_features"), "validUntil": claims.get("drip_valid_until"),
            "organisation":claims.get("drip_org"), "seatsUsed":claims.get("drip_seats_used"), "customer": claims.get("drip_customer") or claims.get("drip_org"), "seenAt": _now().isoformat(timespec="seconds"),
        }
        _save(data)


def status() -> dict:
    cfg = config.load()
    data = _load()
    res = data.get("response")
    source = "key"
    if not res and data.get("identity"):
        res, source = data["identity"], "drip-id"
    if res:
        plan = res.get("plan") or "base"
        valid_until = res.get("validUntil")
        checked = data.get("checkedAt") or data.get("identity", {}).get("seenAt")
        try:
            checked_at = datetime.fromisoformat(str(checked).replace("Z", "+00:00")) if checked else None
            until = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00")) if valid_until else None
            if (checked_at and checked_at.tzinfo is None) or (until and until.tzinfo is None):
                raise ValueError("Timezone mancante")
            offline_days = (_now() - checked_at).days if checked_at else GRACE_DAYS + 1
            expired = bool(until and until <= _now())
            state = res.get("status") or "active"
            # Offline tolerance applies only to an entitlement that was actually active.
            # Revoked/suspended responses must never turn into an active grace subscription.
            if state in {"active", "offline_grace", "trialing"}:
                if expired:
                    state = "expired"
                elif offline_days > GRACE_DAYS:
                    state = "offline_expired"
                elif offline_days > 2:
                    state = "offline_grace"
        except (ValueError, TypeError, OverflowError):
            state = "expired"
        features = res.get("features")
        if features is None:
            features = PLANS.get(plan, PLANS["base"])["features"]
        if not isinstance(features, list) or not all(isinstance(f, str) for f in features):
            features = []
        return {
            "status": state, "plan": plan, "planLabel": PLANS.get(plan, {}).get("label", plan), "source": source,
            "validUntil": valid_until, "customer": res.get("customer"), "seats": res.get("seats"),
            "organisation": res.get("organisation"), "seatsUsed": res.get("seatsUsed"),
            "validation": "expired" if state in {"expired","offline_expired"} else "verified_response",
            "connectivity": {"state": "last_attempt_failed" if data.get("error") else "last_verified" if checked else "not_verified", "lastVerifiedAt": checked},
            "features": features if state in {"active", "offline_grace", "trialing"} else ["design", "analyze"],
            "limits": res.get("limits") or PLANS.get(plan, PLANS["base"])["limits"],
            "keyHint": data.get("keyHint"), "checkedAt": checked, "error": data.get("error"),
            "enforcement": cfg["licenseEnforcement"], "deviceId": config.device_id(), "catalog": FEATURES,
            "platformUrl": cfg["platformUrl"],
        }
    first = config.first_run_at()
    ends = (datetime.fromisoformat(first) if first else _now()) + timedelta(days=int(cfg.get("trialDays") or 30))
    active = ends > _now()
    return {
        "status": "trialing" if active else "unlicensed", "plan": "trial", "planLabel": "Prova", "source": "trial",
        "validUntil": ends.isoformat(timespec="seconds"), "daysLeft": max(0, (ends - _now()).days),
        "features": PLANS["trial"]["features"] if active else ["design", "analyze"], "limits": PLANS["trial"]["limits"],
        "enforcement": cfg["licenseEnforcement"], "deviceId": config.device_id(), "catalog": FEATURES, "platformUrl": cfg["platformUrl"],
        "error": data.get("error"), "validation":"local_trial", "organisation":None,"seatsUsed":None,
        "connectivity":{"state":"not_verified","lastVerifiedAt":None},
    }


def allows(feature: str) -> bool:
    st = status()
    return st["enforcement"] != "strict" or feature in st["features"]
