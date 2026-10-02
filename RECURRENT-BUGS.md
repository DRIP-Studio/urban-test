# RECURRENT-BUGS — DRIP Urban

Bug tornati in più release 4x–53. Uno è chiuso solo quando c'è un **test di comportamento** che lo copre (nessun test sul testo del sorgente). Aggiornato il 2026-10-02.

| ID | Bug | Prevenzione strutturale in 1.0 | Test di regressione | Stato |
|---|---|---|---|---|
| RB-01 | Marker che si spostano durante lo zoom | Asset statici = layer GPU (symbol), nessun marker DOM | `e2e/assets.spec.ts`: il cartello è renderizzato sulla sua coordinata a zoom 17 → 18,5 → 20 → 17; 0 `.maplibregl-marker` | **chiuso** |
| RB-02 | Asset finiti in alto a sinistra | Asset da GeoJSON validato, coordinate obbligatorie a livello di tipo | stesso test: posizione proiettata fuori dall'angolo 40×40 px a ogni zoom | **chiuso** |
| RB-03 | Cunei/trapezi nelle rotatorie | Grafo di routing separato dalla geometria; gole tangenti limitate dai bracci vicini | `core/test/physical.test.ts`: anello con foro, 4 gole senza auto-intersezioni | **chiuso** |
| RB-04 | Segnaletica orizzontale inventata | Nessun marking oltre a quelli derivati da sezione e regolazione esplicita | `physical.test.ts`: nessuna linea di arresto senza regolazione; rotatoria nuova senza zebre né linee d'anello | **chiuso** |
| RB-05 | Frecce di senso che spariscono | Frecce derivate dalle corsie nel modello fisico, layer unico | `physical.test.ts`: ogni corsia a senso unico > 12 m ha una freccia | **chiuso** (verifica di rendering per zoom non automatizzata) |
| RB-06 | Asset mancanti nel Twin | Twin legge lo stesso modello fisico | `e2e/views.spec.ts` e `assets.spec.ts`: "Parità 2D/3D: n/n" | **chiuso** |
| RB-07 | Cartelli sovrapposti nel Twin | Alt+clic aggiunge un pannello allo stesso palo (`poleId`, `stackOrder`); il Twin impila i pannelli | `assets.spec.ts`: 2 pannelli, 1 palo, ordini 0 e 1, parità 2D/3D | **chiuso** |
| RB-08 | Pulsanti morti | Strumenti e comandi solo da registro | `web/test/registries.test.ts`: ogni strumento ha handler, scorciatoia unica e suggerimento; ogni comando ha `run` | **chiuso** |
| RB-09 | Traffico vuoto | Stima DRIP sempre disponibile, etichettata "Stimato" | `assets.spec.ts`: senza chiavi il layer traffico ha > 100 elementi e il badge "Stimato" | **chiuso** |
| RB-10 | Heatmap vuota | Screening sicurezza calcolato all'apertura del pannello | `assets.spec.ts`: heatmap con ≥ 1 punto e dicitura "surrogato" | **chiuso** |
| RB-11 | Catalogo materiali vuoto | Catalogo statico nel pacchetto assets | `registries.test.ts`: ≥ 17 materiali con colore e categoria, almeno uno permeabile | **chiuso** |
| RB-12 | Pannelli tagliati / sovrapposti | Shell a griglia, griglie fluide nei pannelli, niente `!important` | `views.spec.ts`: dock senza scorrimento orizzontale (Junction Lab), nessun overflow di pagina a 1024 px; baseline visive a 1440 e 1024 | **parziale**: 1366/1600/1920 non ancora nelle baseline |
| RB-13 | Branding disallineato | Lockup SVG con varianti normali e reverse | baseline `hub-head.png`, header in tutte le schermate e2e | **parziale**: SVG ricavati dai PNG (P1-01) |
