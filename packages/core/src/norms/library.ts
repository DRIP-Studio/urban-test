/**
 * Normative library: Italian (and EU) regulations used in road and urban design.
 *
 * Every entry is a reference, not a legal text: titles, dates and article summaries are one-line
 * reminders for the designer, who must always read the official consolidated text (testo vigente).
 * URLs are given only where the official URN pattern is certain (Normattiva `uri-res/N2Ls`,
 * EUR-Lex ELI); entries without a reliable official link have no `url`.
 * Article numbers are cited only where known; otherwise ranges or chapters are given generically.
 */

export type NormKind = 'legge' | 'dlgs' | 'dpr' | 'dm' | 'direttiva_min' | 'lr' | 'ue' | 'uni' | 'cam';

export type NormTopic =
  | 'strade' | 'segnaletica' | 'intersezioni' | 'ciclabilita' | 'accessibilita' | 'pianificazione' | 'urbanistica'
  | 'edilizia' | 'appalti' | 'strutture' | 'cantieri' | 'paesaggio' | 'ambiente' | 'illuminazione' | 'verde'
  | 'arredo' | 'sicurezza' | 'rumore' | 'sosta' | 'ztl';

export type NormStatus = 'vigente' | 'vigente_modificato' | 'norma_tecnica';

export interface NormArticle {
  /** e.g. "art. 7 c. 9", "§ 8.2.1", "Tab. 3.4.a", "artt. 137–155". */
  readonly ref: string;
  readonly summary: string;
}

export interface Norm {
  readonly id: string;
  /** Short citation, e.g. "D.Lgs. 285/1992". */
  readonly short: string;
  /** Common name, e.g. "Codice della Strada". */
  readonly name: string;
  readonly title: string;
  readonly issuer: string;
  /** ISO date of the act (YYYY-MM-DD); year only for technical standards. */
  readonly date: string;
  readonly number?: string;
  readonly kind: NormKind;
  readonly scope: string;
  readonly topics: readonly NormTopic[];
  readonly status: NormStatus;
  /** Amendments and caveats, in general terms. */
  readonly statusNote?: string;
  readonly articles: readonly NormArticle[];
  /** Official source (Normattiva / EUR-Lex). Omitted when the exact official link is not certain. */
  readonly url?: string;
}

const NIR = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:';

export const NORMS: readonly Norm[] = [
  // ---------------------------------------------------------------- Codice della Strada e Regolamento
  {
    id: 'cds', short: 'D.Lgs. 285/1992', name: 'Codice della Strada',
    title: 'Decreto legislativo 30 aprile 1992, n. 285 — Nuovo codice della strada',
    issuer: 'Stato', date: '1992-04-30', number: '285', kind: 'dlgs',
    scope: 'Classificazione delle strade, regolamentazione della circolazione, segnaletica, norme di comportamento e sanzioni.',
    topics: ['strade', 'segnaletica', 'sicurezza', 'ztl', 'ciclabilita', 'sosta'],
    status: 'vigente_modificato',
    statusNote: 'Modificato più volte; da ultimo in modo esteso dalla L. 25 novembre 2024 n. 177 (sicurezza stradale: norme di comportamento, sanzioni, micromobilità, controllo della velocità). Consultare sempre il testo vigente.',
    url: `${NIR}stato:decreto.legislativo:1992-04-30;285`,
    articles: [
      { ref: 'art. 2', summary: 'Classificazione delle strade: A autostrade, B extraurbane principali, C extraurbane secondarie, D urbane di scorrimento, E urbane di quartiere, F locali (con le categorie E-bis e F-bis introdotte da modifiche successive).' },
      { ref: 'art. 3', summary: 'Definizioni stradali e di traffico: area pedonale, centro abitato, corsia e pista ciclabile, zona a traffico limitato, zona residenziale, zona scolastica, ecc.' },
      { ref: 'art. 6', summary: 'Regolamentazione della circolazione fuori dei centri abitati (ordinanze dell\'ente proprietario).' },
      { ref: 'art. 7', summary: 'Regolamentazione della circolazione nei centri abitati: ordinanze del sindaco, sosta, corsie riservate.' },
      { ref: 'art. 7 c. 9', summary: 'Zone a traffico limitato e aree pedonali istituite con deliberazione della giunta comunale; accessi controllabili con impianti elettronici.' },
      { ref: 'art. 14', summary: 'Poteri e compiti degli enti proprietari: manutenzione, gestione e pulizia delle strade, apposizione della segnaletica.' },
      { ref: 'art. 36', summary: 'Piani urbani del traffico (PUT) obbligatori per i comuni con popolazione superiore a 30.000 abitanti e per quelli individuati dalla Regione.' },
      { ref: 'art. 37', summary: 'Apposizione e manutenzione della segnaletica a cura degli enti proprietari.' },
      { ref: 'art. 38', summary: 'Segnaletica stradale: tipi (verticale, orizzontale, luminosa, complementare) e prevalenza delle segnalazioni.' },
      { ref: 'art. 39', summary: 'Segnali verticali: pericolo, prescrizione, indicazione.' },
      { ref: 'art. 40', summary: 'Segnali orizzontali: strisce, attraversamenti, frecce, iscrizioni.' },
      { ref: 'art. 41', summary: 'Segnali luminosi: lanterne semaforiche veicolari, pedonali e ciclabili.' },
      { ref: 'art. 42', summary: 'Segnali complementari: dispositivi di rallentamento, delineatori, isole di traffico.' },
      { ref: 'art. 43', summary: 'Segnalazioni degli agenti del traffico.' },
      { ref: 'art. 44', summary: 'Passaggi a livello.' },
      { ref: 'art. 45', summary: 'Uniformità della segnaletica, mezzi di regolazione e controllo, omologazioni.' },
      { ref: 'art. 140', summary: 'Principio informatore della circolazione.' },
      { ref: 'art. 141', summary: 'Velocità: regolazione da parte del conducente in relazione alle condizioni.' },
      { ref: 'art. 142', summary: 'Limiti di velocità: 130 autostrade, 110 extraurbane principali, 90 extraurbane secondarie e locali, 50 km/h nei centri abitati (elevabile fino a 70 km/h su strade urbane con caratteristiche idonee).' },
      { ref: 'art. 143', summary: 'Posizione dei veicoli sulla carreggiata.' },
      { ref: 'art. 144', summary: 'Circolazione dei veicoli per file parallele.' },
      { ref: 'art. 145', summary: 'Precedenza alle intersezioni.' },
      { ref: 'art. 146', summary: 'Violazione della segnaletica stradale.' },
      { ref: 'art. 182', summary: 'Circolazione dei velocipedi.' },
      { ref: 'art. 188', summary: 'Circolazione e sosta dei veicoli al servizio di persone con disabilità.' },
      { ref: 'art. 190', summary: 'Comportamento dei pedoni.' },
      { ref: 'art. 191', summary: 'Comportamento dei conducenti verso i pedoni (precedenza sugli attraversamenti).' },
      { ref: 'art. 208', summary: 'Proventi delle sanzioni: quota vincolata a sicurezza stradale, segnaletica e mobilità sostenibile.' },
    ],
  },
  {
    id: 'reg-cds', short: 'DPR 495/1992', name: 'Regolamento del Codice della Strada',
    title: 'Decreto del Presidente della Repubblica 16 dicembre 1992, n. 495 — Regolamento di esecuzione e di attuazione del nuovo codice della strada',
    issuer: 'Presidente della Repubblica', date: '1992-12-16', number: '495', kind: 'dpr',
    scope: 'Norme tecniche della segnaletica (forme, dimensioni, colori, installazione), cantieri, attraversamenti.',
    topics: ['segnaletica', 'cantieri', 'sicurezza'],
    status: 'vigente_modificato',
    statusNote: 'Modificato più volte (tra cui DPR 610/1996). Le figure dei segnali sono negli allegati al Titolo II.',
    url: `${NIR}presidente.repubblica:decreto:1992-12-16;495`,
    articles: [
      { ref: 'artt. 30–43', summary: 'Segnalamento temporaneo di cantieri e lavori stradali (attuazione art. 21 CdS).' },
      { ref: 'artt. 77–83', summary: 'Segnali verticali: norme generali, visibilità, dimensioni, installazione, pannelli integrativi.' },
      { ref: 'art. 79', summary: 'Visibilità dei segnali: spazi di avvistamento in funzione della velocità.' },
      { ref: 'art. 81', summary: 'Installazione dei segnali verticali: posizione rispetto alla carreggiata, altezza del bordo inferiore, numero di segnali per sostegno (di norma non più di due, oltre ai pannelli integrativi).' },
      { ref: 'art. 83', summary: 'Pannelli integrativi (distanza, estesa, eccezioni, orari).' },
      { ref: 'art. 84', summary: 'Segnali di pericolo: installazione prima del punto di pericolo, di norma a 150 m fuori dai centri abitati, distanze diverse nei centri abitati o con pannello di distanza.' },
      { ref: 'art. 135', summary: 'Segnali utili per la guida, tra cui zona a traffico limitato (fig. II.322), area pedonale, zona residenziale.' },
      { ref: 'artt. 137–155', summary: 'Segnaletica orizzontale: strisce longitudinali e trasversali, attraversamenti, frecce, stalli, colori e materiali.' },
      { ref: 'art. 145', summary: 'Attraversamenti pedonali: zebrature parallele all\'asse; larghezza non inferiore a 2,50 m sulle strade locali e urbane di quartiere e a 4 m sulle altre.' },
      { ref: 'art. 146', summary: 'Attraversamenti ciclabili.' },
      { ref: 'art. 149', summary: 'Strisce di delimitazione degli stalli di sosta.' },
      { ref: 'artt. 158 e segg.', summary: 'Segnali luminosi: lanterne semaforiche veicolari, pedonali e ciclabili, tempi e installazione.' },
    ],
  },
  {
    id: 'l177-2024', short: 'L. 177/2024', name: 'Riforma del Codice della Strada 2024',
    title: 'Legge 25 novembre 2024, n. 177 — Interventi in materia di sicurezza stradale e delega al Governo per la revisione del codice della strada',
    issuer: 'Stato', date: '2024-11-25', number: '177', kind: 'legge',
    scope: 'Modifiche estese al D.Lgs. 285/1992 e delega per la revisione organica del Codice.',
    topics: ['strade', 'sicurezza'], status: 'vigente',
    statusNote: 'In vigore dal 14 dicembre 2024; alcune disposizioni richiedono decreti attuativi.',
    url: `${NIR}stato:legge:2024-11-25;177`,
    articles: [{ ref: 'testo', summary: 'Modifiche a norme di comportamento, sanzioni, micromobilità e controllo della velocità; verificare le singole disposizioni nel testo vigente del CdS.' }],
  },
  // ---------------------------------------------------------------- Progettazione stradale
  {
    id: 'dm-2001', short: 'DM 5/11/2001', name: 'Norme funzionali e geometriche per la costruzione delle strade',
    title: 'Decreto ministeriale 5 novembre 2001, n. 6792 — Norme funzionali e geometriche per la costruzione delle strade',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2001-11-05', number: '6792', kind: 'dm',
    scope: 'Classificazione funzionale, composizione della piattaforma, andamento planimetrico e altimetrico, visibilità. Si applica alle strade di nuova costruzione.',
    topics: ['strade', 'sicurezza'], status: 'vigente_modificato',
    statusNote: 'Integrato dal DM 22/4/2004 (applicazione alle nuove costruzioni; riferimento per gli adeguamenti delle strade esistenti).',
    articles: [
      { ref: 'cap. 2', summary: 'Classificazione funzionale e categorie di traffico ammesse per tipo di strada.' },
      { ref: 'cap. 3', summary: 'Criteri di composizione della piattaforma: corsie, banchine, spartitraffico, marciapiedi (larghezza minima 1,50 m).' },
      { ref: 'Tab. 3.4.a', summary: 'Larghezza delle corsie per categoria: A 3,75; B 3,75; C1 3,75 / C2 3,50; D 3,25; E 3,00; F extraurbana 3,50 / 3,25; F urbana 2,75 m.' },
      { ref: 'cap. 5', summary: 'Andamento planimetrico e altimetrico: rettifili, curve, pendenze massime, raccordi verticali.' },
      { ref: 'cap. 5 (visibilità)', summary: 'Distanze di visibilità per l\'arresto, il sorpasso e il cambio di corsia.' },
    ],
  },
  {
    id: 'dm-2004', short: 'DM 22/4/2004', name: 'Modifica del DM 5/11/2001',
    title: 'Decreto ministeriale 22 aprile 2004 — Modifica del decreto 5 novembre 2001, n. 6792',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2004-04-22', kind: 'dm',
    scope: 'Ambito di applicazione delle norme geometriche: obbligatorie per le nuove costruzioni, di riferimento per gli interventi sulle strade esistenti.',
    topics: ['strade'], status: 'vigente',
    articles: [{ ref: 'testo', summary: 'Le norme si applicano alla costruzione di nuovi tronchi stradali; per gli adeguamenti di strade esistenti costituiscono riferimento, con deroghe motivate.' }],
  },
  {
    id: 'dm-2006', short: 'DM 19/4/2006', name: 'Norme per le intersezioni stradali',
    title: 'Decreto ministeriale 19 aprile 2006 — Norme funzionali e geometriche per la costruzione delle intersezioni stradali',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2006-04-19', kind: 'dm',
    scope: 'Intersezioni a raso e a livelli sfalsati, rotatorie, corsie specializzate, visibilità nelle intersezioni.',
    topics: ['intersezioni', 'strade', 'sicurezza'], status: 'vigente',
    articles: [
      { ref: 'Allegato, cap. 4', summary: 'Intersezioni a raso: angoli di intersezione prossimi all\'ortogonale, corsie specializzate, triangoli di visibilità.' },
      { ref: 'Allegato, § 4.5', summary: 'Rotatorie: convenzionali (diametro esterno 40–50 m), compatte (25–40 m), mini-rotatorie (14–25 m); larghezze della corona giratoria, delle entrate e delle uscite.' },
    ],
  },
  {
    id: 'dm-223-1992', short: 'DM 223/1992', name: 'Barriere stradali di sicurezza',
    title: 'Decreto ministeriale 18 febbraio 1992, n. 223 — Regolamento recante istruzioni tecniche per la progettazione, omologazione e impiego delle barriere stradali di sicurezza',
    issuer: 'Ministero dei lavori pubblici', date: '1992-02-18', number: '223', kind: 'dm',
    scope: 'Progetto e impiego delle barriere di sicurezza (classi di contenimento).',
    topics: ['strade', 'sicurezza'], status: 'vigente_modificato',
    statusNote: 'Istruzioni tecniche aggiornate dal DM 21/6/2004; prodotti marcati CE secondo UNI EN 1317.',
    articles: [{ ref: 'istruzioni tecniche', summary: 'Scelta della classe di contenimento in funzione del tipo di strada e del traffico; progetto delle barriere.' }],
  },
  {
    id: 'dlgs-35-2011', short: 'D.Lgs. 35/2011', name: 'Gestione della sicurezza delle infrastrutture stradali',
    title: 'Decreto legislativo 15 marzo 2011, n. 35 — Attuazione della direttiva 2008/96/CE sulla gestione della sicurezza delle infrastrutture stradali',
    issuer: 'Stato', date: '2011-03-15', number: '35', kind: 'dlgs',
    scope: 'Valutazione d\'impatto sulla sicurezza, audit e ispezioni di sicurezza, classificazione della sicurezza della rete.',
    topics: ['sicurezza', 'strade'], status: 'vigente_modificato',
    statusNote: 'Modificato dal D.Lgs. 213/2021 (recepimento della direttiva (UE) 2019/1936).',
    url: `${NIR}stato:decreto.legislativo:2011-03-15;35`,
    articles: [{ ref: 'testo', summary: 'Audit di sicurezza in fase di progetto e ispezioni periodiche sulle reti interessate.' }],
  },
  {
    id: 'dir-2008-96', short: 'Dir. 2008/96/CE', name: 'Direttiva UE sicurezza delle infrastrutture stradali',
    title: 'Direttiva 2008/96/CE del Parlamento europeo e del Consiglio sulla gestione della sicurezza delle infrastrutture stradali',
    issuer: 'Unione europea', date: '2008-11-19', kind: 'ue',
    scope: 'Quadro europeo per audit, valutazioni e ispezioni di sicurezza stradale.',
    topics: ['sicurezza'], status: 'vigente_modificato',
    statusNote: 'Modificata dalla direttiva (UE) 2019/1936; recepita con D.Lgs. 35/2011.',
    url: 'https://eur-lex.europa.eu/eli/dir/2008/96/oj',
    articles: [{ ref: 'testo', summary: 'Procedure di gestione della sicurezza: valutazione d\'impatto, audit, ispezioni, valutazione della rete.' }],
  },
  // ---------------------------------------------------------------- Ciclabilità
  {
    id: 'dm-557-1999', short: 'DM 557/1999', name: 'Regolamento piste ciclabili',
    title: 'Decreto ministeriale 30 novembre 1999, n. 557 — Regolamento recante norme per la definizione delle caratteristiche tecniche delle piste ciclabili',
    issuer: 'Ministero dei lavori pubblici', date: '1999-11-30', number: '557', kind: 'dm',
    scope: 'Tipologie, larghezze, caratteristiche plano-altimetriche e segnaletica delle piste ciclabili.',
    topics: ['ciclabilita'], status: 'vigente',
    statusNote: 'Le corsie ciclabili su carreggiata e le strade urbane ciclabili sono state introdotte nel CdS da modifiche successive (2020).',
    articles: [
      { ref: 'art. 7', summary: 'Larghezze: corsia ciclabile minima 1,50 m (strisce comprese); 1,25 m per due corsie contigue (totale minimo 2,50 m); eccezionalmente fino a 1,00 m per tratti di limitata lunghezza, opportunamente segnalati.' },
      { ref: 'art. 8', summary: 'Velocità di progetto e caratteristiche plano-altimetriche: pendenza longitudinale di norma non superiore al 5%.' },
    ],
  },
  {
    id: 'l2-2018', short: 'L. 2/2018', name: 'Legge quadro sulla mobilità ciclistica',
    title: 'Legge 11 gennaio 2018, n. 2 — Disposizioni per lo sviluppo della mobilità in bicicletta e la realizzazione della rete nazionale di percorribilità ciclistica',
    issuer: 'Stato', date: '2018-01-11', number: '2', kind: 'legge',
    scope: 'Piano generale della mobilità ciclistica, rete Bicitalia, piani regionali e Biciplan comunali.',
    topics: ['ciclabilita', 'pianificazione'], status: 'vigente',
    url: `${NIR}stato:legge:2018-01-11;2`,
    articles: [
      { ref: 'art. 2', summary: 'Definizioni (ciclovia, rete cicloviaria, via verde ciclabile, ecc.).' },
      { ref: 'art. 6', summary: 'Piani urbani della mobilità ciclistica (Biciplan), parte integrante del PUMS.' },
    ],
  },
  // ---------------------------------------------------------------- Accessibilità
  {
    id: 'dm-236-1989', short: 'DM 236/1989', name: 'Prescrizioni tecniche per l\'accessibilità',
    title: 'Decreto ministeriale 14 giugno 1989, n. 236 — Prescrizioni tecniche necessarie a garantire l\'accessibilità, l\'adattabilità e la visitabilità degli edifici privati e di edilizia residenziale pubblica',
    issuer: 'Ministero dei lavori pubblici', date: '1989-06-14', number: '236', kind: 'dm',
    scope: 'Specifiche tecniche di accessibilità, richiamate anche per gli spazi pubblici dal DPR 503/1996.',
    topics: ['accessibilita', 'edilizia'], status: 'vigente',
    articles: [
      { ref: '§ 4.2.1', summary: 'Percorsi: criteri di progettazione per la continuità e la sicurezza dei percorsi pedonali.' },
      { ref: '§ 8.1.11', summary: 'Rampe: pendenza massima 8%, larghezza minima 0,90 m (1,50 m per l\'incrocio di due sedie a ruote).' },
      { ref: '§ 8.2.1', summary: 'Percorsi pedonali: larghezza minima 0,90 m con allargamenti per l\'inversione (1,50 m) ogni 10 m; pendenza longitudinale ≤ 5%, trasversale ≤ 1%; raccordi con il piano stradale con rampe di pendenza ≤ 15% per dislivelli fino a 15 cm.' },
      { ref: '§ 8.2.3', summary: 'Parcheggi: posto auto riservato di larghezza non inferiore a 3,20 m.' },
    ],
  },
  {
    id: 'dpr-503-1996', short: 'DPR 503/1996', name: 'Barriere architettoniche negli spazi pubblici',
    title: 'Decreto del Presidente della Repubblica 24 luglio 1996, n. 503 — Regolamento recante norme per l\'eliminazione delle barriere architettoniche negli edifici, spazi e servizi pubblici',
    issuer: 'Presidente della Repubblica', date: '1996-07-24', number: '503', kind: 'dpr',
    scope: 'Spazi pedonali, marciapiedi, attraversamenti, parcheggi e servizi pubblici accessibili.',
    topics: ['accessibilita', 'sosta'], status: 'vigente',
    url: `${NIR}presidente.repubblica:decreto:1996-07-24;503`,
    articles: [
      { ref: 'art. 4', summary: 'Spazi pedonali: percorsi accessibili negli spazi urbani.' },
      { ref: 'art. 5', summary: 'Marciapiedi: dislivello tra marciapiede e zone carrabili non superiore a 15 cm; raccordi con rampe.' },
      { ref: 'art. 6', summary: 'Attraversamenti pedonali: accessibili, con piattaforme o scivoli e segnalazioni per persone con disabilità sensoriale.' },
      { ref: 'art. 10', summary: 'Parcheggi: posti riservati ai veicoli al servizio di persone con disabilità nella misura minima di 1 ogni 50 o frazione di 50.' },
      { ref: 'art. 11', summary: 'Circolazione e sosta dei veicoli al servizio di persone con disabilità.' },
    ],
  },
  {
    id: 'l13-1989', short: 'L. 13/1989', name: 'Superamento delle barriere architettoniche negli edifici privati',
    title: 'Legge 9 gennaio 1989, n. 13 — Disposizioni per favorire il superamento e l\'eliminazione delle barriere architettoniche negli edifici privati',
    issuer: 'Stato', date: '1989-01-09', number: '13', kind: 'legge',
    scope: 'Accessibilità degli edifici privati; prescrizioni tecniche nel DM 236/1989.',
    topics: ['accessibilita', 'edilizia'], status: 'vigente_modificato',
    url: `${NIR}stato:legge:1989-01-09;13`,
    articles: [{ ref: 'testo', summary: 'Obbligo di accessibilità/adattabilità nei progetti di nuovi edifici e ristrutturazioni.' }],
  },
  {
    id: 'l104-1992', short: 'L. 104/1992', name: 'Legge quadro sulla disabilità',
    title: 'Legge 5 febbraio 1992, n. 104 — Legge-quadro per l\'assistenza, l\'integrazione sociale e i diritti delle persone handicappate',
    issuer: 'Stato', date: '1992-02-05', number: '104', kind: 'legge',
    scope: 'Eliminazione delle barriere architettoniche e PEBA estesi agli spazi urbani.',
    topics: ['accessibilita'], status: 'vigente_modificato',
    url: `${NIR}stato:legge:1992-02-05;104`,
    articles: [{ ref: 'art. 24', summary: 'Eliminazione o superamento delle barriere architettoniche; i piani (PEBA, L. 41/1986 art. 32) comprendono gli spazi urbani.' }],
  },
  // ---------------------------------------------------------------- Pianificazione della mobilità
  {
    id: 'pgtu-1995', short: 'Direttive PGTU 1995', name: 'Direttive per i Piani Urbani del Traffico',
    title: 'Ministero dei lavori pubblici, 12 aprile 1995 — Direttive per la redazione, adozione ed attuazione dei piani urbani del traffico',
    issuer: 'Ministero dei lavori pubblici', date: '1995-04-12', kind: 'direttiva_min',
    scope: 'Contenuti e livelli del PUT (PGTU, piani particolareggiati ed esecutivi), classifica funzionale della viabilità urbana, isole ambientali.',
    topics: ['pianificazione', 'strade', 'ztl'], status: 'vigente',
    articles: [
      { ref: 'classifica funzionale', summary: 'Classifica funzionale delle strade urbane (scorrimento veloce, scorrimento, interquartiere, quartiere, interzonali, locali) e isole ambientali.' },
      { ref: 'livelli del PUT', summary: 'Livelli di progettazione: PGTU, piani particolareggiati, piani esecutivi; aggiornamento biennale.' },
    ],
  },
  {
    id: 'pums-2017', short: 'DM 397/2017', name: 'Linee guida PUMS',
    title: 'Decreto ministeriale 4 agosto 2017, n. 397 — Individuazione delle linee guida per i piani urbani di mobilità sostenibile',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2017-08-04', number: '397', kind: 'dm',
    scope: 'Procedura di redazione e approvazione dei PUMS, obiettivi, strategie, indicatori di monitoraggio.',
    topics: ['pianificazione'], status: 'vigente_modificato',
    statusNote: 'Modificato e integrato dal DM 28/8/2019 n. 396.',
    articles: [
      { ref: 'Allegato 1', summary: 'Procedura per la redazione e approvazione del PUMS.' },
      { ref: 'Allegato 2', summary: 'Macro-obiettivi, obiettivi specifici, strategie e indicatori.' },
    ],
  },
  {
    id: 'pums-2019', short: 'DM 396/2019', name: 'Modifiche alle linee guida PUMS',
    title: 'Decreto ministeriale 28 agosto 2019, n. 396 — Modifiche al decreto 4 agosto 2017 di individuazione delle linee guida per i PUMS',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2019-08-28', number: '396', kind: 'dm',
    scope: 'Aggiornamento degli indicatori e dei termini del DM 397/2017.',
    topics: ['pianificazione'], status: 'vigente',
    articles: [{ ref: 'testo', summary: 'Revisione della tabella degli indicatori e dei tempi di adozione dei PUMS.' }],
  },
  // ---------------------------------------------------------------- Urbanistica ed edilizia
  {
    id: 'dm-1444-1968', short: 'DM 1444/1968', name: 'Standard urbanistici e zone territoriali omogenee',
    title: 'Decreto interministeriale 2 aprile 1968, n. 1444 — Limiti inderogabili di densità edilizia, di altezza, di distanza fra i fabbricati e rapporti massimi tra spazi destinati agli insediamenti e spazi pubblici',
    issuer: 'Ministero dei lavori pubblici', date: '1968-04-02', number: '1444', kind: 'dm',
    scope: 'Zone territoriali omogenee A–F, dotazioni minime di spazi pubblici (standard), distanze e altezze.',
    topics: ['urbanistica'], status: 'vigente',
    articles: [
      { ref: 'art. 2', summary: 'Zone territoriali omogenee: A centri storici, B completamento, C espansione, D produttive, E agricole, F attrezzature di interesse generale.' },
      { ref: 'art. 3', summary: 'Dotazione minima di 18 m² per abitante: 4,5 istruzione, 2 attrezzature di interesse comune, 9 verde e sport, 2,5 parcheggi.' },
      { ref: 'art. 4', summary: 'Quantità minime di spazi pubblici per zona territoriale omogenea.' },
      { ref: 'art. 7', summary: 'Limiti di densità edilizia.' },
      { ref: 'art. 8', summary: 'Limiti di altezza degli edifici.' },
      { ref: 'art. 9', summary: 'Limiti di distanza tra i fabbricati (10 m tra pareti finestrate nelle zone di nuova edificazione).' },
    ],
  },
  {
    id: 'l1150-1942', short: 'L. 1150/1942', name: 'Legge urbanistica',
    title: 'Legge 17 agosto 1942, n. 1150 — Legge urbanistica',
    issuer: 'Stato', date: '1942-08-17', number: '1150', kind: 'legge',
    scope: 'Piani regolatori generali e attuativi; base della disciplina urbanistica statale.',
    topics: ['urbanistica', 'pianificazione'], status: 'vigente_modificato',
    statusNote: 'Ampiamente integrata (L. 765/1967) e, per molte materie, sostituita dalle leggi regionali sul governo del territorio.',
    url: `${NIR}stato:legge:1942-08-17;1150`,
    articles: [
      { ref: 'art. 7', summary: 'Contenuti del piano regolatore generale (rete viaria, zonizzazione, spazi pubblici, vincoli).' },
      { ref: 'art. 13', summary: 'Piani particolareggiati di esecuzione.' },
      { ref: 'art. 28', summary: 'Lottizzazioni e convenzioni urbanistiche.' },
      { ref: 'art. 41-quinquies', summary: 'Fondamento dei limiti e degli standard fissati dal DM 1444/1968.' },
    ],
  },
  {
    id: 'dpr-380-2001', short: 'DPR 380/2001', name: 'Testo unico dell\'edilizia',
    title: 'Decreto del Presidente della Repubblica 6 giugno 2001, n. 380 — Testo unico delle disposizioni legislative e regolamentari in materia edilizia',
    issuer: 'Presidente della Repubblica', date: '2001-06-06', number: '380', kind: 'dpr',
    scope: 'Titoli abilitativi, definizioni degli interventi, opere pubbliche, barriere architettoniche negli edifici.',
    topics: ['edilizia', 'accessibilita'], status: 'vigente_modificato',
    url: `${NIR}presidente.repubblica:decreto:2001-06-06;380`,
    articles: [
      { ref: 'art. 3', summary: 'Definizioni degli interventi edilizi.' },
      { ref: 'art. 6', summary: 'Attività edilizia libera.' },
      { ref: 'art. 7', summary: 'Opere pubbliche dei comuni deliberate dal consiglio o dalla giunta, con progetto validato: non serve il permesso di costruire.' },
      { ref: 'art. 10', summary: 'Interventi subordinati a permesso di costruire.' },
      { ref: 'art. 22', summary: 'Interventi subordinati a segnalazione certificata di inizio attività (SCIA).' },
      { ref: 'artt. 77–82', summary: 'Eliminazione delle barriere architettoniche negli edifici privati e pubblici.' },
    ],
  },
  {
    id: 'lr-campania-16-2004', short: 'L.R. Campania 16/2004', name: 'Norme sul governo del territorio (Campania)',
    title: 'Legge regionale Campania 22 dicembre 2004, n. 16 — Norme sul governo del territorio',
    issuer: 'Regione Campania', date: '2004-12-22', number: '16', kind: 'lr',
    scope: 'Pianificazione regionale, provinciale e comunale in Campania (PUC, PUA, RUEC). Esempio: ogni Regione ha la propria legge urbanistica.',
    topics: ['urbanistica', 'pianificazione'], status: 'vigente_modificato',
    statusNote: 'Attuata dal Regolamento regionale 4 agosto 2011 n. 5. Le norme urbanistiche variano da Regione a Regione: verificare la legge della Regione del progetto.',
    articles: [
      { ref: 'art. 23', summary: 'Piano urbanistico comunale (PUC).' },
      { ref: 'art. 26', summary: 'Piani urbanistici attuativi (PUA).' },
      { ref: 'art. 28', summary: 'Regolamento urbanistico edilizio comunale (RUEC).' },
    ],
  },
  // ---------------------------------------------------------------- Appalti, strutture, cantieri
  {
    id: 'dlgs-36-2023', short: 'D.Lgs. 36/2023', name: 'Codice dei contratti pubblici',
    title: 'Decreto legislativo 31 marzo 2023, n. 36 — Codice dei contratti pubblici',
    issuer: 'Stato', date: '2023-03-31', number: '36', kind: 'dlgs',
    scope: 'Livelli della progettazione (PFTE ed esecutivo), verifica e validazione, BIM, criteri ambientali minimi.',
    topics: ['appalti'], status: 'vigente_modificato',
    statusNote: 'Modificato dal correttivo D.Lgs. 31 dicembre 2024 n. 209.',
    url: `${NIR}stato:decreto.legislativo:2023-03-31;36`,
    articles: [
      { ref: 'art. 41', summary: 'Livelli e contenuti della progettazione: progetto di fattibilità tecnico-economica (PFTE) e progetto esecutivo.' },
      { ref: 'art. 42', summary: 'Verifica della progettazione e validazione.' },
      { ref: 'art. 43', summary: 'Metodi e strumenti di gestione informativa digitale (BIM).' },
      { ref: 'art. 57', summary: 'Clausole sociali e criteri di sostenibilità energetica e ambientale: obbligo dei CAM.' },
      { ref: 'Allegato I.7', summary: 'Contenuti minimi del quadro esigenziale, del documento di indirizzo alla progettazione, del PFTE e del progetto esecutivo.' },
      { ref: 'Allegato I.8', summary: 'Verifica preventiva dell\'interesse archeologico.' },
    ],
  },
  {
    id: 'ntc-2018', short: 'DM 17/1/2018', name: 'Norme tecniche per le costruzioni (NTC 2018)',
    title: 'Decreto ministeriale 17 gennaio 2018 — Aggiornamento delle «Norme tecniche per le costruzioni»',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2018-01-17', kind: 'dm',
    scope: 'Sicurezza strutturale: azioni, materiali, geotecnica, ponti, sismica.',
    topics: ['strutture'], status: 'vigente',
    statusNote: 'Istruzioni applicative nella Circolare 21 gennaio 2019 n. 7.',
    articles: [
      { ref: 'cap. 5', summary: 'Ponti (stradali e ferroviari): azioni, schemi di carico, verifiche.' },
      { ref: 'cap. 6', summary: 'Progettazione geotecnica (opere di sostegno, rilevati, fondazioni).' },
      { ref: 'cap. 7', summary: 'Progettazione per azioni sismiche.' },
    ],
  },
  {
    id: 'dm-cantieri-2002', short: 'DM 10/7/2002', name: 'Disciplinare segnaletica temporanea',
    title: 'Decreto ministeriale 10 luglio 2002 — Disciplinare tecnico relativo agli schemi segnaletici, differenziati per categoria di strada, da adottare per il segnalamento temporaneo',
    issuer: 'Ministero delle infrastrutture e dei trasporti', date: '2002-07-10', kind: 'dm',
    scope: 'Schemi segnaletici per cantieri stradali per categoria di strada.',
    topics: ['cantieri', 'segnaletica', 'sicurezza'], status: 'vigente',
    statusNote: 'Da applicare con il DI 22/1/2019 sulla sicurezza degli operatori nelle attività in presenza di traffico.',
    articles: [{ ref: 'tavole', summary: 'Schemi per lavori su strade urbane ed extraurbane: restringimenti, sensi unici alternati, deviazioni.' }],
  },
  // ---------------------------------------------------------------- Paesaggio e ambiente
  {
    id: 'dlgs-42-2004', short: 'D.Lgs. 42/2004', name: 'Codice dei beni culturali e del paesaggio',
    title: 'Decreto legislativo 22 gennaio 2004, n. 42 — Codice dei beni culturali e del paesaggio',
    issuer: 'Stato', date: '2004-01-22', number: '42', kind: 'dlgs',
    scope: 'Tutela dei beni culturali e paesaggistici; autorizzazioni per interventi su beni e aree vincolate.',
    topics: ['paesaggio'], status: 'vigente_modificato',
    statusNote: 'Interventi esclusi o soggetti ad autorizzazione semplificata: DPR 13 febbraio 2017 n. 31.',
    url: `${NIR}stato:decreto.legislativo:2004-01-22;42`,
    articles: [
      { ref: 'art. 10', summary: 'Beni culturali (comprese piazze, vie e spazi urbani di interesse artistico o storico).' },
      { ref: 'art. 21', summary: 'Interventi soggetti ad autorizzazione della Soprintendenza.' },
      { ref: 'art. 136', summary: 'Immobili e aree di notevole interesse pubblico.' },
      { ref: 'art. 142', summary: 'Aree tutelate per legge.' },
      { ref: 'art. 146', summary: 'Autorizzazione paesaggistica.' },
    ],
  },
  {
    id: 'dlgs-152-2006', short: 'D.Lgs. 152/2006', name: 'Testo unico ambientale',
    title: 'Decreto legislativo 3 aprile 2006, n. 152 — Norme in materia ambientale',
    issuer: 'Stato', date: '2006-04-03', number: '152', kind: 'dlgs',
    scope: 'VIA e VAS, gestione delle acque, rifiuti, bonifiche.',
    topics: ['ambiente'], status: 'vigente_modificato',
    url: `${NIR}stato:decreto.legislativo:2006-04-03;152`,
    articles: [
      { ref: 'Parte II', summary: 'Valutazione ambientale strategica (VAS) e di impatto ambientale (VIA).' },
      { ref: 'art. 184-bis', summary: 'Sottoprodotti.' },
      { ref: 'art. 185', summary: 'Esclusioni dalla disciplina dei rifiuti (tra cui il suolo non contaminato riutilizzato nello stesso sito).' },
      { ref: 'Parte IV', summary: 'Gestione dei rifiuti e bonifica dei siti contaminati.' },
    ],
  },
  {
    id: 'dpr-120-2017', short: 'DPR 120/2017', name: 'Terre e rocce da scavo',
    title: 'Decreto del Presidente della Repubblica 13 giugno 2017, n. 120 — Regolamento recante la disciplina semplificata della gestione delle terre e rocce da scavo',
    issuer: 'Presidente della Repubblica', date: '2017-06-13', number: '120', kind: 'dpr',
    scope: 'Gestione delle terre e rocce da scavo come sottoprodotti, riutilizzo in sito, deposito temporaneo.',
    topics: ['ambiente', 'cantieri'], status: 'vigente',
    url: `${NIR}presidente.repubblica:decreto:2017-06-13;120`,
    articles: [
      { ref: 'art. 4', summary: 'Criteri per qualificare le terre e rocce da scavo come sottoprodotti.' },
      { ref: 'art. 24', summary: 'Utilizzo nel sito di produzione delle terre e rocce escluse dalla disciplina dei rifiuti.' },
    ],
  },
  {
    id: 'l447-1995', short: 'L. 447/1995', name: 'Legge quadro sull\'inquinamento acustico',
    title: 'Legge 26 ottobre 1995, n. 447 — Legge quadro sull\'inquinamento acustico',
    issuer: 'Stato', date: '1995-10-26', number: '447', kind: 'legge',
    scope: 'Classificazione acustica, valutazioni di impatto acustico delle infrastrutture.',
    topics: ['rumore', 'ambiente'], status: 'vigente_modificato',
    url: `${NIR}stato:legge:1995-10-26;447`,
    articles: [{ ref: 'art. 8', summary: 'Documentazione di impatto acustico per la realizzazione e modifica di strade.' }],
  },
  {
    id: 'dpr-142-2004', short: 'DPR 142/2004', name: 'Rumore da traffico veicolare',
    title: 'Decreto del Presidente della Repubblica 30 marzo 2004, n. 142 — Disposizioni per il contenimento e la prevenzione dell\'inquinamento acustico derivante dal traffico veicolare',
    issuer: 'Presidente della Repubblica', date: '2004-03-30', number: '142', kind: 'dpr',
    scope: 'Fasce di pertinenza acustica e limiti di immissione per tipo di strada.',
    topics: ['rumore'], status: 'vigente',
    url: `${NIR}presidente.repubblica:decreto:2004-03-30;142`,
    articles: [{ ref: 'Allegato 1', summary: 'Ampiezza delle fasce di pertinenza e limiti per strade esistenti e di nuova realizzazione.' }],
  },
  // ---------------------------------------------------------------- ZTL
  {
    id: 'dpr-250-1999', short: 'DPR 250/1999', name: 'Varchi elettronici ZTL',
    title: 'Decreto del Presidente della Repubblica 22 giugno 1999, n. 250 — Regolamento recante norme per l\'autorizzazione alla installazione e all\'esercizio di impianti per la rilevazione degli accessi di veicoli ai centri storici e alle zone a traffico limitato',
    issuer: 'Presidente della Repubblica', date: '1999-06-22', number: '250', kind: 'dpr',
    scope: 'Impianti di rilevazione degli accessi (varchi elettronici) a ZTL e centri storici: autorizzazione ministeriale e omologazione.',
    topics: ['ztl'], status: 'vigente',
    url: `${NIR}presidente.repubblica:decreto:1999-06-22;250`,
    articles: [{ ref: 'testo', summary: 'Installazione ed esercizio dei varchi subordinati ad autorizzazione del Ministero e a dispositivi omologati.' }],
  },
  // ---------------------------------------------------------------- Illuminazione, verde, arredo
  {
    id: 'uni-11248', short: 'UNI 11248', name: 'Illuminazione stradale — selezione delle categorie illuminotecniche',
    title: 'UNI 11248:2016 — Illuminazione stradale: selezione delle categorie illuminotecniche',
    issuer: 'UNI', date: '2016', kind: 'uni',
    scope: 'Classificazione della zona di studio e scelta della categoria illuminotecnica di progetto ed esercizio.',
    topics: ['illuminazione'], status: 'norma_tecnica',
    statusNote: 'Da usare con la serie UNI EN 13201 e con le leggi regionali sull\'inquinamento luminoso.',
    articles: [{ ref: 'prospetti', summary: 'Categorie illuminotecniche di ingresso per tipo di strada e parametri di influenza (traffico, complessità, conflitti).' }],
  },
  {
    id: 'uni-en-13201', short: 'UNI EN 13201', name: 'Illuminazione stradale — requisiti prestazionali',
    title: 'UNI EN 13201-2/-3/-4/-5:2016 — Illuminazione stradale',
    issuer: 'UNI / CEN', date: '2016', kind: 'uni',
    scope: 'Requisiti prestazionali (classi M, C, P), calcolo, misurazione e indicatori di prestazione energetica.',
    topics: ['illuminazione'], status: 'norma_tecnica',
    articles: [
      { ref: 'parte 2', summary: 'Requisiti prestazionali delle classi M (veicolari), C (zone di conflitto), P (pedonali e ciclabili).' },
      { ref: 'parte 5', summary: 'Indicatori di prestazione energetica (PDI, AECI).' },
    ],
  },
  {
    id: 'uni-en-1176', short: 'UNI EN 1176', name: 'Attrezzature per aree da gioco',
    title: 'UNI EN 1176 (attrezzature e superfici per aree da gioco) e UNI EN 1177 (rivestimenti di superfici ammortizzanti)',
    issuer: 'UNI / CEN', date: '2018', kind: 'uni',
    scope: 'Requisiti di sicurezza delle attrezzature da gioco, spazi di caduta, superfici ammortizzanti.',
    topics: ['arredo', 'sicurezza'], status: 'norma_tecnica',
    articles: [
      { ref: 'EN 1176-1', summary: 'Requisiti generali di sicurezza e metodi di prova; spazio minimo e zona di caduta.' },
      { ref: 'EN 1177', summary: 'Superfici ammortizzanti: altezza di caduta critica.' },
    ],
  },
  {
    id: 'cam-illuminazione', short: 'CAM illuminazione (DM 27/9/2017)', name: 'CAM illuminazione pubblica',
    title: 'Decreto ministeriale 27 settembre 2017 — Criteri ambientali minimi per l\'acquisizione di sorgenti luminose e apparecchi per illuminazione pubblica e per la progettazione di impianti',
    issuer: 'Ministero dell\'ambiente', date: '2017-09-27', kind: 'cam',
    scope: 'Requisiti ambientali di sorgenti, apparecchi e progetti di illuminazione pubblica.',
    topics: ['illuminazione', 'ambiente'], status: 'vigente',
    statusNote: 'Obbligatori negli appalti pubblici (D.Lgs. 36/2023 art. 57).',
    articles: [{ ref: 'criteri', summary: 'Efficienza degli apparecchi, controllo del flusso luminoso, contenimento dell\'inquinamento luminoso.' }],
  },
  {
    id: 'cam-verde', short: 'CAM verde (DM 63/2020)', name: 'CAM verde pubblico',
    title: 'Decreto ministeriale 10 marzo 2020, n. 63 — Criteri ambientali minimi per il servizio di gestione del verde pubblico e la fornitura di prodotti per la cura del verde',
    issuer: 'Ministero dell\'ambiente', date: '2020-03-10', number: '63', kind: 'cam',
    scope: 'Progettazione e gestione del verde pubblico, scelta delle specie, prodotti per la cura del verde.',
    topics: ['verde', 'ambiente'], status: 'vigente',
    statusNote: 'Obbligatori negli appalti pubblici (D.Lgs. 36/2023 art. 57).',
    articles: [{ ref: 'criteri', summary: 'Censimento del verde, scelta di specie adatte al sito, gestione sostenibile, piano di manutenzione.' }],
  },
  {
    id: 'cam-arredo', short: 'CAM arredo urbano (DM 5/2/2015)', name: 'CAM arredo urbano',
    title: 'Decreto ministeriale 5 febbraio 2015 — Criteri ambientali minimi per l\'acquisto di articoli per l\'arredo urbano',
    issuer: 'Ministero dell\'ambiente', date: '2015-02-05', kind: 'cam',
    scope: 'Materiali, durabilità e fine vita degli articoli di arredo urbano.',
    topics: ['arredo', 'ambiente'], status: 'vigente',
    statusNote: 'Obbligatori negli appalti pubblici (D.Lgs. 36/2023 art. 57).',
    articles: [{ ref: 'criteri', summary: 'Contenuto di materiale riciclato, assenza di sostanze pericolose, manutenibilità e disassemblabilità.' }],
  },
  {
    id: 'cam-edilizia', short: 'CAM edilizia (DM 256/2022)', name: 'CAM edilizia',
    title: 'Decreto ministeriale 23 giugno 2022, n. 256 — Criteri ambientali minimi per l\'affidamento del servizio di progettazione e di lavori per interventi edilizi',
    issuer: 'Ministero della transizione ecologica', date: '2022-06-23', number: '256', kind: 'cam',
    scope: 'Criteri ambientali per progetti e lavori edilizi, inclusi spazi esterni (permeabilità, isola di calore).',
    topics: ['edilizia', 'ambiente', 'verde'], status: 'vigente',
    articles: [{ ref: 'criteri', summary: 'Permeabilità dei suoli, riduzione dell\'effetto isola di calore, gestione delle acque meteoriche, materiali.' }],
  },
];

const byId = new Map(NORMS.map((n) => [n.id, n]));

export function normById(id: string): Norm | undefined {
  return byId.get(id);
}

/** "D.Lgs. 285/1992 art. 142" — short citation of a norm with an optional article reference. */
export function citeNorm(id: string, article?: string): string {
  const n = byId.get(id);
  if (!n) return article ?? id;
  return article ? `${n.short} ${article}` : n.short;
}

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Library search: every word of the query must appear in the norm (short/long title, name, scope,
 * topics, status note or one of its articles). Results are ranked by where the words match.
 */
export function searchNorms(query: string): Norm[] {
  const words = fold(query).split(/[^a-z0-9./-]+/).filter((w) => w.length > 1);
  if (!words.length) return [...NORMS];
  const scored: { n: Norm; s: number }[] = [];
  for (const n of NORMS) {
    const head = fold(`${n.short} ${n.name} ${n.id}`);
    const body = fold(`${n.title} ${n.scope} ${n.topics.join(' ')} ${n.statusNote ?? ''} ${n.issuer}`);
    const arts = fold(n.articles.map((a) => `${a.ref} ${a.summary}`).join(' '));
    let s = 0;
    let ok = true;
    for (const w of words) {
      if (head.includes(w)) s += 3;
      else if (body.includes(w)) s += 2;
      else if (arts.includes(w)) s += 1;
      else { ok = false; break; }
    }
    if (ok) scored.push({ n, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.n);
}
