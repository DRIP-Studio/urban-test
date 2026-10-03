# Piattaforma DRIP — contratto di integrazione (DRIP Urban 2.0)

DRIP Urban è un programma locale che dipende dalla piattaforma centrale DRIP per quattro cose:
- **identità**: DRIP ID e Keycloak, con OpenID Connect;
- **abbonamenti e licenze**;
- **aggiornamenti**;
- **integrazioni**: API e webhook.

Se la piattaforma non risponde, il programma continua a funzionare:
- l'ultima licenza valida resta usabile per 14 giorni;
- l'accesso locale resta disponibile;
- gli aggiornamenti attendono.

Configurazione: **Impostazioni → Account, licenza e integrazioni**, salvata in `settings/platform.json` nella cartella dati.

| Variabile d'ambiente | Effetto |
|---|---|
| `DRIP_PLATFORM_URL` | indirizzo della piattaforma; predefinito `https://api.studiodrip.it` |
| `DRIP_URBAN_AUTH` | `protected` (predefinito, richiede l'accesso) oppure `open` (postazione singola senza login, come la 1.0) |
| `DRIP_ID_ISSUER`, `DRIP_ID_CLIENT_ID`, `DRIP_ID_CLIENT_SECRET` | client OIDC di DRIP ID |
| `DRIP_FST_URL` | portale civico; predefinito Frattamaggiore Si Trasforma |

## 1. Identità: DRIP ID e Keycloak

- **Flusso:** OpenID Connect Authorization Code con PKCE (S256), `state` e `nonce`.
- **Token:** l'`id_token` arriva dal token endpoint su TLS, insieme a `userinfo`.
- **Provider preconfigurati:**
  - **DRIP ID**, issuer `https://id.studiodrip.it/realms/drip`, client `drip-urban`;
  - **Keycloak dell'ente**, disattivato finché non si inserisce l'issuer.

**Configurazione del client Keycloak:**
- Client ID: `drip-urban`, confidenziale o pubblico (con PKCE il segreto è facoltativo).
- Valid redirect URI: `http://127.0.0.1:8765/api/auth/oidc/callback`. Su un server, l'equivalente con il suo indirizzo.
- Scope: `openid profile email`.

**Ruoli.** I ruoli vengono letti da `realm_access.roles`, `resource_access.<client>.roles` e `groups`, poi mappati così:

| Ruolo Keycloak | Ruolo DRIP Urban |
|---|---|
| `drip-urban-admin`, `admin` | admin |
| `drip-urban-publisher`, `publisher` | publisher |
| `drip-urban-editor`, `editor`, `planner` | editor |
| `drip-urban-viewer`, `viewer` | viewer |

Chi non ha un ruolo mappato riceve il ruolo predefinito (editor). La mappatura è modificabile in Impostazioni.

**Token bearer da altri servizi DRIP.** Un `Authorization: Bearer <access token>` emesso dall'issuer viene verificato con l'introspection RFC 7662.

**Abbonamento nel token DRIP ID.** Il token può portare i claim seguenti; il programma li usa quando non è stata attivata una chiave di licenza:
- `drip_plan`;
- `drip_features` (array);
- `drip_valid_until` (ISO 8601);
- `drip_customer`.

### Accesso locale provvisorio

Al primo avvio esiste l'utente **admin / admin**:
- è obbligatorio cambiare la password al primo accesso;
- l'account scade dopo 30 giorni.

Il launcher Windows stampa queste credenziali nella console. Le password locali sono salvate con PBKDF2-SHA256, 310.000 iterazioni. L'amministratore crea altri utenti locali da Impostazioni → Utenti.

## 2. Abbonamenti e licenze

### Piani

| Piano | Funzioni | Limiti |
|---|---|---|
| `trial` | tutte, per 30 giorni dal primo avvio | 5 progetti, 400 km² |
| `base` | design, analyze, traffic, twin, civic | 10 progetti, 25 km² |
| `pro` | tutte tranne largeCity e multiUser | 100 progetti, 400 km² |
| `enterprise` | tutte | nessun limite |

### Funzioni

| Codice | Funzione |
|---|---|
| `design` | progettazione |
| `analyze` | analisi |
| `traffic` | traffico |
| `transit` | TPL |
| `twin` | twin 3D |
| `civic` | civico |
| `elios` | AI |
| `api` | API e webhook |
| `models3d` | modelli 3D |
| `largeCity` | città grandi |
| `liveTraffic` | traffico live |
| `multiUser` | multiutente |

### Applicazione dei limiti

- **`soft`** (predefinito): una licenza scaduta mostra soltanto un avviso.
- **`strict`**: le funzioni fuori piano rispondono `402`.

### Endpoint che la piattaforma deve esporre

```
POST {platformUrl}/v1/licenses/activate
  { "key": "…", "deviceId": "…", "product": "drip-urban", "version": "2.0.0", "usage": { "projects": 3 } }

POST {platformUrl}/v1/licenses/validate
  { "token": "…", "deviceId": "…", "product": "drip-urban", "version": "2.0.0", "usage": { … } }

→ 200 { "plan": "pro", "status": "active", "validUntil": "2027-10-01T00:00:00Z", "seats": 5,
        "features": ["design", …], "limits": { "projects": 100, "areaKm2": 400 },
        "token": "<token di rinnovo>", "customer": "Comune di …" }
→ 4xx { "message": "…" }   (il messaggio viene mostrato all'utente)
```

`deviceId` è un identificativo anonimo e stabile dell'installazione, salvato in `settings/device.json`.

### Endpoint locali

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /api/license` | stato della licenza |
| `POST /api/license/activate` | attiva con `{key}` |
| `POST /api/license/refresh` | aggiorna dalla piattaforma |
| `POST /api/license/deactivate` | disattiva |

## 3. Aggiornamenti automatici

```
GET {platformUrl}/v1/releases/drip-urban/latest?channel=stable&current=2.0.0&os=windows
→ 200 { "version": "2.1.0", "notes": "…", "url": "https://…/drip-urban-2.1.0.zip",
        "sha256": "<hex>", "size": 123456, "mandatory": false, "publishedAt": "…" }
```

**Ciclo di un aggiornamento:**
1. Il controllo parte all'avvio, se `updates.autoCheck` è attivo, oppure da Impostazioni → Aggiornamenti.
2. Il pacchetto, uno zip con la struttura del repository, viene scaricato in `<dati>/updates/` e verificato con SHA-256.
3. **Installa al prossimo avvio** scrive `pending.json`.
4. Al riavvio, `Avvia DRIP Urban.bat`:
   - verifica di nuovo l'hash;
   - fa un backup zip;
   - estrae il pacchetto senza toccare `.venv`, `.git`, `node_modules` e i dati;
   - aggiorna le dipendenze Python.

**Endpoint locali:**

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /api/update` | stato degli aggiornamenti |
| `POST /api/update/check` | controlla se c'è una nuova versione |
| `POST /api/update/download` | scarica il pacchetto |
| `POST /api/update/apply` | prepara l'installazione al prossimo avvio |

## 4. API pubblica v1 e chiavi

**Chiavi.** Si creano in Impostazioni → API e webhook:
- formato: `drip_<id>_<segreto>`;
- vengono mostrate una sola volta e si salva solo lo SHA-256;
- ruolo: viewer, editor o admin.

Si usano con `Authorization: Bearer drip_…`.

| Metodo e percorso | Ruolo | Descrizione |
|---|---|---|
| `GET /api/v1/info` | viewer | versione, licenza, funzioni |
| `GET /api/v1/projects` | viewer | elenco dei progetti |
| `GET /api/v1/projects/{pid}` | viewer | metadati e scenari |
| `GET /api/v1/projects/{pid}/scenarios/{sid}` | viewer | scenario con le operazioni |
| `POST /api/v1/projects/{pid}/scenarios/{sid}/operations` | editor | aggiunge 1–500 operazioni in coda allo scenario: `{ "operations": [{ "type": "road.update", "payload": {…} }] }` |
| `GET /api/v1/projects/{pid}/docs/{name}` | viewer | documenti di progetto (transit, sidewalks, mobility, civic…) |

Il server controlla la forma di ogni operazione e risponde `400` se non è valida. La validazione di dominio è la stessa dell'interfaccia e avviene quando lo scenario viene ricalcolato: un'operazione che non si applica compare tra quelle fallite nella postazione e non viene mai scartata in silenzio. La documentazione OpenAPI completa è su `/docs` del server locale.

## 5. Webhook

Ogni evento viene inviato con `POST` JSON, con questi header:
- `X-Drip-Event: <evento>`;
- `X-Drip-Signature: sha256=<HMAC-SHA256 del corpo grezzo con il segreto del webhook>`.

Si fanno 3 tentativi con attesa crescente. L'esito dell'ultimo invio è visibile in Impostazioni.

```json
{ "event": "publication.created", "at": "2026-10-03T10:00:00+00:00", "product": "drip-urban", "version": "2.0.0",
  "data": { "projectId": "p-…", "author": "…", "publication": "pub-…", "scenarioId": "…", "title": "…",
            "status": "proposta", "reportIds": [1234, 1240], "portal": "https://frattamaggioresitrasforma.studiodrip.it" } }
```

**Eventi:**

| Ambito | Eventi |
|---|---|
| Progetti | `project.created`, `project.updated`, `project.archived` |
| Scenari | `scenario.created`, `scenario.saved`, `scenario.deleted` |
| Snapshot | `snapshot.created` |
| Pubblicazioni | `publication.created`, `publication.withdrawn` |
| Licenza | `license.changed` |
| Elios | `elios.action` |

**Uso con FST.** In `publication.created`, `reportIds` contiene le segnalazioni di Frattamaggiore Si Trasforma a cui lo scenario risponde. Il portale può collegarle alla pubblicazione senza che DRIP Urban scriva nel plugin.

## 6. Verifica della firma (esempio)

```python
import hashlib, hmac
def valid(body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```
