# Changelog

## 2.0.0 — aggiornamento del 2026-10-05

### Novità già nel branch, ora documentate
- Aggancio di due strade con un raccordo, senza spostare nessun vertice esistente (Alt+clic: sposta l'estremo).
- Consigli di tracciamento in tempo reale mentre si disegna (raggi delle curve rispetto al minimo DM 5/11/2001, angoli degli incroci, incroci troppo vicini): solo consigli, niente cambia in automatico.
- Aggiornamento «Live» di tutte le analisi aperte dopo ogni modifica, sospendibile dalla barra di stato.
- Segnaletica orizzontale completa: attraversamenti, denti di squalo, isole, corsie riservate, stalli speciali, dissuasori.
- Città intere fino a 5.000 km² (es. Roma): import a tasselli, zona di lavoro, vista d'insieme.
- Rete acquedotto in pressione e DTM da nuvole di punti LAS/XYZ.

### Marciapiedi stimati
- Gli angoli agli incroci sono chiusi: raccordo del cordolo con lo stesso raggio della carreggiata e retro del marciapiede arrotondato. Prima la stima si interrompeva 2,5 m prima di ogni incrocio e lasciava gli angoli scoperti.
- Ogni angolo esiste solo se sono attivi entrambi i lati che collega; contorno tratteggiato solo sul lato edifici, senza cuciture tra i pezzi.

### Segnaletica
- Frecce di corsia, frecce di preselezione e scritte BUS/bici non finiscono più dentro gli attraversamenti pedonali: vengono spostate a monte della zebra, oppure omesse se non c'è spazio.

### Prossimi passi
- I consigli non compaiono più sui pezzi di una strada esistente tagliata dalla nuova (prima proponeva marciapiedi a strade che li avevano).
- Un solo consiglio per marciapiedi e limiti su tutta la strada disegnata, applicato a tutti i suoi tratti; gli incroci sono indicati con il nome della strada incrociata.
- Pannello a fisarmonica: una scheda aperta, le altre su una riga; si può comprimere; aprire una scheda inquadra il punto in mappa.
- Una nuova strada senza nome resta senza nome invece di prendere il nome del modello di sezione.

### Interfaccia
- Le notifiche non intercettano più i clic sul pannello sottostante: sono attivi solo i loro pulsanti.
- L'import automatico dei marciapiedi al primo avvio non ricarica più il progetto: aggiorna solo la città di base e mantiene modalità, strumento, pannello, selezione e le modifiche fatte nel frattempo (prima poteva azzerare lo strumento in uso e perdere modifiche non ancora salvate). Una sola notifica di avanzamento.

### Test
Core 78 (nuovi: angoli dei marciapiedi; nessuna freccia nelle zebre), web 61, API 46, end-to-end 15 (suite da ~10 a 1,4 minuti).

## 2.0.0 — aggiornamento del 2026-10-04 (sera)

### Segnaletica orizzontale e moderazione del traffico
- Strumento «Segnaletica» (W): linee continue, tratteggiate, doppie, miste, gialle, zig-zag, arresto, dare precedenza, triangoli, frecce, scritte, simboli, stalli, zebrature, chevron, box giallo; colori bianco, giallo, blu, rosso, rosa, verde; riferimenti artt. 137–155 Reg.
- Scritte, simboli e frecce con un clic, orientati sul senso di marcia e centrati sulla corsia.
- Segnaletica automatica: frecce e linee continue di preselezione dalle svolte delle corsie, stalli colorati dalla sezione, fermate bus con zig-zag e «BUS».
- Strumento «Moderazione» (D): dossi con i limiti dell'art. 179, piattaforme e attraversamenti rialzati, cuscini berlinesi, bande rumorose, incroci rialzati.
- Ponti, viadotti e gallerie: rilevati dai tag OSM o impostati nell'Inspector; pile 3D e ombra in mappa.

### Suggerimenti «Prossimi passi»
- Dopo ogni modifica: marciapiedi, limiti di velocità, regolazione degli incroci, segnali e rialzo degli attraversamenti, varchi ZTL e Zona 30, presegnalamento dei dossi, coordinamento semaforico. Ogni suggerimento ha la norma e un'azione in un clic.

### Veicoli, edifici, modelli
- Veicoli 3D realistici (auto in vari colori, furgoni, camion, bus 12 m, ambulanze) in mappa e nel Twin.
- Edifici con facciate in intonaco e tetti in coppi; demolizione e ripristino nello scenario.
- La posa di un modello importato libera l'area da edifici e arredi esistenti.

### Piani e opere (Civil 3D / InfraWorks)
- Piano urbanistico: import PUC/PRG (Shapefile/GeoJSON, Gauss-Boaga/UTM), standard DM 1444/68, conformità dell'edificato, vincoli e fasce di rispetto, verifica del progetto.
- Piano del traffico: classificazione funzionale PGTU, isole ambientali → Zone 30/ZTL, indicatori PUMS.
- Drenaggio urbano: strumento (C), metodo razionale, Gauckler-Strickler, dimensionamento DN.
- Andamento planimetrico con verifiche DM 5/11/2001 § 5.2.
- Twin sul terreno reale (DTM, livellette, scarpate).

### Elios
- Nuovi strumenti: `add_traffic_calming`, `set_road_structure`, `set_lane_turns`, `urban_standards`, `classify_network`, `environmental_islands`, `pums_indicators`, `check_drainage`, `alignment_report`.

## 2.0.0 — aggiornamento del 2026-10-04

### Arredo 3D
- 45 modelli rifatti (389 pezzi) con rotazioni, tronchi di cono ed ellissoidi.
- Stesse geometrie in pianta (renderer a facce ombreggiate), sulla mappa inclinata (un'estrusione per pezzo con quote reali) e nel Twin.

### Altimetria
- DTM da Copernicus GLO-90 o da file LiDAR .asc.
- Profilo longitudinale con livellette e raccordi parabolici e verifiche DM 5/11/2001.
- Sezioni trasversali, sterri e riporti.

### Computo metrico estimativo
- Capitoli e quantità dal modello.
- Prezziario regionale importabile da CSV.
- Sicurezza, IVA ed export CSV.

### Export BIM
- IFC 4.3 georeferenziato.
- LandXML 1.2 con assi, profili e DTM.

### Carte ufficiali e collaborazione
- WMS configurabili, con il catasto dell'Agenzia delle Entrate preimpostato e proxy sicuro.
- Collaborazione in tempo reale: presenze e aggiornamento automatico dalle modifiche dei colleghi.

### Elios
- Nuovi strumenti: `load_terrain`, `road_profile_report`, `design_road_profile`.

### Test
Core 46, web 53, API 40, end-to-end 9.

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
