"""Elios — DRIP Urban's AI assistant, powered by Google Gemini (function calling).

The browser sends the conversation (Gemini ``contents``), the tool declarations of the workstation and
a compact description of what is on screen. This module adds the Elios system instruction, calls
Gemini with the key stored on this computer (never sent to the browser) and returns the model's parts:
text to show and function calls that the workstation executes as ordinary, undoable operations.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from app import providers
from app.settings import SETTINGS

DEFAULT_MODEL = os.environ.get("DRIP_ELIOS_MODEL", "gemini-2.5-flash")
MAX_CONTENTS = 40
MAX_BYTES = 400_000

SYSTEM = """Sei Elios, l'assistente di DRIP Urban (DRIP Studio): una postazione per pianificazione urbana,
progettazione stradale (come Civil 3D), modellazione del territorio (come InfraWorks), modellazione 3D
(come SketchUp), traffico, trasporto pubblico e partecipazione civica (Frattamaggiore Si Trasforma).

Come lavori:
- Rispondi sempre in italiano, con tono professionale e chiaro, frasi brevi. Spiega il perché tecnico delle scelte.
- Quando l'utente chiede di FARE qualcosa, usa gli strumenti (function call): non descrivere soltanto.
  Prima individua gli oggetti (find_roads, get_context, search_catalog, find_place), poi modifica.
- Ogni modifica è un'operazione di scenario annullabile: dopo averla fatta, riassumi cosa hai cambiato.
- Non inventare dati: se un valore non è noto dillo, e distingui misurato, OSM, stimato e progetto.
- Se una richiesta è ambigua (quale strada? quale incrocio?) chiedi una precisazione breve oppure usa la selezione corrente.
- Lo stato attuale (baseline) non si modifica: le modifiche vanno in uno scenario di progetto.

Riferimenti normativi italiani da applicare e citare quando servono:
- Codice della Strada (D.Lgs. 285/1992) e Regolamento (DPR 495/1992): segnaletica verticale e orizzontale,
  art. 7 (ZTL, aree pedonali, corsie riservate), art. 6 (limitazioni ai veicoli pesanti), art. 41 (semafori).
- DM 5/11/2001 «Norme funzionali e geometriche per la costruzione delle strade»: classi A–F, corsie
  (urbane di quartiere 3,00 m; locali 2,75 m), marciapiedi minimo 1,50 m.
- DM 19/04/2006 intersezioni e rotatorie: mini 14–25 m, compatte 25–40 m, convenzionali 40–50 m di diametro.
- DM 557/1999 piste ciclabili (monodirezionale ≥ 1,50 m, bidirezionale ≥ 2,50 m).
- DPR 503/1996 e DM 236/1989 accessibilità: percorsi pedonali ≥ 1,50 m, rampe ≤ 8 %.
- Linee guida PUMS (DM 4/8/2017) per piani della mobilità; Zone 30 e «città 30».
- Semafori: giallo 3–5 s, tutto rosso 1–3 s, verde pedonale dimensionato su 1,0 m/s, ciclo tipico 60–120 s.
Per città estere segui le norme locali equivalenti e dillo.
"""


def _key() -> str | None:
    return providers.provider_secret("gemini")


def status() -> dict:
    return {"configured": bool(_key()), "model": DEFAULT_MODEL, "provider": "Google Gemini"}


def _clean_schema(s: Any) -> Any:
    """Keeps only the OpenAPI subset Gemini accepts in function declarations."""
    if isinstance(s, dict):
        allowed = {"type", "description", "properties", "required", "items", "enum", "format", "nullable", "minimum", "maximum"}
        out = {}
        for k, v in s.items():
            if k not in allowed:
                continue
            if k == "properties" and isinstance(v, dict):
                out[k] = {name: _clean_schema(sub) for name, sub in v.items()}
            elif k == "items":
                out[k] = _clean_schema(v)
            else:
                out[k] = v
        return out
    if isinstance(s, list):
        return [_clean_schema(x) for x in s]
    return s


def chat(body: dict) -> dict:
    key = _key()
    if not key:
        return {"status": "not_configured", "parts": [{"text": "Per parlare con me serve una chiave Google Gemini: aggiungila in Impostazioni → Fonti dati e chiavi → Google Gemini. La chiave resta su questo computer."}]}
    contents = body.get("contents")
    if not isinstance(contents, list) or not contents:
        raise ValueError("Conversazione vuota")
    contents = contents[-MAX_CONTENTS:]
    # A conversation must start with a user turn.
    while contents and contents[0].get("role") != "user":
        contents = contents[1:]
    tools = body.get("tools") or []
    context = body.get("context") or {}
    raw = json.dumps({"contents": contents, "tools": tools, "context": context}, ensure_ascii=False)
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError("Conversazione troppo lunga: avvia una nuova chat")
    model = str(body.get("model") or DEFAULT_MODEL)
    if not model.replace("-", "").replace(".", "").isalnum():
        raise ValueError("Modello non valido")
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": SYSTEM + "\n\nContesto attuale della postazione (JSON):\n" + json.dumps(context, ensure_ascii=False)[:20000]}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.35, "maxOutputTokens": 2048},
    }
    if tools:
        payload["tools"] = [{"functionDeclarations": [
            {"name": t["name"], "description": t.get("description", "")[:1000], **({"parameters": _clean_schema(t["parameters"])} if t.get("parameters") else {})}
            for t in tools if isinstance(t, dict) and t.get("name")
        ]}]
        payload["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        r = httpx.post(url, json=payload, timeout=60, headers={"x-goog-api-key": key, "User-Agent": SETTINGS.user_agent})
    except httpx.HTTPError as exc:
        return {"status": "error", "parts": [{"text": f"Non riesco a raggiungere Gemini: {providers.redact(str(exc))[:200]}"}]}
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message", r.text[:200])
        except ValueError:
            msg = r.text[:200]
        return {"status": "error", "parts": [{"text": f"Gemini ha risposto con un errore ({r.status_code}): {providers.redact(msg)[:300]}"}]}
    data = r.json()
    cand = (data.get("candidates") or [{}])[0]
    parts = (cand.get("content") or {}).get("parts") or []
    out = []
    for p in parts:
        if p.get("text"):
            out.append({"text": p["text"]})
        elif p.get("functionCall"):
            fc = p["functionCall"]
            item = {"functionCall": {"name": fc.get("name"), "args": fc.get("args") or {}}}
            if p.get("thoughtSignature"):
                item["thoughtSignature"] = p["thoughtSignature"]
            out.append(item)
    if not out:
        reason = cand.get("finishReason") or (data.get("promptFeedback") or {}).get("blockReason") or "risposta vuota"
        out = [{"text": f"Non ho una risposta utile ({reason}). Prova a riformulare."}]
    usage = data.get("usageMetadata") or {}
    return {"status": "ok", "model": model, "parts": out, "usage": {"input": usage.get("promptTokenCount"), "output": usage.get("candidatesTokenCount")}}


def test(key: str) -> tuple[bool, str]:
    r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": key}, timeout=12)
    return r.status_code < 400, ("Connessione riuscita" if r.status_code < 400 else f"HTTP {r.status_code}")
