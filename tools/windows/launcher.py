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


def main() -> int:
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
    print("  chiudi questa finestra (o Ctrl+C) per fermare il server.\n")
    threading.Thread(target=_open_when_ready, args=(url, f"http://{HOST}:{port}/api/health"), daemon=True).start()
    uvicorn.run("app.main:app", host=HOST, port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
