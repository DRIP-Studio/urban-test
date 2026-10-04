# DRIP Urban 2.0: confronto con InfraWorks e Civil 3D

Aggiornato il 2026-10-04. La tabella dice dove si trova ogni funzione e con quale stato. Non dice che le funzioni sono uguali a quelle di InfraWorks o di Civil 3D.

DRIP Urban è pensato per la progettazione urbana italiana: Codice della Strada, DM 5/11/2001, DM 1444/68, PGTU e PUMS. Per questo ha alcune funzioni che InfraWorks e Civil 3D non hanno (semafori, ZTL, normativa). Non ha però la modellazione libera di solidi e superfici, esclusa su richiesta.

Stati:
- **Sì**: disponibile e con test.
- **Parziale**: c'è, ma con i limiti indicati.
- **No**: non c'è.

## Modello, terreno, dati

| Funzione (InfraWorks / Civil 3D) | DRIP Urban | Stato |
|---|---|---|
| Modello della città da dati aperti (Model Builder) | Rete stradale, edifici, contesto e arredo da OSM, per qualsiasi comune | Sì |
| Terreno (DEM, superfici TIN) | DTM Copernicus GLO-90 o LiDAR `.asc`, nel profilo e nel Twin. Export LandXML TIN | Sì |
| Nuvole di punti, 3D Tiles fotogrammetrici | — | No |
| Carte e immagini (WMS, catasto) | WMS configurabili, catasto AdE, ortofoto | Sì |
| Import modelli 3D | glTF/GLB. Alla posa vengono demoliti gli edifici e rimossi gli arredi sotto l'ingombro | Sì |
| Proposte / scenari | Scenari con cronologia, confronto e fusione | Sì |
| Storyboard e presentazioni | Modalità *Presenta*, inquadrature del Twin salvate | Sì |

## Strade e corridoi

| Funzione | DRIP Urban | Stato |
|---|---|---|
| Strade parametriche con sezione tipo (assemblies) | Sezioni con corsie, marciapiedi, sosta, ciclabili, spartitraffico e cordoli. Modelli DM 2001 | Sì |
| Allineamenti orizzontali (report) | Rettifili e curve con raggio e deviazione. Verifiche § 5.2: raggio minimo, sviluppo, rettifili, successione dei raggi, visibilità in curva | Parziale: le clotoidi vengono verificate, non progettate |
| Profilo longitudinale, livellette, raccordi | Vertici trascinabili, raccordi parabolici, proposta automatica, verifiche § 5.3 | Sì |
| Sezioni trasversali, sterri e riporti | Sezioni con scarpate, volumi per aree medie, scarpate nel Twin | Sì |
| Sopraelevazione | Valore dall'abaco per ogni curva, nel report | Parziale: non è applicata alla superficie |
| Incroci e rotatorie | Junction Lab (conflitti, svolte, regolazione), rotatorie parametriche, incroci rialzati | Sì |
| Viadotti, ponti, gallerie | Struttura della strada con altezza, livello e pile. Da tag OSM o manuale | Sì |
| Segnaletica orizzontale e verticale | Ogni tipo del Reg. CdS, automatica e personalizzata. 243 segnali verticali, pali multipli | Sì |
| Moderazione del traffico | Dossi (limiti art. 179), piattaforme, attraversamenti rialzati, cuscini, bande | Sì |
| Movimenti terra e computo | Computo metrico estimativo con prezziario regionale | Sì |

## Reti e impianti

| Funzione | DRIP Urban | Stato |
|---|---|---|
| Reti a gravità (Pipe Networks) | Caditoie, pozzetti, scarichi e condotte. Metodo razionale, curve di possibilità pluviometrica, Gauckler-Strickler, dimensionamento DN, profilo | Sì |
| Reti in pressione | — | No |
| Analisi dei bacini | Superfici scolanti dal modello fisico, assegnate alla caditoia più vicina | Parziale: non usa le linee di displuvio del DTM |
| Impianti semaforici | Piani, fasi, lanterne, coordinamento a banda verde, impianti uniti | Sì: assente nei due prodotti Autodesk |

## Mobilità e pianificazione

| Funzione | DRIP Urban | Stato |
|---|---|---|
| Simulazione del traffico (InfraWorks Traffic) | Stima dei flussi, microsimulazione DRIP Flow, traffico live | Sì |
| Trasporto pubblico | GTFS, linee, fermate, frequenze, bike sharing | Sì |
| Piano urbanistico | Import PUC/PRG, standard DM 1444/68, conformità dell'edificato, vincoli e fasce di rispetto | Sì |
| Piano del traffico e PUMS | Classificazione funzionale, isole ambientali, indicatori PUMS | Sì |
| Verifiche normative | Libreria delle norme con articoli e verifiche di conformità sullo scenario | Sì: assente nei due prodotti Autodesk |
| Suggerimenti di progetto | *Prossimi passi* dopo ogni modifica, con norma e azione | Sì |

## Interoperabilità

| Formato | Stato |
|---|---|
| IFC 4.3 georeferenziato | Sì |
| LandXML 1.2: assi, profili, TIN | Sì |
| DXF | Sì |
| DWG nativo | No: si usano DXF, IFC e LandXML |
| Shapefile e GeoJSON per il piano urbanistico | Sì: in import |
