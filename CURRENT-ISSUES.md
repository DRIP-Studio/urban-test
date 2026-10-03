# CURRENT-ISSUES — DRIP Urban 2.0

Formato: id · descrizione · causa radice · stato · fix · test. Aggiornato il 2026-10-03.

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
| V2-04 | Carte tecniche ufficiali (WMS CTR/DBT regionali, catasto) | indirizzi dei servizi non forniti | aperto | aggiungere basemap WMS quando disponibili; oggi stile CTR su dati OSM | — |
| V2-05 | Ritorno verso FST | il plugin FST espone solo API di lettura | aperto | ricevitore del webhook `publication.created` (con `reportIds`) sul portale | `test_fst_reports_filtered_to_project_area_and_configurable_portal` |
| V2-06 | Altimetria, computi, IFC/LandXML | fuori perimetro 2.0 | aperto | vedi docs/ANALISI-2.0.md §13 | — |

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
