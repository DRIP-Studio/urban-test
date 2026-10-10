# DRIP Urban — verifica dell’upgrade master, 2026-10-09

Verifica finale del lavoro interno sul repository corrente. Tutte le aree principali sono implementate con il perimetro di prova indicato sotto; le integrazioni live che richiedono servizi/credenziali esterni restano bloccate. Readiness: release candidate locale verificata nelle condizioni documentate, non rilascio pubblico della piattaforma centrale. Cronologia nel handoff; questa matrice è lo stato corrente.

| Sottosistema | Stato implementazione | Perimetro e limiti |
|---|---|---|
| Simulation Engine 2.0 | IMPLEMENTED + TESTED | Microscopico/ibrido, ambito comunale reale, 1k–50k, conservazione, worker/backpressure, rendering LOD separato. Stress software e hardware5 min per modo completati. |
| Clock, temporale, ZTL, Scenario Lab | IMPLEMENTED + TESTED | IANA/DST, calendario, opere temporali, replay cancellabile, alternative confrontate con medesimo seed/domanda. |
| Twin, editing, follow, camere | IMPLEMENTED + TESTED | Editing nativo/undo, quote/ENU, sette camere follow, percorsi; cammino non certifica collisioni fisiche. |
| Asset, edifici, materiali, texture | IMPLEMENTED + TESTED | Geometrie native, PBR/import reali, gestione catalogo, edifici procedurali e LOD. Fotogrammetria proprietaria richiede dataset. |
| Segnaletica, zebra/hatching, VMS | IMPLEMENTED + TESTED | Editor e geometrie Map/Twin condivisi, programmi/clock/dati solver; nessun dato parcheggi inventato. |
| TPL e ottimizzazione semaforica | IMPLEMENTED + TESTED | Partenze/calendari/soste/capacità/interscambi, routing temporale direzionale, detector e priorità, confronto solver prima applicazione. Calibrazione osservata e interlocking ferroviario industriale non certificati. |
| Civil, modellazione, utilities, clash | IMPLEMENTED + PARTIALLY TESTED | Assi/assemblaggi/profili/grading/solidi/reti3D; LAS/LAZ→DTM reali, LandXML/scambi supportati. Non certifica equivalenza universale Autodesk né raw point-cloud viewer. |
| Sottopassi stradali e pedonali | IMPLEMENTED + TESTED | Profili/rampa/quote/libera altezza e topologia reali, tool AI, validazione/undo e DTM/manuale espliciti. Rilievi e verifica strutturale esecutiva esterni. |
| Lavori, Gantt, scenari futuri | IMPLEMENTED + TESTED | Date/dependenze/costi/fasi native e proiezione temporale Map/Twin. |
| Presentazione e video | IMPLEMENTED + TESTED | Percorsi, scene live/confronto, annotazioni/grafici/immagini, WebM realmente decodificato, HTML offline/PNG/PDF; HTML non include solver/Twin offline. |
| DRIP Platform | IMPLEMENTED + PARTIALLY TESTED | Login protetto, JWT/JWKS, ruoli/chiavi/policy/updater/launcher reali locali. Integrazione centrale live BLOCKED: endpoint/configurazione/credenziali esterni sotto. |
| UI, ricerca, comandi, precisione | IMPLEMENTED + TESTED | Palette/shortcuts/menu/inspector/snap, recupero errori locale senza perdere progetto. |
| Elios, AI GIS e semafori | IMPLEMENTED + PARTIALLY TESTED | Tool analisi accessibilità/rete/clash/profili/semafori e scenari valutati dal solver, cancellazione/scope; conversazione Gemini live BLOCKED: chiave non fornita. |
| QA e readiness | IMPLEMENTED + TESTED | Unit/API/browser/visual/build e stress software/hardware passati. Nessuna certificazione per ore o tutte le GPU/browser. |

## Architettura e integrità

Un solo modello autoriale: baseline, replay e operazioni ScenarioHistory. Le nuove modifiche passano per commit/undo/autosave; la rete proiettata nel tempo non sostituisce la sorgente. Simulazione e Scenario Lab in worker separati. Snapshot trasferibili con conferma e cache limitate. Tile grafici200m edifici/400m strade, batch opachi/trasparenti, riuso dei modelli invariati, dettaglio vicino e fallback dichiarato lontano. Agent count fisico indipendente dal budget grafico.

## Blocchi esterni verificati

- Gemini: settings/providers.json non presente nella configurazione locale; nessuna chiave di provider fornita. Tool deterministici e solver sono testati, non viene simulata una risposta linguistica live.
- DRIP ID/servizi centrali: discovery configurata id.studiodrip.it e account.studiodrip.it in timeout; api.studiodrip.it non risolta da questo ambiente. Client/credenziali/contratti centrali di entitlement/enrollment non forniti. Il sito pubblico studiodrip.it è invece raggiungibile e la verifica dei token di stile è stata completata.
- Dataset fotogrammetrici/asset proprietari e rilievi/calibrazione della domanda non presenti. Import e sistemi procedurali funzionano; i risultati sintetici non sono dati osservati.

## Migrazioni e compatibilità

Pacchetto .dripu v2 con manifest SHA e asset/documenti portabili, import validato atomico in nuovo progetto; compatibilità dei pacchetti precedenti e migrazione schema53 verificate. LAS/LAZ richiede laspy[lazrs]>=2.7,<3, dichiarato nelle dipendenze. Nessuna migrazione irreversibile o aggiornamento installato sui dati dell’utente. Updater provato su directory temporanee con rollback dei file; ambiente pip non transazionale, compatibilità rollback delle dipendenze resta limite operativo.

## Prestazioni, prove e readiness

Dati correnti in performance/BUDGETS-2026-10-09.md. NVIDIA RTX5070 realmente identificata:51,89 FPS durante movimento camera nella fixture urbana, p95 input a caldo91,9 ms e a freddo264,5 ms. Software non soddisfa30 FPS; tick50k software p95 campionato oltre125 ms. Non si nascondono questi limiti diminuendo gli agenti.

Prove passate:147 core e96 frontend ripetuti dopo le ultime correzioni;85 API; typecheck/build. Suite browser completa:43 passati/4 skip opt-in,8,4 min; login protetto separato1 passato, storico separato1 passato, sottopasso hardware1 passato. Presentazione con WebM decodificato/HTML offline/PNG/PDF e zero pageerror. Stress hardware esteso2 passati,11 min complessivi: tutti i cinque carichi in ciascun modo e300 s a50k. Il renderer NVIDIA è verificato dal contesto WebGL, non dedotto dal sistema.

Manifest cumulativo dei file cambiati: performance/CHANGED-FILES-2026-10-09.json. Sottosistemi principali: packages/core (simulazione, routing, tempo, Civil/utility/AI), apps/web (Twin/Map/editor/presentazione/platform), API/servizi backend, e2e e documentazione. Le modifiche sono nel repository corrente, non committate automaticamente.


## Risultati dello stress hardware

Baseline Frattamaggiore, Chromium1440×900, RTX5070 ANGLE D3D11. Agenti realmente instradati nel worker; warm start sintetico distribuito e domanda aggiuntiva zero per verificare conservazione. Sono condizioni di stress, non domanda comunale calibrata. Nessuna suite o build concorrente.

| Misura a50k | Microscopico | Ibrido |
|---|---:|---:|
| Tempo reale / simulato |303,53 /302,75 s|303,16 /302,25 s|
| Bilancio attivi+arrivati |50000|50000|
| Campioni grafici massimo |4096|4096|
| Tick massimo campionato |51,1 ms|53,9 ms|
| p95 dei59 campioni tick |45,8 ms|48,0 ms|
| FPS rAF UI min–max |59,88–60,98|59,90–61,32|
| Heap pagina post-GC iniziale→finale |121,56→176,92 MiB|120,93→177,43 MiB|
| Heap worker post-GC iniziale→finale |16,62→24,98 MiB|16,63→25,85 MiB|
| Transizioni Map/Twin |4|4|
| Errori / crash / pannelli errore |0|0|

Entrambi passano anche1k/5k/10k/25k. L’aumento dell’heap comprende cache del solver e caricamento lazy del Twin. La prova dimostra crescita contenuta nel run e cache limitate; non prova matematicamente assenza di crescita per durata indefinita. Hardware urbano separato: heap dopo riscaldamento196,65→186,75 MB. Stress software precedente300 s per modo: worker finale circa25 MiB e pagina circa171 MiB, tick e rendering più lenti. Memoria GPU non misurata.

Gli FPS UI non sono FPS scena: negli screenshot del run50k la scena statica aggiornata su richiesta mostra circa19–23 FPS. Il benchmark urbano con camera in movimento misura invece51,89 FPS scena. Non è certificato Ultra con50k mesh individuali; l’aggregazione LOD è esposta, senza diminuire gli agenti fisici. Su SwiftShader la fixture urbana finale misura4,98 FPS camera e p95 input848,5 ms: obiettivi grafici/interazione non raggiunti su questo renderer.

Il percorso storico di geometria completa50k si blocca oltre30 s nel browser limitato512MB, nessun evento page.crash. Il nuovo buffer2000 campioni/703827 byte richiede3 ms nella ripetizione finale. L’esatta sessione del crash originale non è disponibile: non riproducibile sul codice attuale nelle condizioni comunali testate, con evidenze delimitate. Nessuna dichiarazione di correzione universale su qualsiasi macchina.

## Visual QA ed export

Applicazione realmente avviata per tutti i test UI. Ispezionati Map/Twin, geometrie/materiali/segnaletica, profili LAZ, grading e sottopasso ravvicinato, Present e HTML offline, fotogramma WebM decodificato e PDF rasterizzato. Screenshot dei due run hardware50k dopo entrambi gli ingressi Twin mostrano rete, edifici, agenti LOD e diagnostica. Snapshot Present attende entrambe le mappe caricate; sottopasso attende globe/primitive pronte. Nessuna baseline aggiornata per nascondere lo skeleton.

Corretti download asincroni HTML/WebM: anchor nel DOM, un Blob pronto conservato con link reale fino a successivo export/chiusura, cleanup e errori encoder visibili. Camera delle scene letta realmente dalla mappa; primo RAF cinematico limitato0..1 per evitare indice negativo. WebM scaricato e decodificato, dimensioni verificate, immagine/legenda/grafici e didascalia nel documento effettivo. PDF e PNG dal documento autonomo verificati; export HTML non incorpora runtime solver/3D.

## Comandi e risultati di accettazione

- `npm test`:147 core +96 frontend, passati.
- `.venv/Scripts/python.exe -m pytest services/api/tests`:85 API passati nella verifica cumulativa corrente; avvisi esistenti FastAPI on_event/httpx.
- `npm run typecheck` e `npm run build`:passati. Build1925 moduli; principale2459,34KB/733,35KB gzip; Twin4214,21KB/1141,12KB gzip. Avviso import misto statico/dinamico sidewalks resta.
- `npx playwright test`:43 passati,4 skip opt-in,8,4 min.
- `DRIP_E2E_AUTH=protected`, login-2:1 passato.
- `DRIP_LEGACY_REPRO=1`, simulation-legacy:1 passato.
- `DRIP_LONG_STRESS=1 DRIP_STRESS_MS=300000`, simulation-long software:2 passati,11,2 min.
- `DRIP_E2E_GPU=hardware DRIP_LONG_STRESS=1 DRIP_STRESS_MS=300000`, simulation-long:2 passati,11 min.
- Sottopasso hardware mirato:1 passato; benchmark urbano hardware:1 passato.

Le variabili vanno impostate con `$env:NOME='valore'` in PowerShell. Test su progetto/dati isolati, nessuna cancellazione dei progetti utente. I4 skip della suite ordinaria sono stati coperti con i comandi separati sopra.

## Limiti e decisione di rilascio

Le funzionalità interne sono reviewable e testate; nessuna integrazione centrale viene finta o abilitata con admin/licenza hardcoded. Rilascio pubblico integrato resta BLOCCATO dai contratti/credenziali DRIP ID, licensing, update feed/enrollment e provider linguistico, più dataset proprietari quando richiesti. La licenza sconosciuta resta sconosciuta e policy configurata senza risposta valida fallisce chiusa.

Limiti dichiarati: dati di rilievo/calibrazione esterni, nessuna verifica strutturale esecutiva/rail interlocking industriale, scambi CAD limitati ai formati/geometrie supportati (curve LandXML esportate tramite campionamento), LAZ→DTM senza viewer raw completo, cammino senza certificazione collisioni, nessuna prova ore/multiGPU/multiBrowser o misura VRAM. Import/font proprietari richiedono disponibilità e diritti. Nessuna migrazione irreversibile, deploy, installazione updater sull’ambiente dell’utente o commit automatico eseguiti.
