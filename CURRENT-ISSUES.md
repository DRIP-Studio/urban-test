# CURRENT-ISSUES — DRIP Urban 2.0

Formato: id · descrizione · causa radice · stato · fix · test. Aggiornato il 2026-10-08.

## Simulazione: continuazione verificata

- Percorso grafico a parti complete corretto con LOD e cache. Frame congelati nel cambio Map/Twin riprodotti e corretti annullando attese dei renderer smontati; regressione dedicata.
- Rete municipale completa, due modi, cinque carichi fino a 50k e heap worker verificati: [evidenze e limiti](docs/HANDOFF-SIMULATION-2026-10-08.md).
- Limiti: nessuna certificazione di ore di run, domanda calibrata, GPU Ultra o comune diverso dalla fixture verificata. Le restanti fasi master sono lavoro attivo.

## Audit 8 ottobre 2026

Dettagli e perimetro non completato: [AUDIT-2026-10-08](docs/AUDIT-2026-10-08.md).

| ID | Descrizione | Stato / verifica |
|---|---|---|
| A26-01 | Raggio uscita rotatoria ignorato e parametri Inspector mancanti | chiuso per i controlli implementati: geometria condivisa, corsie/isola/ellisse/uscita, undo e persistenza; `physical.test.ts`, `editor-regression.spec.ts` |
| A26-02 | Snap OFF lasciava altri agganci attivi e spostava incroci vicino ai nodi | chiuso: master persistito, F9, coordinate libere; `snap.test.ts`, `road-snap.test.ts`, e2e |
| A26-03 | Suggerimenti dichiaravano successo anche su commit rifiutato | chiuso: pipeline unica di commit per le modifiche suggerite; `suggestions.test.ts` |
| A26-04 | Cambio regolazione lasciava vecchi piani e simulazione | chiuso: rimozione atomica, run Flow ricostruito e notificato, cache traffico invalidata; `analysis.test.ts`, `worker-simulation.test.ts` |
| A26-05 | Licenza revocata poteva diventare offline_grace | chiuso: stati inattivi mai promossi, feature vuote non ampliate; `test_license_state.py` |
| A26-06 | Ricerca oggetti e risposte geocoder obsolete | chiuso per oggetti/zone/superfici/segnali/rotatorie/scenari; `project-search.test.ts`, e2e |
| A26-07 | Entitlement di altri prodotti DRIP non definiti | aperto: serve contratto centrale; launcher espone unknown, nessun grant inventato |
| A26-08 | Regolazione rotatoria dosata/oraria senza controller dedicato | aperto: avviso esplicito; precedenza conservata sugli accessi senza piano |
| A26-09 | Ampiamento complessivo richiesto (isole, 3D, civil, comune intero, ecc.) | ancora aperto: perimetro esatto nel documento di audit |

## P0 — blocker

| ID | Descrizione | Causa radice | Stato | Fix | Test |
|---|---|---|---|---|---|
| P0-01 | Il lavoro reale 53.0 (scenario `future`) deve sopravvivere | Formato 53.0 diverso | **chiuso** | Adapter in sola lettura `migrate53.py` | `test_migration_from_legacy_fixture`; dati reali: 86 operazioni, 0 fallite (docs/MIGRATION.md) |
| P0-02 | Stack frontend | — | **chiuso** 2026-10-01 | React + TS + Vite, confermato dall'utente | — |
| P0-03 | Twin e 2D con renderer diversi | Doppio renderer 53.0 | **chiuso** | Modello fisico unico | RB-06 |

Nessun P0 aperto.

## 2.0 — aperti (dipendono da DRIP o da terzi)

| ID | Descrizione | Causa | Stato | Prossimo passo | Test |
|---|---|---|---|---|---|
| V2-01 | Token del design system del sito | studiodrip.it non raggiungibile dall'ambiente di sviluppo | aperto | fornire i token (colori, raggi, spaziature, ombre) e aggiornare `tokens.css` | baseline visive |
| V2-02 | Endpoint della piattaforma DRIP | da implementare lato piattaforma | aperto | `/v1/licenses/activate`, `/v1/licenses/validate`, `/v1/releases/drip-urban/latest` (docs/PLATFORM.md) | `test_license_trial_without_platform`, `test_update_check_reports_unreachable_platform` |
| V2-03 | Client DRIP ID | da registrare | aperto | client `drip-urban`, redirect `/api/auth/oidc/callback`, ruoli `drip-urban-*`, claim `drip_*` | — |
| V2-04 | Carte tecniche ufficiali (WMS CTR/DBT regionali, catasto) | URL della CTR regionale non fornito | **parziale** — WMS configurabili, catasto AdE preimpostato (EPSG:3857 da verificare sul servizio reale) | inserire l'URL WMS della Regione in Impostazioni | `test_wms.py` |
| V2-05 | Ritorno verso FST | il plugin FST espone solo API di lettura | aperto | ricevitore del webhook `publication.created` (con `reportIds`) sul portale | `test_fst_reports_filtered_to_project_area_and_configurable_portal` |
| V2-06 | Altimetria, computi, IFC/LandXML | — | **chiuso** | DTM, profili, sezioni, movimenti terra; computo metrico; IFC 4.3 e LandXML | `vertical.test.ts`, `test_terrain.py`, `quantities.test.ts`, `ifc.test.ts`, `landxml.test.ts` |
| V2-07 | Profilo di progetto non applicato alle superfici del Twin | il Twin usava terreno ellissoidico | **chiuso** | terreno DTM a tasselli, superfici drappeggiate su terreno e livellette, scarpate, edifici e arredi alla quota del suolo | `twin-heights.test.ts` |
| V2-09 | Clotoidi e cigli di progetto | l'asse da rilievo è una polilinea | aperto | l'andamento planimetrico riconosce rettifili e curve circolari; il progetto delle curve di transizione e della sopraelevazione per corsia non c'è | `streetscape.test.ts` (alignment) |
| V2-10 | Reti in pressione (acquedotto, gas) e sottoservizi | fuori perimetro | aperto | c'è il drenaggio a gravità; le reti in pressione restano da fare | — |
| V2-11 | Nuvole di punti e 3D Tiles fotogrammetrici | fuori perimetro | aperto | si importano DTM .asc e modelli glTF; LAS/LAZ e 3D Tiles no | — |
| V2-08 | Collaborazione solo con un processo server | hub eventi in memoria | aperto | per installazioni multi-processo serve un broker (Redis) | `test_collab.py` |

## P1 — major

| ID | Descrizione | Causa radice | Stato | Fix / prossimo passo | Test |
|---|---|---|---|---|---|
| P1-01 | Loghi solo da PNG | Vettoriali originali non disponibili | aperto | SVG ricavati per tracciatura (potrace) dai PNG forniti; sostituire con gli SVG ufficiali quando disponibili, stessi nomi file | visual `hub-head.png` |
| P1-02 | Font Ginto in licenza di prova | Licenza | **2.0: in uso su richiesta del committente**; verificare che la licenza copra la distribuzione con l'app | Manrope (OFL) come riserva | — |
| P1-03 | Catalogo segnali | Libreria mai costruita | **chiuso** | 243 segnali CdS SVG (CC BY-SA 3.0) | e2e posa cartello |
| P1-04 | Test 53.0 sul testo del sorgente | Strategia di test | **chiuso** | Vitest core (23) + web (8), pytest (9), Playwright (9) | — |
| P1-05 | Semafori attorno a rotatoria a precedenza | Generati automaticamente dal 53.0 | **chiuso** | Non migrati, elencati nel report come `info` | report migrazione |
| P1-06 | Rotatoria migrata `ef0e3e8fbc` disordinata | Dati 53.0: bracci cortissimi, nodi < 10 m | aperto — richiede ridisegno dell'utente | Ridisegnare con lo strumento Rotatoria | — |
| P1-07 | SUMO non integrato | Fuori dal perimetro 1.0 | aperto | Simulazione = DRIP Flow; dichiarato in PROVIDERS | — |
| P1-08 | Chiavi provider negli errori di rete | httpx riporta l'URL con la chiave | **chiuso** | `providers.redact()` su tutti i messaggi | `test_provider_keys_are_masked_and_redacted` |
| P1-09 | Icone semaforiche mancanti al primo fotogramma | `styleimagemissing` non risolve più in MapLibre 6 | **chiuso** | `setMissingStyleImageResolver` | e2e senza avvisi "could not be loaded" |

## P2 — polish

| ID | Descrizione | Stato |
|---|---|---|
| P2-01 | Bundle Twin 4,1 MB (Cesium) caricato solo in modalità Twin | accettato, già in chunk separato |
| P2-02 | Baseline visive solo a 1440×900 e 1024×700 | aperto (RB-12) |
| P2-03 | Un timeout intermittente su `openWorkspace` visto 1 volta su ~10 esecuzioni | aperto: diagnostica aggiunta in `e2e/helpers.ts`, non più riprodotto in 8 esecuzioni |

## Flow — audit 2026-10-08, seconda richiesta

| ID | Stato | Risultato / residuo |
|---|---|---|
| SIM-01 | parziale | glTF illimitati sostituiti da budget/LOD, buffer limitato; crash originario e run lungo 50k non certificati |
| SIM-02 | chiuso, testato | pannello unmount fermava run: continua tra mappa/Twin; closeProject lo ferma |
| SIM-03 | chiuso, riprodotto/testato | avvio durante init/build falliva: comando accodato fino alla rete pronta |
| SIM-04 | chiuso, testato | 1× avanzava 2,5×: accumulatore del passo fisso |
| SIM-05 | aperto | grande comune contiene solo work area: niente caricamento/simulazione di tutta la rete municipale ancora |
| SIM-06 | aperto | ibrido, worker dedicato/partitioning, interpolazione, follow e clock globale |

Dettaglio, matrice richiesta e handoff: `docs/HANDOFF-SIMULATION-2026-10-08.md`.


## Stato successivo — 2026-10-09

Le righe SIM-05/SIM-06 dell'audit storico sono superate: rete municipale, micro/ibrido, worker, clock, follow e LOD implementati e testati nel perimetro dell'handoff. Non equivalgono a certificazione su ogni comune/hardware. Navi multimodale e Asset manager ora implementati e browser testati. Restano in lavorazione variazioni delle restrizioni durante un viaggio TPL, QA export produzione e completamento verifiche master. Contratti/credenziali centrali DRIP ID/Issuer/licensing/control plane non disponibili; chiave provider Elios assente per certificazione end-to-end delle richieste linguistiche. Non dichiarare release pronta.


Aggiornamento successivo: chiusi routing temporale TPL, alternative, profili extrema, export produzione/PDF e recupero viste nelle condizioni dei test. V2-09 superato da alignments analitici nativi/crossfall, V2-10 da utilities e reti in pressione esistenti ampliate, V2-11 da LAS/LAZ→DTM e 3D Tiles reali configurabili (dataset fotogrammetrico esterno non fornito). Non implica certificazione professionale/as-built o visualizzatore nuvole grezze. Suite generale e budget/LOD in QA; nessuna release completa dichiarata.


V2-01: raggiungibilita del sito superata il 2026-10-09 (HTTP 200), token pubblici verificati e documentati in DESIGN-SYSTEM. Rimane da confermare il diritto di distribuzione dei font proprietari; nessun token privato/contratto API ottenuto dal sito pubblico.


### Stato finale interno — 2026-10-09

Stress hardware RTX5070/D3D11 completato senza suite concorrenti:2 passati,11 min;1k/5k/10k/25k/50k entrambi i modi,300 s a50k,4 transizioni per modo, bilancio esatto, zero pageerror/crash/pannelli errore. Tick max51,1/53,9 ms; p95 dei59 campioni45,8/48 ms; worker finale24,98/25,85 MiB. UI rAF circa60 FPS, distinto dagli FPS scena statici19–23 osservati negli screenshot. Screenshot di entrambi i run ispezionati. Evidenza performance/SIMULATION-2026-10-09-hardware.json.

Stato corrente autorevole: docs/RELEASE-READINESS-2026-10-09.md (per i file già sotto docs: RELEASE-READINESS-2026-10-09.md).43 browser ordinari passati,4 skip coperti da login1/storico1/stress2;147 core/96 frontend/85 API, typecheck/build passati. Nessuna certificazione ore/VRAM/tutte le GPU. Software4,98 FPS e848,5 ms p95 input non raggiunge i budget. Integrazione centrale/provider linguistico live restano bloccati da servizi, contratti e credenziali esterni; sito pubblico accessibile. I vecchi stati delle sezioni precedenti sono cronologia, non elenco dei moduli ancora da implementare.
