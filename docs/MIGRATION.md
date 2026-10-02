# Migrazione da DRIP Urban Planning Studio 28–53

## Cosa succede

1. All'avvio l'Hub cerca `%LOCALAPPDATA%\DRIP Urban Planning Studio\data`, oppure il percorso in `DRIP_URBAN_LEGACY_DATA`.
2. Se trova `scenarios.json`, propone **Migra**.
3. La migrazione **legge soltanto** la cartella 53.x. Non scrive, non sposta e non cancella nulla, e il file `provider_settings.json` non viene letto né copiato.
4. Crea un **nuovo progetto** sulla baseline di Frattamaggiore 1.0. Ogni scenario 53.x diventa uno scenario 1.0 composto da operazioni validate.
5. Ogni oggetto 53.x viene convertito in un'operazione oppure elencato nel report di migrazione (`docs/migration.json` del progetto) con il motivo. Nulla viene scartato in silenzio.

Codice: `services/api/app/projects/migrate53.py`, con l'unione dei tratti in `app/city/legacy_city.py`.

## Corrispondenze

| 53.x | 1.0 |
|---|---|
| tratto OSM modificato (sensi, rimozione) | `road.setOneway`, `road.remove`, sulle strade 1.0 che lo contengono (mappa tratti→strade da 6.409 tratti a 2.922 strade) |
| split di tratti | `road.split` sul nodo legacy, poi le operazioni si applicano ai frammenti |
| strada di progetto | `road.add` con sezione ricostruita da corsie e larghezza |
| rotatoria (anello `rbid:n*` + bracci) | `roundabout.add`, con i bracci riconosciuti dagli archi aggiunti che terminano sui nodi dell'anello |
| superfici (piazza, verde, sosta, giardino della pioggia…) | `area.set` con materiale |
| arredo, semafori, cartelli II.36/II.37 | `asset.add` con id di catalogo 1.0 |
| elementi generati dalla rotatoria 53.0 (isole, segnaletica) | non migrati: la 1.0 li rigenera dal modello; elencati come `info` |
| scenari di collaudo 24/25 (`v25-integration`, `v24-plan-test`) | non migrati; elencati come `info` |

Le rotatorie con diametro sotto i 14 m, minimo del DM 19/04/2006 per le mini-rotatorie, vengono portate a 14 m con un `warning`.

Un anello senza bracci collegati alla rete non è una rotatoria funzionante: viene riportato come `error` e va reinserito su un incrocio.

## Risultato sui dati reali (scenario `future`, verificato il 2026-10-02)

| Voce | Valore |
|---|---|
| Operazioni create | 86, di cui **0 fallite** alla validazione del core |
| Per tipo | `road.setOneway` 32 · `road.remove` 23 · `area.set` 17 · `road.add` 9 · `roundabout.add` 3 · `road.split` 1 · `asset.add` 1 |
| `info` | 34 elementi auto-generati dalle rotatorie 53.0 (tra cui 8 lanterne semaforiche); 2 scenari di collaudo; 1 nota su 2 rami di rotatoria |
| `warning` | 3 diametri portati a 14 m (da 10, 10 e 12 m); 2 strade con inizio e fine coincidenti |
| `error` | 1 anello isolato senza bracci: da reinserire |
| Tempo di calcolo del modello fisico | circa 230 ms all'apertura |

## Limiti noti

- **Rotatoria `ef0e3e8fbc`** (40.94546, 14.26374): nel 53.0 aveva bracci molto corti e nodi a meno di 10 m l'uno dall'altro. La 1.0 la ricostruisce dai dati, ma la geometria resta disordinata. Conviene ridisegnarla con lo strumento Rotatoria. CURRENT-ISSUES P1-06.
- **Semafori attorno alla rotatoria `e70cb5297b`**: le 8 lanterne erano generate automaticamente dal controllo della rotatoria 53.0, non inserite a mano. Non vengono migrate e sono elencate come `info`. Una rotatoria a precedenza nella 1.0 non ha semafori, a meno che non si regoli il controllo esplicitamente. CURRENT-ISSUES P1-05, chiuso.
