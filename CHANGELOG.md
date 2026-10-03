# Changelog

## 2.0.0 — 2026-10-03

Analisi completa delle richieste in [docs/ANALISI-2.0.md](docs/ANALISI-2.0.md).

### Marchio e interfaccia
- Tema chiaro accanto a quello scuro, preferenza salvata e allineata al sistema.
- Colori DRIP, Ginto e Ginto Nord per l'interfaccia, Playfair per gli accenti FST.
- Lockup con altezze uniformi di simbolo, logo e "Urban", anche nella home.
- Barra superiore adattiva sotto i 1280 px.

### Piattaforma DRIP ([PLATFORM](docs/PLATFORM.md))
- Accesso con DRIP ID e Keycloak (OpenID Connect + PKCE), ruoli mappati, accesso locale provvisorio admin/admin con cambio password obbligatorio.
- Abbonamenti e licenze dalla piattaforma centrale (trial/base/pro/enterprise), 14 giorni offline, claim `drip_*`.
- Aggiornamenti automatici verificati SHA-256, installati al riavvio dal launcher con backup.
- API v1 con chiavi `drip_…`, webhook firmati HMAC (11 eventi).

### Elios, l'assistente AI
- Chat Gemini con sfumature DRIP e dettatura vocale.
- 30 strumenti per agire sul progetto (strade, ZTL, segnali, arredo, semafori, restrizioni, navigatore, TPL, marciapiedi, traffico live, FST), tutti annullabili.

### Progettazione
- Pali con più pannelli, arredo con volume anche in 2D, import di modelli glTF/GLB (anche da SketchUp).
- PMV, pannelli a messaggio variabile, con testo manuale o automatico dal traffico live.
- Aggancio delle strade non collegate senza deformarle; snap a 6 m sui nodi; correzione della strada che si contorceva all'incrocio.
- Marciapiedi importati in automatico e stimati dove mancano (attivabili e disattivabili, senza modificare la strada).

### Semafori
- Webster con conflitti a livello di movimento, svolte permesse, lanterne a frecce.
- Lanterne rimovibili una per una; corridoi coordinati (onda verde) con diagramma tempo-spazio.
- Ottimizzazione di tutta la rete in un passo.

### Regole e mobilità
- ZTL con fasce per giorno, permessi, carico/scarico, varchi e pannelli LED.
- Divieti e limiti per mezzi pesanti impostabili e importati da OSM (anche `:conditional`); corsie preferenziali con orari.
- Navigatore a tappe con profili auto, camion, bus, bici, a piedi, emergenza.
- TPL multimodale (metro, treno, tram, BRT, bus, filobus, traghetto, a chiamata) con frequenze per fascia, flotta, costi, bacino, passeggeri e CO₂; bike sharing.
- Traffico live con aggiornamento automatico, incidenti e chiusure HERE.

### Scala, export, civico
- Città grandi: import OSM a tasselli fino a 2.000 km².
- Basemap Carta tecnica (stile CTR); DXF in UTM con layer in italiano; tavola PDF A3 con cartiglio.
- Frattamaggiore Si Trasforma:
  - segnalazioni nell'area del progetto;
  - attività con stato e note;
  - pubblicazioni collegate alle segnalazioni;
  - portale configurabile.

### Correzioni
- `from __future__` in `overpass.py`.
- Pulsanti coperti o che chiudevano i pannelli.
- Layout della modalità Civico.
- Ciclo infinito React #185.
- ZTL sovradimensionate.
- Parcheggi marcati "divieto".
- Camion senza percorso.
- Linee TPL perse.

### Test
Core 41, web 14, API 23, end-to-end 9.

## 1.0.0 — 2026-10-02

Ricostruzione da zero di DRIP Urban Planning Studio 53.0. Numerazione nuova; la serie 28–53 resta storia e si migra in sola lettura.

### Architettura
- Un solo modello della città: baseline immutabile + scenario come elenco di operazioni validate, ricalcolato con checkpoint; undo/redo dalla storia dello scenario.
- Un solo modello fisico, usato da mappa 2D, Twin 3D, export e pubblicazioni.
- Core TypeScript nel Web Worker; React 19 + MapLibre 6 + Cesium; FastAPI.

### Progettazione
- Strade (dritte e curve), nodi, taglio, editor di sezione con template.
- Incroci con inviluppi da bordi reali e raccordi tangenti; Junction Lab (movimenti, conflitti, piani compatibili, swept path).
- Rotatorie secondo DM 19/04/2006: grafo di routing separato, anello, cuscinetto, isola, gole tangenti, isole spartitraffico.
- Signal Studio: fasi, ciclo, verde/giallo/tutto rosso, pedonali a tre luci, validazione dei conflitti.
- 243 segnali CdS con composizione su palo; ~40 elementi di arredo; 34 materiali; superfici e zone (ZTL, zona 30, scolastica…).

### Analisi e traffico
- Routing con orari ZTL; stima traffico BPR dichiarata come stima; DRIP Flow (IDM, semafori, precedenze).
- Screening di sicurezza surrogato, import incidenti CSV; centralità e ponti; città dei 7 minuti; isocrone; audit dello scenario.
- GTFS e GTFS-RT; HERE live; meteo e aria Open-Meteo/CAMS.

### Presentazione e civico
- Presenta: prima/dopo (cursore, affiancati, alternati), scene, inquadrature dal Twin, versione civica FST.
- Pubblicazioni civiche co-firmate Frattamaggiore Si Trasforma × DRIP Studio, con trasparenza e ritiro; lettura in sola lettura dell'API pubblica FST.
- Export: GeoJSON con provenienza, PNG, PDF, CSV (strade, traffico, sicurezza), scenario JSON, pacchetto progetto.

### Dati e affidabilità
- Salvataggio atomico, revisioni con rebase su conflitto, coda offline, snapshot, registro audit.
- Migrazione 53.x in sola lettura con report completo.
- Chiavi dei provider mascherate e rimosse dai messaggi d'errore.

### Distribuzione e test
- `Avvia DRIP Urban.bat`: ambiente Python locale, server unico su 127.0.0.1:8765, apertura del browser.
- Test: core 23, web 8, API 9, end-to-end 9 (con baseline visive).
