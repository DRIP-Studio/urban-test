# Provider e fonti esterne — DRIP Urban 1.0

Regola generale: senza un provider configurato, l'app funziona lo stesso con dati e modelli propri, dichiarati come tali. Un dato "live" compare solo se arriva davvero da un feed in tempo reale.

## Con chiave o URL (Impostazioni → Provider)

| Provider | Cosa abilita | Senza configurazione | Prova chiave |
|---|---|---|---|
| **HERE Traffic API v7** | flussi e incidenti in tempo reale nell'area visibile (provenienza `live`, con data di cattura) | Traffico usa la stima DRIP (BPR), etichettata "Stimato" | richiesta flow su 200 m attorno a Frattamaggiore |
| **Google Maps Platform**, Map Tiles API | basemap "Google Satellite" nella mappa 2D, con le tile richieste tramite il server locale | basemap non elencata | `createSession` satellite, la stessa chiamata usata dalla basemap |
| **GTFS-Realtime** (URL) | posizioni dei veicoli TPL in tempo reale | nessun veicolo live; linee e orari GTFS statici restano disponibili | download del feed |

### Come sono gestite le chiavi

- Sono salvate in `settings/providers.json` nella cartella dati dell'utente, mai nel codice e mai nel repository.
- L'API le restituisce solo mascherate (`abc…wxyz`).
- Ogni messaggio d'errore passa da `providers.redact()`, perché gli errori di rete riportano l'URL della richiesta, che contiene la chiave. Coperto da test (`test_provider_keys_are_masked_and_redacted`).
- Le richieste a Google partono dal server locale: la chiave non arriva al browser.

## Senza chiave

| Fonte | Uso | Note |
|---|---|---|
| OpenStreetMap (Overpass) | import di nuove aree come job; la baseline di Frattamaggiore è già inclusa | ODbL; area massima circa 4 × 5 km |
| Nominatim | ricerca luoghi nella palette comandi e scelta dell'area di un nuovo progetto | User-Agent identificato, rispetto dei limiti d'uso |
| Open-Meteo e Open-Meteo Air Quality (CAMS) | meteo e qualità dell'aria nel pannello Analisi | provenienza dichiarata con link |
| Tile OSM, Esri World Imagery, OpenTopoMap | basemap raster | attribuzione sempre visibile |
| FST, API pubblica `fst-mobile/v1/maps/reports` e `…/projects` | segnalazioni e progetti civici in sola lettura | cache di 5 minuti; nessuna scrittura verso il plugin |

## Modelli DRIP, dichiarati come tali

| Modello | Natura | Etichetta nell'interfaccia |
|---|---|---|
| Stima traffico | domanda giornaliera × quota di attraversamento × profilo orario, assegnata con BPR | "Stimato · Modello DRIP: non è un conteggio". Il profilo orario è un'ipotesi DRIP, non una fonte statistica. |
| DRIP Flow | microsimulazione IDM con semafori e precedenze | "Simulazione" |
| Sicurezza | screening surrogato da geometria, conflitti e velocità; si possono importare incidenti da CSV | "Screening surrogato" finché non si importano dati incidentali ufficiali |
| Accessibilità, isocrone | cammino sulla rete pedonale effettiva dello scenario | risultato di calcolo sulla rete, non un rilievo |

## Non disponibile in 1.0

- **SUMO**: nessuna integrazione. La simulazione disponibile è DRIP Flow.
- **Cesium ion e Google Photorealistic 3D Tiles**: non integrati. Il Twin usa terreno ellissoidico e immagini Esri; gli edifici sono estrusi da OSM.
- **Google Routes**: non usato. I tempi di percorrenza vengono dal routing interno sulla rete di scenario.
