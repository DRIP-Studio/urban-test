"""HTTP surface of the DRIP platform integration: auth, users, licence, updates, API keys, webhooks, API v1."""
from __future__ import annotations

import json
import re
from typing import Any

import anyio
from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse, Response

from app.projects import service as ps
from app.settings import VERSION

from . import auth, config, integrations, license, updates

router = APIRouter()


def _me() -> dict:
    u = auth.current_user.get()
    if not u:
        raise HTTPException(401, "Accesso richiesto")
    return u


def _require(role: str) -> dict:
    u = _me()
    if not auth.has_role(u, role):
        raise HTTPException(403, "Permesso insufficiente per questa operazione")
    return u


def _bad(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(403, str(exc))
    if isinstance(exc, ps.NotFound):
        return HTTPException(404, str(exc))
    if isinstance(exc, ps.Conflict):
        return HTTPException(409, {"message": str(exc), "current": exc.current})
    return HTTPException(400, str(exc))


def _cookie(resp, token: str, max_age: int, request: Request) -> None:
    resp.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/")


# ------------------------------------------------------------------ session

@router.get("/api/auth/session")
def session(request: Request) -> dict:
    cfg = config.load()
    u = auth.current_user.get()
    if u and u.get("provider") == "local" and u.get("username"):
        # The session keeps the identity of the login: the photo may have changed since.
        u = {**u, "picture": auth.local_avatar_url(u["username"])}
    return {
        "mode": cfg["authMode"], "authenticated": bool(u and u.get("provider") != "open"), "user": u,
        "localLogin": cfg.get("localLogin", True),
        "providers": [{"id": p["id"], "label": p["label"], "kind": p.get("kind", "keycloak")} for p in cfg["identityProviders"] if p.get("enabled") and p.get("issuer")],
        "provisionalHint": _provisional_hint(),
    }


def _provisional_hint() -> str | None:
    users = auth._load_users()  # noqa: SLF001 — creates the provisional admin on first run
    u = next((x for x in users if x["username"] == "admin" and x.get("mustChangePassword") and x.get("provisional")), None)
    return "Primo accesso: utente «admin», password «admin». Ti verrà chiesto di cambiarla subito." if u else None


@router.put("/api/auth/me/avatar")
async def put_avatar(file: UploadFile = File(...)) -> dict:
    u = _me()
    if u.get("provider") != "local":
        raise HTTPException(400, "La foto di questo account si cambia su DRIP ID")
    data = await file.read(auth.AVATAR_MAX + 1)
    try:
        return {"picture": auth.set_local_avatar(u["username"], data)}
    except (ValueError, PermissionError) as exc:
        raise _bad(exc) from exc


@router.delete("/api/auth/me/avatar")
def delete_avatar() -> dict:
    u = _me()
    if u.get("provider") != "local":
        raise HTTPException(400, "La foto di questo account si cambia su DRIP ID")
    auth.set_local_avatar(u["username"], None)
    return {"picture": None}


@router.get("/api/auth/avatar/{username}")
def get_avatar(username: str) -> Response:
    _me()
    a = auth.local_avatar(username)
    if not a:
        raise HTTPException(404, "Nessuna foto")
    return Response(a[0], media_type=a[1], headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})


@router.post("/api/auth/login")
def login(request: Request, body: dict = Body(...)) -> JSONResponse:
    try:
        ident = auth.local_login(str(body.get("username") or ""), str(body.get("password") or ""))
    except PermissionError as exc:
        raise HTTPException(401, str(exc)) from exc
    token, age = auth.issue_session(ident)
    resp = JSONResponse({"ok": True, "user": ident})
    _cookie(resp, token, age, request)
    return resp


@router.post("/api/auth/logout")
def logout(request: Request) -> JSONResponse:
    u = auth.current_user.get() or {}
    redirect = None
    if u.get("provider") not in {None, "local", "open", "apikey"}:
        redirect = auth.logout_url(u["provider"], None, str(request.base_url))
    resp = JSONResponse({"ok": True, "redirect": redirect})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@router.post("/api/auth/password")
def password(request: Request, body: dict = Body(...)) -> JSONResponse:
    u = _me()
    if u.get("provider") != "local":
        raise HTTPException(400, "La password di DRIP ID si cambia sul portale DRIP ID")
    try:
        auth.change_password(u["username"], str(body.get("old") or ""), str(body.get("new") or ""))
    except (PermissionError, ValueError) as exc:
        raise _bad(exc) from exc
    ident = {**u, "mustChangePassword": False}
    for k in ("iat", "exp"):
        ident.pop(k, None)
    token, age = auth.issue_session(ident)
    resp = JSONResponse({"ok": True})
    _cookie(resp, token, age, request)
    return resp


@router.get("/api/auth/oidc/{pid}/login")
def oidc_login(pid: str, request: Request, next: str = "/") -> RedirectResponse:  # noqa: A002
    redirect_uri = str(request.url_for("oidc_callback"))
    try:
        url = auth.oidc_start(pid, redirect_uri, next)
    except Exception as exc:  # noqa: BLE001 — shown on the login screen
        return RedirectResponse(f"/#/login?error={_q(f'Provider non raggiungibile: {exc}')}", status_code=302)
    return RedirectResponse(url, status_code=302)


@router.get("/api/auth/oidc/callback", name="oidc_callback")
def oidc_callback(request: Request, code: str = "", state: str = "", error: str = "", error_description: str = "") -> RedirectResponse:
    if error:
        return RedirectResponse(f"/#/login?error={_q(error_description or error)}", status_code=302)
    try:
        ident, nxt, extra = auth.oidc_finish(code, state)
    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(f"/#/login?error={_q(str(exc))}", status_code=302)
    license.apply_identity_entitlement(extra.get("entitlement") or {})
    token, age = auth.issue_session(ident)
    resp = RedirectResponse(nxt or "/", status_code=302)
    _cookie(resp, token, age, request)
    return resp


def _q(s: str) -> str:
    from urllib.parse import quote
    return quote(s[:300])


# ------------------------------------------------------------------ users (admin)

@router.get("/api/auth/users")
def users() -> list[dict]:
    _require("admin")
    return auth.list_users()


@router.put("/api/auth/users")
def put_user(body: dict = Body(...)) -> dict:
    _require("admin")
    try:
        return auth.upsert_user(body)
    except ValueError as exc:
        raise _bad(exc) from exc


@router.delete("/api/auth/users/{username}")
def del_user(username: str) -> dict:
    me = _require("admin")
    if me.get("username") == username:
        raise HTTPException(400, "Non puoi eliminare il tuo account mentre lo usi")
    try:
        auth.delete_user(username)
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True}


# ------------------------------------------------------------------ platform configuration (admin)

@router.get("/api/platform/services")
def services(request: Request) -> list[dict]:
    """DRIP services for the launcher, with the addresses this installation actually knows."""
    _me()
    cfg = config.load()
    drip = next((p for p in cfg["identityProviders"] if p["id"] == "drip" and p.get("enabled") and p.get("issuer")), None)
    known = {
        "urban": str(request.base_url).rstrip("/") + "/",
        "fst": cfg.get("fstUrl") or "",
        # Keycloak account console of the DRIP realm.
        "account": f"{drip['issuer'].rstrip('/')}/account" if drip else "",
    }
    entitlement = license.status()
    result = []
    for s in cfg.get("services", []):
        feature = s.get("requiredFeature") or ("design" if s["id"] == "urban" else None)
        state = "unknown"
        if feature:
            if entitlement["status"] in {"active", "offline_grace", "trialing"} and feature in entitlement["features"]:
                state = "trial" if entitlement["status"] == "trialing" else "active"
            else:
                state = "unavailable"
        result.append({**s, "url": s.get("url") or known.get(s["id"], ""), "current": s["id"] == "urban", "entitlement": state})
    return result


@router.get("/api/platform/config")
def get_config() -> dict:
    _require("admin")
    return config.public_view()


@router.put("/api/platform/config")
def put_config(body: dict = Body(...)) -> dict:
    _require("admin")
    try:
        return config.public_view(config.save(body))
    except (ValueError, PermissionError) as exc:
        raise _bad(exc) from exc


@router.get("/api/platform/keys")
def keys() -> list[dict]:
    _require("admin")
    return integrations.list_keys()


@router.post("/api/platform/keys")
def new_key(body: dict = Body(...)) -> dict:
    me = _require("admin")
    try:
        return integrations.create_key(str(body.get("name") or ""), str(body.get("role") or "viewer"), me["name"], body.get("scopes"), body.get("expiresAt"))
    except ValueError as exc:
        raise _bad(exc) from exc


@router.delete("/api/platform/keys/{kid}")
def del_key(kid: str) -> dict:
    _require("admin")
    integrations.revoke_key(kid)
    return {"ok": True}


@router.get("/api/platform/webhooks")
def hooks() -> dict:
    _require("admin")
    return {"hooks": integrations.list_hooks(), "events": list(integrations.EVENTS)}


@router.post("/api/platform/webhooks")
def save_hook(body: dict = Body(...)) -> dict:
    _require("admin")
    try:
        return integrations.save_hook(body)
    except ValueError as exc:
        raise _bad(exc) from exc


@router.delete("/api/platform/webhooks/{hid}")
def del_hook(hid: str) -> dict:
    _require("admin")
    integrations.delete_hook(hid)
    return {"ok": True}


@router.post("/api/platform/webhooks/{hid}/test")
def test_hook(hid: str) -> dict:
    _require("admin")
    h = next((x for x in json.loads(json.dumps(integrations.list_hooks())) if x["id"] == hid), None)
    if not h:
        raise HTTPException(404, "Webhook inesistente")
    integrations.emit(h["events"][0], {"test": True, "message": "Prova di consegna da DRIP Urban"})
    return {"ok": True, "message": "Evento di prova inviato: l'esito compare tra qualche secondo."}


# ------------------------------------------------------------------ licence / subscription

@router.get("/api/license")
def get_license() -> dict:
    _me()
    return license.status()


@router.post("/api/license/activate")
def activate(body: dict = Body(...)) -> dict:
    _require("admin")
    try:
        st = license.activate(str(body.get("key") or ""))
    except ValueError as exc:
        raise _bad(exc) from exc
    integrations.emit("license.changed", {"plan": st.get("plan"), "status": st.get("status")})
    return st


@router.post("/api/license/refresh")
def refresh_license() -> dict:
    _me()
    return license.refresh()


@router.post("/api/license/deactivate")
def deactivate() -> dict:
    _require("admin")
    st = license.deactivate()
    integrations.emit("license.changed", {"plan": st.get("plan"), "status": st.get("status")})
    return st


# ------------------------------------------------------------------ updates

@router.get("/api/update")
def update_status() -> dict:
    _me()
    return updates.status()


@router.post("/api/update/check")
async def update_check() -> dict:
    _me()
    return await anyio.to_thread.run_sync(updates.check)


@router.post("/api/update/download")
def update_download() -> dict:
    _require("admin")
    try:
        return {"job": updates.download()}
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/api/update/apply")
def update_apply() -> dict:
    _require("admin")
    try:
        return updates.apply()
    except ValueError as exc:
        raise _bad(exc) from exc


# ------------------------------------------------------------------ API v1 (stable contract for the DRIP platform)

@router.post("/api/update/rollback")
def update_rollback() -> dict:
    _require("admin")
    try:
        return updates.rollback()
    except ValueError as exc:
        raise _bad(exc) from exc

@router.get("/api/v1/info")
def v1_info() -> dict:
    u = _me()
    st = license.status()
    return {
        "product": "drip-urban", "version": VERSION, "apiVersion": 1, "caller": {"name": u.get("name"), "role": u.get("role"), "via": u.get("via") or u.get("provider")},
        "license": {k: st.get(k) for k in ("status", "plan", "validUntil", "features")},
        "events": list(integrations.EVENTS),
        "docs": "/docs",
    }


@router.get("/api/v1/projects")
def v1_projects() -> list[dict]:
    _me()
    return ps.list_projects(include_archived=False)


@router.get("/api/v1/projects/{pid}")
def v1_project(pid: str) -> dict:
    _me()
    try:
        return {**ps.get_meta(pid), "scenarios": ps.list_scenarios(pid)}
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc


@router.get("/api/v1/projects/{pid}/scenarios/{sid}")
def v1_scenario(pid: str, sid: str) -> dict:
    _me()
    try:
        return ps.get_scenario(pid, sid)
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc


_OP_TYPE = re.compile(r"^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$|^batch$")


@router.post("/api/v1/projects/{pid}/scenarios/{sid}/operations")
def v1_append(pid: str, sid: str, body: Any = Body(...)) -> dict:
    """Appends operations authored outside the workstation (platform, Elios, scripts).

    The server checks the envelope; the full domain validation runs when the scenario is replayed,
    and an operation that does not apply is listed as failed in the workstation, never silently dropped.
    """
    me = _require("editor")
    ops = body.get("operations") if isinstance(body, dict) else body
    if not isinstance(ops, list) or not ops or len(ops) > 500:
        raise HTTPException(400, "operations: lista di 1–500 operazioni")
    from datetime import datetime, timezone
    import uuid
    clean = []
    for op in ops:
        if not isinstance(op, dict) or not _OP_TYPE.match(str(op.get("type") or "")) or not isinstance(op.get("payload"), (dict, list)):
            raise HTTPException(400, f"Operazione non valida: {str(op)[:120]}")
        clean.append({"id": str(op.get("id") or f"op-{uuid.uuid4().hex[:8]}"), "type": op["type"], "payload": op["payload"],
                      "author": me["name"], "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    try:
        cur = ps.get_scenario(pid, sid)
        return ps.save_scenario(pid, sid, {"operations": [*(cur.get("operations") or []), *clean]}, cur.get("revision", 0), me["name"])
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc


@router.get("/api/v1/projects/{pid}/docs/{name}")
def v1_doc(pid: str, name: str) -> Any:
    _me()
    try:
        return ps.get_doc(pid, name)
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc
