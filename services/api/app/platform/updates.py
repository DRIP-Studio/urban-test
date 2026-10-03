"""Automatic updates from the DRIP platform.

* ``GET {platformUrl}/v1/releases/drip-urban/latest?channel=&current=&os=`` answers
  ``{version, notes, url, sha256, size, mandatory, publishedAt}``.
* The package (zip of the repository layout) is downloaded in the background into
  ``<data>/updates/`` and verified with SHA-256. Nothing is replaced while the program runs.
* ``apply`` writes ``<data>/updates/pending.json``; the Windows launcher installs it at the next
  start (``tools/windows/launcher.py``), keeping ``.venv`` and every user data folder untouched.
"""
from __future__ import annotations

import hashlib
import platform as _pf
import re
import threading
from datetime import datetime, timezone

import httpx

from app import jobs
from app.settings import SETTINGS, VERSION
from app.storage import atomic_write_json, read_json

from . import config

_state: dict = {"checkedAt": None, "latest": None, "error": None}
_lock = threading.Lock()


def _dir():
    return SETTINGS.data_dir / "updates"


def _vtuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def check() -> dict:
    cfg = config.load()
    url = cfg["platformUrl"].rstrip("/") + "/v1/releases/drip-urban/latest"
    try:
        r = httpx.get(url, params={"channel": cfg["updates"].get("channel", "stable"), "current": VERSION, "os": _pf.system().lower(),
                                   "deviceId": config.device_id()}, timeout=10, headers={"User-Agent": SETTINGS.user_agent})
        r.raise_for_status()
        latest = r.json()
        with _lock:
            _state.update(latest=latest, error=None)
    except (httpx.HTTPError, ValueError) as exc:
        with _lock:
            _state.update(error=f"Piattaforma DRIP non raggiungibile: {exc}"[:300])
    with _lock:
        _state["checkedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return status()


def status() -> dict:
    with _lock:
        latest = _state.get("latest")
        out = {"current": VERSION, "checkedAt": _state["checkedAt"], "error": _state["error"], "latest": latest,
               "available": bool(latest and _vtuple(str(latest.get("version", "0"))) > _vtuple(VERSION)),
               "channel": config.load()["updates"].get("channel", "stable"), "autoCheck": config.load()["updates"].get("autoCheck", True)}
    pending = read_json(_dir() / "pending.json", None)
    out["pending"] = pending
    return out


def download() -> dict:
    st = status()
    latest = st.get("latest")
    if not st["available"] or not latest:
        raise ValueError("Nessun aggiornamento disponibile")
    if not str(latest.get("url", "")).startswith("https://") or not re.fullmatch(r"[0-9a-f]{64}", str(latest.get("sha256", ""))):
        raise ValueError("Pacchetto di aggiornamento senza indirizzo https o impronta SHA-256: rifiutato")
    version = re.sub(r"[^0-9A-Za-z.\-]", "", str(latest["version"]))

    def run(report):
        target = _dir() / f"drip-urban-{version}.zip"
        target.parent.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha256()
        with httpx.stream("GET", latest["url"], timeout=60, follow_redirects=True, headers={"User-Agent": SETTINGS.user_agent}) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length") or latest.get("size") or 0)
            done = 0
            tmp = target.with_suffix(".part")
            with open(tmp, "wb") as fh:
                for chunk in r.iter_bytes(1 << 16):
                    fh.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    if total:
                        report(min(0.95, done / total), f"Download {done // (1 << 20)} / {total // (1 << 20)} MB")
        if h.hexdigest() != latest["sha256"]:
            tmp.unlink(missing_ok=True)
            raise RuntimeError("Impronta SHA-256 diversa da quella pubblicata: pacchetto scartato")
        tmp.replace(target)
        atomic_write_json(_dir() / "ready.json", {"version": version, "file": target.name, "sha256": latest["sha256"], "notes": latest.get("notes"),
                                                   "downloadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        return {"version": version, "file": target.name}

    return jobs.start("update_download", f"Aggiornamento {version}", run)


def apply() -> dict:
    ready = read_json(_dir() / "ready.json", None)
    if not ready or not (_dir() / ready["file"]).exists():
        raise ValueError("Scarica prima l'aggiornamento")
    pending = {**ready, "requestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "from": VERSION}
    atomic_write_json(_dir() / "pending.json", pending)
    return {"ok": True, "pending": pending, "message": "Aggiornamento pronto: verrà installato al prossimo avvio di DRIP Urban."}


def auto_check_in_background() -> None:
    if config.load()["updates"].get("autoCheck", True):
        threading.Thread(target=check, daemon=True, name="update-check").start()
