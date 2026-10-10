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
_download_lock = threading.Lock()


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
        if not isinstance(latest, dict) or not isinstance(latest.get("version"), str) or not re.fullmatch(r"[0-9A-Za-z.\-]{1,64}", latest["version"]):
            raise ValueError("Risposta release senza versione valida")
        size = latest.get("size")
        if size is not None and (not isinstance(size, int) or isinstance(size, bool) or size < 0 or size > 1024**3):
            raise ValueError("Dimensione release non valida")
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
    out["ready"] = read_json(_dir() / "ready.json", None)
    out["installation"] = read_json(_dir() / "installation.json", None)
    return out


def download() -> dict:
    st = status()
    latest = st.get("latest")
    if not st["available"] or not latest:
        raise ValueError("Nessun aggiornamento disponibile")
    if not str(latest.get("url", "")).startswith("https://") or not re.fullmatch(r"[0-9a-f]{64}", str(latest.get("sha256", ""))):
        raise ValueError("Pacchetto di aggiornamento senza indirizzo https o impronta SHA-256: rifiutato")
    version = re.sub(r"[^0-9A-Za-z.\-]", "", str(latest["version"]))

    if not _download_lock.acquire(blocking=False):
        raise ValueError("Un download aggiornamento è già in corso")

    def run(report):
        target = _dir() / f"drip-urban-{version}.zip"
        tmp = target.with_suffix(".part")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with httpx.stream("GET", latest["url"], timeout=60, follow_redirects=True, headers={"User-Agent": SETTINGS.user_agent}) as r:
                r.raise_for_status()
                if r.url.scheme != "https" or any(response.url.scheme != "https" for response in r.history):
                    raise ValueError("Redirect aggiornamento non sicuro")
                header_size = int(r.headers.get("content-length") or 0)
                declared_size = int(latest.get("size") or 0)
                if header_size < 0 or max(header_size, declared_size) > 1024**3:
                    raise ValueError("Pacchetto aggiornamento oltre 1 GB")
                if header_size and declared_size and header_size != declared_size:
                    raise ValueError("Dimensione HTTP diversa dalla release pubblicata")
                total = declared_size or header_size
                done = 0
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_bytes(1 << 16):
                        done += len(chunk)
                        if done > 1024**3:
                            raise ValueError("Pacchetto aggiornamento oltre 1 GB")
                        fh.write(chunk)
                        h.update(chunk)
                        if total:
                            report(min(0.95, done / total), f"Download {done // (1 << 20)} / {total // (1 << 20)} MB")
            if total and done != total:
                raise ValueError("Download incompleto: dimensione diversa da quella pubblicata")
            if h.hexdigest() != latest["sha256"]:
                raise RuntimeError("Impronta SHA-256 diversa da quella pubblicata: pacchetto scartato")
            tmp.replace(target)
            atomic_write_json(_dir() / "ready.json", {"version": version, "file": target.name, "sha256": latest["sha256"], "notes": latest.get("notes"),
                                                       "downloadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            return {"version": version, "file": target.name}
        finally:
            tmp.unlink(missing_ok=True)
            _download_lock.release()

    try:
        return jobs.start("update_download", f"Aggiornamento {version}", run)
    except Exception:
        if _download_lock.locked():
            _download_lock.release()
        raise


def apply() -> dict:
    ready = read_json(_dir() / "ready.json", None)
    if not ready or not (_dir() / ready["file"]).exists():
        raise ValueError("Scarica prima l'aggiornamento")
    pending = {**ready, "requestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "from": VERSION}
    atomic_write_json(_dir() / "pending.json", pending)
    return {"ok": True, "pending": pending, "message": "Aggiornamento pronto: verrà installato al prossimo avvio di DRIP Urban."}


def rollback() -> dict:
    receipt = read_json(_dir() / "installation.json", None)
    if not receipt or receipt.get("status") != "installed" or not receipt.get("backup"):
        raise ValueError("Nessun aggiornamento installato con backup ripristinabile")
    from pathlib import Path
    backup = Path(receipt["backup"]).resolve()
    if backup.parent != _dir().resolve() or not backup.is_file():
        raise ValueError("Backup assente o fuori dalla directory aggiornamenti")
    if hashlib.sha256(backup.read_bytes()).hexdigest() != receipt.get("backupSha256"):
        raise ValueError("Integrità del backup non valida")
    pending = {"action": "rollback", "file": backup.name, "sha256": receipt["backupSha256"],
               "version": receipt["from"], "remove": receipt.get("createdFiles", []),
               "requestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "from": VERSION}
    atomic_write_json(_dir() / "pending.json", pending)
    return {"ok": True, "message": "Ripristino preparato per il prossimo avvio. Progetti e impostazioni sono preservati."}


def auto_check_in_background() -> None:
    if config.load()["updates"].get("autoCheck", True):
        threading.Thread(target=check, daemon=True, name="update-check").start()
