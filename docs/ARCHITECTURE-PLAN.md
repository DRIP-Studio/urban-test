# DRIP Urban 1.0 — Piano architetturale (Fase 2)

Stato: **proposta, in attesa di conferma su stack e sequenza.** Versione prodotto nuova: `1.0.0` (semver pulito; la numerazione 53.x resta storia).

## 1. Principio

ONE CITY MODEL → ONE SCENARIO MODEL → ONE PHYSICAL MODEL → MULTIPLE VIEWS.

```
Fonti (OSM, GeoJSON, CSV, GTFS, provider traffico, sensori)
  └─ Import & Normalize (backend, Python)
       └─ Baseline City Graph   ← immutabile per progetto, con provenienza per attributo
            └─ Scenario = lista ordinata di Operazioni (comandi) sulla baseline
                 └─ Effective Network (grafo + corsie + controlli)       ← derivato, mai salvato
                      └─ Physical Model (superfici, cordoli, marking, asset 3D-ready) ← derivato
                           ├─ Vista 2D (MapLibre, layer WebGL)
                           ├─ Vista Twin (Cesium, stesso Physical Model)
                           ├─ Analisi (junction, safety, rete, accessibilità)
                           ├─ Simulazione (DRIP Flow / SUMO)
                           ├─ Present / Civic publish
                           └─ Export (GeoJSON, CSV, PNG, PDF, DXF, SUMO)
```

Regole non negoziabili:
- Si salva **solo** baseline + operazioni + asset di progetto. Tutto il resto è derivato e ricalcolabile (niente geometria "cotta" che diverge).
- Un solo builder del Physical Model. 2D e 3D lo leggono entrambi: un asset esiste in 3D se e solo se esiste nel modello.
- Ogni mutazione passa da un **Command** (id, autore, timestamp, do/undo, validazione). Undo/redo, audit log, autosave e collaborazione futura usano la stessa pipeline.
- Ogni valore mostrato porta una provenienza: `existing | osm | measured | derived | estimated | project | simulated | live`.

## 2. Stack (raccomandato)

| Livello | Scelta | Perché |
|---|---|---|
| Frontend | **TypeScript + React 19 + Vite** | Inspector, pannelli, Signal Studio, editor di sezione e Project Hub sono UI dense e stateful: React dà componenti testabili; TS dà tipi condivisi con il modello. |
| Stato | Store a slice (Zustand) + Command bus proprio | Separazione App / Temp / Server state come richiesto (§236–238). |
| Geometria/Physical Model | Pacchetto TS `@drip/urban-core` eseguito in **Web Worker** | Anteprime di drag a 60 fps senza round-trip; stessa funzione usata da 2D, Twin ed export. |
| Mappa | MapLibre GL (npm, versione bloccata) | Già in uso; layer GPU, niente migliaia di marker DOM (§177). |
| Twin | CesiumJS (npm, una sola versione, servito in locale) | Niente CDN doppia; legge il Physical Model. |
| Backend | **FastAPI mantenuto**, diviso in servizi | Recupera import OSM, routing networkx, junction intelligence, provider, GTFS. |
| Persistenza | File di progetto per cartella (`project.json` + `scenarios/*.json` + `assets/`) con scrittura atomica, snapshot e journal comandi; SQLite per indici/recenti | Portabile (pacchetto progetto = zip della cartella), recuperabile dopo crash. |
| Test | Vitest (core + UI), pytest (servizi), Playwright (E2E + visual regression) | Test di **comportamento**, nessun test sul testo del sorgente. |
| Distribuzione Windows | Frontend compilato in `dist/` incluso nello ZIP; launcher `.bat` + Python venv | L'utente finale non deve installare Node. |

Alternativa possibile: vanilla TypeScript a moduli senza React. Meno dipendenze, ma tutta l'UI densa (Signal Studio, cross-section drag, layer manager, command palette) andrebbe costruita a mano. Sconsigliata.

## 3. Struttura del repository

```
drip-urban/
  apps/web/                 React app (shell, viste, pannelli)
    src/app/                bootstrap, router viste, registri
    src/registries/         tools, panels, actions, layers, commands, shortcuts
    src/views/              hub, design, analyze, traffic, transit, twin, present, civic
    src/ui/                 componenti del design system
    src/map/                adapter MapLibre (layer GPU, interazioni, snap)
    src/twin/               adapter Cesium
  packages/core/            modello, comandi, geometria, physical model, validazione (TS puro, testato)
  packages/assets/          catalogo segnali IT (SVG), arredo (2D symbol + 3D), materiali
  packages/design-tokens/   token → CSS variables
  services/api/             FastAPI
    app/project/  app/city/  app/topology/  app/junction/  app/traffic/
    app/simulation/  app/transit/  app/safety/  app/environment/  app/civic/  app/export/
  tools/migrate-53/         adapter dati 53.x → 1.0
  tests/e2e/                Playwright
  docs/                     ARCHITECTURE, DESIGN-SYSTEM, DATA-MODEL, PROVIDERS, QA, MIGRATION
  CURRENT-ISSUES.md  RECURRENT-BUGS.md  CHANGELOG.md  README.md
```

## 4. Modello dati (sintesi; dettaglio in DATA-MODEL.md alla Fase 4)

- `Project { id, name, city, bbox, crs, baselineRef, scenarios[], assets, presentationScenes[], permissions, metadata, schemaVersion }`
- `Baseline { nodes, roads(edge + LaneModel + CrossSection), junctions, buildings, features, sources[] }`
- `Road { id, axis(polyline|spline), class, crossSection[elements con larghezza], lanes[Lane], direction, speed, surface, provenance{per attributo} }`
- `Lane { id, index, direction, width, modes, turns, speed, priority, restriction }`
- `Junction { id, kind, approaches[], laneConnections[from→movement→to], control(yield|stop|signal|roundabout), envelope }`
- `Roundabout { id, type, outerD, innerD, circWidth, lanes, apron, splitters[], entries/exits(radius,width,angle), control }` → genera **separatamente** grafo di routing e geometria di visualizzazione.
- `SignalController { junctionId, cycle, offset, mode, signalGroups[], laneGroups[], phases[], detectors[] }`
- `Asset { id, type(catalogo), anchor(lon,lat,elev), rotation, dims, material, attachedTo?(road|curb|pole), state(existing|project) }`
- `Operation { id, type, target, params, author, ts }` — tutte le modifiche di scenario.

## 5. Sequenza di consegna (fette verticali verificate)

Ogni milestone è usabile, testata e mostrata con screenshot; non si passa alla successiva con P0 aperti.

| # | Milestone | Copre (punti master prompt) | Criterio di accettazione |
|---|---|---|---|
| M0 | Fondamenta | 2, 3, 122–139, 182–186, 220–239 | Repo, design system a token, shell DRIP con co-branding reale, command bus + undo, registri, autosave, test harness. |
| M1 | Project Hub + modello + migrazione | 4–6, 7 (OSM), 165, 170–172, 216–217 | Apri/crea/duplica progetti; il progetto 53.0 "future" importato con conteggi verificati (127 elementi, 114 tratti, 4 rotatorie). |
| M2 | Mappa + layer + basemap | 8, 9, 140–141, 173–181 | Selettore basemap con miniature, layer manager con provenienza; 6.409 tratti renderizzati via GPU; nessun marker DOM per asset statici. |
| M3 | Road engine | 10–23, 141 | Disegna/modifica strada, sezione drag-resize, corsie, sensi, frecce stabili a ogni zoom; Physical Model unico. |
| M4 | Incroci + rotatorie | 24–37 | Incrocio X/T da approcci reali, rotatoria 4 bracci tangente senza cunei, nessun marking automatico non richiesto. |
| M5 | Semafori + sicurezza | 28–31, 40–51, 187–192 | Signal Studio con timeline, validazione verdi in conflitto, pedonale 3 luci, conflict points, black point surrogato dichiarato. |
| M6 | Traffico + simulazione + routing | 72–88 | Navigator su scenario, prima/dopo, stima/live onesto, DRIP Flow visibile con veicoli in corsia che si fermano al rosso. |
| M7 | Arredo, segnaletica, materiali | 52–71 | Catalogo segnali IT reale (SVG), composizione palo, arredo 2D+3D, array lungo percorso, materiali. |
| M8 | Twin | 142–154 | Stesso progetto, stessa geometria, stessi asset del 2D (test automatico di parità). |
| M9 | Transit + analisi | 89–106 | GTFS, linee, isocrone "città dei 7 minuti", rete, pedoni, ciclabilità, ambiente con provenienza. |
| M10 | Civic FST + Present + Export | 110–121, 155–164 | Pubblicazione di uno scenario selezionato in vista FST, before/after, export GeoJSON/PNG/PDF/CSV. |
| M11 | Performance + QA finale + pacchetto Windows | 173–176, 194–215, 250 | Suite completa, visual regression delle 8 viste, ZIP con launcher. |

Stima onesta: è un prodotto di dimensione paragonabile a più mesi di lavoro di un team. In questa sessione e nelle successive procedo milestone per milestone; a ogni consegna dichiaro cosa è **verificato**, cosa è solo **implementato** e cosa **manca**.

## 6. Dipendenze esterne da dichiarare

- Chiavi HERE / Google / Cesium ion: solo da Settings, mai nel codice. Senza chiave → stima DRIP etichettata "stimato", mai "live".
- Font Ginto: licenza trial → serve licenza desktop/web prima della distribuzione. Fallback Manrope (OFL).
- Loghi DRIP e FST: disponibili solo in PNG. Per header nitido a ogni densità servono gli SVG ufficiali.
- Dati incidentali ufficiali (ISTAT/Polizia Locale): non presenti → la sicurezza resta "screening surrogato" finché non vengono importati.
- SUMO: integrazione solo se installato localmente.
