"""DRIP Urban launcher: serves API + built web app on one local port and opens the browser.

Run through `Avvia DRIP Urban.bat`, which prepares the Python environment first.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "services" / "api"
DIST = ROOT / "apps" / "web" / "dist"
HOST = "127.0.0.1"


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((HOST, port)) == 0


def _is_drip(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/health", timeout=2) as r:
            return r.status == 200 and b"drip" in r.read().lower()
    except OSError:
        return False


def _open_when_ready(url: str, health: str) -> None:
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health, timeout=1):
                webbrowser.open(url)
                return
        except OSError:
            time.sleep(0.4)
    print("Il server non risponde dopo 60 s: controlla i messaggi qui sopra.")


# Never overwritten by an update: the Python environment, user data, local caches.
_KEEP = {".venv", ".git", "node_modules", ".data"}


def _install_pending_update() -> None:
    """Installs an update downloaded and verified by the API (app/platform/updates.py).

    The zip mirrors the repository layout. Files are extracted over the installation, except the
    Python environment and data folders; the previous version is kept in updates/backup-<ver>.zip.
    """
    sys.path.insert(0, str(API))
    from app.settings import SETTINGS, VERSION  # noqa: E402

    updates = SETTINGS.data_dir / "updates"
    marker = updates / "pending.json"
    if not marker.is_file():
        return
    import hashlib
    import json
    import shutil
    import subprocess
    import zipfile

    info = json.loads(marker.read_text(encoding="utf-8"))
    pkg = updates / info["file"]
    try:
        digest = hashlib.sha256(pkg.read_bytes()).hexdigest()
        if digest != info["sha256"]:
            raise RuntimeError("impronta SHA-256 non valida")
        print(f"Installazione dell'aggiornamento {info['version']} (da {VERSION})…")
        backup = updates / f"backup-{VERSION}.zip"
        with zipfile.ZipFile(backup, "w", zipfile.ZIP_DEFLATED) as zb:
            for f in ROOT.rglob("*"):
                rel = f.relative_to(ROOT)
                if f.is_file() and not (set(rel.parts) & _KEEP):
                    zb.write(f, rel.as_posix())
        with zipfile.ZipFile(pkg) as z:
            for member in z.infolist():
                rel = Path(member.filename)
                if rel.is_absolute() or ".." in rel.parts or set(rel.parts) & _KEEP:
                    continue
                target = ROOT / rel
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        req = API / "requirements.txt"
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(req)], check=False)
        print(f"Aggiornamento {info['version']} installato. Copia della versione precedente: {backup}")
    except Exception as exc:  # noqa: BLE001 — never block the start for a failed update
        print(f"Aggiornamento non installato ({exc}). DRIP Urban parte con la versione attuale.")
    finally:
        marker.unlink(missing_ok=True)
        (updates / "ready.json").unlink(missing_ok=True)


def main() -> int:
    _install_pending_update()
    if not (DIST / "index.html").is_file():
        print(f"Interfaccia non compilata: manca {DIST / 'index.html'}.")
        print("Da sviluppatore: esegui `npm install` e `npm run build` nella cartella del progetto.")
        return 2
    port = int(os.environ.get("DRIP_URBAN_PORT", "8765"))
    url = f"http://{HOST}:{port}/"
    if _port_in_use(port):
        if _is_drip(port):
            print(f"DRIP Urban è già in esecuzione: apro {url}")
            webbrowser.open(url)
            return 0
        print(f"La porta {port} è occupata da un altro programma. Imposta DRIP_URBAN_PORT con una porta libera.")
        return 3

    sys.path.insert(0, str(API))
    os.chdir(API)
    import uvicorn  # noqa: E402  (installed by the .bat)
    from app.settings import SETTINGS  # noqa: E402

    print("DRIP Urban")
    print(f"  indirizzo : {url}")
    print(f"  dati      : {SETTINGS.data_dir}")
    if not (SETTINGS.settings_dir / "users.json").exists():
        print("  primo accesso: utente «admin», password «admin» (provvisoria, da cambiare subito)")
    print("  chiudi questa finestra (o Ctrl+C) per fermare il server.\n")
    threading.Thread(target=_open_when_ready, args=(url, f"http://{HOST}:{port}/api/health"), daemon=True).start()
    uvicorn.run("app.main:app", host=HOST, port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
