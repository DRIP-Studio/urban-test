# RECURRENT-BUGS — DRIP Urban

Bug che sono tornati in più release 4x–53. Ognuno avrà un **test di comportamento** (non sul testo del sorgente) prima della chiusura.

| ID | Bug | Causa radice (audit 53.0) | Prevenzione strutturale in 1.0 | Test di regressione | Stato |
|---|---|---|---|---|---|
| RB-01 | Marker che si spostano durante lo zoom | Trasformazioni CSS e collision solver in coordinate schermo sul contenitore del marker | Asset statici = layer GPU (symbol/model), non marker DOM. Marker DOM solo per maniglie di editing; mai `transform` sulla radice | E2E: posiziona asset, zoom 14→20→14, `map.project(anchor)` coincide con centro icona ±1 px | aperto |
| RB-02 | Asset che finiscono in alto a sinistra | Marker creati prima del layout / senza `setLngLat` valido | Asset renderizzati da dati GeoJSON validati; coordinate obbligatorie a livello di tipo | Unit: asset senza ancora rifiutato; E2E: nessun asset in (0..40, 0..40) px | aperto |
| RB-03 | Cunei/trapezi nelle rotatorie | Accessi tagliati a mano + `roundabout_throat`; geometria di visualizzazione mescolata al grafo | Grafo di routing e geometria fisica separati; raccordi tangenti con fillet calcolati da offset delle linee di bordo | Core: per ogni braccio, angolo bordo/anello ≤ 3° al punto di tangenza; nessuna auto-intersezione nei poligoni | aperto |
| RB-04 | Segnaletica orizzontale generata a caso | Auto-marking in `road_canvas.py` con eccezioni per rotatorie | Nessun marking automatico oltre linee di corsia della sezione; tutto il resto è asset esplicito | Core: rotatoria nuova → 0 attraversamenti, 0 zebrature, 0 separatori di approccio | aperto |
| RB-05 | Frecce di senso che spariscono | Regole LOD diverse per percorso di codice | Frecce derivate dal LaneModel nel Physical Model, layer unico con LOD dichiarato | E2E: a zoom ≥ 17 ogni corsia a senso unico visibile ha ≥ 1 freccia renderizzata | aperto |
| RB-06 | Asset mancanti nel Twin | Secondo renderer in `earth3d.html` | Twin legge lo stesso Physical Model | Parità: insieme id asset 2D == insieme id asset 3D | aperto |
| RB-07 | Cartelli sovrapposti nel Twin | Più cartelli sullo stesso punto senza palo comune | Composer palo: più pannelli su un palo, offset verticale calcolato | Core: cartelli entro 0,5 m → stesso palo, nessuna sovrapposizione di bbox 3D | aperto |
| RB-08 | Pulsanti morti | Pulsanti in HTML senza handler o con handler condizionati | Tool/azioni solo da registro; un pulsante senza azione registrata non compila | Unit: ogni voce di registro ha handler; E2E: click su ogni tool cambia stato | aperto |
| RB-09 | Traffico vuoto | Provider senza chiave → nessun fallback visibile | Catena provider con stato esplicito; fallback "stimato" sempre disponibile | E2E senza chiavi: layer traffico popolato, badge "stimato" | aperto |
| RB-10 | Heatmap vuota | Layer creato senza dati o con pesi a zero | Heatmap disponibile solo se ha dati; altrimenti empty state con motivo | E2E: heatmap sicurezza con ≥ 1 punto; senza dati → messaggio | aperto |
| RB-11 | Catalogo materiali vuoto | Caricamento asincrono non atteso | Catalogo statico nel pacchetto assets, validato in build | Unit: ≥ 17 materiali richiesti (§63) presenti con preview | aperto |
| RB-12 | Pannelli tagliati / sovrapposti | CSS stratificato con `!important` | Layout a griglia della shell con aree dichiarate; un solo pannello inferiore alla volta | Visual: 8 viste a 1366×768, 1600×950, 1920×1080 senza overflow | aperto |
| RB-13 | Branding disallineato | Logo raster ridotto, nessun lockup definito | Componente Lockup con regole di spazio di rispetto e 3 breakpoint (§121) | Visual: header a 3 larghezze | aperto |
