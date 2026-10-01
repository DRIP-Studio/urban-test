"""Build the Italian sign catalogue from packages/assets/signs/it.

Source: Wikimedia Commons via github.com/albertograva/italian_road_signs (CC BY-SA 3.0).
Every SVG is parsed with a real XML parser and rebuilt keeping only SVG/XLink
elements and attributes: no scripts, foreignObject, event handlers or editor data.

Usage: python tools/signs/build_catalog.py
"""
from __future__ import annotations

import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "packages/assets/signs/it"
OUT = SRC / "clean"
SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
DROP_TAGS = {"script", "foreignObject", "metadata", "title", "desc", "switch"}
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)

FAMILY_RULES = [
    ("priority", r"dare_precedenza|fermarsi|diritto_di_precedenza|fine_del_diritto|intersezione_con|intersezione_a_T|precedenza_a_destra"),
    ("prohibition", r"^divieto|^limite_di_velocita|^fine_limite_di|transito_vietato|^fine_del_divieto|distanziamento"),
    ("mandatory", r"obbligatori|obbligatorio|^direzioni_consentite|passaggi_consentiti|^limite_minimo|^fine_limite_minimo|catene|^pista_ciclabile|^percorso_pedonale|^fine_pista|^fine_percorso|percorso_riservato|^rotatoria$|circolazione_rotatoria|uso_corsie|corsia_riservata"),
    ("ztl", r"zona_traffico_limitato|ZTL|area_pedonale|zona_30|zona_residenziale|fine_zona"),
    ("parking", r"parcheggio|sosta|rimozione_forzata|passo_carrabile|taxi"),
    ("temporary", r"provvisorio|lavori|mezzi_di_lavoro|segnaletica_in_rifacimento|coda|incidente|sgombraneve|posto_di_blocco"),
    ("warning", r"pericol|curva|strettoia|dosso|cunetta|discesa|salita|bambini|animali|caduta|sdrucciolevole|attraversamento|passaggio_a_livello|croce|semaforo|doppio_senso|banchina|forte_vento|materiale_instabile|piena|aeromobili|ponte_mobile|sbocco|confluenza|doppia_curva|autocarri|zona_soggetta|transitabilita|strada_dissestata"),
    ("direction", r"preavviso|direzione_|segnale_di_itinerario|progressiva|Strada_|strada_comunale|estesa|distanza|inizio_|fine_centro|confine|segnali_di_territorio|segnali_turistici|avvio_zona|svolta_a_sx|variazione_corsie|inversione"),
]
FAMILY_LABEL = {
    "priority": "Precedenza", "prohibition": "Divieto", "mandatory": "Obbligo", "ztl": "ZTL e zone",
    "parking": "Sosta", "temporary": "Temporanei e lavori", "warning": "Pericolo",
    "direction": "Direzione e territorio", "information": "Indicazione",
}


def family_of(sign_id: str) -> str:
    for fam, rx in FAMILY_RULES:
        if re.search(rx, sign_id):
            return fam
    return "information"


def label_of(sign_id: str) -> str:
    t = re.sub(r"_-_new$", "", sign_id).replace("_", " ").replace(" - ", " – ").replace(" kmh", " km/h")
    return t[:1].upper() + t[1:]


def _ns(tag: str) -> tuple[str, str]:
    if tag.startswith("{"):
        ns, local = tag[1:].split("}", 1)
        return ns, local
    return "", tag


def _clean(el: ET.Element) -> None:
    for child in list(el):
        if not isinstance(child.tag, str):  # comments / processing instructions
            el.remove(child)
            continue
        ns, local = _ns(child.tag)
        if ns not in (SVG, "") or local in DROP_TAGS:
            el.remove(child)
            continue
        _clean(child)
    for key in list(el.attrib):
        ns, local = _ns(key)
        value = el.attrib[key]
        if ns not in ("", XLINK) or local.lower().startswith("on"):
            del el.attrib[key]
        elif local == "href" and re.match(r"\s*(javascript:|https?:|data:text)", value, re.I):
            del el.attrib[key]


def sanitize(path: Path) -> str:
    root = ET.parse(path).getroot()
    if _ns(root.tag)[1] != "svg":
        raise ValueError("root is not <svg>")
    _clean(root)
    if "viewBox" not in root.attrib:
        w = float(re.sub(r"[^\d.]", "", root.attrib.get("width", "")) or 0)
        h = float(re.sub(r"[^\d.]", "", root.attrib.get("height", "")) or 0)
        if w <= 0 or h <= 0:
            raise ValueError("no viewBox and no numeric size")
        root.set("viewBox", f"0 0 {w:g} {h:g}")
    for k in ("width", "height", "x", "y"):
        root.attrib.pop(k, None)
    return ET.tostring(root, encoding="unicode")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.svg"):
        old.unlink()
    items, failures = [], []
    for f in sorted(SRC.glob("*.svg")):
        sid = f.stem
        slug = re.sub(r"[^\w.,()+-]", "_", unicodedata.normalize("NFKD", sid))
        try:
            (OUT / f"{slug}.svg").write_text(sanitize(f), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001 — report every broken source file
            failures.append({"file": f.name, "error": str(exc)})
            continue
        fam = family_of(sid)
        items.append({"id": f"it.sign.{slug}", "file": f"{slug}.svg", "label": label_of(sid), "family": fam})
    catalog = {
        "source": "Wikimedia Commons via github.com/albertograva/italian_road_signs",
        "license": "CC BY-SA 3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "families": FAMILY_LABEL,
        "items": items,
    }
    (SRC / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    counts: dict[str, int] = {}
    for i in items:
        counts[i["family"]] = counts.get(i["family"], 0) + 1
    print("signs", len(items), counts, "failures", failures)


if __name__ == "__main__":
    main()
