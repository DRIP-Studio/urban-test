# DRIP Urban — Audit del codice 53.0 (Fase 1)

Data: 2026-10-01 · Fonte: `DRIP-Urban-Planning-Studio-53.0-JUNCTION-SAFETY-REBUILD-Windows.zip` (estratto in `_audit/urban-53/`)
Metodo: lettura del codice, esecuzione del 53.0 su una **copia** dei dati utente (`%LOCALAPPDATA%\DRIP Urban Planning Studio\data`, chiavi API escluse), screenshot runtime in `_audit/urban-53/shots/`.

## 1. Cosa c'è davvero

| Area | Stato reale |
|---|---|
| Backend | FastAPI, 1 processo, `main.py` 117 KB con **159 endpoint** in un unico file. Stato in memoria (`CityState`, RLock) + JSON su disco con scrittura atomica. |
| Frontend | `app.js` **467 KB / 1.979 righe** (righe fino a 6.000 caratteri), 355 funzioni globali, 122 layer MapLibre, oggetto `window.state` con ~120 chiavi mutabili da chiunque. |
| CSS | 3 fogli stratificati (`workstation.css` 108 KB, `canvas-engine.css`, `v53.css`) con **245 `!important`**. |
| Twin 3D | `earth3d.html` separato (70 KB) con **un secondo renderer** che rilegge le API e ridisegna strade/asset per conto suo. Carica Cesium da CDN in **due versioni (1.105 e 1.145)**. |
| Dati città | `city.json` 26 MB: 5.645 nodi, 6.409 tratti, 4.053 edifici, 1.044 feature di contesto. OSM ODbL, acquisito 2026-09-17, bbox 14.255–14.3005 / 40.9285–40.9548. **Reale e valido.** |
| Dati utente | `scenarios.json` 370 KB. Scenario `future` ("Scenario progetto"): 18 operazioni, 127 elementi (31 cartelli, 28 alberi, 23 custom, 11 semafori, 10 attraversamenti, 9 piazze…), 98 nodi e 114 tratti aggiunti, 77 tratti rimossi, 4 rotatorie. **Lavoro reale da migrare.** |
| Test | 77 test nel gate. 33 file di test su 53 leggono il sorgente e verificano **stringhe nel sorgente** (`assert 'occupied.some' not in render`), non comportamento. Spiega perché i bug "chiusi" ritornano. pytest non installato nel venv di produzione. |

## 2. Difetti osservati a runtime (53.0, 1600×950)

- Logo DRIP ridotto a un glifo di ~20 px; FST assente dalla shell tecnica.
- Primario blu elettrico (`--blue` definito 6 volte: #2f5bff / #315cff / #335cff), non l'azzurro DRIP #83B4D1; pannello destro avorio su shell nera: due sistemi visivi nella stessa schermata.
- In ANALYZE due pannelli inferiori **sovrapposti** (Network assignment + Network traffic) con doppia scrollbar nativa.
- Tab toolbar "TRAFFICO" renderizzato come pillola bianca vuota.
- Controlli nativi del browser (`<select>`, `<input type=date>`) nel pannello traffico.
- Rotatoria utente `roundabout:ef0e3e8fbc`: overlay di progetto arancione che sborda dalle carreggiate, tronchi stradali che terminano in punta, segnaletica orizzontale tagliata, 4 semafori veicolari attorno a una rotatoria a precedenza.
- "MEDIA —" nel pannello traffico: valore vuoto mostrato come metrica.

## 3. Cause radice dei bug ricorrenti

1. **Doppio renderer** (MapLibre in `app.js` + Cesium in `earth3d.html`): ogni nuovo tipo di asset va implementato due volte → "Twin missing assets", "Twin signs overlap".
2. **Stato globale mutabile senza proprietario**: `state.*` scritto da 355 funzioni; nessun comando/undo centralizzato → selezione, delete, duplicate incoerenti.
3. **Geometria di visualizzazione calcolata in tre posti** (`civil.py`, `road_canvas.py`, frontend) → cunei, marking casuali, frecce che spariscono a seconda del percorso di codice.
4. **CSS a strati versione-per-versione** risolto con `!important` → clipping, pannelli sovrapposti, skin incoerenti.
5. **Test sul testo del sorgente** invece che sul comportamento → regressioni non rilevate.
6. **Catalogo segnali** con un solo SVG reale (`dare_precedenza.svg`); il resto è disegnato al volo → incoerenza grafica.

## 4. Classificazione moduli

| Modulo | Decisione | Motivo |
|---|---|---|
| `models.py` (Pydantic) | **MIGRATE** | Buona base (Provenance, Accuracy, RoadEdge con lane_profile/section). Va spezzato per dominio e versionato (`schema_version`). |
| `importers/osm_overpass.py` | **KEEP → REFACTOR** | Import Overpass a tile, cache, parsing sezioni/corsie da tag OSM: corretto e prezioso. Separare fetch / parse / normalize. |
| `data/city.json` + preset gz | **KEEP** | Dataset reale Frattamaggiore. Diventa la baseline del template "Frattamaggiore". |
| `routing.py` | **KEEP → REFACTOR** | networkx, politiche temporali, mezzi pesanti, turn rules. Va ricollegato al nuovo grafo corsie. |
| `junction_intelligence.py` | **KEEP → REFACTOR** | Modello lane-group, Bézier lane-to-lane, conflitti crossing/merge/diverge, validazione verdi incompatibili. È il pezzo più solido: diventa `services/junction`. |
| `topology.py` (rotatorie, incroci, svincoli, split, move) | **REBUILD** | 972 righe con righe da 500 caratteri; rotatoria = 192 nodi ring + trimming manuale. Rifare con separazione netta grafo di routing / geometria fisica. Si recuperano gli algoritmi di split e move con falloff. |
| `civil.py` + `road_canvas.py` | **REBUILD** | Generazione corridoi/sezioni/marking duplicata e con eccezioni ad hoc (`_clip_auto_markings_around_roundabouts`). Unico motore "physical model" nuovo. |
| `traffic.py`, `providers.py` | **REFACTOR** | Catena HERE → Google → stima DRIP con provenienza esplicita: logica giusta. Isolare provider, chiavi solo da Settings. |
| `flow_engine.py`, `simulation.py` | **REFACTOR** | Mesoscopico con RNG seminato: ok come base DRIP Flow. Va reso deterministico per test e legato ai piani semaforici del nuovo modello. |
| `transit.py` | **KEEP → REFACTOR** | Import GTFS/GTFS-RT funzionante, minimale. |
| `environment.py` | **REFACTOR** | IDW su dati meteo/aria: dichiarare sempre "interpolato". |
| `exports.py` | **REFACTOR** | SVG/PNG/PDF/DXF/SHP/SUMO: recuperabile, va alimentato dal nuovo modello. |
| `signage.py` + `sync_real_signs.py` | **REBUILD** | Serve una libreria SVG reale e completa dei segnali italiani (Codice della Strada, figure II.x) come asset versionati. |
| `fst.py` | **MIGRATE** | 21 voci di catalogo FST con `geometry_status` onesto. Diventa seed del modulo Civic, non dati fittizi. |
| `revisions.py`, `persistence.py`, `jobs.py` | **MIGRATE** | Scrittura atomica e job di import riutilizzabili dentro il nuovo Project Service. |
| `main.py` | **DELETE** (sostituito) | Router per servizio. |
| `static/app.js`, `workstation.js`, `v53.js` | **DELETE** | Riscrittura modulare. Si estraggono solo costanti utili (preset strada, tipi corsia, catalogo asset). |
| `workstation.css`, `canvas-engine.css`, `v53.css` | **DELETE** | Un solo design system a token. |
| `earth3d.html` | **DELETE** | Twin diventa una vista dello stesso modello nell'app. |
| `vendor/maplibre-gl*` | **REPLACE** | Dipendenza npm versionata. |
| test storici esclusi dal gate + test a stringhe | **DELETE** | Sostituiti da test di comportamento. Si conservano i test numerici su routing/OSM/topologia. |
| `API-SMOKE-*`, `BUTTON-AUDIT-*`, `UI-CONTRACT-*`, `REBUILD-*`, `QA-*` (≈ 70 file) | **DELETE** | Rumore di release. Storia → `docs/history` nell'archivio, non nel prodotto. |
| `launcher.py` (migrazione dati, backup) | **MIGRATE** | La logica di backup prima dell'aggiornamento e la cartella dati persistente vanno mantenute. |

## 5. Asset di brand disponibili

- DRIP: `drip-logo-lockup.png`, `drip-logo-symbol.png`, `drip-logo-wordmark.png` (static 53.0); `logo-drip-mark.png`, `logo-drip-text.png` (`drip-studio-web/assets/img/brand`). **Solo PNG, nessun SVG ufficiale trovato.**
- FST: `fst-logo.png` (`drip-studio-web/assets/img/brand`). **Nessun SVG ufficiale trovato.**
- Font: Ginto (400/400i/500/700) e Ginto Nord (500/700/900) in `drip-studio-web/assets/fonts` — **licenza trial**, serve licenza prima di distribuire. Playfair Display e Manrope: open (OFL).
