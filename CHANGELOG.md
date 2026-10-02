# Changelog

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
