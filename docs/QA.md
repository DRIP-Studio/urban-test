# QA — DRIP Urban 1.0

## Verifica dell’8 ottobre 2026

| Suite | Esito sul codice aggiornato |
|---|---|
| `npm run typecheck` | riuscito |
| `npm test` | core 85/85, web 84/84 |
| `npm run build` | riuscito |
| `python -m pytest services/api` | 57/57 |
| `npx playwright test` | 17/17, comprese baseline visive esistenti non aggiornate |
| `git diff --check` | nessun errore di whitespace |

Regressioni nuove: Inspector rotatoria → corsie/raggio/worker → undo/redo → autosave/ricarica; master snap/F9 persistito; intersezioni esatte con snap OFF; commit suggerito rifiutato senza falso successo; rimozione controllo semaforico, rete Flow aggiornata e timer fermato al cambio progetto; stati licenza revocata/offline, ring avatar e launcher; ricerca oggetti; strumenti Elios con validazione core reale.

Ispezionato lo screenshot reale `.shots/roundabout-controls.png` e la baseline dell’Hub; la suite verifica anche Twin, parità 2D/3D, viewport 1024 e altri flussi esistenti. Gli artefatti di verifica sono ignorati da Git. Nessuna baseline rigenerata per far passare i test.

Avvisi già presenti: import dinamico inefficace di `sidewalks.ts` in build; deprecazioni FastAPI `on_event` e compatibilità httpx/Starlette nei test API. Credenziali provider e servizi centrali non sono stati esercitati contro server reali.

Perimetro residuo della richiesta: [AUDIT-2026-10-08](AUDIT-2026-10-08.md). Le suite verdi coprono i test disponibili e le regressioni aggiunte, non certificano tutte le nuove capacità ancora da implementare.

## Come si esegue

| Suite | Comando | Cosa copre |
|---|---|---|
| Core (Vitest) | `npm test -w @drip-urban/core` | storia scenari, geometria, modello fisico, rotatorie, routing, Junction Lab, traffico, simulazione, sicurezza, rete — sulla baseline reale di Frattamaggiore |
| Web (Vitest) | `npm test -w @drip-urban/web` | registri livelli/strumenti/comandi, basemap senza chiavi, catalogo materiali |
| API (pytest) | `cd services/api && ../../.venv/Scripts/python -m pytest` | progetti, scenari, snapshot, pacchetti e path traversal, id non validi, pubblicazione civica e ruoli, chiavi provider, migrazione |
| End-to-end (Playwright) | `npx playwright test` | flusso completo e viste; server e dati isolati in `e2e/.data/<run>`, porte 8790/5190 |

Aggiornare le baseline visive solo dopo un cambiamento intenzionale: `npx playwright test --update-snapshots`, poi controllare le immagini in `e2e/__screenshots__`.

## Esito al 2026-10-02 (commit di consegna)

| Suite | Esito |
|---|---|
| Core | 23/23 |
| Web | 8/8 |
| API | 9/9 |
| End-to-end | 9/9, ripetuto 3 volte consecutive senza errori |
| Build di produzione | riuscita; verificata servita da FastAPI (mappa, Twin, parità 56/56, nessuna richiesta fallita) |
| Launcher Windows | verificato: prima installazione dipendenze, avvio, caso "già in esecuzione" |

## Test end-to-end

| Test | Verifica |
|---|---|
| design flow persists and exports | strada (Invio, undo, redo) → rotatoria → piano semaforico automatico → simulazione con veicoli → salvataggio → ricarica (3 operazioni) → export GeoJSON (> 1000 elementi, elementi di progetto) |
| saving conflicts never lose work | un altro client salva prima: la modifica locale viene ribasata e salvata |
| hub, workspace modes, present, narrow window | nessun errore di pagina o richiesta fallita; baseline visive; Junction Lab senza colonne tagliate; nessun overflow a 1024 px |
| twin 3D | parità 2D/3D |
| signs… (RB-01/02/07) | cartello fermo sulla coordinata a 4 zoom, nessun marker DOM, due pannelli sullo stesso palo |
| traffic estimate and safety heatmap (RB-09/10) | senza chiavi: traffico stimato popolato e dichiarato; heatmap sicurezza con punti e dicitura "surrogato" |

## Verifiche manuali (Playwright, schermate in `.shots/`, non versionate)

Hub, migrazione 53.x, Junction Lab, Signal Studio, rotatoria da interfaccia, disegno strada, editor di sezione (clic sul bordo), rebase su conflitto, stima e simulazione traffico, Twin, Presenta (inquadra l'area modificata), pagina pubblica civica, export PNG/PDF/CSV/GeoJSON, sicurezza.

## Limiti dichiarati

Vedi CURRENT-ISSUES: loghi tracciati da PNG (P1-01), Ginto non incluso (P1-02), rotatoria migrata da ridisegnare (P1-06), SUMO assente (P1-07), baseline solo a due risoluzioni (P2-02).

## Scalabilità Flow — seconda richiesta 2026-10-08

92 test core, 84 web, 57 API passati. Build e typecheck passati. Playwright: 17/18 nella suite completa, poi 3/3 nel rerun simulation-scale + workflow dopo aggiornamento del locator per la nuova scelta di ambito. I test di stress distinguono agenti totali e buffer grafico. Cinque fixture core avanzano un passo reale fino a 50.000 agenti; non sono run lunghi calibrati. Browser registra FPS rAF e heap stimato, non GPU FPS/memoria totale. Handoff: `docs/HANDOFF-SIMULATION-2026-10-08.md`.


## Verifica master in corso — 2026-10-09

Core 138/138 + due nuovi test routing con stato di ingresso e proibizioni laneConnections; frontend 93/93; API 78/78 + test provider cache/HTTP meteo. Build/typecheck passati. Login protetto 1/1 con DRIP_E2E_AUTH=protected. Asset manager/navigatore/viste 7/7, GIS/AI/scenari/sottopasso/Twin 1/1. Suite completa da 40 test in corso; non anticipare risultato. Login è escluso dalla sessione open e si esegue separatamente nell'ambiente protetto.

Stress municipalità: evidenze aggiornate in performance/SIMULATION-2026-10-09.json. Entrambi i modi fino a 50k, run da 120 s e transizioni; massimo 4096 rendered, 50k simulated. Software Twin min 3,74–4,78 FPS: stabile nel perimetro provato, fluidità insufficiente per certificare hardware software. Nessun test di ore o memoria GPU. Crash legacy freeze riprodotto; crash browser originario non riprodotto nel perimetro documentato.

Screenshot Asset manager largo e geometria Dissuasore ispezionati; navigatore TPL con origine/destinazione/percorso reale e controlli ispezionato, lista istruzioni scorrevole. Shader video e grading già verificati sul rendering reale. Ulteriore QA produzione/export e comportamento temporale TPL prima del report finale.


### QA corrente — 9 ottobre, recupero e interoperabilità
146 core /93 web /85 API passati. E2E export produzione senza __drip, compositor offline compilato e PDF A4; PDF renderizzato con Poppler e corretto dopo difetto visivo. Profilo extrema, retry Twin con renderError/context loss, upload LAZ reale (ground filter), GTFS-RT protobuf HTTP stale/no timestamp/error verificati. Screenshot .shots/production-pdf-qa.png, profile-extrema.png, renderer-recovery.png, laz-profile.png e gtfs-stale.png; alcuni in attesa dell'ispezione conclusiva della suite. Unit test native history split, timed transit e two-arm lane connections. Build passata dopo fix fixture types; warning static/dynamic sidewalks resta. Suite browser generale corrente 45 casi, risultato da registrare alla conclusione.


### QA e LOD municipale successivi — 2026-10-09

Suite browser generale completata: 41 passati / 4 esclusi intenzionalmente (login protetto, legacy repro e due stress lunghi hanno comandi dedicati). Nessun fallimento. Regressione unitaria ripetuta dopo LOD: 146 core / 95 frontend, tutti passati.

Twin: edifici raggruppati per celle metriche 200 m, dettaglio balconi vicino, facciate procedurali semplificate a distanza, culling oltre 10 km. IDs, impronte e quote native preservati; due test geometria/tiling. Arredi lontani nativi in batch, importati in ingombro dichiarato; modelli completi vicini con budget grafico distinto da popolazione. Segnali con texture completa entro 1200 m. Browser edifici/segnaletica/carico urbano: 3/3 passati; screenshot reale urbano ispezionato. Non certifica tutte le GPU.

Benchmark dichiarato: 4053 edifici, 2922 strade, 100 linee TPL e 1000 arredi nativi, 1000 agenti fisici su SwiftShader. Prima misura rAF 26,6 FPS, p95 frame 166,7 ms, p95 input→due rAF 633,9 ms: il target UI 200 ms NON raggiunto. Heap performance.memory non raccolto non prova una perdita; ulteriore misura CDP post-GC e ottimizzazione in corso. Stress 50k ripetuto per 300 s a modo: microscopico passato, ibrido in corso; non anticiparne l'esito.


### Risultati dopo completamento LOD e routing direzionale

Stress SwiftShader 300 s per modo concluso: microscopico 303,93 s wall /294 s simulati; ibrido 303,74/290 s. 1k/5k/10k/25k/50k, quattro transizioni per modo, nessun errore/crash, bilancio 50.000. Heap post-GC finale 171,4/170,3 MiB main e 24,93/24,97 MiB worker; worker inferiore al campione iniziale. Massimo 4096 campioni grafici. Minimo rAF 4,39/5,20 FPS; massimo tick campionato 651,9/348 ms: target temporale p95 non certificato in questa prova (macchina condivisa anche con regressioni durante parte del run). Dati in SIMULATION-2026-10-09.json; precedente 120 s conservato separatamente.

Renderer hardware disponibile e ora verificato: ANGLE NVIDIA RTX 5070 Direct3D11. Benchmark nativo dichiarato 4053 edifici, 2922 strade, 100 linee TPL, 1000 arredi e 1000 agenti: camera in movimento 51,9 FPS, UI rAF circa60 FPS, controlli caldi p95 91,9 ms (24 campioni), cold p95 264,5 ms (12 campioni), heap raccolto circa187 MB dopo warmup e cambi qualita, inferiore al confronto caldo circa197 MB. Scena statica request-render circa10 FPS e un aggiornamento solver 10 Hz: non confondere frame richiesti con capacita di rendering. Screenshot urbano hardware ispezionato nella QA successiva. SwiftShader continua a non raggiungere i target interattivi di densita urbana: registrato, nessuna falsa certificazione. Benchmark freddo/caldo e memorie in URBAN-2026-10-09-hardware.json /software.json.

Native import LOD vicino/lontano/vicino, trascinamento/undo/follow, materiali custom, Civil/DTM e segnaletica ripetuti dopo renderer: passati. Nessun altro modello autoriale creato. Corretto batch vuoto in celle con sole markings. Regressioni finali unitarie 147 core /96 frontend e build/typecheck passati. API completa 85/85 passata. Browser generale 47 casi in corso; stress hardware dedicato da eseguire dopo, non anticiparne esiti.


## Continuazione: export cinematografico e camera, 2026-10-09

HTML e WebM conservano un solo Blob pronto fino al successivo export o alla chiusura della vista, con link reale e anchor DOM per download automatico. Errori encoder persistenti visibili. Scene aggiunte solo dopo lettura camera effettiva. Primo timestamp RAF cinematografico può precedere performance.now di avvio: progresso ora limitato a0..1, evitando indice negativo. Test completo presentazione passato: download, link ancora valido dopo1,2 s, WebM decodificato, scena/immagini/grafici reali, HTML offline, PNG/PDF, zero pageerror. Fotogramma decodificato ispezionato. Typecheck e build passati; regressione completa successiva in esecuzione.


### Regressione finale corrente

Suite completa47 casi:43 passati/4 skip opt-in,8,4 min, nessun fallimento. Include export produzione con camera reale e Blob ancora valido, WebM decodificato, confronto Present caricato, GIS/AI/scenari/semafori, sottopassi, TPL, opere, materiali, Civil e persistenza. Login protetto eseguito separatamente:1 passato. Verifica sottopasso hardware aggiuntiva:1 passato; screenshot attende globe/primitive pronte, inquadratura ravvicinata piano/rampa/pareti ispezionata. Le prime prove fallite di download e camera sono corrette, non cancellate dalla cronologia; questa è la regressione successiva.


### Stato finale interno — 2026-10-09

Stress hardware RTX5070/D3D11 completato senza suite concorrenti:2 passati,11 min;1k/5k/10k/25k/50k entrambi i modi,300 s a50k,4 transizioni per modo, bilancio esatto, zero pageerror/crash/pannelli errore. Tick max51,1/53,9 ms; p95 dei59 campioni45,8/48 ms; worker finale24,98/25,85 MiB. UI rAF circa60 FPS, distinto dagli FPS scena statici19–23 osservati negli screenshot. Screenshot di entrambi i run ispezionati. Evidenza performance/SIMULATION-2026-10-09-hardware.json.

Stato corrente autorevole: docs/RELEASE-READINESS-2026-10-09.md (per i file già sotto docs: RELEASE-READINESS-2026-10-09.md).43 browser ordinari passati,4 skip coperti da login1/storico1/stress2;147 core/96 frontend/85 API, typecheck/build passati. Nessuna certificazione ore/VRAM/tutte le GPU. Software4,98 FPS e848,5 ms p95 input non raggiunge i budget. Integrazione centrale/provider linguistico live restano bloccati da servizi, contratti e credenziali esterni; sito pubblico accessibile. I vecchi stati delle sezioni precedenti sono cronologia, non elenco dei moduli ancora da implementare.
