# Modello dati — DRIP Urban 1.0

I tipi completi sono in `packages/core/src/model/types.ts`, che è la fonte di verità. Questo documento ne riassume la forma e le regole.

## Su disco

Cartella dati: `%LOCALAPPDATA%\DRIP Urban`, oppure il valore di `DRIP_URBAN_DATA`.

```
projects/<id>/project.json            metadati, elenco scenari, stato
projects/<id>/baseline.json.gz        città di partenza, immutabile
projects/<id>/scenarios/<sid>.json    scenario = operazioni + revisione
projects/<id>/docs/<name>.json        presentazione, civico, TPL, sicurezza, traffico…
projects/<id>/thumbnail.png
projects/<id>/snapshots/<stamp>/      versioni manuali e automatiche
projects/<id>/audit.jsonl             registro delle modifiche, solo in aggiunta
publications/<pub>.json               pubblicazioni civiche
settings/                             utente, provider (chiavi mai restituite in chiaro)
```

Le scritture sono atomiche: il file temporaneo viene rinominato. Ogni salvataggio di scenario porta `baseRevision`. Se sul server la revisione è più recente, l'API risponde 409. Il client allora rilegge lo scenario dal server e vi riapplica le proprie operazioni non salvate (rebase), senza perdere lavoro.

## Provenienza

Ogni strada, oggetto e valore derivato porta `Provenance { kind, source, acquiredAt?, url? }`.

| `kind` | Significato |
|---|---|
| `existing` | rilievo o atto ufficiale |
| `osm` | OpenStreetMap contributors |
| `measured` | sensore o misura sul campo |
| `derived` | calcolato da altri valori con fonte |
| `estimated` | stima di modello, dichiaratamente non misurata |
| `project` | disegnato in uno scenario |
| `simulated` | output di simulazione |
| `live` | feed in tempo reale di un provider |

L'interfaccia mostra la provenienza come badge. Un valore `estimated` non viene mai presentato come misurato.

## Città (`CityBaseline`)

| Campo | Contenuto |
|---|---|
| `nodes` | `RoadNode { id, at: [lon, lat] }` |
| `roads` | `Road { id, from, to, axis[], roadClass, name, speedKmh, oneway, section: CrossSection, lanes[], provenance }`. L'asse inizia e finisce esattamente sui nodi. |
| `buildings`, `features` | edifici e contesto (verde, acqua, ferrovia) da OSM |
| `assets` | segnaletica e arredo esistenti |
| `bbox`, `origin` | estensione e origine del sistema metrico locale |
| `sources` | elenco delle fonti con data di acquisizione |

`CrossSection.elements` è l'elenco ordinato da sinistra a destra rispetto al senso dell'asse. I tipi di elemento sono `lane`, `bus`, `cycle`, `parking`, `sidewalk`, `green`, `median`, `furniture`, `shoulder` e `curb`, ciascuno con `widthM` in metri.

## Scenario

```ts
Scenario { id, name, description?, isBaseline, locked, archived, createdAt, operations: Operation[] }
Operation { id, type, payload, author, at }
```

Lo scenario di base non contiene operazioni ed è bloccato. La rete di uno scenario è `replay(baseline, operations)`: viene ricalcolata e mai salvata.

### Operazioni registrate

| Gruppo | Tipi |
|---|---|
| Strade | `road.add`, `road.remove`, `road.update`, `road.setAxis`, `road.setSection`, `road.setOneway`, `road.split` |
| Nodi e incroci | `node.move`, `junction.set` |
| Rotatorie | `roundabout.add`, `roundabout.update`, `roundabout.remove` |
| Semafori | `signal.setPlan`, `signal.removePlan` |
| Zone | `zone.set`, `zone.remove` (ZTL, zona 30, pedonale, scolastica, ZTL ambientale, sosta, cantiere) |
| Superfici | `area.set`, `area.remove` |
| Oggetti | `asset.add`, `asset.update`, `asset.remove` |
| Composizione | `batch`: più operazioni atomiche, un solo passo di undo |

Ogni operazione ha `validate` (rifiuta input incoerenti con un messaggio in italiano) e `apply` (pura, restituisce una nuova rete).

Un'operazione che non supera la validazione, compreso un tipo sconosciuto da un file manomesso, finisce nell'elenco `failed` del replay con i motivi. Non interrompe il caricamento.

## Elementi della rete

- **Rotatoria**: `Roundabout { id, name, type, center, replacedNodeId?, outerDiameterM, aspect, orientationDeg, circulatoryWidthM, lanes: 1|2, apronWidthM, islandMaterial, control, speedKmh, arms[] }`.
  - Gli intervalli di diametro seguono il DM 19/04/2006: mini 14–25 m, compatta 25–40 m, convenzionale 40–70 m.
  - Il grafo di routing è un anello di archi a senso unico antiorario; la geometria visiva è calcolata a parte.
- **Piano semaforico**: `SignalPlan { id, nodeId, name, mode: fixed_time|actuated|adaptive|green_wave, cycleS, offsetS, phases[{ id, name, greenGroups, greenS, yellowS, allRedS, pedestrian… }], actuation? }`.
  - La validazione rifiuta verdi contemporanei per movimenti in conflitto.
  - Il pedonale usa le tre luci all'italiana.
- **Oggetto**: `Asset { id, type (id di catalogo, es. it.sign.II.36), at, elevationM?, rotationDeg, state, material?, attachedTo?, properties, provenance }`.
- **Zona**: `Zone { id, kind, name, polygon, allowedModes, schedule?, speedKmh?, … }`.
- **Superficie**: `Area { id, kind, name?, polygon, material, state, … }`; tipi: piazza, verde, aiuola d'albero, giardino della pioggia, fossato drenante, pavimentazione permeabile, sosta, spartitraffico verde, attraversamento, zebratura, gioco, sedime edificio.

## Modello fisico (derivato)

`buildPhysicalModel(network, frame)` restituisce:

- `surfaces`: carreggiate, marciapiedi, inviluppi d'incrocio, anelli, isole;
- `markings`: linee di corsia, linee di arresto, dare precedenza, zebre, frecce, misurati in metri;
- `lines`: cordoli e bordi;
- `stats`.

Mappa 2D, Twin 3D, export e pubblicazioni leggono tutti questo stesso modello.

## Pacchetto di progetto

`GET /api/projects/<id>/package` produce uno zip della cartella di progetto. In importazione ogni percorso viene controllato contro il path traversal e il progetto riceve un nuovo id.
