# CURRENT-ISSUES — DRIP Urban 1.0

Formato: id · descrizione · causa radice · stato · fix · test. Aggiornato a ogni milestone.

## P0 — blocker

| ID | Descrizione | Causa radice | Stato | Fix | Test |
|---|---|---|---|---|---|
| P0-01 | Il lavoro reale dell'utente (scenario 53.0 `future`) deve sopravvivere al passaggio | Formato 53.0 diverso dal modello 1.0 | aperto | Adapter `tools/migrate-53` in sola lettura sui dati originali | Conteggi post-migrazione = sorgente (127/114/98/77/4) |
| P0-02 | Decisione stack frontend | — | chiuso 2026-10-01 | Confermato dall'utente: React + TS + Vite | — |
| P0-03 | Twin e 2D usano renderer diversi | Doppio renderer 53.0 | aperto | Physical Model unico | RB-06 |

## P1 — major

| ID | Descrizione | Causa radice | Stato | Fix | Test |
|---|---|---|---|---|---|
| P1-01 | Loghi DRIP/FST solo PNG | SVG ufficiali non presenti nel workspace | aperto — l'utente fornirà gli SVG, manca il percorso | Lockup usa PNG ad alta risoluzione finché non arrivano gli SVG | Visual header |
| P1-02 | Font Ginto in licenza trial | Licenza | aperto — decisione utente | Fallback Manrope dichiarato | — |
| P1-03 | Catalogo segnali con 1 solo SVG reale | Libreria mai costruita | aperto | Libreria SVG Codice della Strada in `packages/assets` | RB-11 analogo per segnali |
| P1-04 | Test 53.0 verificano testo del sorgente | Strategia di test | aperto | Suite di comportamento (Vitest/pytest/Playwright) | — |
| P1-05 | 4 semafori veicolari attorno a rotatoria a precedenza (dati utente) | Generazione automatica controlli 53.0 | aperto | La migrazione segnala gli elementi incoerenti invece di cancellarli | Report migrazione |

## P2 — polish

Nessuno ancora: si apre a partire da M0.
