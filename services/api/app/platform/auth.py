"""Authentication: DRIP ID / Keycloak (OpenID Connect), provisional local admin, API keys, sessions.

* Sessions are HMAC-signed tokens in an HttpOnly cookie (no server-side session store).
* OIDC uses Authorization Code + PKCE. The ID token comes straight from the token endpoint over TLS,
  which OIDC Core §3.1.3.7 accepts in place of the signature check; issuer, audience, expiry and nonce
  are verified. Bearer access tokens from the DRIP platform are checked with token introspection
  (RFC 7662), so no JWT crypto dependency is needed.
* The local admin is provisional: ``admin`` / ``admin`` on first run, password change forced at the
  first login, and the account expires after 30 days unless renewed by an administrator.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.settings import SETTINGS
from app.storage import atomic_write_json, read_json

from . import config

ROLES = ("viewer", "editor", "publisher", "admin")
ROLE_RANK = {r: i for i, r in enumerate(ROLES)}
COOKIE = "drip_session"
PROVISIONAL_DAYS = 30

current_user: contextvars.ContextVar[dict | None] = contextvars.ContextVar("drip_current_user", default=None)
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


# ------------------------------------------------------------------ password hashing (PBKDF2, stdlib)

def _hash_password(password: str, salt: bytes | None = None) -> dict:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return {"algo": "pbkdf2-sha256", "iter": 310_000, "salt": salt.hex(), "hash": dk.hex()}


def _check_password(password: str, rec: dict) -> bool:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(rec["salt"]), int(rec.get("iter", 310_000)))
    return hmac.compare_digest(dk.hex(), rec["hash"])


# ------------------------------------------------------------------ local users

def _users_path():
    return SETTINGS.settings_dir / "users.json"


def _load_users() -> list[dict]:
    users = read_json(_users_path(), None)
    if users is None:
        users = [{
            "username": "admin", "name": "Amministratore (provvisorio)", "role": "admin",
            "password": _hash_password("admin"), "mustChangePassword": True, "provisional": True,
            "createdAt": _iso(_now()), "expiresAt": _iso(_now() + timedelta(days=PROVISIONAL_DAYS)),
        }]
        atomic_write_json(_users_path(), users)
    return users


def _save_users(users: list[dict]) -> None:
    atomic_write_json(_users_path(), users)


def _public_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k != "password"}


def list_users() -> list[dict]:
    return [_public_user(u) for u in _load_users()]


def local_login(username: str, password: str) -> dict:
    cfg = config.load()
    if not cfg.get("localLogin", True):
        raise PermissionError("L'accesso locale è disattivato: usa DRIP ID")
    with _lock:
        users = _load_users()
        u = next((x for x in users if x["username"].lower() == username.strip().lower()), None)
        if not u or not _check_password(password, u["password"]):
            time.sleep(0.4)  # slows down guessing
            raise PermissionError("Nome utente o password non corretti")
        if u.get("disabled"):
            raise PermissionError("Account disattivato")
        if u.get("expiresAt") and datetime.fromisoformat(u["expiresAt"]) < _now():
            raise PermissionError("Credenziali provvisorie scadute: accedi con DRIP ID o chiedi il rinnovo a un amministratore")
        u["lastLoginAt"] = _iso(_now())
        _save_users(users)
    return {"sub": f"local:{u['username']}", "name": u.get("name") or u["username"], "username": u["username"], "role": u["role"],
            "provider": "local", "provisional": bool(u.get("provisional")), "mustChangePassword": bool(u.get("mustChangePassword")),
            "expiresAt": u.get("expiresAt"), "picture": local_avatar_url(u["username"])}


# ------------------------------------------------------------------ profile photo (local accounts)

AVATAR_MAX = 256 * 1024
AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp"}
_MAGIC = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"RIFF": "image/webp"}


def _sniff(data: bytes) -> str | None:
    for magic, mime in _MAGIC.items():
        if data.startswith(magic) and (mime != "image/webp" or data[8:12] == b"WEBP"):
            return mime
    return None


def set_local_avatar(username: str, data: bytes | None) -> str | None:
    """Stores (or removes, with None) the photo of a local account. Returns its URL."""
    if data is not None:
        if len(data) > AVATAR_MAX:
            raise ValueError("La foto deve pesare al massimo 256 KB")
        mime = _sniff(data)
        if mime not in AVATAR_TYPES:
            raise ValueError("Formato non supportato: usa PNG, JPEG o WebP")
    with _lock:
        users = _load_users()
        u = next((x for x in users if x["username"] == username), None)
        if not u:
            raise PermissionError("Account locale inesistente")
        if data is None:
            u.pop("avatar", None)
        else:
            import base64
            u["avatar"] = {"mime": mime, "data": base64.b64encode(data).decode("ascii"), "at": _iso(_now())}
        _save_users(users)
    return local_avatar_url(username)


def local_avatar(username: str) -> tuple[bytes, str] | None:
    import base64
    u = next((x for x in _load_users() if x["username"] == username), None)
    a = (u or {}).get("avatar")
    return (base64.b64decode(a["data"]), a["mime"]) if a else None


def local_avatar_url(username: str) -> str | None:
    u = next((x for x in _load_users() if x["username"] == username), None)
    a = (u or {}).get("avatar")
    return f"/api/auth/avatar/{username}?v={a['at']}" if a else None


def change_password(username: str, old: str, new: str) -> None:
    if len(new) < 10 or new.lower() == new or not any(c.isdigit() for c in new):
        raise ValueError("La nuova password deve avere almeno 10 caratteri, una maiuscola e un numero")
    with _lock:
        users = _load_users()
        u = next((x for x in users if x["username"] == username), None)
        if not u or not _check_password(old, u["password"]):
            raise PermissionError("Password attuale non corretta")
        if _check_password(new, u["password"]):
            raise ValueError("La nuova password deve essere diversa")
        u["password"] = _hash_password(new)
        u["mustChangePassword"] = False
        u["passwordChangedAt"] = _iso(_now())
        _save_users(users)


def upsert_user(body: dict) -> dict:
    username = str(body.get("username") or "").strip()
    if not (3 <= len(username) <= 40) or not username.replace(".", "").replace("-", "").replace("_", "").isalnum():
        raise ValueError("Nome utente: 3–40 caratteri tra lettere, numeri, . - _")
    role = body.get("role", "editor")
    if role not in ROLES:
        raise ValueError("Ruolo non valido")
    with _lock:
        users = _load_users()
        u = next((x for x in users if x["username"] == username), None)
        if u is None:
            pw = str(body.get("password") or "")
            if len(pw) < 10:
                raise ValueError("Password iniziale di almeno 10 caratteri")
            u = {"username": username, "createdAt": _iso(_now()), "password": _hash_password(pw), "mustChangePassword": True}
            users.append(u)
        u["name"] = str(body.get("name") or username)[:80]
        u["role"] = role
        u["disabled"] = bool(body.get("disabled", False))
        if body.get("renew"):
            u["expiresAt"] = _iso(_now() + timedelta(days=PROVISIONAL_DAYS))
        if "provisional" in body:
            u["provisional"] = bool(body["provisional"])
            if not u["provisional"]:
                u.pop("expiresAt", None)
        if body.get("password") and u.get("createdAt") != _iso(_now()):
            u["password"] = _hash_password(str(body["password"]))
            u["mustChangePassword"] = True
        if not any(x["role"] == "admin" and not x.get("disabled") for x in users):
            raise ValueError("Deve restare almeno un amministratore attivo")
        _save_users(users)
        return _public_user(u)


def delete_user(username: str) -> None:
    with _lock:
        users = [u for u in _load_users() if u["username"] != username]
        if not any(x["role"] == "admin" and not x.get("disabled") for x in users):
            raise ValueError("Deve restare almeno un amministratore attivo")
        _save_users(users)


# ------------------------------------------------------------------ session tokens

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_session(identity: dict) -> tuple[str, int]:
    hours = int(config.load().get("sessionHours") or 12)
    payload = {**identity, "iat": int(time.time()), "exp": int(time.time()) + hours * 3600}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(config.secret_key(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", hours * 3600


def read_session(token: str | None) -> dict | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    good = _b64(hmac.new(config.secret_key(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, good):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    if payload.get("provider") == "local":
        # Local accounts can be disabled, expired or have changed password since the token was issued.
        u = next((x for x in _load_users() if x["username"] == payload.get("username")), None)
        if not u or u.get("disabled"):
            return None
        payload["mustChangePassword"] = bool(u.get("mustChangePassword"))
        payload["role"] = u["role"]
    return payload


# ------------------------------------------------------------------ OpenID Connect (DRIP ID, Keycloak)

_discovery: dict[str, tuple[float, dict]] = {}
_pending: dict[str, dict] = {}
_introspected: dict[str, tuple[float, dict | None]] = {}


def provider(pid: str) -> dict:
    p = next((x for x in config.load()["identityProviders"] if x["id"] == pid), None)
    if not p or not p.get("enabled") or not p.get("issuer"):
        raise ValueError("Provider di identità non configurato")
    return p


def discover(issuer: str) -> dict:
    hit = _discovery.get(issuer)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    r = httpx.get(issuer.rstrip("/") + "/.well-known/openid-configuration", timeout=10, headers={"User-Agent": SETTINGS.user_agent})
    r.raise_for_status()
    doc = r.json()
    _discovery[issuer] = (time.time(), doc)
    return doc


def oidc_start(pid: str, redirect_uri: str, next_url: str) -> str:
    p = provider(pid)
    meta = discover(p["issuer"])
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v["at"] > 600]:
        _pending.pop(k, None)
    _pending[state] = {"provider": pid, "nonce": nonce, "verifier": verifier, "next": next_url if next_url.startswith("/") else "/", "redirect": redirect_uri, "at": now}
    q = {"response_type": "code", "client_id": p["clientId"], "redirect_uri": redirect_uri, "scope": p.get("scopes") or "openid profile email",
         "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"}
    return f"{meta['authorization_endpoint']}?{urlencode(q)}"


def _roles_from_claims(claims: dict, client_id: str) -> set[str]:
    roles = set((claims.get("realm_access") or {}).get("roles") or [])
    roles |= set(((claims.get("resource_access") or {}).get(client_id) or {}).get("roles") or [])
    roles |= set(claims.get("roles") or []) | set(claims.get("groups") or [])
    return {str(r).lstrip("/") for r in roles}


def map_role(roles: set[str]) -> str:
    cfg = config.load()
    mapped = [cfg["roleMapping"][r] for r in roles if r in cfg["roleMapping"]]
    return max(mapped, key=lambda r: ROLE_RANK[r]) if mapped else cfg.get("defaultRole", "editor")


def oidc_finish(code: str, state: str) -> tuple[dict, str, dict]:
    pend = _pending.pop(state, None)
    if not pend or time.time() - pend["at"] > 600:
        raise PermissionError("Sessione di accesso scaduta: riprova")
    p = provider(pend["provider"])
    meta = discover(p["issuer"])
    data = {"grant_type": "authorization_code", "code": code, "redirect_uri": pend["redirect"], "client_id": p["clientId"], "code_verifier": pend["verifier"]}
    if p.get("clientSecret"):
        data["client_secret"] = p["clientSecret"]
    r = httpx.post(meta["token_endpoint"], data=data, timeout=15, headers={"User-Agent": SETTINGS.user_agent})
    if r.status_code >= 400:
        raise PermissionError(f"Il provider di identità ha rifiutato l'accesso ({r.status_code})")
    tok = r.json()
    id_token = tok.get("id_token") or ""
    try:
        claims = json.loads(_unb64(id_token.split(".")[1]))
    except (IndexError, ValueError, json.JSONDecodeError) as exc:
        raise PermissionError("Risposta del provider di identità non valida") from exc
    aud = claims.get("aud")
    auds = aud if isinstance(aud, list) else [aud]
    if claims.get("iss") != meta.get("issuer", p["issuer"]) or p["clientId"] not in auds:
        raise PermissionError("Token di identità non destinato a DRIP Urban")
    if claims.get("exp", 0) < time.time() - 60 or claims.get("nonce") != pend["nonce"]:
        raise PermissionError("Token di identità scaduto o riutilizzato")
    # Access-token claims carry the Keycloak roles (the ID token may not).
    try:
        access_claims = json.loads(_unb64((tok.get("access_token") or "").split(".")[1]))
    except (IndexError, ValueError, json.JSONDecodeError):
        access_claims = {}
    roles = _roles_from_claims(claims, p["clientId"]) | _roles_from_claims(access_claims, p["clientId"])
    identity = {
        "sub": f"{p['id']}:{claims.get('sub')}", "name": claims.get("name") or claims.get("preferred_username") or claims.get("email") or "Utente",
        "username": claims.get("preferred_username") or claims.get("email") or claims.get("sub"), "email": claims.get("email"),
        "role": map_role(roles), "provider": p["id"], "providerLabel": p.get("label"),
    }
    # Profile photo from DRIP ID / Keycloak (OIDC «picture»): only https URLs are shown.
    pic = claims.get("picture")
    if isinstance(pic, str) and pic.startswith("https://") and len(pic) < 2048:
        identity["picture"] = pic
    # Subscription claims published by the DRIP platform on the DRIP ID token (see docs/PLATFORM.md).
    entitlement = {k: v for k, v in {**access_claims, **claims}.items() if k.startswith("drip_")}
    return identity, pend["next"], {"idToken": id_token, "entitlement": entitlement, "endSession": meta.get("end_session_endpoint")}


def introspect(token: str) -> dict | None:
    """Validates a bearer access token issued by DRIP ID / Keycloak (cached for 60 s)."""
    hit = _introspected.get(token)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    result: dict | None = None
    for p in config.load()["identityProviders"]:
        if not (p.get("enabled") and p.get("issuer") and p.get("clientSecret")):
            continue
        try:
            meta = discover(p["issuer"])
            ep = meta.get("introspection_endpoint")
            if not ep:
                continue
            r = httpx.post(ep, data={"token": token, "client_id": p["clientId"], "client_secret": p["clientSecret"]}, timeout=10)
            info = r.json() if r.status_code < 400 else {}
        except (httpx.HTTPError, ValueError):
            continue
        if info.get("active"):
            roles = _roles_from_claims(info, p["clientId"])
            result = {"sub": f"{p['id']}:{info.get('sub')}", "name": info.get("name") or info.get("username") or "Servizio DRIP",
                      "username": info.get("username"), "role": map_role(roles), "provider": p["id"], "via": "bearer"}
            break
    _introspected[token] = (time.time(), result)
    return result


def logout_url(pid: str, id_token: str | None, post_logout: str) -> str | None:
    try:
        p = provider(pid)
        ep = discover(p["issuer"]).get("end_session_endpoint")
    except (ValueError, httpx.HTTPError):
        return None
    if not ep:
        return None
    q: dict[str, Any] = {"client_id": p["clientId"], "post_logout_redirect_uri": post_logout}
    if id_token:
        q["id_token_hint"] = id_token
    return f"{ep}?{urlencode(q)}"


def has_role(user: dict | None, role: str) -> bool:
    return bool(user) and ROLE_RANK.get(user.get("role", "viewer"), 0) >= ROLE_RANK[role]
