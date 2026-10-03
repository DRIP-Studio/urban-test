# Design system — DRIP Urban 2.0

Autorità di progetto: `DRIP-FST-DESIGN.md` nella cartella di lavoro. Questo documento descrive come quelle regole sono applicate nel codice.

## Due registri

| Registro | Dove | Carattere |
|---|---|---|
| **Tecnico DRIP** | workspace, hub, pannelli | shell scura, densità alta, mappa al centro, colore usato solo per stato e progetto |
| **Civico FST** | Presenta in versione civica, pagina pubblica di una pubblicazione | fondo avorio, Playfair Display per titoli e sommario, accento rosso piattaforma FST, informazione neutra e verificabile |

## Token

Unica fonte dei valori: `apps/web/src/ui/tokens.css`. Nei fogli `app.css`, `components.css` e `panels.css` non c'è nessun colore esadecimale.

Restano solo velature `rgba()` di overlay e ombre (17 occorrenze), che dipendono dal contesto e non hanno un nome di marca.

I colori di marca sono misurati sui file ufficiali (`packages/assets/brand/source`):

| Token | Valore | Uso |
|---|---|---|
| `--drip-blue` | #5587A2 | marchio DRIP |
| `--drip-accent` | #83B4D1 | attivo, selezione, azione primaria |
| `--drip-orange` | #E8772E | tutto ciò che è **progetto** (proposta, modifica) |
| `--fst-red` | #8B0209 | rosso del logo FST (solo nel logo) |
| `--fst-civic` | #7A1F32 | rosso dell'interfaccia FST (stati e accenti civici) |
| `--fst-ink` | #131212 | testo FST |
| `--ivory` | #F5F3EF | fondo civico, testo su scuro |

**Provenienza**: un colore per ciascun tipo (`--prov-*`), sempre accompagnato dall'etichetta testuale. Il colore da solo non porta mai il significato.

| Gruppo | Token |
|---|---|
| Tipografia | `--font-ui` Ginto (Manrope come riserva); `--font-display` Ginto Nord; `--font-editorial` Playfair Display; `--font-mono` per coordinate e numeri tecnici; scala `--fs-10` … `--fs-40` |
| Spaziatura | `--s-1` … `--s-12`, base 4 px |
| Raggi | `--r-1` … `--r-4` (6–12 px) |
| Movimento | `--t-fast` 100 ms, `--t-std` 160 ms, `--t-panel` 220 ms; azzerati con `prefers-reduced-motion` |
| Layout | top bar 52, status bar 26, rail 72, inspector 368, dock 300 px |
| Livelli | `--z-map-ui` < `--z-panel` < `--z-menu` < `--z-modal` < `--z-toast` |

Dalla 2.0 l'interfaccia usa **Ginto** e **Ginto Nord**, i font di marca DRIP richiesti dal committente (`apps/web/public/fonts`). La licenza deve coprire la distribuzione insieme all'app: vedi CURRENT-ISSUES P1-02. Manrope resta come riserva.

## Temi

- **Scuro** (predefinito) e **chiaro**:
  - si alternano dal pulsante sole/luna nella top bar o dal menu utente;
  - la scelta è salvata per utente;
  - la preferenza "sistema" segue `prefers-color-scheme`.
- Il tema chiaro ridefinisce solo i token (`:root[data-theme='light']` in `tokens.css`). I componenti non conoscono il tema.
- I loghi passano alla variante `-reverse` sul tema scuro, sia `TechnicalLockup` sia `CivicLockup` nel pannello Civico.
- Il gradiente DRIP (`--drip-gradient`: blu, azzurro, rosa, arancio) è riservato a Elios e agli accenti di marca.

## Lockup

Simbolo DRIP, wordmark e "URBAN" condividono la stessa altezza delle maiuscole (`--lk-h`). Sono disponibili due taglie:
- `md`: 17 px, nella top bar;
- `lg`: 26 px, nella home.

## Design system del sito

studiodrip.it non era raggiungibile dall'ambiente di sviluppo: i token derivano dai file ufficiali dei loghi. Con i token del sito (colori, raggi, spaziature, ombre) basta aggiornare `tokens.css`.

## Componenti (`ui/controls.tsx`)

| Componente | Note |
|---|---|
| `Button` | varianti `default`, `primary`, `project`, `ghost`, `danger`; stato `busy` |
| `IconButton` | etichetta e scorciatoia sempre presenti come tooltip |
| `Segmented`, `Select`, `Toggle`, `Slider` | controlli di scelta |
| `NumberField`, `TextField`, `Field` | `NumberField` ha unità e limiti |
| `Section` | collassabile, con contatore e azioni |
| `Stat`, `ProvBadge` | valore con la sua provenienza |
| `Empty`, `Skeleton` | uno stato vuoto spiega sempre perché è vuoto |
| `Kbd` | scorciatoia da tastiera |

Altri elementi dell'interfaccia:

- `Popover` e `ConfirmHost` sostituiscono `confirm()` nativo;
- toast con livelli info, successo, errore;
- palette comandi (Ctrl+K);
- menu contestuale.

## Marchi (`shell/Brand.tsx`)

- `TechnicalLockup`: marchio DRIP + "URBAN", con il nome della città quando serve.
- `CivicLockup`: lockup completo FST + "Tecnologia DRIP Studio" (wordmark DRIP), usato nelle pagine civiche.

Gli SVG in `packages/assets/brand` sono vettorializzati dai PNG ufficiali, in varianti normali e `-reverse`. Non sono i vettoriali originali: vedi CURRENT-ISSUES P1-01.

## Regole di layout

- La shell è una griglia con aree dichiarate. Un solo pannello inferiore (dock) alla volta.
- Un pannello che non entra si adatta: griglie `auto-fill`/`minmax` e scorrimento verticale. Le colonne non vengono mai tagliate (RB-12, verificato in e2e).
- Nessun `!important` nei fogli dell'app; l'unico è nel foglio usato solo dagli screenshot dei test (`e2e/screenshot.css`).
- Mappa:
  - oggetti statici e cartelli sono layer GPU, non marker DOM (RB-01, RB-02);
  - le icone si generano tramite `setMissingStyleImageResolver`, così sono presenti dal primo fotogramma.
- Larghezza minima supportata della postazione: 1024 px, verificata in e2e senza scorrimento orizzontale. Sotto i 1280 px le azioni secondarie della top bar (scorciatoie, tema) passano nel menu utente.
