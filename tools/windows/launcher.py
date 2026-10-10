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


def _install_pending_update() -> None:
    """Install a validated staged release before starting the server."""
    sys.path.insert(0, str(API))
    from app.settings import SETTINGS, VERSION
    from app.storage import atomic_write_json
    from update_package import install
    import json
    import subprocess
    from datetime import datetime, timezone
    updates = SETTINGS.data_dir / "updates"
    marker = updates / "pending.json"
    if not marker.is_file(): return
    receipt = {"at": datetime.now(timezone.utc).isoformat(), "from": VERSION}
    try:
        info = json.loads(marker.read_text(encoding="utf-8"))
        name = info["file"]
        if Path(name).name != name or "\\" in name or ":" in name:
            raise ValueError("Nome pacchetto non valido")
        package = updates / name
        receipt["version"] = info["version"]
        def prepare(stage):
            requirements = stage / "services/api/requirements.txt"
            if requirements.is_file():
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(requirements)], check=True)
        backup = updates / ("backup-" + str(int(time.time())) + ".zip")
        rolling_back = info.get("action") == "rollback"
        receipt.update(install(ROOT, package, info["sha256"], backup, SETTINGS.data_dir, prepare,
                               remove=info.get("remove", []) if rolling_back else (),
                               require_release=not rolling_back))
        receipt["status"] = "rolled_back" if rolling_back else "installed"
        print(f"Aggiornamento {info['version']} installato. Backup: {backup}")
        marker.unlink(missing_ok=True)
        (updates / "ready.json").unlink(missing_ok=True)
    except Exception as error:
        receipt.update(status="failed", error=str(error))
        print(f"Aggiornamento fallito: {error}. Consultare updates/installation.json.")
        # Preserve the request and package for diagnosis; do not silently discard failure.
        marker.replace(updates / "failed-request.json")
    finally:
        atomic_write_json(updates / "installation.json", receipt)


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
