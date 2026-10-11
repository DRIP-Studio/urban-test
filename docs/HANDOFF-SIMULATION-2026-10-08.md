# DRIP Urban — continuità del lavoro master, 2026-10-08

## Stato del lavoro

Questo documento conserva la cronologia delle verifiche; le sezioni iniziali riportano risultati storici, superati dagli aggiornamenti successivi e da RELEASE-READINESS-2026-10-09.md. Il programma master continua con le fasi 3–14; non è un report finale. Richiesta di riferimento: allegato `3c270178-d5f2-4d25-be6a-d83d042fb1b0`.

La precedente passata aveva separato budget grafici e agenti, limitato i modelli Twin e corretto avvio/continuità. Le verifiche erano 92 core / 84 web, 57 API e test browser mirati; crash originale, ibrido e stress prolungato restavano aperti. Questa continuazione affronta quei punti prima delle fasi successive.

## Simulation Engine 2.0 — implementato e testato nelle condizioni sotto

- Due strategie operative selezionabili: microscopica IDM e ibrida (velocità/densità per corsia lontano dal dettaglio; identità, percorsi, bilancio e intersezioni conservati).
- Worker di simulazione separato da geometria/analisi. Snapshot trasferibili; conferme numerate; lo smontaggio di un renderer annulla le sue attese, evitando un blocco dei frame dopo Map → Twin.
- Endpoint `simulation-network` restituisce tutte le strade e i nodi anche per un progetto grande con zona di lavoro. La geometria edilizia non viene duplicata nel solver. Cambio zona di lavoro mantiene la rete municipale indipendente; cambio progetto ferma il run.
- Ambiti reali: comune, viewport, incrocio (300 m), corridoio (distanza dalle strade selezionate), quartiere/distretto (poligoni circolari dichiarati, non confini amministrativi inventati), zona/area selezionata. Ambiti senza nodi utilizzabili vengono rifiutati.
- Mappa: impronta volumetrica semplice per ogni campione, dettagli entro un budget separato, cache delle parti, id stabile del veicolo. Twin: 96 modelli vicini, pool di 4.000 punti, qualità esplicita e riduzione automatica sui renderer software/lenti. Nessun limite al numero di agenti del solver.
- Diagnostica: simulati/disegnati, tick, Hz fisici misurati, latenza, FPS UI/scena distinti, heap stimato quando disponibile, ambito attivo.
- Replay incrementale conserva i checkpoint dopo `postMessage` anche se le identità JS delle operazioni cambiano. Modifiche di contenuto sotto lo stesso id invalidano correttamente la cache.
- Gridlock conservato, nessuna espulsione silenziosa. Domanda non inserita resta in attesa; storico arrivi limitato agli ultimi 900 s con contatore totale separato. Cache routing limitata a 128 alberi.

### Riproduzione storica e condizioni disponibili

Il vecchio `vehiclesFC` del commit HEAD è congelato come fixture esclusivamente di test. In Chromium isolato con heap controllato a 512 MB, richiedere le parti complete di 50.000 veicoli blocca la valutazione per oltre 30 secondi; **nessun evento `page.crash` ricevuto**. Lo stesso browser genera il nuovo buffer di 2.000 impronte in circa 1,6 ms, 703.827 byte serializzati. È una riproduzione del percorso bloccante, non dell’esatta macchina/sessione originale.

Il crash segnalato non è riproducibile nelle condizioni attuali verificate: baseline Frattamaggiore del repository, cinque carichi, entrambi i solver, transizioni. Evidenza delimitata a queste condizioni, non una garanzia universale per qualsiasi comune/GPU. Le condizioni originali esatte non sono presenti nel repository. Il percorso grafico bloccante è corretto e il suo sostituto verificato.

### Stress e memoria

`e2e/simulation-long.spec.ts`: 1k/5k/10k/25k per 5 s ciascuno; 50k per 120 s per solver, quattro transizioni Map/Twin. Sono agenti realmente instradati e avanzati nel worker, con warm start sintetico spaziale, non cloni di oggetti privati. Domanda aggiuntiva zero per verificare conservazione. Ogni campione deve avanzare nel tempo, anche durante la permanenza in Twin. Bilancio attivi + arrivati sempre uguale alla popolazione iniziale. Nessun crash/error JS.

A 50k: circa 24 MB di heap worker e 165 MB di heap pagina dopo GC; crescita del worker limitata al riscaldamento delle cache (circa 9–13 MB osservati). Il caricamento lazy del Twin aggiunge circa 46 MB alla pagina. Non è una prova di stabilità per ore né una domanda calibrata. La flotta sovrasatura diverse corsie: il gridlock viene mantenuto, non espulso.

Renderer software SwiftShader, 1440×900: mediana rAF nel Twin circa 8–12 FPS, mappa circa 35–50 FPS; la qualità si riduce automaticamente. Il picco tick osservato a 50k è 125 ms microscopico / 75 ms ibrido; include snapshot e step. L’interfaccia resta utilizzabile; non è certificato rendering Ultra a 50k modelli individuali. LOD/aggregazione sono intenzionali e dichiarati. Heap pagina e worker misurati separatamente; memoria GPU non misurata.

Risultati versionati: [performance/SIMULATION-2026-10-08.json](performance/SIMULATION-2026-10-08.json). Comandi opt-in: `DRIP_LONG_STRESS=1` per stress; `DRIP_LEGACY_REPRO=1` per browser storico isolato. Screenshot `.shots/simulation-controls-map.png` e `simulation-controls-twin.png` ispezionati; diagnostica leggibile, immagini e attribuzioni presenti.

Verifiche: 96 core, 88 web; due API `test_large`; due E2E controls/scale, due stress prolungati, un test storico controllato. Build e typecheck passati. Una regressione intermedia di frame congelati dopo lo smontaggio della mappa è stata riprodotta e corretta con test unitario ed E2E prolungato.

## Fasi successive: stato storico prima dell’implementazione

| Fase | Stato dell’ampliamento richiesto | Lavoro da continuare |
|---|---|---|
| 3 clock/temporale/ZTL/Scenario Lab | IMPLEMENTED + PARTIALLY TESTED | clock, routing/ZTL dinamici e Lab testati; frequenze TPL e metriche operative vengono completate nella fase 7; calibrazione/OD ancora da ampliare |
| 4 Twin editing/follow/camera | IMPLEMENTED + PARTIALLY TESTED | E2E drag/undo/follow passato; interpolazione aggiunta, regressione finale e tram operativo in fase 7 |
| 5 asset/building/materiali | IMPLEMENTED + PARTIALLY TESTED | materiali/project textures, edificio/procedurale/PBR/LOD verificati; 3D Tiles reale richiede dataset fornito |
| 6 segnaletica/VMS | IMPLEMENTED + PARTIALLY TESTED | editor, programmi e Twin testati; copertura completa famiglie normative non certificata |
| 7 TPL/ottimizzazione | IMPLEMENTED + PARTIALLY TESTED | solver e orari/trasferimenti/ottimizzatore/navigazione testati; calibrazione reale non fornita |
| 8 civil/modellazione/utilities | IMPLEMENTED + PARTIALLY TESTED | alignments/profili/grading/clash/solid/sottopassi testati; as-built non forniti |
| 9 works/Gantt/phasing | IMPLEMENTED + TESTED | calendario, dipendenze, proiezione cantieri Map/Twin e undo testati su scenari dichiarati |
| 10 presentation/export | IMPLEMENTED + PARTIALLY TESTED | scene, grafica, percorso e export reali verificati; codec/hardware multipiattaforma non certificati |
| 11 piattaforma | IMPLEMENTED + PARTIALLY TESTED | moduli preesistenti e fix licenza; ampliamento centrale ancora da verificare |
| 12 UX/precisione | IMPLEMENTED + PARTIALLY TESTED | snap, numerici, ricerca già corretti; passata globale restante |
| 13 Elios | IMPLEMENTED + PARTIALLY TESTED | edit validati esistenti; alternative e valutazioni automatiche restanti |
| 14 release QA | NOT IMPLEMENTED (stato storico) | verifica completa dopo tutti gli ampliamenti |

Questi stati descrivono l’ampliamento, non negano i moduli preesistenti. Nessun blocco esterno impedisce di continuare il lavoro interno. Contratti centrali di entitlement/provider e asset fotogrammetrici reali saranno distinti dai sistemi locali implementabili.

## Continuazione 2026-10-09 — clock e Scenario Lab

- `ProjectClock` opzionale nel modello condiviso; `clock.set` validata, undo/redo e autosalvataggio ordinari. Unica timeline in ogni workspace. Conversione nel fuso IANA del progetto, cambio data e mezzanotte, rifiuto delle ore inesistenti DST e supporto esplicito del fold a livello core.
- Flow usa l’istante del progetto: domanda interpolata, calendari e grafi per categoria aggiornati al cambio minuto. La topologia stabile conserva gli agenti già presenti; una tratta successiva bloccata produce un nuovo percorso o attesa al nodo, senza teleport/delete. Programmi semaforici temporali condivisi con map/Twin, validati contro conflitti e tempi minimi. Fuori programma si usa il piano base.
- Scrubbing Flow = replay deterministico cancellabile nel worker, a blocchi di lavoro, con progresso reale. Non modifica soltanto il cursore. Speed/durata non riavviano gli agenti; modifiche di calendario/rete restano espliciti restart. Fine durata preserva l’ultimo risultato.
- Navigator, stima, isocrone/accessibilità, ZTL inspector/pannelli e luce Twin usano lo stesso clock. Permessi Navigator ricavati dalle zone effettive, senza categorie incompatibili con quelle salvate. Rimossi clock indipendenti del Twin.
- Scenario Lab valuta baseline/A/B/C e altre alternative in worker separato: domanda/seed/calendario identici, Flow effettivo, code/arrivi/velocità, stima assegnazione, accessibilità pedonale/ciclabile, connettività, conflitti geometrici. Export JSON con impostazioni e metodo. CO₂ = ipotesi esplicite editabili g/km e g/s, non dato live o modello certificato. Popolazione residente non inventata dagli edifici. Merge scenari validato e salvato come batch undoable.
- E2E clock e Scenario Lab passati: replay a 65 s, velocità senza reset, data coerente nel Twin, quattro scenari ed export. Screenshot Map/Twin/Lab ispezionati. Lab spostato a sheet largo per rendere confrontabili più colonne.
- 101 test core e 88 web passati, typecheck passato prima del test aggiuntivo dei programmi. La passata finale ripeterà build/stress dopo tutti gli ampliamenti. I dati di stress del 2026-10-08 restano riferiti a quella revisione; non sono automaticamente certificazione delle nuove modifiche temporali.

Si continua con fase 4, poi 5–14, senza report finale intermedio. Restano da completare calibrazione/OD, metriche TPL e popolazione da fonti reali, e integrazioni climatiche solo con un provider effettivo.

## Twin 2026-10-09 — verifica reale

Inspector numerico X/Y/Z/rotazione/scala, selezione multipla, allineamenti, duplicazione e rimozione; gizmo X/Y/Z/rotazione con preview dei modelli reali, snap comune, Alt precisione e batch singolo. Operazioni asset condivise con Map e history. Coordinate ENU e quota superficie/profilo condivise. Camere orbit/fly/walk/cinematic e sette profili follow; singola telemetria selezionata calcolata dal solver, percorso/corsia/destinazione/manovra/segnale. Budget render indipendente. Interpolazione posizione/quaternione dei modelli dettagliati aggiunta dopo primo E2E.

E2E Twin: trascinamento reale, un solo batch, quota e Ctrl+Z, solver 1.000 agenti, cinque camere follow, nessun pageerror. Screenshot editing/follow ispezionati. Inspector viene chiuso selezionando un mezzo. Clock e Lab ripetuti e passati; tabella a quattro scenari leggibile. 102 core e 88 web passati; typecheck dopo interpolazione passato.

Limiti da verificare nella passata finale: collisioni camminata non presenti; tram e servizio TPL non ancora operativi; interpolazione appena aggiunta da ripetere in E2E/stress. Si continua materiali/asset e fasi successive, senza certificare intera release.

## Materiali e asset 2026-10-09

Materiali nel network condiviso mediante material.set; catalogo è proiezione di sola lettura. Applicazione batch ad aree, arredi, edifici e sezioni stradali, autosave/undo. Editor colore/immagine/ritaglio/offset/rotazione/scala/opacità/rugosità/metallicità/bump/normal map/emissione/tinta/contrasto/luminosità. Preview live. API texture valida PNG/JPEG/WebP con Pillow, normalizza PNG, deduplica via hash e conserva file nel progetto. Export/import dei pacchetti ora include textures e models.

UV metrici su superfici e facciate; geometria senza compressione ST (altrimenti i valori metrici fuori 0–1 si deformavano). Native furniture GLB PBR vicino a 500 m, fallback procedurale batch lontano; dimensioni fisiche e ground pivot condivisi. Correzione limiti delle parti ruotate nel generatore: 51 asset con metadati unità/assi/pivot/bounds. glTF import: bounding box reale e pivot, correzione assi che scambiava ingombro X/Z, rifiuto geometria senza POSITION invece di inventare 2 m.

building.style conserva baseline e aggiunge override undoable per altezza/piani/uso/copertura/facciata/materiali/balconi. OSM conserva livelli/roof/material colour/use quando disponibili. Finestre dipendono dai piani, falde/padiglioni e balconi hanno geometria. Facciate/tetti possono usare immagini del progetto. Collegamento 3D Tiles valida manifest reale e viene caricato da Cesium con georeferenziazione originale; nessun dataset fotogrammetrico proprietario presente da certificare. Predisposizione testata solo compilazione, dati esterni non inventati.

Meteo chiaramente simulato (sereno/nuvoloso/coperto/pioggia/nebbia), ambiente salvato nel network; sole/data/fuso effettivi, pioggia animata dal project clock. Finestre notturne dipendono dalla direzione solare, non dall'intensità del cielo coperto.

E2E materiali/building meteo passati e screenshot ispezionati; corrette due regressioni visive (shader parola riservata e UV compressi). E2E Twin ripetuto dopo PBR/interpolazione e passato. API texture dedup/rejection/package roundtrip passato. Core 103 e web 88 passati prima degli ultimi ampliamenti segnaletica; typecheck successivo passato. Non è ancora certificazione release né fotorealismo da dataset proprietario.

## Segnaletica 2026-10-09

Editor geometrico dei vertici con trascinamento e numerici metrici, batch singolo per gesto; linee tratteggiate/doppie, offset, scala, ripetizione e reverse. Binding a strada/corsia con progressive: geometria deriva dall'asse corrente. Zebra poligonale e hatch con angolo/larghezza/passo/bordo; clipping robusto su poligoni concavi. Test core verifica area di ogni striscia dentro la sagoma. Parametri validati nelle operazioni condivise.

Pali: gap fisico sufficiente per targhe 90 cm, quote rispettate nella mappa inclinata, targhe rimosse escluse dalla pila; trasformazioni Twin espandono il palo collegato. VMS manuale/live/programma settimanale/simulazione della tratta, fonti esplicite. Pagine e finestre usano clock globale; texture Twin rivalutata con cambio messaggio. Non sono inventati dati di parcheggio o traffico live.

E2E editor, modifica numerica, programma VMS e rendering Twin passato (11,8 s); screenshot editor/Twin ispezionati, nessun error panel Cesium. Fase 6 IMPLEMENTED + PARTIALLY TESTED: non ancora testate tutte le famiglie normative/pali in rendering né un provider live reale. Si procede fase 7 e la QA finale ripeterà le regressioni.

## TPL e semafori 2026-10-09

`TransitLine` nel core, `transit.set` validata e undoable; documenti legacy migrati solo nello scenario corrente, altri conservati finché migrati. Il doc conserva GTFS/bike e archivio legacy, non riscrive la rete progettata corrente in due modelli. Guardie contro load tardivo su altro progetto/scenario.

Esercizio A→B: partenze feriali/festive/notturne per fascia, frequenza zero sospende; slot bloccato dal traffico resta in attesa. Bus/BRT/filobus/tram/DRT su percorsi connessi, semafori/IDM/lane; servizi su sede propria lungo geometria salvata con accelerazione, velocità e fermate. Soste, capacità, domanda esplicita per fermata e discesa; interscambi configurabili con cammino dichiarato e reinserimento reale nella coda destinataria. Domanda zero se non configurata: non è ridership calibrata. Metriche partenze, ritardo, arrivi, attesa e saliti; telemetria/follow reali anche per tram/treni/battelli, LOD condiviso.

Controller attuato/adattivo ora legge detector fisici del solver, garantisce min/max green, yellow/all-red e clearance pedonale. Priorità TPL/emergenza/pedonale/bilanciata; stati runtime condivisi Map/Twin. Ottimizzatore confronta solver reale: ciclo, offset, sequenza, split, modalità e priorità. Ambiti incrocio/corridoio coordinato/rete; candidate batch e applicazione esplicita undoable. Stesso clock/domanda/seed; before/after visibile. Disponibilità verde pedonale distinta da ritardo di persone non modellate. Metriche TPL integrate nel Lab.

Core 109 test passati, typecheck passato; E2E TPL undo/solver/tram-follow e confronto candidati ripetuti e passati. Screenshot ispezionati: distanza camera ampliata per mezzi lunghi, padding della tabella corretto dopo ispezione (da ripetere visualmente). Fase 7 IMPLEMENTED + PARTIALLY TESTED: scenario sintetico non calibrato, flotte su corsa A→B senza turni autisti/materiale rotabile riciclato; interscambi e ottimizzazione multipiano appena aggiunti richiedono regressione finale. Tracciati ferroviari non includono interlocking ferroviario né marcia a vista certificata. Si continua con Civil/utilities/modellazione e le fasi rimanenti, non è una release completata.


## Civil, reti e modellazione 2026-10-09 (lavoro in corso)

Tracciati rettifilo/arco/clotoide integrati con quadratura metrica, quote e sezioni con crossfall interpolato, assembly a strati e quantità/costi espliciti, mass haul da DTM reale. Operazioni road.setAlignment/road.setCorridor condivise e undoable. Nodo finale e assi connessi aggiornati atomicamente; verifica dei profili dopo modifica geometrica ancora necessaria.

Reti estese acqua/fognatura/stormwater/elettricità/gas/telecom/distretto, nodi/quota/datum/condotte/intermedi/chambers, metriche lunghezza e pendenza. Clash worker con distanza 3D finita, diametri/franchi, sedi stradali e fondazioni con profondità dichiarata; include drenaggio/acquedotto esistenti, esclude datum incompatibili. Vista Twin sottosuolo. Risultati invalidati quando cambia rete/DTM; modifiche datum/sistema respinte se incompatibili con le condotte.

Asset.solid è geometria nativa nello stesso modello asset, non un documento parallelo: poligoni e fori con triangolazione/estrusione, materiali PBR, sagome Map, GLB Twin, push/pull, vertici, muri/scale/pensiline, gruppi, serie, rotazione attorno al centro comune e undo. Test area cortile/normali/volume/unione muro passati; E2E Civil/utilities e modellazione passati 24,3 s, screenshot reali ispezionati. Anteprima Civil corretta dopo QA visiva.

Non è certificazione Civil professionale completa: clash fondazioni campionato, grading generalizzato e ulteriori verifiche di progetto da completare; non forniti rilievi/as-built/calibrazione. Pianificazione lavori ora in implementazione, segue presentazione/platform/UX/Elios/regressione. Non concluso il master.


## Lavori e presentazione 2026-10-09 (QA in corso)

Piano lavori/WorksPhase nella rete e works.set undoable: Gantt, date inclusive, budget, appaltatore/categoria, area e dipendenze validate acicliche. Proiezione derivata dalla data di clock, senza sovrascrivere gli oggetti autoriali: costruzioni visibili dal completamento, demolizioni dall’inizio, chiusure stradali durante cantiere. Map/Twin area di cantiere, grafo temporale Flow alla data. E2E date/undo/Twin passato e screenshot Gantt ispezionato. Stato amministrativo distinto da date; nessun avanzamento reale inventato.

Presentazione migrata da documento legacy a presentation.set nello scenario/undo. Scene con tempo globale, simulazione live e domanda dichiarata, confronto con scenari salvati, percorsi camera Twin a più keyframe, annotazioni georeferenziate e registrazione canvas WebM reale. E2E nativepath/annotazione/salvataggio/download WebM (639 KB)/racconto JSON passato 15,6 s; screenshot Twin ispezionato. Corretta chiusura automatica del pannello che nascondeva Stop video. Screenshot confronto era preso prima del caricamento: ora verifica feature effettivamente renderizzate, da ripetere. Separazione update live dai layer statici e metadata presentazione esclusi dal restart solver. Stampa browser/PDF non ancora QA, esportazione interattiva completa non ancora implementata. Seguono Platform/UX/Elios e recupero verifiche/capacità mancanti; master non completato.


### Ulteriore richiesta utente 2026-10-09

Integrare AI nell’analisi GIS, nei cicli semaforici e nella valutazione di ulteriori interventi. Aggiungere sottopassi stradali e pedonali: quote/rampe/luce/sagome, collegamento alla rete e al Twin, operazioni undoable e verifiche reali. La richiesta amplia il master, non sostituisce le fasi ancora in corso. Da implementare durante il completamento Civil/Elios e verificare in browser.


## Platform e integrazione GIS/AI — continuazione 2026-10-09

Login ridisegnato e verificato via API protetta reale: password errata/visibilità/CapsLock, desktop e mobile, accesso provvisorio con cambio password obbligatorio. E2E passato; screenshot ispezionati. JWT OIDC verificati con JWKS e issuer/audience/lifetime/azp, niente token decodificato senza firma per attribuire ruoli. Test RSA/firma falsificata passati. Nuova dipendenza PyJWT[crypto] 2.15.x, documentazione primaria https://pyjwt.readthedocs.io/en/stable/usage.html . SSO reale richiede credenziali/provider effettivo.

Policy centrale fornita da deployment file fidato: revisioni monotone, cache offline, impostazioni e azioni bloccate lato server anche per admin. Nessun contratto remoto inventato; enrollment/control plane richiede API centrale autentica. File policy configurato ma mai ricevuto blocca accesso anziché sbloccare. Aggiornamenti: staging e validazione percorsi/dati protetti/SHA, backup file sostituiti e ripristino dopo errore; test su directory temporanee, mai aggiornato il repository reale. Pip prepara dipendenze prima della sostituzione: ambiente Python non transazionale; compatibilità rollback dipendenze da verificare. Stato installazione salvato; richiesta fallita conservata. Sei test updater/package passati, inclusa failure durante sostituzione; quattro test JWT/policy passati prima dell'ultimo fail-closed aggiunto.

Formato .dripu v2 con inventario SHA-256, versioni modello/app, contenuti nativi, textures/models/docs/scenari e migrazione legacy v1. Import atomico in nuovo progetto; rifiuto integrità/versione/percorsi/duplicati e gzip baseline invalido. Roundtrip reale passato; regressione completa ancora da eseguire.

Elios analyze_gis: grafo, accessibilità piedi/bici, cicli e clash effettivi; evaluate_interventions: alternative e solver Flow ibrido common seed/calendar/demand; apply_evaluated_intervention: solo candidato valutato nello stesso progetto/scenario/operazioni, batch undoable. Nessuna domanda live inventata; calibrazione e popolazione marcate mancanti. Guardie contro cambio progetto/scenario durante risposta AI, cancellazione worker. Richieste linguistiche reali richiedono chiave Gemini; strumenti testati direttamente nell'app, non certificazione del provider.

Sottopassi nel Road.structure e profilo esistente via road.setUnderpass: rampe/quote/luce/soletta, controllo lunghezza/pendenza, ingresso/uscita connessi. Pedonale converte corsie/sezione/accesso; nessun passaggio motor/emergenza nel grafo. Core due test e typecheck passati. E2E editor/GIS/3 alternative solver/undo/Twin passato 12,2 s; screenshot Twin iniziale non accettabile (superficie bianca), investigazione visuale in corso. Pareti visualizzate come superfici, non elementi FEM; drenaggio e raccordi definitivi richiedono progetto dettagliato e quote di rilievo.

Correzioni trasversali: proiezione lavori preserva data corrente quando si modifica durante playback; dipendenza finish-start rispetta date inclusive. Cinematica usa geodesia e ownership camera per evitare interferenza con orbita automatica. Da ripetere E2E presentazione e regressione.


## Regressione aggiuntiva 2026-10-09 — master ancora attivo

Risolta superficie bianca della vista sottosuolo: sky atmosphere/skybox/fog disabilitati insieme al globo e rispettati dal daylight. Sottopassi ripetuti in browser, screenshot ispezionato, nessun error panel Cesium. Pareti/soletta/rampe nel modello reale; verifica di dettaglio e dati di rilievo restano limitazioni esplicite. Conversione pedonale→stradale ora recupera attributi traffico originali, anche dopo modifiche ripetute; test significativo passato.

Grading generale nel modello Area e area.set: piano metrico con pendenze, scarpate dichiarate/ritenuta, terreno derivato e quantità worker da DTM. Test convergenza su piani e immutabilità; browser edit/undo/redo/quantità/Twin passato. Screenshot editor e terreno ispezionati. Integrazione delle celle di bordo e pareti di sostegno richiedono ancora perfezionamento; nessuna certificazione geotecnica.

Export presentazione HTML offline con geometrie reali prima/dopo, pan/zoom/confronto/scene/testo e fotogramma reale della simulazione; dichiara .dripu necessario per Twin e solver. Test download/apertura offline, PNG/PDF/WebM reali passato, screenshot HTML ispezionato. Percorso geodesico e camera ownership verificati nuovamente. Elementi editoriali avanzati da completare.

Aggiornamenti: stato/receipt, richiesta ripristino verificata dal server con backup SHA; test ripristino su directory temporanee passato. Non eseguito aggiornamento dell'installazione utente. Licenza mostra organizzazione/posti solo quando comunicati, stato ultima verifica e fallimento tentativo separati; rimozione locale non simula rilascio seat remoto. Contratti centrali/credenziali reali ancora necessari.

GIS: corretta copertura per singola categoria, indipendente da categorie precedenti mancanti. TPL: slot programmati contati anche per linee non connesse, mancati distinti dai partiti; test servizio non connesso e attraversamento mezzanotte passati. Intervallo integrato half-open esplicito nel test. Cancellazione Elios interrompe fetch tramite AbortController e worker valutazione, impedisce strumenti successivi; modifiche già applicate restano undoable.

Regressione unit ultima esecuzione: core 127/127, frontend 88/88; typecheck passato. API precedente 70/70. Stress esteso 1k/5k/10k/25k/50k e 120 s per modo avviato sul codice aggiornato: risultati da registrare alla fine, non anticipare certificazione. Master NON concluso; proseguire Civil/UX/editoria/affidabilità e QA completa.


### Stress ripetuto e regressioni successive

Stress esteso ripetuto sul codice aggiornato: entrambi i modi e tutte le taglie 1k/5k/10k/25k/50k passati, 50k circa 123 s wall / 121–122 s simulati, quattro transizioni Map/Twin per modo, nessun errore/crash. Bilancio finale 50.000. Heap dopo GC frontend 166 MB, worker 25 MB; worker finale inferiore al primo campione, frontend +44 MB dopo caricamento Twin. Massimo 4096 disegnati, agenti fisici indipendenti. Risultati compatti in docs/performance/SIMULATION-2026-10-09.json e dettagli .shots/long-stress-*.json. Minimi FPS 3,74 microscopico / 4,78 ibrido con SwiftShader: stabile ma fluidità software bassa; non certificati ore di esecuzione, memoria GPU, tutte le configurazioni o 50k mesh individuali. Screenshot Twin microscopico ispezionato senza error panel.

Download release: validazione forma/versione/dimensione metadata, un download alla volta, HTTPS anche redirect, misura bytes + SHA, cleanup .part su ogni errore. Tre nuovi test completati, 17/17 con platform suite. Profilo/crossfall riparametrizzati sulle modifiche asse/nodo, sottopassi preservano rampe fisiche e respingono asse insufficiente. Test metrici e immutabilità passato; typecheck dopo fixture completa passato.

Ricerca globale estesa con ranking e singolo errore di digitazione, incroci/edifici/marking/interventi/linee/fermate TPL/sottoservizi/progetti. Focus sottoservizi transiente apre editor condiviso; TPL apre linea effettiva. Tre test ricerca passati. Policy UI disabilita anche durata sessione e ruolo. Corretto flag cinematicPathActive erroneamente azzerato ad ogni frame: ownership rimane per intera riproduzione, nuova asserzione E2E avviata con Civil/editor/underpass. Non anticipare risultati.


### Continuazione: editoria, affidabilità e controlli 2026-10-09

Scene: grafici con valori/fonte/istante, testi, immagini/loghi PNG/JPEG/WebP nel repository texture del progetto, legende e annotazioni geografiche (frecce/callout) nel modello PresentationScene e presentation.set. Scene Twin modificabili senza avviare la camera. Compositore canvas condiviso tra video nativo e HTML offline, immagini inglobate nell’HTML per PNG/PDF senza server. Corretta acquisizione video sul postRender Cesium: il primo controllo visivo aveva terreno nero; ripetizione con tile e primitive pronte mostra terreno, edifici e testo corretti. WebM realmente decodificato nel browser e screenshot ispezionato. E2E presentazione + Civil + modellazione: 3/3 passati; grafica/video dopo ultimo refactor da includere nella regressione generale in corso.

Modellazione: fori rettangolari interni con dimensioni/centro locali espliciti, poi vertici liberamente editabili; validazione topologica nativa e rimozione foro. Browser modello con foro e serie di copie passato. Civil: controllo planimetrico usa curvature analitiche esatte quando authored, clotoidi con raggio minimo all’estremo; rilievi non analitici mantengono fitting dichiarato. Divisione strada conserva esattamente parabole verticali anche quando il taglio cade nella curva, tramite PVI equivalenti, e interpola/rebase crossfall. Sottopasso è struttura unitaria: divisione respinta con motivo esplicito, edit/remove/undo disponibili. Sottopasso rimosso ripristina traffico e profilo precedenti; editor segue undo. Clash indica copertura/fondazioni non verificate quando mancano quote al punto, evitando esito pulito implicito.

AI: save_evaluated_scenarios crea scenari nativi atomici da candidati reali già valutati, batch con clock e interventi, descrizione con domanda/seed/risultati/metodo. Scenario sorgente resta corrente; test API e browser salvano due alternative e verificano contenuti. Guardie di cancellazione/progetto/revisione su piani, terreno, grading, trasporti e segnalazioni civiche. Import immagini/materiali non aggiorna uno scenario cambiato mentre attende upload. TPL manuale non usa più segmenti retti come fallback stradale; in-flight routing verifica scope. Bike sharing migrato nel modello Network.bikeShare e transit.set: edit/undo/redo ora nativi, documento legacy solo sorgente di migrazione e GTFS (non seconda copia editabile dello scenario).

Platform: API keys con ambiti server e scadenza UTC (default 90 giorni), ruoli come ulteriore vincolo; segreto SHA-256, one-time reveal, date creazione/ultimo uso/scadenza. Revoca e touch serializzati per evitare riscrittura di record revocati. Bearer invalido non ricade su admin della modalità open. Chiavi legacy conservano permessi derivati dal ruolo e assenza di scadenza dichiarata. UI policy disabilita anche gestioni chiavi/utenti/licenza/update. E2E reale crea key read-only, verifica POST/GET admin 403, revoca 401, screenshot con segreto mascherato. Pacchetti native: schema operazioni ricorsivo, ID scenario/file, rifiuto prima di staging; forward operation types non vengono interpretati sul server, replay espone operazioni non applicabili.

Ultima regressione completa: core 135/135, frontend 93/93, API 77/77, typecheck/build passati. Suite browser generale ancora in corso; test login protetto chiamato nella modalità open non è significativo e va eseguito separatamente con DRIP_E2E_AUTH=protected. Non segnare master concluso: rimangono copertura navigator multimodale, asset manager unificato, contesto Twin AI e ulteriore QA.


### Ripresa 2026-10-09: navigatore, asset manager e contesto AI

Navigatore: motocicli sulle corsie generali con restrizioni motor vehicle; itinerario TPL con orari reali authored, attese, accesso/uscita e cambi sulla rete pedonale; multimodale confronta cammino puro e TPL. Nessuna previsione live inventata. Distanze massime pedonali esplicite come preferenze del viaggiatore. Due direzioni richiedono due linee authored. Bus/tram instradati sulla rete, servizi disconnessi respinti; rail/ferry sul tracciato proprio. Core tre test e browser viaggio/attesa/Moto passati. Routing ora edge-state: conserva arrivi diversi allo stesso nodo, rispetta laneConnections e frecce native Junction Lab; due nuovi test passati. Da verificare ulteriormente variazioni temporali delle restrizioni durante un'attesa TPL (rete validata all'istante iniziale), metadati OSM delle relazioni e alternative multimodali.

Asset manager unificato: cataloghi effettivi arredi/segnali/materiali/sezioni, categorie, ricerca/tag/preferiti personali, geometrie procedural isometriche dalle stesse facce del modello (modelli importati dichiarati anteprima ingombro), texture reali, utilizzi nello scenario e focus Inspector. Sostituzione compatibile di selezione con un batch undoable; browser verifica trasformazioni conservate, tag e undo. Pannello largo. Nessun secondo modello del progetto.

Import 3D: audit backend header/chunk/buffer/accessor/gerarchie/texture incorporate, conteggi triangoli/materiali e avvisi di costo. Non validatore completo Khronos. Scala/dimensioni non finite respinte; modello referenziato da baseline o cronologia di qualsiasi scenario non eliminabile, evitando undo con file mancante. Test API misurazione/corruzione/NaN/reference409 passati. loadModels e upload/3D Tiles non scrivono UI/scenario di un altro progetto dopo await.

Elios legge camera/viewport reali del Twin mediante registro leggero senza import Cesium nel bundle iniziale; browser get_context verifica sorgente live-twin-camera e coordinate finite. AI GIS/semafori/scenari e sottopassi restano funzionali come sopra; provider linguistico reale richiede la chiave Gemini, non sostituito da demo.

Regressione corrente: core 138/138 più 2 test turn-routing separati, frontend 93/93, API 78/78, typecheck passato. Browser: 7/7 asset/navigatore/viste, underpass/GIS/scenari/contesto camera passato; login protected 1/1 separato. Workflow 2/2 passato con locator comando aggiornato. Snapshot layout clock intenzionali ispezionati; ulteriori screenshot asset/nav da QA completa. Master ancora attivo: ulteriore affidabilità temporal routing, provider adapters, profilo punti alto/basso, produzione export e QA complessiva prima del report unico finale.


### Ulteriore verifica 2026-10-09: temporale, profili, import e recupero

- TPL Navigator verifica disponibilità delle tratte all'ora di ingresso e ad ogni confine di minuto attraversato. Cerca le partenze successive effettive quando una corsa è bloccata (orizzonte esplicito 24 ore); cache grafi locale limitata a 64. Date/cantieri riproiettati dalla rete autoriale, anche dopo mezzanotte. Alternative distinte ricalcolate escludendo una linea usata; fino a tre itinerari reali. Sei test core, incluse apertura durante attesa, chiusura durante viaggio e cantiere il giorno successivo. Stime velocità authored, nessuna previsione ritardo live.
- Routing motorizzato usa solo l'albero edge-state, senza duplicare Dijkstra; regole di corsia anche ai raccordi di due bracci senza superficie Junction Lab. Tre test turn-routing. Divisione nativa strada conserva la parabola in 401 campioni, undo/redo testati nella history reale.
- Punti alti/bassi esatti delle parabole verticali e vertici senza raccordo: marker Max/Min e progressive/quote nel Profile Studio, focus sezione e strumento Elios vertical_profile_report. Browser passato, screenshot ispezionato. Dock espandibile per leggere grafico e sezioni senza cambiare rete.
- Export dalla build di produzione senza debug globals: HTML autonomo aperto offline con compositore compilato, passato. QA PDF reale ha trovato layout su due pagine con mappa separata; corretto CSS di stampa A4 orizzontale, ora una pagina con geometrie e testo, render Poppler ispezionato. E2E presentazione, decodifica WebM, PNG/HTML/PDF e produzione ripetuti: 2/2 passati.
- GTFS-RT: protobuf effettivo servito da fixture HTTP locale, passa attraverso API reale e UI. Feed vecchio / senza timestamp mostrati esplicitamente; errore rimuove posizioni. Test browser passato, test protobuf/coordinata invalida passato. Provider ufficiale dell'operatore non fornito.
- ErrorBoundary locale Map/Twin/Presentazione e dock, globale per applicazione. Errori Cesium/render e perdita contesto grafico danno retry/ritorno mappa, mantengono history e solver. Browser inietta errore nell'evento reale del renderer, verifica retry e context loss: passato; screenshot ispezionato. Nessuna promessa di recupero automatico di una GPU guasta.
- LAZ realmente decodificato con laspy/lazrs in chunk di 250k, array numerici compatti, waveform 4/5/9/10 respinti esplicitamente. Import UI .laz collegato allo stesso terrain document. Test LAS/LAZ dello stesso terreno coincide entro 2 cm, LAS troncati/record zero/scala NaN/header invalido respinti. Upload browser reale con 18.997 punti terreno mostra profilo: passato. LAS/LAZ ricampionano DTM; non è ancora un visualizzatore della nuvola grezza. Dipendenza server nuova laspy[lazrs]>=2.7,<3.
- Geocoding Navigator verifica progetto/scenario dopo await. WMS gestiti dalla policy: editor disabled in base a lockedKeys/azioni effettive providers.manage/platform.manage; server continua a imporre policy.

Regressione corrente: 146/146 core, 93/93 frontend, 85/85 API; build passata. Browser mirati 4/4 recupero/profili/nav/asset, 2/2 LAZ/profili, 2/2 presentazione/produzione, 1/1 GTFS. Suite browser generale aggiornata (45 casi) in esecuzione. Non anticipare esito, release/hardware/integrazione centrale restano non certificati. Continua verifica budget, LOD e requisiti master; nessun report finale inviato.


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


## Patch cumulativa successiva — lavoro ancora attivo (2026-10-09)

Il nuovo brief in allegato d3161a2d estende i requisiti: RELEASE-READINESS precedente non certifica questa patch.

- Aggiunto stato traffico direzionale condiviso, provider timestamp/freshness, velocità/chiusure nel routing e solver; UI quattro fonti, copertura, legenda osservato/stimato. Core 4 test, API affidabilità 3 test, E2E traffico passato con fixture provider esplicita.
- Ambiente globale Live/Studio: clock wall time, congelamento ripetibile, meteo nativo e fonte traffico; E2E nuovo ambiente e clock Map/Twin passati. Select corretto per evitare click-through; focus Popover verificato.
- Elios: tre alternative semaforiche e riferimento, confronto con vincoli di throughput/domanda/TPL/accessibilità, progressi e tabella, salvataggio nativo, applicazione e undo. E2E passato con flotta iniziale sintetica 150, 300 s e 40k spostamenti/giorno: risultati diversi fra alternative, senza forzare una raccomandazione. Chiamata conversazionale al provider Gemini non verificata senza credenziale.
- Prima implementazione pedoni su percorsi, marciapiedi e attraversamenti reali: due test core passati (bilancio e attesa rosso/verde); integrazione renderer Map/Twin in verifica browser, non ancora certificata.
- Suite core precedente a pedoni: 151 passati. Web: 95/96 al primo run, un timeout geometria in contesa; stesso test isolato 2/2 passato. Confronto Elios 3 nuovi test passati. Serve regressione cumulativa finale.
- Runner E2E Windows usa ora il percorso assoluto System32/taskkill.exe. Eseguire le suite browser in sequenza: porte e directory di prova sono condivise.

Restano internamente attivi gli altri punti della matrice `PATCH-ACCEPTANCE-2026-10.md`; nessun report finale emesso per questa patch.


### Continuazione patch — 2026-10-10

Meteo: acquisizione Open-Meteo indipendente da CAMS, stato parziale e recupero immediato degli errori; timestamp valido distinto dal recupero, UTC epoch e intervallo precipitazione espliciti. Acquisizione UI salva weatherCapture nel modello nativo con undo, rifiuta timestamp mancanti/vecchi e fenomeni non supportati. Istantanea modellata ad aggiornamento manuale, non sensore live. Due E2E ambiente passati, screenshot environment-provider ispezionato; quattro test provider passati. Riferimento contratto: https://open-meteo.com/en/docs . Pioggia Twin usa intensità effettiva e smoothstep GLSL con estremi ordinati; QA visiva pioggia successiva ancora necessaria.

Pedoni: E2E Map/Twin passato e screenshot ispezionati dopo correzione quota billboard. Percorsi locali sintetici, non ancora OD pedonale completo o trasferimento di identità passeggero TPL.

Elios: picco code ora usa conteggio completo dei veicoli fermi sulle tratte, senza troncamento ai dodici elementi UI. Vincoli aggiunti per ritardo medio, verde pedonale, copertura ciclabile e conflitti. Errore sincrono salvataggio scenari gestito. Regresso browser dopo modifica in corso.

Regressione: 153 core e 99 frontend passati. Timeout test building LOD dovuto a import Cesium dentro il test: import spostato al caricamento modulo, asserzioni e timeout invariati. Notifiche con pausa lettura hover/focus, azioni di recupero persistenti; modali conferma e palette con focus contenuto/ripristinato. Nuovi test di questi cambiamenti in corso, non anticipare esito.


### Verifica cumulativa del 10 ottobre — ancora in corso

156 test core e 103 frontend passati; build produzione passata. API completa passata. Login protetto desktop/mobile passato e screenshot ispezionati. Nuovi strumenti Elios per clock, ambiente, simulazione comunale e scena presentazione usano modello e servizi esistenti; test browser dedicato passato. Diagnostica proattiva locale con riferimenti agli oggetti e vincoli di confronto aggiuntivi verificata.

Twin: pedoni vicini con modelli procedurali articolati (pool massimo 32), lontani con billboard (budget 500), senza alterare popolazione simulata. QA browser pedoni passata. Matrice dawn/noon/sunset/blue-hour/night/rain/heavy-rain passata; screenshot ispezionati. Preset solari calcolati per origine, data e fuso; notte e intensità pioggia corrette.

La regressione ordinaria da 56 casi è in esecuzione: sono emersi errori Navigator (locator ambiguo), ricerca (nome accessibile obsoleto), grading (attesa indiscriminata di primitive), sottoservizi (rapporto assente, causa ancora da isolare). Nessuna certificazione finale per questa patch: correggere e ripetere prima dello stress cumulativo.


### Ripresa 11 ottobre — regressioni e integrazione

Repository ripreso dal checkpoint 7b3e835, senza reset o commit automatici. La suite precedente ha registrato sette fallimenti. Ripetizione mirata dopo correzioni: 8/9 passati, ultimo caso presentazione passato nella verifica isolata successiva insieme a nuovo test lifecycle baseline. Il controllo di proprietà camera viene ora caricato prima del playback; la ripetizione integrata resta in corso, non si attribuisce un difetto applicativo non riprodotto.

Cause corrette: Select dentro label riattivava il trigger per azione predefinita; annullata tale azione. BillboardCollection pedoni creata solo al primo agente, eliminando primitive vuote mai ready. Reload baseline mantiene il worker comunale indipendente e la stessa cronologia nativa, inclusa redo; test unitario ed E2E passati. Rapporto utility ricalcolato se la rete cambia durante import marciapiedi, senza risultati obsoleti. Screenshot clash e grading Twin ispezionati.

Integrazione successiva: renderer degli agenti posseduto dalla mappa anziché dal pannello Traffico, con view bounds e cleanup propri. Avvii TPL e scene live tramite startProjectSimulation condiviso. Aggiornamento live scollega il listener dalla vecchia mappa e usa intervallo limitato effettivo; archivio usa il fuso progetto. Test browser integrati in corso.

Validazione signal.setPlan ora rifiuta payload incompleti con Issue e confronta anche conflitti derivati dalla geometria, evitando bypass con matrice vuota. Suite core completa:157 passati. Typecheck passato. Stato master ancora attivo.
