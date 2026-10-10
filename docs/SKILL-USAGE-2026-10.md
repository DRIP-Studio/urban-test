# Skill disponibili e applicate — ottobre2026

Inventario locale verificato; i plugin del catalogo di sessione sono valutati per pertinenza, non dichiarati usati automaticamente.

## Inventario filesystem

- `C:/Users/paone/.agents/skills/animate-expo/SKILL.md`
- `C:/Users/paone/.agents/skills/animate/SKILL.md`
- `C:/Users/paone/.agents/skills/animation-vocabulary/SKILL.md`
- `C:/Users/paone/.agents/skills/apple-design/SKILL.md`
- `C:/Users/paone/.agents/skills/ask-sonner/SKILL.md`
- `C:/Users/paone/.agents/skills/brandkit/SKILL.md`
- `C:/Users/paone/.agents/skills/design-taste-frontend-v1/SKILL.md`
- `C:/Users/paone/.agents/skills/design-taste-frontend/SKILL.md`
- `C:/Users/paone/.agents/skills/emil-design-eng/SKILL.md`
- `C:/Users/paone/.agents/skills/find-animation-opportunities/SKILL.md`
- `C:/Users/paone/.agents/skills/find-skills/SKILL.md`
- `C:/Users/paone/.agents/skills/frontend-design/SKILL.md`
- `C:/Users/paone/.agents/skills/full-output-enforcement/SKILL.md`
- `C:/Users/paone/.agents/skills/gpt-taste/SKILL.md`
- `C:/Users/paone/.agents/skills/high-end-visual-design/SKILL.md`
- `C:/Users/paone/.agents/skills/image-to-code/SKILL.md`
- `C:/Users/paone/.agents/skills/imagegen-frontend-mobile/SKILL.md`
- `C:/Users/paone/.agents/skills/imagegen-frontend-web/SKILL.md`
- `C:/Users/paone/.agents/skills/impeccable/SKILL.md`
- `C:/Users/paone/.agents/skills/improve-animations/SKILL.md`
- `C:/Users/paone/.agents/skills/industrial-brutalist-ui/SKILL.md`
- `C:/Users/paone/.agents/skills/migrate-radix-to-base/SKILL.md`
- `C:/Users/paone/.agents/skills/minimalist-ui/SKILL.md`
- `C:/Users/paone/.agents/skills/mobile-native/SKILL.md`
- `C:/Users/paone/.agents/skills/pick-ui-library/SKILL.md`
- `C:/Users/paone/.agents/skills/prototype/SKILL.md`
- `C:/Users/paone/.agents/skills/redesign-existing-projects/SKILL.md`
- `C:/Users/paone/.agents/skills/review-animations/SKILL.md`
- `C:/Users/paone/.agents/skills/shadcn/SKILL.md`
- `C:/Users/paone/.agents/skills/stitch-design-taste/SKILL.md`
- `C:/Users/paone/.agents/skills/web-design-guidelines/SKILL.md`
- `C:/Users/paone/.agents/skills/write-swift/SKILL.md`
- `C:/Users/paone/.codex/skills/.system/imagegen/SKILL.md`
- `C:/Users/paone/.codex/skills/.system/openai-docs/SKILL.md`
- `C:/Users/paone/.codex/skills/.system/review-agent/SKILL.md`
- `C:/Users/paone/.codex/skills/.system/skill-creator/SKILL.md`
- `C:/Users/paone/.codex/skills/.system/skill-installer/SKILL.md`
- `C:/Users/paone/.codex/skills/image-to-code-skill/SKILL.md`

## Uso effettivo (aggiornato durante implementazione)

| Skill | Percorso | Motivo e decisione | File influenzati |
|---|---|---|---|
| frontend-design | C:/Users/paone/.agents/skills/frontend-design/SKILL.md | Identità coerente derivata da DRIP, chiarezza delle fonti e stati vuoti; nessun tema marketing aggiunto al CAD | Audit iniziale |
| animate | C:/Users/paone/.agents/skills/animate/SKILL.md | Token esistenti estesi, proprietà compositore, riduzione movimento e interruzione | Audit iniziale |
| find-animation-opportunities | C:/Users/paone/.agents/skills/find-animation-opportunities/SKILL.md | Sei transizioni motivate, filtro di frequenza per comandi e dati | Audit iniziale |
| improve-animations | C:/Users/paone/.agents/skills/improve-animations/SKILL.md | Audit in sola lettura delegato come richiesto dalla skill; implementazione successiva con animate | Audit iniziale |
| review-animations | C:/Users/paone/.agents/skills/review-animations/SKILL.md | Revisione finale motion con valori misurati, interruzione e reduced-motion | Da applicare al diff |
| web-design-guidelines | C:/Users/paone/.agents/skills/web-design-guidelines/SKILL.md | Linee guida ufficiali aggiornate lette: focus, semantica, stati asincroni, tastiera | Audit iniziale |
| impeccable | C:/Users/paone/.agents/skills/impeccable/SKILL.md | Context eseguito su Workspace; modalità Operate, sistema esistente autoritativo, verifica visiva e detector finale | Audit iniziale |
| full-output-enforcement | C:/Users/paone/.agents/skills/full-output-enforcement/SKILL.md | Matrice77 sezioni più premessa0; implementazioni intere senza segnaposto | PATCH-ACCEPTANCE-2026-10.md |

## Skill ispezionate, escluse per ambito

- design-taste-frontend: la sezione13 esclude dashboard, editor e dense product UI; non applicati layout/immagini da landing page.
- Skill native Swift/Expo/mobile, Figma, Base44, Stripe, documenti Office, marketing/brandkit, imagegen e hosting: nessuna superficie o integrazione di questo tipo richiesta nella patch. Non si sostituisce il sistema DRIP con una libreria diversa.
- image-to-code e varianti landing: l’incarico richiede mantenere architettura, geometrie GIS e identità ufficiale; immagini generate non sono fonte di verità per il modello urbano.

## Applicazione verificata nella continuazione

- `animate`, `improve-animations`, `web-design-guidelines`: token semantici duration/easing e colore in `apps/web/src/ui/tokens.css`, reduced-motion anche per loader con durate letterali, fallback contrasto/trasparenza; focus e chiusura del Popover, selezione senza click-through, scroll Elios rispettoso della lettura e della preferenza di movimento.
- Audit delegato in sola lettura: `emil-design-eng/SKILL.md`, `apple-design/SKILL.md`, `redesign-existing-projects/SKILL.md`, `animate/RECIPES.md` letti dall’agente di audit. Influenze applicate: tempi più brevi per superfici frequenti, focus restituito al trigger, niente libreria UI parallela, palette originale mantenuta.
- `C:/Users/paone/.codex/plugins/cache/openai-curated-remote/data-analytics/1.0.11/skills/validate-data/SKILL.md` e shared `analysis-quality.md` / `shared-skill-instructions.md`: verifica standard integrata nell’implementazione. Denominatore nullo => N/V, minore throughput/domanda non ammessa/TPL peggiorato escludono la raccomandazione. Fonte osservata distinta dalla stima, timestamp di rilevazione distinto dal recupero, conteggi non derivati da velocità HERE. Test indipendenti di casi limite in `elios-evaluation.test.ts` e `traffic-state.test.ts`.

Detector Impeccable eseguito il 10 ottobre su EnvironmentControl, DiagnosticsPanel e CSS condivisi: 11 segnalazioni, 8 legate al nome --t-spring e 3 a bordi di callout esistenti. Il token --spring usa una curva monotona senza overshoot; il nome non prova un rimbalzo. I bordi dei callout distinguono annotazioni operative. Revisione motion applicata: palette istantanea, notifiche con transizioni interrompibili e progress via transform, login 260 ms. Verifica browser focus/notifiche ancora in correzione del test prima di certificare.

`pick-ui-library`: mantenuti controlli e store esistenti, nessuna libreria sovrapposta. Le nuove tabelle di confronto usano metriche del solver e primitive native. Il pass finale resta aperto per le superfici ancora in lavorazione.
