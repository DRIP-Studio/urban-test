# Architettura — DRIP Urban 1.0

Questo documento descrive il sistema così com'è implementato. Il piano iniziale, con la motivazione delle scelte, è in [ARCHITECTURE-PLAN](ARCHITECTURE-PLAN.md).

## Principio

**Un modello della città → uno scenario → un modello fisico → più viste.**

```
OSM / pacchetto 53.x / GeoJSON / GTFS / provider
  └─ services/api            import, normalizzazione, persistenza
       └─ CityBaseline        immutabile per progetto, con provenienza
            └─ Scenario        lista ordinata di Operation validate
                 └─ Network    rete effettiva = replay delle operazioni sulla baseline (derivata, mai salvata)
                      └─ Physical Model   superfici, cordoli, segnaletica, linee (derivato)
                           ├─ Mappa 2D (MapLibre)
                           ├─ Twin 3D (Cesium)
                           ├─ Analisi, traffico, simulazione
                           ├─ Presenta / pubblicazione civica
                           └─ Export (GeoJSON, PNG, PDF, CSV, scenario JSON, pacchetto)
```

Su disco finiscono **solo** la baseline e le operazioni. Ogni geometria visibile si ricalcola, così 2D, 3D ed export non possono divergere.

## Pacchetti

### `packages/core` (TypeScript puro, senza DOM)

| Modulo | Responsabilità |
|---|---|
| `model/types.ts` | tipi della città, dello scenario e della rete |
| `geo/` | `LocalFrame` (WGS84 ↔ metri locali, raggi di curvatura); polilinee: offset, bande, Bézier, intersezioni |
| `ops/registry.ts` | `defineOperation({ type, label, validate, apply })`; un'operazione non registrata non esiste |
| `ops/network-ops.ts` | operazioni su strade, nodi, incroci, semafori, zone, superfici, oggetti, rotatorie, `batch` |
| `ops/replay.ts` | `NetworkReplayer`: replay con checkpoint memorizzati, quindi l'undo non ricalcola da zero |
| `history/scenario-history.ts` | `ScenarioHistory`: unico scrittore dello scenario, undo/redo |
| `physical/` | sezioni, topologia, inviluppi degli incroci (intersezione dei bordi + raccordi Bézier tangenti), rotatorie (anello, cuscinetto, isola, gole tangenti, isole spartitraffico), segnaletica CdS in metri |
| `analysis/` | grafo e routing con orari ZTL, Junction Lab (gruppi di corsia, conflitti, piani compatibili), stima traffico BPR, DRIP Flow (IDM + semafori + precedenze), screening sicurezza surrogato, centralità/ponti, accessibilità 7 minuti, isocrone, audit dello scenario |

Grafo di routing e geometria visiva delle rotatorie sono **separati**: l'anello del grafo è fatto di archi a senso unico antiorario, mentre la visualizzazione è un anello con foro.

### `packages/assets`

| Contenuto | Origine |
|---|---|
| Loghi SVG | vettorializzati dai PNG ufficiali (`tools/brand/vectorize.cjs`) |
| 243 segnali italiani | sanificati via XML (`tools/signs/build_catalog.py`) |
| Catalogo arredo | ~40 elementi con dimensioni e parti 3D procedurali |
| Catalogo materiali | 34 materiali |

### `apps/web` (React 19 + Vite)

| Cartella | Responsabilità |
|---|---|
| `engine/` | Web Worker con core e analisi; protocollo a job (route, junction, traffic, safety, network, access, isochrone, audit, physicalFor, controllo simulazione) |
| `state/store.ts` | Zustand: routing hash, apertura progetto, `commit`/`undo`/`redo`, autosave con coda offline in localStorage, recupero dopo crash, rebase su conflitto 409 |
| `map/` | registro dei livelli (`LAYERS`, `SOURCES`) con un solo proprietario per sorgente GeoJSON; basemap; immagini; semafori in tempo reale |
| `tools/` | registro strumenti (scorciatoia, modalità, cursore, handler); snap su indice spaziale; disegno, posa, modifica, selezione |
| `shell/` | top bar, rail strumenti, status bar, palette comandi, menu contestuale, scorciatoie |
| `panels/` | Inspector, editor di sezione, Junction Lab, Signal Studio, Traffico, Navigatore, Analisi, Confronto, TPL, Civico, Export |
| `twin/` | Cesium: legge lo stesso Physical Model; un controllo di parità conta gli oggetti 2D e 3D |
| `present/` | prima/dopo, scene, pubblicazione civica pubblica |
| `ui/` | token CSS, componenti, icone, popover, conferme |

Ogni modifica passa da `commit(type, payload)`. Il comando viene validato dal registro core, aggiunto alla `ScenarioHistory`, rieseguito nel worker e salvato in autosave. Nessun pannello scrive la rete direttamente.

### `services/api` (FastAPI)

| Modulo | Responsabilità |
|---|---|
| `storage.py`, `projects/service.py` | cartelle di progetto, scrittura atomica, revisioni con concorrenza ottimistica (409), snapshot, `audit.jsonl`, pacchetti zip con controllo path traversal |
| `projects/migrate53.py` | adapter 53.x in sola lettura |
| `city/legacy_city.py` | fusione dei tratti in strade |
| `osm/` | import Overpass come job |
| `providers.py` | HERE, Open-Meteo/CAMS, Nominatim, tile Google; chiavi mascherate in lettura |
| `transit.py` | GTFS e GTFS-RT |
| `civic.py` | pubblicazioni, ruoli, proxy in sola lettura della API pubblica FST |
| `main.py` | rotte; serve anche `apps/web/dist` in produzione |

## Confini

- **Plugin WordPress FST**: solo lettura degli endpoint pubblici `/wp-json/fst-mobile/v1/maps/reports|projects`, con cache di 5 minuti. Nessuna scrittura e nessuna modifica al plugin.
- **Dati 53.x**: letti soltanto. La migrazione crea un progetto nuovo.
- **Chiavi dei provider**: salvate nella cartella dati dell'utente e mai restituite in chiaro. Senza chiave l'interfaccia mostra la stima DRIP etichettata "stimato", mai "live".

## Runtime

Produzione: un solo processo uvicorn su `127.0.0.1:8765` serve sia l'API sia la build statica (Cesium in `/cesium`, worker MapLibre in `/maplibre`, glifi in `/glyphs`). Avvio: `Avvia DRIP Urban.bat` → `tools/windows/launcher.py`.

Sviluppo: Vite sulla porta 5180, con proxy di `/api`, `/signs`, `/brand` e `/catalog` verso la 8765.
