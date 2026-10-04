# Provider e fonti esterne — DRIP Urban 2.0

Regola generale: senza un provider configurato, l'app funziona lo stesso con dati e modelli propri, dichiarati come tali. Un dato "live" compare solo se arriva davvero da un feed in tempo reale.

## Con chiave o URL (Impostazioni → Provider)

| Provider | Cosa abilita | Senza configurazione | Prova chiave |
|---|---|---|---|
| **HERE Traffic API v7** | flussi (`/flow`) e incidenti, cantieri e chiusure (`/incidents`) in tempo reale nell'area visibile, provenienza `live` con data di cattura; aggiornamento automatico ogni 2–10 min; alimenta i PMV in modalità automatica | Traffico usa la stima DRIP (BPR), etichettata "Stimato" | richiesta flow su 200 m attorno a Frattamaggiore |
| **Google Maps Platform**, Map Tiles API | basemap "Google Satellite" nella mappa 2D, con le tile richieste tramite il server locale | basemap non elencata | `createSession` satellite, la stessa chiamata usata dalla basemap |
| **Google Gemini** (API key) | Elios, l'assistente AI: chat con strumenti che agiscono sullo scenario (`gemini-2.5-flash`, header `x-goog-api-key`, richieste dal server locale) | Elios spiega come configurarla; il resto dell'app funziona | elenco dei modelli disponibili (`GET v1beta/models`) |
| **GTFS-Realtime** (URL) | posizioni dei veicoli TPL in tempo reale | nessun veicolo live; linee e orari GTFS statici restano disponibili | download del feed |

### Come sono gestite le chiavi

- Sono salvate in `settings/providers.json` nella cartella dati dell'utente, mai nel codice e mai nel repository.
- L'API le restituisce solo mascherate (`abc…wxyz`).
- Ogni messaggio d'errore passa da `providers.redact()`, perché gli errori di rete riportano l'URL della richiesta, che contiene la chiave. Coperto da test (`test_provider_keys_are_masked_and_redacted`).
- Le richieste a Google partono dal server locale: la chiave non arriva al browser.

## Senza chiave

| Fonte | Uso | Note |
|---|---|---|
| OpenStreetMap (Overpass) | import di nuove aree come job; la baseline di Frattamaggiore è già inclusa | ODbL; fino a 20 km² in una richiesta, oltre a tasselli da 16 km² fino a 2.000 km² (limite secondo l'abbonamento) |
| Nominatim | ricerca luoghi nella palette comandi e scelta dell'area di un nuovo progetto | User-Agent identificato, rispetto dei limiti d'uso |
| Open-Meteo e Open-Meteo Air Quality (CAMS) | meteo e qualità dell'aria nel pannello Analisi | provenienza dichiarata con link |
| Copernicus DEM GLO-90 tramite Open-Meteo Elevation API | modello del terreno del progetto (profili, sezioni, movimenti terra) | 90 m nativi, campionati su griglia; © DLR e Airbus, distribuito da ESA. In alternativa: DTM LiDAR regionale in ESRI ASCII Grid |
| WMS configurati (catasto Agenzia delle Entrate, CTR/DBT regionali) | carte tecniche come base o sovrapposizione | richiesti tramite il server locale solo per i servizi configurati; cache di 24 ore |
| Tile OSM, Esri World Imagery, OpenTopoMap | basemap raster | attribuzione sempre visibile |
| FST, API pubblica `fst-mobile/v1/maps/reports` e `…/projects` | segnalazioni e progetti civici in sola lettura, filtrati sull'area del progetto | cache di 5 minuti (forzabile con *Aggiorna*); nessuna scrittura verso il plugin; portale configurabile (`fstUrl`, `DRIP_FST_URL`) |
| Piattaforma DRIP | licenze, aggiornamenti, DRIP ID | vedi [PLATFORM](PLATFORM.md); senza piattaforma: prova di 30 giorni o ultima licenza valida per 14 giorni |

## Modelli DRIP, dichiarati come tali

| Modello | Natura | Etichetta nell'interfaccia |
|---|---|---|
| Stima traffico | domanda giornaliera × quota di attraversamento × profilo orario, assegnata con BPR | "Stimato · Modello DRIP: non è un conteggio". Il profilo orario è un'ipotesi DRIP, non una fonte statistica. |
| DRIP Flow | microsimulazione IDM con semafori e precedenze | "Simulazione" |
| Sicurezza | screening surrogato da geometria, conflitti e velocità; si possono importare incidenti da CSV | "Screening surrogato" finché non si importano dati incidentali ufficiali |
| Accessibilità, isocrone | cammino sulla rete pedonale effettiva dello scenario | risultato di calcolo sulla rete, non un rilievo |

## Non disponibile in 2.0

- **SUMO**: nessuna integrazione. La simulazione disponibile è DRIP Flow.
- **Cesium ion e Google Photorealistic 3D Tiles**: non integrati. Il Twin usa terreno ellissoidico e immagini Esri; gli edifici sono estrusi da OSM.
- **Google Routes**: non usato. I tempi di percorrenza vengono dal routing interno sulla rete di scenario.
