# QA — DRIP Urban 1.0

## Come si esegue

| Suite | Comando | Cosa copre |
|---|---|---|
| Core (Vitest) | `npm test -w @drip-urban/core` | storia scenari, geometria, modello fisico, rotatorie, routing, Junction Lab, traffico, simulazione, sicurezza, rete — sulla baseline reale di Frattamaggiore |
| Web (Vitest) | `npm test -w @drip-urban/web` | registri livelli/strumenti/comandi, basemap senza chiavi, catalogo materiali |
| API (pytest) | `cd services/api && ../../.venv/Scripts/python -m pytest` | progetti, scenari, snapshot, pacchetti e path traversal, id non validi, pubblicazione civica e ruoli, chiavi provider, migrazione |
| End-to-end (Playwright) | `npx playwright test` | flusso completo e viste; server e dati isolati in `e2e/.data/<run>`, porte 8790/5190 |

Aggiornare le baseline visive solo dopo un cambiamento intenzionale: `npx playwright test --update-snapshots`, poi controllare le immagini in `e2e/__screenshots__`.

## Esito al 2026-10-02 (commit di consegna)

| Suite | Esito |
|---|---|
| Core | 23/23 |
| Web | 8/8 |
| API | 9/9 |
| End-to-end | 9/9, ripetuto 3 volte consecutive senza errori |
| Build di produzione | riuscita; verificata servita da FastAPI (mappa, Twin, parità 56/56, nessuna richiesta fallita) |
| Launcher Windows | verificato: prima installazione dipendenze, avvio, caso "già in esecuzione" |

## Test end-to-end

| Test | Verifica |
|---|---|
| design flow persists and exports | strada (Invio, undo, redo) → rotatoria → piano semaforico automatico → simulazione con veicoli → salvataggio → ricarica (3 operazioni) → export GeoJSON (> 1000 elementi, elementi di progetto) |
| saving conflicts never lose work | un altro client salva prima: la modifica locale viene ribasata e salvata |
| hub, workspace modes, present, narrow window | nessun errore di pagina o richiesta fallita; baseline visive; Junction Lab senza colonne tagliate; nessun overflow a 1024 px |
| twin 3D | parità 2D/3D |
| signs… (RB-01/02/07) | cartello fermo sulla coordinata a 4 zoom, nessun marker DOM, due pannelli sullo stesso palo |
| traffic estimate and safety heatmap (RB-09/10) | senza chiavi: traffico stimato popolato e dichiarato; heatmap sicurezza con punti e dicitura "surrogato" |

## Verifiche manuali (Playwright, schermate in `.shots/`, non versionate)

Hub, migrazione 53.x, Junction Lab, Signal Studio, rotatoria da interfaccia, disegno strada, editor di sezione (clic sul bordo), rebase su conflitto, stima e simulazione traffico, Twin, Presenta (inquadra l'area modificata), pagina pubblica civica, export PNG/PDF/CSV/GeoJSON, sicurezza.

## Limiti dichiarati

Vedi CURRENT-ISSUES: loghi tracciati da PNG (P1-01), Ginto non incluso (P1-02), rotatoria migrata da ridisegnare (P1-06), SUMO assente (P1-07), baseline solo a due risoluzioni (P2-02).
