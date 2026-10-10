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

### Invalidation e simulazione attiva

Quando cambia la rete effettiva, il worker invalida la stima traffico di scenario. Un run DRIP Flow attivo viene ricostruito sulla rete nuova con domanda, seed, focus, velocità di playback e pausa conservati. Tempo e metriche ripartono da zero; `simRestarted` porta il frame iniziale e una notifica esplicita. `init` ferma timer e run del progetto precedente.

`junction.set` verso controlli diversi da `signal` elimina nello stesso commit tutti i piani del nodo; `signal.removePlan` porta a non regolato un incrocio rimasto senza piano. Nascondere una lanterna (`signal.setHeads`) mantiene invece il controllo: sono azioni distinte.

Le modifiche suggerite passano da `applySuggestion` a un batch validato; una scheda viene rimossa e il successo viene comunicato solo dopo un commit riuscito. Nessun percorso modifica direttamente il modello.

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

### Flow: separazione scala fisica / scala grafica

`frameData(SimView)` legge gli agenti senza mutarli e conserva le metriche complete; budget e bounds limitano solo il buffer di presentazione. Il worker invia un solo snapshot ordinario in transito, confermato da `simAck` nel main thread; i tick continuano durante backpressure. La simulazione vive in simulation.worker, separata dal worker di geometria/analisi; il worker Scenario Lab valuta alternative isolate. Microscopic e hybrid municipal condividono rete, clock, controlli e metriche; il routing riusa una banca deterministica limitata di percorsi, senza limitare gli agenti fisici. Il passo fisico rimane 0,25 s e un accumulatore conserva la velocità richiesta. Il run vive nel proxy, non nel pannello Traffico, e si interrompe alla chiusura/cambio progetto.


### Modello nativo e upgrade 2026-10-09

Clock, transit, bikeShare, utilities, works, presentation, materials, buildingStyles, cityModels e grading sono nella rete derivata dello stesso baseline + operations; non sono copie parallele editabili. Ogni modifica passa da operazioni registrate e ScenarioHistory. Proiezione cantieri per data conserva rete autoriale e undo. Il clock IANA governa Map, Twin, solver, restrizioni e lab.

Civil conserva asse analitico tangent/arc/clothoid, vertical parabole, crossfall, assembly e quote. Asset.solid ospita estrusione e fori; road.structure.underpass conserva profilo e traffico precedenti per ripristino. Quotazioni senza rilievo dichiarate manuali; quantità e clash indicano dati mancanti. Mesh da geometrie native, materiali condivisi Map/Twin.

TPL operational è nel solver con schedule, dwell, capacità e domanda passeggeri dichiarata. Navigatore TPL usa linee/fermate native, orari e rete pedonale; nessun realtime inventato. Routing motorizzato mantiene stato edge per rispettare svolte laneConnections e alternative di arrivo. Asset manager legge cataloghi e utilizzi nativi; tag/preferiti personali non duplicano il modello del progetto.

AI: gli strumenti GIS/solver/civil/TPL applicano operazioni validate; scope progetto/scenario/revisione e AbortController proteggono richieste asincrone. Il Twin espone un lettore camera registrato senza import Cesium nel bundle iniziale. Valutazioni AI salvano scenari nativi con impostazioni e metriche prima dell'applicazione.

Presentazione.set salva scene/camera/annotazioni/geografiche/grafici/loghi. Canvas compositor condiviso tra video acquisito su Cesium postRender ed export HTML offline; pacchetto .dripu necessario per la scena/solver nativi. .dripu v2 manifesta SHA e importa atomico in progetto nuovo.

Platform: scope/expiry server per API keys, JWT issuer/audience/JWKS, policy deployment fidata con cache fail-closed. Contratto remoto DRIP centrale non inventato. Updater Windows staging SHA/backup/rollback verificato su directory isolate. Provider cache limitata a 128 risposte; meteo HTTP failure non è dato valido. GTFS-RT espone timestamp feed, retrieval time, age/freshness e valida coordinate; la validazione locale non certifica endpoint operatori non forniti.

Rete autoriale mantenuta nel worker separata dalla proiezione alla data corrente: itinerari TPL dopo mezzanotte riproiettano le fasi dal modello originale. Cache routing temporale locale/limitata e alternative su servizi effettivi. Boundary delle viste non sostituisce store/history: retry smonta e ricrea solo il renderer. LAS/LAZ import DTM usa decoder lazrs reale e memorie numeriche compatte; nessuna supporto waveform implicito.


Renderer municipale: edifici in celle ENU 200 m, superfici/segnaletica fisica in celle 400 m, oggetti conservati per riferimento nel payload condiviso. Materiali opachi e trasparenti degli arredi in passaggi distinti. Modelli vicini invariati riutilizzati per firma geometria/trasformazione/materiali; i fuori-budget restano geometria nativa batch o ingombro dichiarato per importati. Nessun limite nuovo agli agenti fisici. Regole LOD/adattamento dipendono dal renderer effettivo, non da finti stati hardware. Routing restituisce traversals ordinati roadId/forward per validare le corse TPL nelle direzioni e svolte effettive a ciascun confine temporale.
