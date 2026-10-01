"""Civic publication (Frattamaggiore Si Trasforma layer).

A publication is an immutable, self-contained bundle of one scenario: the
editorial text, the transparency record and the before/after geometry exported
by the workstation. Nothing is invented: every field comes from the request,
and the record states who published it and when.
"""
from __future__ import annotations

import json
import time
import uuid

import httpx
from datetime import datetime, timezone

from app.settings import SETTINGS
from app.storage import atomic_write_json, read_json, safe_id

STATUSES = {"proposta", "in_valutazione", "approvato", "finanziato", "in_corso", "completato", "sospeso"}


def _user() -> dict:
    return read_json(SETTINGS.settings_dir / "user.json", None) or {"name": "Utente locale", "role": "admin"}


def user() -> dict:
    return _user()


def set_user(name: str, role: str) -> dict:
    if role not in {"viewer", "editor", "publisher", "admin"}:
        raise ValueError("Ruolo non valido")
    if not (2 <= len(name.strip()) <= 80):
        raise ValueError("Nome 2–80 caratteri")
    u = {"name": name.strip(), "role": role}
    atomic_write_json(SETTINGS.settings_dir / "user.json", u)
    return u


def can_publish() -> bool:
    return _user().get("role") in {"publisher", "admin"}


def publish(project_id: str, body: dict) -> dict:
    if not can_publish():
        raise PermissionError("Il tuo ruolo non consente la pubblicazione civica")
    required = ("title", "summary", "scenarioId", "status", "responsibleBody")
    missing = [k for k in required if not str(body.get(k) or "").strip()]
    if missing:
        raise ValueError(f"Campi obbligatori mancanti: {', '.join(missing)}")
    if body["status"] not in STATUSES:
        raise ValueError("Stato non valido")
    for doc in body.get("documents") or []:
        if not str(doc.get("title") or "").strip() or not str(doc.get("url") or "").startswith(("https://", "http://")):
            raise ValueError("Ogni documento richiede titolo e URL")
    geo = body.get("geometry") or {}
    if not isinstance(geo.get("after"), dict) or geo["after"].get("type") != "FeatureCollection":
        raise ValueError("Geometria di progetto mancante")
    if len(json.dumps(body)) > 25 * 1024 * 1024:
        raise ValueError("Pubblicazione troppo grande")
    pub_id = "pub-" + uuid.uuid4().hex[:10]
    u = _user()
    record = {
        "id": pub_id, "projectId": safe_id(project_id), "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "publishedBy": u["name"], "title": body["title"].strip()[:160], "summary": body["summary"].strip()[:4000],
        "story": (body.get("story") or "").strip()[:20000], "scenarioId": body["scenarioId"], "scenarioName": body.get("scenarioName"),
        "status": body["status"], "responsibleBody": body["responsibleBody"].strip()[:200],
        "estimatedCostEur": body.get("estimatedCostEur") if isinstance(body.get("estimatedCostEur"), (int, float)) else None,
        "costSource": (body.get("costSource") or "").strip()[:300] or None,
        "documents": body.get("documents") or [], "metrics": body.get("metrics") or [], "geometry": geo,
        "bbox": body.get("bbox"), "sources": body.get("sources") or [],
    }
    atomic_write_json(SETTINGS.publications_dir / f"{pub_id}.json", record)
    return record


def list_publications(project_id: str | None = None) -> list[dict]:
    d = SETTINGS.publications_dir
    if not d.exists():
        return []
    rows = [read_json(p) for p in d.glob("pub-*.json")]
    rows = [r for r in rows if r and (not project_id or r["projectId"] == project_id)]
    return sorted(({k: v for k, v in r.items() if k != "geometry"} for r in rows), key=lambda r: r["publishedAt"], reverse=True)


def get_publication(pub_id: str) -> dict | None:
    return read_json(SETTINGS.publications_dir / f"{safe_id(pub_id)}.json")


def withdraw(pub_id: str) -> None:
    if not can_publish():
        raise PermissionError("Il tuo ruolo non consente di ritirare pubblicazioni")
    # Withdrawn publications are kept for the transparency record, flagged and hidden from the public view.
    p = SETTINGS.publications_dir / f"{safe_id(pub_id)}.json"
    rec = read_json(p)
    if rec:
        rec["withdrawnAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rec["withdrawnBy"] = _user()["name"]
        atomic_write_json(p, rec)


FST_ORIGIN = "https://frattamaggioresitrasforma.studiodrip.it"
_fst_cache: dict[str, tuple[float, dict]] = {}


def fst_public(kind: str) -> dict:
    """Read-only public data of the FST civic platform (reports / projects). Never writes to it."""
    if kind not in {"reports", "projects"}:
        raise ValueError("Tipo non valido")
    hit = _fst_cache.get(kind)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        r = httpx.get(f"{FST_ORIGIN}/wp-json/fst-mobile/v1/maps/{kind}", timeout=15, headers={"User-Agent": SETTINGS.user_agent, "Accept": "application/json"})
        r.raise_for_status()
        data = {"status": "ok", "source": f"{FST_ORIGIN} (API pubblica fst-mobile/v1)", "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": r.json().get("items", [])}
    except (httpx.HTTPError, ValueError) as exc:
        return {"status": "error", "message": f"Piattaforma FST non raggiungibile: {exc}"[:300], "items": []}
    _fst_cache[kind] = (time.time(), data)
    return data
