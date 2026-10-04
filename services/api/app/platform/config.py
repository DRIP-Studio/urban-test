"""DRIP platform settings: central platform URL, identity providers, auth mode, update channel.

Stored in ``settings/platform.json`` in the user's data folder. Environment variables override the file
so that an installation can be pre-configured by DRIP (``DRIP_PLATFORM_URL``, ``DRIP_URBAN_AUTH``,
``DRIP_ID_ISSUER``, ``DRIP_ID_CLIENT_ID``, ``DRIP_ID_CLIENT_SECRET``).
"""
from __future__ import annotations

import os
import secrets
import threading
import uuid
from copy import deepcopy
from typing import Any

from app.settings import SETTINGS
from app.storage import atomic_write_json, read_json

DEFAULT_PLATFORM_URL = "https://api.studiodrip.it"

DEFAULTS: dict[str, Any] = {
    # open: single-user desktop, no login (1.0 behaviour). protected: every /api call needs a session or a token.
    "authMode": "protected",
    "sessionHours": 12,
    "platformUrl": DEFAULT_PLATFORM_URL,
    "identityProviders": [
        {
            "id": "drip",
            "label": "DRIP ID",
            "kind": "keycloak",
            "issuer": "https://id.studiodrip.it/realms/drip",
            "clientId": "drip-urban",
            "clientSecret": "",
            "scopes": "openid profile email",
            "enabled": True,
        },
        {
            "id": "org",
            "label": "Keycloak dell'ente",
            "kind": "keycloak",
            "issuer": "",
            "clientId": "drip-urban",
            "clientSecret": "",
            "scopes": "openid profile email",
            "enabled": False,
        },
    ],
    # Keycloak role → DRIP Urban role. Unmapped users get defaultRole.
    "roleMapping": {
        "drip-urban-admin": "admin", "admin": "admin",
        "drip-urban-publisher": "publisher", "publisher": "publisher",
        "drip-urban-editor": "editor", "editor": "editor", "planner": "editor",
        "drip-urban-viewer": "viewer", "viewer": "viewer",
    },
    "defaultRole": "editor",
    "localLogin": True,
    "updates": {"autoCheck": True, "channel": "stable"},
    # soft: an expired/missing licence only shows a banner. strict: features outside the plan are refused.
    "licenseEnforcement": "soft",
    "trialDays": 30,
    # Civic platform (Frattamaggiore Si Trasforma or another municipality on the same WordPress plugin).
    "fstUrl": "https://frattamaggioresitrasforma.studiodrip.it",
    # Official technical maps (WMS) served through /api/tiles/wms/<id>/… (see app/wms.py).
    "wms": [
        {
            "id": "catasto",
            "label": "Catasto — Agenzia delle Entrate",
            "url": "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php",
            "layers": "CP.CadastralParcel",
            "format": "image/png",
            "version": "1.3.0",
            "crs": "EPSG:3857",
            "transparent": True,
            "kind": "overlay",
            "attribution": "Agenzia delle Entrate — Cartografia catastale (CC BY 4.0)",
            "minzoom": 15,
            "enabled": True,
        },
        {
            "id": "ctr",
            "label": "Carta tecnica regionale (CTR) — inserire URL WMS della Regione",
            "url": "",
            "layers": "",
            "format": "image/png",
            "version": "1.3.0",
            "crs": "EPSG:3857",
            "transparent": False,
            "kind": "basemap",
            "attribution": "",
            "minzoom": 0,
            "enabled": False,
        },
    ],
}

_lock = threading.Lock()


def _path():
    return SETTINGS.settings_dir / "platform.json"


def _env_overrides(cfg: dict) -> dict:
    if os.environ.get("DRIP_PLATFORM_URL"):
        cfg["platformUrl"] = os.environ["DRIP_PLATFORM_URL"].rstrip("/")
    if os.environ.get("DRIP_FST_URL"):
        cfg["fstUrl"] = os.environ["DRIP_FST_URL"].rstrip("/")
    if os.environ.get("DRIP_URBAN_AUTH") in {"open", "protected"}:
        cfg["authMode"] = os.environ["DRIP_URBAN_AUTH"]
    drip = next((p for p in cfg["identityProviders"] if p["id"] == "drip"), None)
    if drip is not None:
        for env, key in (("DRIP_ID_ISSUER", "issuer"), ("DRIP_ID_CLIENT_ID", "clientId"), ("DRIP_ID_CLIENT_SECRET", "clientSecret")):
            if os.environ.get(env):
                drip[key] = os.environ[env]
    return cfg


def load() -> dict:
    stored = read_json(_path(), {}) or {}
    cfg = deepcopy(DEFAULTS)
    for k, v in stored.items():
        if k == "identityProviders" and isinstance(v, list):
            by_id = {p["id"]: p for p in cfg["identityProviders"]}
            for p in v:
                if isinstance(p, dict) and p.get("id"):
                    by_id[p["id"]] = {**by_id.get(p["id"], {}), **p}
            cfg["identityProviders"] = list(by_id.values())
        elif k in cfg:
            cfg[k] = v
    return _env_overrides(cfg)


EDITABLE = {"authMode", "sessionHours", "platformUrl", "identityProviders", "roleMapping", "defaultRole", "localLogin", "updates", "licenseEnforcement", "fstUrl", "wms"}


def save(patch: dict) -> dict:
    with _lock:
        stored = read_json(_path(), {}) or {}
        for k, v in patch.items():
            if k not in EDITABLE:
                raise ValueError(f"Impostazione non modificabile: {k}")
            if k == "authMode" and v not in {"open", "protected"}:
                raise ValueError("Modalità di accesso non valida")
            if k == "defaultRole" and v not in {"viewer", "editor", "publisher", "admin"}:
                raise ValueError("Ruolo non valido")
            if k == "platformUrl" and not str(v).startswith(("https://", "http://localhost", "http://127.0.0.1")):
                raise ValueError("La piattaforma DRIP richiede un indirizzo https://")
            if k == "fstUrl" and v and not str(v).startswith("https://"):
                raise ValueError("La piattaforma civica richiede un indirizzo https://")
            if k == "wms":
                from app import wms
                v = wms.validate(v)
            if k == "identityProviders":
                for p in v:
                    if p.get("issuer") and not str(p["issuer"]).startswith(("https://", "http://localhost", "http://127.0.0.1")):
                        raise ValueError(f"Issuer non valido per {p.get('label') or p.get('id')}: serve https://")
                    # An empty secret in the patch keeps the stored one (the UI never receives it).
                    if p.get("clientSecret") == "":
                        prev = next((q for q in stored.get("identityProviders", []) if q.get("id") == p.get("id")), {})
                        p["clientSecret"] = prev.get("clientSecret", "")
            stored[k] = v
        atomic_write_json(_path(), stored)
    return load()


def public_view(cfg: dict | None = None) -> dict:
    """Configuration without secrets, for the settings screen."""
    cfg = deepcopy(cfg or load())
    for p in cfg["identityProviders"]:
        p["hasClientSecret"] = bool(p.pop("clientSecret", ""))
    return cfg


def secret_key() -> bytes:
    """HMAC key for session tokens; created once per installation."""
    path = SETTINGS.settings_dir / "secret.key"
    with _lock:
        if path.exists():
            return path.read_bytes()
        key = secrets.token_bytes(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(key)
        return key


def device_id() -> str:
    """Stable anonymous id of this installation (licence seat binding)."""
    path = SETTINGS.settings_dir / "device.json"
    data = read_json(path, None)
    if data and data.get("id"):
        return data["id"]
    did = "dev-" + uuid.uuid4().hex
    from datetime import datetime, timezone
    atomic_write_json(path, {"id": did, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    return did


def first_run_at() -> str:
    path = SETTINGS.settings_dir / "device.json"
    device_id()
    return (read_json(path, {}) or {}).get("createdAt", "")
