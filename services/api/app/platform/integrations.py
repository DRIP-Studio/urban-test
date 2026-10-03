"""API keys and webhooks for the DRIP platform and third-party integrations.

* API keys: ``Authorization: Bearer drip_<id>_<secret>``. Only a SHA-256 of the secret is stored; the
  full key is shown once at creation.
* Webhooks: every event is POSTed as JSON with ``X-Drip-Event`` and ``X-Drip-Signature``
  (``sha256=<hex HMAC of the raw body with the webhook secret>``). Delivery runs in the background
  with three attempts; the last outcome is kept for the settings screen.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from datetime import datetime, timezone

import httpx

from app.settings import SETTINGS, VERSION
from app.storage import atomic_write_json, read_json

from .auth import ROLES

EVENTS = (
    "project.created", "project.updated", "project.archived",
    "scenario.saved", "scenario.created", "scenario.deleted",
    "snapshot.created", "publication.created", "publication.withdrawn",
    "license.changed", "elios.action",
)
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------ API keys

def _keys_path():
    return SETTINGS.settings_dir / "api-keys.json"


def list_keys() -> list[dict]:
    return [{k: v for k, v in x.items() if k != "hash"} for x in read_json(_keys_path(), []) or []]


def create_key(name: str, role: str, author: str) -> dict:
    if role not in ROLES:
        raise ValueError("Ruolo non valido")
    name = name.strip()
    if not (2 <= len(name) <= 60):
        raise ValueError("Nome della chiave: 2–60 caratteri")
    kid, secret = secrets.token_hex(4), secrets.token_urlsafe(32)
    rec = {"id": kid, "name": name, "role": role, "prefix": f"drip_{kid}_{secret[:4]}…", "hash": hashlib.sha256(secret.encode()).hexdigest(),
           "createdAt": _now(), "createdBy": author, "lastUsedAt": None}
    with _lock:
        keys = read_json(_keys_path(), []) or []
        keys.append(rec)
        atomic_write_json(_keys_path(), keys)
    return {**{k: v for k, v in rec.items() if k != "hash"}, "key": f"drip_{kid}_{secret}"}


def revoke_key(kid: str) -> None:
    with _lock:
        keys = [k for k in read_json(_keys_path(), []) or [] if k["id"] != kid]
        atomic_write_json(_keys_path(), keys)


_last_touch: dict[str, float] = {}


def check_key(token: str) -> dict | None:
    if not token.startswith("drip_"):
        return None
    try:
        _, kid, secret = token.split("_", 2)
    except ValueError:
        return None
    keys = read_json(_keys_path(), []) or []
    rec = next((k for k in keys if k["id"] == kid), None)
    if not rec or not hmac.compare_digest(rec["hash"], hashlib.sha256(secret.encode()).hexdigest()):
        return None
    if time.time() - _last_touch.get(kid, 0) > 300:  # lastUsedAt at most every 5 minutes
        _last_touch[kid] = time.time()
        with _lock:
            for k in keys:
                if k["id"] == kid:
                    k["lastUsedAt"] = _now()
            atomic_write_json(_keys_path(), keys)
    return {"sub": f"apikey:{kid}", "name": f"API · {rec['name']}", "username": f"apikey-{kid}", "role": rec["role"], "provider": "apikey", "via": "apikey"}


# ------------------------------------------------------------------ webhooks

def _hooks_path():
    return SETTINGS.settings_dir / "webhooks.json"


def list_hooks() -> list[dict]:
    return [{**{k: v for k, v in h.items() if k != "secret"}, "hasSecret": True} for h in read_json(_hooks_path(), []) or []]


def save_hook(body: dict) -> dict:
    url = str(body.get("url") or "").strip()
    if not url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
        raise ValueError("Il webhook richiede un indirizzo https://")
    events = [e for e in body.get("events") or EVENTS if e in EVENTS]
    if not events:
        raise ValueError("Scegli almeno un evento")
    with _lock:
        hooks = read_json(_hooks_path(), []) or []
        hid = body.get("id")
        h = next((x for x in hooks if x["id"] == hid), None) if hid else None
        created = h is None
        if created:
            h = {"id": "wh-" + secrets.token_hex(4), "secret": secrets.token_urlsafe(24), "createdAt": _now()}
            hooks.append(h)
        h.update(url=url, events=events, active=bool(body.get("active", True)), label=str(body.get("label") or "")[:60])
        atomic_write_json(_hooks_path(), hooks)
    out = {**{k: v for k, v in h.items() if k != "secret"}}
    if created:
        out["secret"] = h["secret"]  # shown once
    return out


def delete_hook(hid: str) -> None:
    with _lock:
        atomic_write_json(_hooks_path(), [h for h in read_json(_hooks_path(), []) or [] if h["id"] != hid])


def _record(hid: str, outcome: dict) -> None:
    with _lock:
        hooks = read_json(_hooks_path(), []) or []
        for h in hooks:
            if h["id"] == hid:
                h["lastDelivery"] = outcome
        atomic_write_json(_hooks_path(), hooks)


def _deliver(h: dict, event: str, payload: dict) -> None:
    body = json.dumps({"event": event, "at": _now(), "product": "drip-urban", "version": VERSION, "data": payload}, ensure_ascii=False).encode()
    sig = "sha256=" + hmac.new(h["secret"].encode(), body, hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "X-Drip-Event": event, "X-Drip-Signature": sig, "User-Agent": SETTINGS.user_agent}
    outcome = {"event": event, "at": _now(), "ok": False, "status": None}
    for attempt in range(3):
        try:
            r = httpx.post(h["url"], content=body, headers=headers, timeout=10)
            outcome.update(ok=r.status_code < 300, status=r.status_code)
            if r.status_code < 500:
                break
        except httpx.HTTPError as exc:
            outcome.update(error=str(exc)[:200])
        time.sleep(2 ** attempt)
    _record(h["id"], outcome)


def emit(event: str, payload: dict) -> None:
    """Fire-and-forget: never blocks or fails the request that caused the event."""
    if event not in EVENTS:
        return
    for h in read_json(_hooks_path(), []) or []:
        if h.get("active") and event in h.get("events", []):
            threading.Thread(target=_deliver, args=(h, event, payload), daemon=True, name=f"webhook-{h['id']}").start()
