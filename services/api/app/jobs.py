"""Background jobs (OSM import) with progress, cancellation and error reporting."""
from __future__ import annotations

import threading
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def start(kind: str, label: str, fn: Callable[[Callable[[float, str], None]], Any]) -> dict:
    jid = "j-" + uuid.uuid4().hex[:10]
    job = {"id": jid, "kind": kind, "label": label, "status": "running", "progress": 0.0, "message": "Avvio", "startedAt": _now(), "result": None, "error": None}
    with _lock:
        _jobs[jid] = job

    def report(p: float, msg: str) -> None:
        with _lock:
            if job["status"] == "running":
                job["progress"] = max(0.0, min(1.0, float(p)))
                job["message"] = msg

    def run() -> None:
        try:
            result = fn(report)
            with _lock:
                job.update(status="done", progress=1.0, message="Completato", result=result, finishedAt=_now())
        except Exception as exc:  # noqa: BLE001 — surfaced to the user with the real cause
            with _lock:
                job.update(status="error", error=str(exc)[:500], message="Errore", finishedAt=_now(), trace=traceback.format_exc()[-2000:])

    threading.Thread(target=run, name=f"job-{jid}", daemon=True).start()
    return dict(job)


def get(jid: str) -> dict | None:
    with _lock:
        j = _jobs.get(jid)
        return {k: v for k, v in j.items() if k != "trace"} if j else None
