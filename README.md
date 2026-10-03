# DRIP Urban 2.0

Postazione di lavoro comunale per pianificazione urbana, progettazione stradale, traffico, simulazione, trasporto pubblico, digital twin e pubblicazione civica.
Prodotto **DRIP Studio**, co-firmato con **Frattamaggiore Si Trasforma** per le pubblicazioni civiche.

Base dati reale: rete stradale, edifici e contesto di Frattamaggiore da OpenStreetMap (ODbL), acquisizione 17/09/2026.
Ogni dato mostrato porta la sua provenienza (OSM, progetto, stima DRIP, provider esterno).

Novità della 2.0 e stato di ogni richiesta: [docs/ANALISI-2.0.md](docs/ANALISI-2.0.md).

## Primo accesso

Al primo avvio si entra con **admin** / **admin**.
- La password va cambiata subito.
- L'accesso provvisorio scade dopo 30 giorni.

Con DRIP ID o con il Keycloak dell'ente si configura l'accesso in Impostazioni → Accesso e identità. Il contratto con la piattaforma DRIP è in [docs/PLATFORM.md](docs/PLATFORM.md).

Elios, l'assistente AI, richiede una chiave Gemini; il traffico live richiede una chiave HERE. Entrambe si impostano in Impostazioni → Provider.

## Avvio (Windows)

1. Installa **Python 3.11+** da python.org e spunta *Add python.exe to PATH*.
2. Doppio clic su **`Avvia DRIP Urban.bat`**.
   - Al primo avvio crea l'ambiente `.venv` e installa le dipendenze (serve Internet una volta).
   - Poi apre `http://127.0.0.1:8765/` nel browser.
3. Per fermare il server, chiudi la finestra nera.

I dati dei progetti stanno in `%LOCALAPPDATA%\DRIP Urban`.
I dati di DRIP Urban Planning Studio 53.x (`%LOCALAPPDATA%\DRIP Urban Planning Studio\data`) si importano dall'Hub: quando vengono trovati compare l'avviso con il pulsante **Migra**. La migrazione li legge soltanto e non li modifica mai.

Variabili opzionali:

| Variabile | Effetto |
|---|---|
| `DRIP_URBAN_PORT` | porta locale (predefinita 8765) |
| `DRIP_URBAN_DATA` | cartella dati alternativa |
| `DRIP_URBAN_LEGACY_DATA` | cartella dati 53.x alternativa |
| `DRIP_URBAN_AUTH` | `protected` (predefinito) oppure `open` (postazione singola senza login) |
| `DRIP_PLATFORM_URL` | piattaforma DRIP per licenze e aggiornamenti |
| `DRIP_ID_ISSUER`, `DRIP_ID_CLIENT_ID`, `DRIP_ID_CLIENT_SECRET` | client OIDC di DRIP ID |
| `DRIP_FST_URL` | portale civico (predefinito Frattamaggiore Si Trasforma) |

## Sviluppo

Requisiti: Node 22+, Python 3.11+.

```bash
npm install
python -m venv .venv && .venv/Scripts/pip install -r services/api/requirements.txt -r services/api/requirements-dev.txt
```

Avvia due processi in due terminali: l'API sulla porta 8765 e Vite sulla 5180, che inoltra `/api` all'API.

```bash
cd services/api && ../../.venv/Scripts/python -m uvicorn app.main:app --port 8765 --reload
```

```bash
npm run dev
```

| Comando | Cosa fa |
|---|---|
| `npm run build` | build di produzione in `apps/web/dist`, servita dall'API |
| `npm test` | test core (Vitest) e web |
| `cd services/api && ../../.venv/Scripts/python -m pytest` | test API |
| `npx playwright test` | end-to-end e regressione visiva, su porte e dati isolati |

## Struttura

| Percorso | Contenuto |
|---|---|
| `packages/core` | modello della città, operazioni, storia scenari, Physical Model, analisi (TypeScript puro, gira nel Web Worker) |
| `packages/assets` | loghi SVG, segnaletica italiana (243 segnali), catalogo arredo e materiali |
| `apps/web` | interfaccia React + MapLibre + Cesium |
| `services/api` | FastAPI: progetti, scenari, snapshot, migrazione 53.x, import OSM a tasselli, provider, GTFS, pubblicazioni civiche, piattaforma DRIP (accesso, licenze, aggiornamenti, API v1, webhook), Elios, modelli 3D |
| `e2e` | test Playwright |
| `tools` | vettorializzazione loghi, costruzione catalogo segnali, launcher Windows |
| `docs` | architettura, design system, modello dati, provider, QA, migrazione |

## Documentazione

- [ANALISI-2.0](docs/ANALISI-2.0.md): stato di ogni richiesta, limiti, prossimi passi
- [PLATFORM](docs/PLATFORM.md): DRIP ID, Keycloak, licenze, aggiornamenti, API, webhook
- [ARCHITECTURE](docs/ARCHITECTURE.md)
- [DESIGN-SYSTEM](docs/DESIGN-SYSTEM.md)
- [DATA-MODEL](docs/DATA-MODEL.md)
- [PROVIDERS](docs/PROVIDERS.md)
- [MIGRATION](docs/MIGRATION.md)
- [QA](docs/QA.md)
- [CHANGELOG](CHANGELOG.md)
- Ledger dei problemi: [CURRENT-ISSUES](CURRENT-ISSUES.md) e [RECURRENT-BUGS](RECURRENT-BUGS.md)
- Audit di partenza: [AUDIT-53.0](docs/AUDIT-53.0.md)

## Licenze dei dati

| Fonte | Licenza |
|---|---|
| OpenStreetMap | ODbL, © OpenStreetMap contributors |
| Segnaletica | da albertograva/italian_road_signs, CC BY-SA 3.0 (Wikimedia Commons) |
| Immagini satellitari | Esri, Maxar, Earthstar Geographics; OpenTopoMap CC-BY-SA |
| Font | Ginto e Ginto Nord (font di marca DRIP, la licenza deve coprirne la distribuzione); Playfair Display e Manrope (OFL); Noto Sans per le etichette mappa (OFL) |
