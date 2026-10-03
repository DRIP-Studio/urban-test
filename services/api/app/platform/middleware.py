"""ASGI middleware: resolves who is calling and enforces the access policy on /api.

Identity sources, in order: session cookie, ``Authorization: Bearer drip_…`` API key, bearer access
token from DRIP ID / Keycloak (introspection). In ``open`` mode an anonymous caller acts as the local
user of the 1.0 single-user desktop (settings/user.json).
"""
from __future__ import annotations

import json
import re
from http.cookies import SimpleCookie

import anyio

from . import auth, config, integrations

PUBLIC = (
    re.compile(r"^/api/health$"),
    re.compile(r"^/api/auth/(session|login|logout)$"),
    re.compile(r"^/api/auth/oidc/"),
    re.compile(r"^/api/civic/fst/[a-z]+$"),
    re.compile(r"^/api/civic/publications/[A-Za-z0-9_.:-]+$"),
)
# Allowed while a provisional password must still be changed.
PASSWORD_CHANGE = (re.compile(r"^/api/auth/"), re.compile(r"^/api/health$"), re.compile(r"^/api/user$"))
ADMIN = (
    re.compile(r"^/api/platform/"), re.compile(r"^/api/auth/users"), re.compile(r"^/api/update/(download|apply)$"),
    re.compile(r"^/api/license/(activate|deactivate)$"), re.compile(r"^/api/migration/"), re.compile(r"^/api/providers/"),
)
WRITE_EXEMPT = (re.compile(r"^/api/auth/"), re.compile(r"^/api/user$"), re.compile(r"^/api/elios/chat$"), re.compile(r"^/api/license/refresh$"), re.compile(r"^/api/update/check$"))


def _match(patterns, path: str) -> bool:
    return any(p.search(path) for p in patterns)


def _legacy_local_user() -> dict:
    from app import civic
    u = civic.stored_user()
    return {"sub": "open:local", "name": u["name"], "username": "local", "role": u.get("role", "admin"), "provider": "open"}


async def _send_json(send, status: int, body: dict) -> None:
    raw = json.dumps(body, ensure_ascii=False).encode()
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())]})
    await send({"type": "http.response.body", "body": raw})


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        method: str = scope["method"]
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        identity = None
        if "cookie" in headers:
            c = SimpleCookie()
            try:
                c.load(headers["cookie"])
            except Exception:  # noqa: BLE001 — malformed cookie header
                c = SimpleCookie()
            if auth.COOKIE in c:
                identity = auth.read_session(c[auth.COOKIE].value)
        bearer = headers.get("authorization", "")
        if identity is None and bearer.lower().startswith("bearer "):
            tok = bearer[7:].strip()
            identity = integrations.check_key(tok) if tok.startswith("drip_") else await anyio.to_thread.run_sync(auth.introspect, tok)
        mode = config.load()["authMode"]
        if identity is None and mode == "open":
            identity = _legacy_local_user()

        token = auth.current_user.set(identity)
        try:
            if path.startswith("/api/") and not _match(PUBLIC, path):
                if identity is None:
                    await _send_json(send, 401, {"detail": {"message": "Accesso richiesto", "code": "auth_required"}})
                    return
                if identity.get("mustChangePassword") and not _match(PASSWORD_CHANGE, path):
                    await _send_json(send, 403, {"detail": {"message": "Cambia la password provvisoria per continuare", "code": "must_change_password"}})
                    return
                if _match(ADMIN, path) and method != "GET" and not auth.has_role(identity, "admin"):
                    await _send_json(send, 403, {"detail": {"message": "Serve il ruolo di amministratore", "code": "forbidden"}})
                    return
                if method in {"POST", "PUT", "PATCH", "DELETE"} and not _match(WRITE_EXEMPT, path) and not auth.has_role(identity, "editor"):
                    await _send_json(send, 403, {"detail": {"message": "Il tuo ruolo consente solo la consultazione", "code": "read_only"}})
                    return
            await self.app(scope, receive, send)
        finally:
            auth.current_user.reset(token)
