# DRIP Urban 2.0 — analisi sistematica delle richieste

Data: 3 ottobre 2026. Branch: `urban-2.0`.

Ogni richiesta del committente ha uno stato:
- **Fatto**: funziona ed è coperto da test o da verifica visiva;
- **Parziale**: funziona, ma con limiti dichiarati;
- **Da fare**: non ancora iniziato.

Per ciascuna sono indicati anche dove si trova nell'app, i riferimenti normativi e i limiti.

Test al momento del rilascio:

| Suite | Test superati |
|---|---|
| Core | 41 |
| Web | 14 |
| API | 23 |
| End-to-end | 9, con baseline visive aggiornate alla nuova grafica |

## 1. Grafica e marchio

| Richiesta | Stato | Dove / come |
|---|---|---|
| Mantenere la grafica attuale | Fatto | stesso linguaggio visivo; aggiunti solo token e componenti |
| Tema chiaro | Fatto | interruttore sole/luna nella barra e nel menu utente; preferenza salvata; segue il sistema operativo |
| Colori DRIP | Fatto | presi dai loghi ufficiali: #5587A2, #83B4D1, #D9B3AD, #E8772E; gradiente DRIP su Elios e accenti |
| Font Ginto e Playfair | Fatto | Ginto per l'interfaccia, Ginto Nord per i titoli, Playfair per gli accenti editoriali FST; anche nelle tavole PDF |
| Stesso design system del sito | Parziale | studiodrip.it non è raggiungibile da questo ambiente: i token derivano dai loghi. **Servono i token del sito** (colori, raggi, spaziature) per allinearli al 100% |
| Altezza uniforme di simbolo, logo e "Urban", anche nella home | Fatto | lockup unico con la stessa altezza delle maiuscole; versione grande nella home |
| Loghi FST e DRIP coerenti col tema | Fatto | versioni `-reverse` sul tema scuro |

## 2. Piattaforma DRIP (dettagli in [PLATFORM](PLATFORM.md))

| Richiesta | Stato | Note |
|---|---|---|
| OpenID per Keycloak | Fatto | Authorization Code + PKCE; più provider; mappatura dei ruoli; introspection per i token di altri servizi |
| DRIP ID | Fatto, da configurare | issuer predefinito `id.studiodrip.it/realms/drip`; servono il client registrato e, se previsto, il segreto |
| Abbonamenti | Fatto | piani trial/base/pro/enterprise, funzioni e limiti; claim `drip_*` nel token DRIP ID; 14 giorni offline |
| API per gestire gli abbonamenti dalla piattaforma centrale | Fatto lato app | contratto `/v1/licenses/activate`, `/v1/licenses/validate`. **La piattaforma DRIP deve implementarlo** |
| API pubbliche e integrazioni | Fatto | chiavi `drip_…`, API v1 (progetti, scenari, operazioni, documenti), webhook firmati HMAC con 11 eventi |
| Aggiornamento automatico | Fatto lato app | controllo, download verificato SHA-256, installazione al prossimo avvio dal launcher con backup. **La piattaforma deve pubblicare `/v1/releases/drip-urban/latest`** |
| Accesso locale provvisorio con credenziali admin | Fatto | `admin` / `admin`, cambio obbligatorio al primo accesso, scadenza a 30 giorni |

## 3. Elios (AI)

| Richiesta | Stato | Note |
|---|---|---|
| Chat con API Gemini | Fatto | `gemini-2.5-flash` via server locale (la chiave non arriva al browser); dettatura vocale |
| Grafica sfumata con i colori DRIP | Fatto | pulsante e pannello con gradiente DRIP |
| Capisce le richieste e le esegue | Fatto | 30 strumenti: strade, zone e ZTL con orari, cartelli, arredo, semafori (singoli, corridoi, intera rete), restrizioni camion, corsie preferenziali, navigatore, TPL e bike sharing, marciapiedi, traffico live, segnalazioni FST. Ogni azione è un'operazione annullabile |
| Norme | Fatto | il prompt di sistema include CdS, Regolamento, DM 5/11/2001, DM 19/04/2006 |

**Limite:** serve una chiave Gemini (Impostazioni → Provider). Senza chiave Elios spiega come configurarla.

## 4. Segnaletica, arredo, 3D

| Richiesta | Stato | Note |
|---|---|---|
| Pali con più cartelli uno sotto l'altro | Fatto | un clic su un cartello esistente aggiunge il pannello sotto (Alt crea un palo separato); riordino e rimozione nell'Inspector; avviso art. 81 Reg. CdS oltre due segnali |
| Arredo 3D anche in 2D | Fatto | simbolo in pianta con volume, ombra e scala reale; inclinando la mappa diventa estrusione 3D |
| Import di modelli 3D (stile SketchUp) | Fatto | glTF/GLB per progetto, unità incluse (pollici SketchUp), dimensioni lette dal modello; impronta in 2D e geometria vera nel Twin |
| Pannelli a messaggio variabile | Fatto | PMV a catalogo, testo manuale o automatico dal traffico live (code, incidenti, chiusure entro 2 km) |

**Limite:** l'esportazione da SketchUp va fatta in glTF/GLB (estensione gratuita); il formato `.skp` nativo non è leggibile senza l'SDK proprietario.

## 5. Semafori

| Richiesta | Stato | Note |
|---|---|---|
| Cicli automatici migliori | Fatto | Webster (ciclo ottimo, verdi proporzionali ai flussi), fasi senza conflitti a livello di movimento, verde pedonale a 1 m/s |
| Cicli e direzioni personalizzabili | Fatto | matrice fasi × svolte (lanterne a frecce), trascinamento delle durate, svolte a sinistra permesse o protette |
| Collegare semafori di incroci diversi | Fatto | corridoi coordinati: ciclo comune, offset da distanza e velocità, onda verde a senso unico o doppio, diagramma tempo-spazio |
| Togliere singole lanterne | Fatto | menu contestuale sulla lanterna o elenco nel Signal Studio; i tempi restano invariati |
| Ottimizzare tutti i semafori | Fatto | Traffico → Stima → Rete semaforica, oppure Elios; un'unica operazione annullabile; i corridoi mantengono gli offset |

## 6. Regole di circolazione

| Richiesta | Stato | Note |
|---|---|---|
| ZTL con orari e giorni personalizzabili | Fatto | più fasce per giorno, permessi, finestre di carico/scarico; il navigatore le rispetta |
| Pannelli LED per le ZTL | Fatto | varchi calcolati sul confine della zona; pannello "ZTL attiva / non attiva" in tempo reale; testi personalizzabili |
| Divieti di transito per camion, impostabili | Fatto | massa, altezza, larghezza, lunghezza; divieto mezzi pesanti con fasce orarie e eccezioni; cartello generato |
| Divieti camion importati da OSM | Fatto | `hgv`, `maxweight`, `maxheight`, `maxwidth`, `maxlength`, `:conditional` con opening_hours |
| Corsie preferenziali | Fatto | bus, taxi, bici, con orari; disegnate in mappa; rispettate dal navigatore |

## 7. Rete stradale

| Richiesta | Stato | Note |
|---|---|---|
| La strada che "si contorce" all'incastro | Fatto | gli angoli di incrocio restano coerenti con i cordoli; se la geometria si autointerseca si ripiega su un inviluppo sicuro; i nuovi tratti terminano esattamente sui nodi |
| Agganciare strade non collegate senza modificarle | Fatto | Rete → Aggancia strade: trova estremi liberi e nodi sovrapposti e li unisce senza spostare la geometria; snap entro 6 m mentre si disegna o si trascina |
| Navigatore a tre punti | Fatto | origine, tappe intermedie, destinazione; profili auto, camion, bus, bici, a piedi, emergenza |
| Intersezioni migliori | Fatto | vedi sopra, più Junction Lab con conflitti a livello di movimento |

## 8. Marciapiedi

| Richiesta | Stato | Note |
|---|---|---|
| Importazione automatica | Fatto | al primo avvio del progetto, da OSM (`sidewalk=*` e marciapiedi disegnati) |
| Dove mancano dati: percorsi pedonali o stima | Fatto | stati: dato OSM, percorso pedonale vicino, stimato, spazio insufficiente, extraurbano. La stima usa le facciate degli edifici entro 30 m e il DM 5/11/2001 |
| Attivare e disattivare la stima senza modificare la strada | Fatto | sovrapposizione separata, interruttore per strada e globale |

## 9. Mobilità e trasporto pubblico

| Richiesta | Stato | Note |
|---|---|---|
| Metro, treno, tram, bus, BRT, filobus, traghetto, a chiamata | Fatto | valori di riferimento per modo (capacità, velocità, costi) |
| Frequenze e stime | Fatto | fasce orarie, flotta necessaria, km e costi annui, bacino d'utenza dagli edifici, passeggeri stimati, CO₂ evitata; linee che seguono le strade |
| Bike sharing | Fatto | stazioni con stalli, copertura a 300 m, proposta automatica dei siti |
| Traffico live e cartelli | Fatto | aggiornamento automatico (2–10 min e allo spostamento della mappa), incidenti e chiusure HERE, PMV automatici |

**Limite:** il traffico live richiede una chiave HERE. Senza chiave non viene mostrato alcun dato "live" inventato.

## 10. Scala e normativa

| Richiesta | Stato | Note |
|---|---|---|
| Città grandi (Roma, New York, Londra) | Fatto | import OSM a tasselli da 16 km² con ripresa, fino a 2.000 km²; limiti legati all'abbonamento; stima di area e tempi |
| Algoritmi di ottimizzazione | Fatto | aggiornamento incrementale del modello fisico (solo le parti cambiate); indice spaziale; Webster di rete; DP e buffer per le zone |
| Mappa tecnica regolamentare dei comuni | Parziale | basemap "Carta tecnica" in stile CTR; export DXF in UTM con layer in italiano (per Civil 3D e AutoCAD); tavola PDF A3 con cartiglio. **Manca il collegamento ai WMS ufficiali** delle CTR/DBT regionali (ad es. Regione Campania), da aggiungere quando ne verranno forniti gli indirizzi |
| Adeguamento alle normative | Parziale | controlli e richiami nell'interfaccia su CdS e Regolamento (artt. 7, 41, 78, 81), DM 5/11/2001 e DM 19/04/2006; Elios conosce anche il DM 236/1989 (accessibilità). Non sostituisce la verifica del progettista |

## 11. Frattamaggiore Si Trasforma

| Richiesta | Stato | Note |
|---|---|---|
| Integrazione migliore | Fatto | segnalazioni filtrate sull'area del progetto, ricerca e categorie, "seleziona la strada", attività di progetto con stato e note, pubblicazioni collegate alle segnalazioni (`reportIds` nel webhook), portale configurabile per altri comuni, strumenti di Elios |

**Limite:** FST espone solo API di lettura. Il ritorno verso il portale passa dal webhook `publication.created`, che il plugin FST deve ricevere.

## 12. Bug e qualità

| Problema | Stato |
|---|---|
| `from __future__ imports must occur at the beginning of the file (overpass.py)` | Corretto |
| Tasti che non si premono | Corretti: il pulsante di Elios era coperto da una regola dei tooltip; i pannelli si chiudevano da soli (toggle al posto di apertura); la modalità Civico metteva il pannello a sinistra e lasciava la mappa nera; la barra superiore sforava sotto i 1100 px |
| Ciclo infinito di React (#185) in un selettore | Corretto |
| ZTL attorno a una strada enormi | Corretto (buffer reale invece dell'inviluppo convesso) |
| Parcheggi marcati "divieto" da OSM | Corretto |
| Camion senza percorso nel navigatore | Corretto |
| Linee TPL perse durante il caricamento | Corretto |

## 13. "Più potente di Civil 3D + InfraWorks + SketchUp": cosa manca ancora

DRIP Urban 2.0 copre bene:
- la pianificazione e il progetto preliminare dello spazio stradale;
- il traffico e la regolazione;
- il TPL;
- la comunicazione civica.

Per arrivare all'esecutivo come Civil 3D servono ancora:

1. **Altimetria:** DTM (dati LiDAR del MASE o regionali), profili longitudinali, livellette, sezioni con scavi e riporti.
2. **Computo metrico:** quantità per materiale e prezziari regionali.
3. **Formati BIM/GIS:** IFC 4.3 (infrastrutture), LandXML, DWG nativo (oggi DXF R12).
4. **Modellazione 3D libera stile SketchUp:** spingi/tira, gruppi. Oggi si importano modelli già pronti.
5. **Collaborazione in tempo reale tra più utenti sullo stesso scenario.** Oggi c'è il controllo delle revisioni con rebase.
6. **WMS ufficiali** delle carte tecniche regionali e del catasto (Agenzia delle Entrate).

Ordine consigliato: 6 → 1 → 2 → 3 → 5 → 4.

## 14. Configurazione necessaria da parte di DRIP

1. **Token del design system del sito** (studiodrip.it non è raggiungibile da qui).
2. **Chiave Gemini**, per Elios.
3. **Client OIDC su DRIP ID:**
   - redirect `…/api/auth/oidc/callback`;
   - ruoli `drip-urban-*`;
   - claim `drip_plan`, `drip_features`, `drip_valid_until`.
4. **Endpoint della piattaforma:** `/v1/licenses/activate`, `/v1/licenses/validate`, `/v1/releases/drip-urban/latest`.
5. **Chiave HERE**, per traffico live, incidenti e PMV automatici.
6. **Lato FST:** ricevitore del webhook `publication.created`, per collegare le pubblicazioni alle segnalazioni.
