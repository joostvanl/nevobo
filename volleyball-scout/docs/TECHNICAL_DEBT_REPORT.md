# Volleyball Scout – Technical Debt & Codebase Analyse

**Datum:** Februari 2025  
**Versie codebase:** Huidige staat  
**Analysemethode:** Code review, statische analyse, patroonherkenning

---

## 1. Executive Summary

De Volleyball Scout-app is functioneel en goed gestructureerd voor een klein project. Er zijn echter verschillende technische schulden, inconsistenties en beveiligingsrisico’s die de kwaliteit en onderhoudbaarheid beïnvloeden. Dit rapport beschrijft de bevindingen en concrete optimalisatiestappen.

---

## 2. Technical Debt

### 2.1 Code Duplicatie

| Locatie | Probleem | Aanbeveling |
|---------|----------|-------------|
| `match.js:293` / `matchreport.js:27` | `escapeHtml()` dubbel geïmplementeerd | Verplaats naar `js/utils.js` en deel tussen modules |
| `match.js` / `setup.js` | `nameToPlayer` / `nameToPlayerForWissel` – vergelijkbare lookups | Gezamenlijke utiliteit voor speler-lookup |
| `match.js` | ID-generatie (crypto random) herhaald in `initFromSetup` en `setup.js` | Uitnemen naar `generateMatchId()` in utils |

### 2.2 Magic Numbers

| Waarde | Gebruik | Voorkomen |
|--------|---------|-----------|
| `6` | Max wissels per set | `match.js:787`, `setup.js:187` – niet in RULES |
| `25`, `15`, `2` | Set-punten en minimale verschil | Goed in `rules.js` |
| `12` | Max spelers (veld + bank) | Hardcoded in setup-logica |
| `7` | Libero-positie | Hardcoded in `getLiberoPlayer()` |

**Aanbeveling:** Voeg constanten toe aan `rules.js` of een `constants.js`:
```javascript
const SCOUT_CONSTANTS = {
  MAX_SUBS_PER_SET: 6,
  MAX_PLAYERS: 12,
  LIBERO_BENCH_POSITION: 7
};
```

### 2.3 Error Handling

| Bestand | Probleem |
|---------|----------|
| `match.js:685-689` | `saveMatch()` fetch: `catch(() => {})` – fout wordt genegeerd |
| `api.php:91` | `@file_get_contents()` onderdrukt fouten |
| `overview.php:65-99` | `fetch` heeft generieke catch zonder foutlog/fb voor gebruiker |
| `matchreport.js:20` | `r.json()` na fetch – geen controle op response.ok |

**Aanbeveling:** Consistente error-handling:
- Toon foutmelding (bijv. via `showAlert`) bij mislukte save
- Log API-fouten (console of server-side)
- Controleer `response.ok` vóór `response.json()`

### 2.4 Lange Functies

| Functie | Bestand | Geschatte grootte |
|---------|---------|-------------------|
| `givePoint()` | match.js | ~85 regels |
| `aggregate()` | matchreport.js | ~170 regels |
| `applyScoreEdit()` | match.js | ~50 regels |

**Aanbeveling:** Opsplitsen in kleinere functies; subroutines voor rally-bewerking en score-edits.

### 2.5 Gemengde Verantwoordelijkheden

`match.js` combineert:
- State management (matchState)
- UI-rendering
- Event handling
- Business logic (scoring, wissels)

**Aanbeveling:** Op termijn eenvoudige scheiding:
- `matchState.js` – state en mutaties
- `matchUi.js` – rendering
- `match.js` – event handlers en orkestratie

---

## 3. Beveiliging

### 3.1 XSS (Cross-Site Scripting)

| Bestand | Risico |
|---------|--------|
| `overview.php:78-89` | `teamA`, `teamB`, `scoreStr`, `meta` direct in `innerHTML` – geen escaping |
| `matchreport.js:329` | `cont.innerHTML = html` – controleer of alle dynamische delen via `escapeHtml` gaan |
| `matchreport.js:590` | `convBody.innerHTML +=` – variabelen `l`, `n`, `conv` – check escaping |

**Aanbeveling:** In `overview.php` alle dynamische strings escapen met `escapeHtml` (bijv. via een kleine util in de pagina of gedeelde functie).

### 3.2 API & CORS

- `Access-Control-Allow-Origin: *` – in productie beperken tot eigen domein
- Geen CSRF-tokens op POST-requests
- Geen rate limiting – gevoelig voor misbruik

### 3.3 Data Directory

- JSON-bestanden in `data/` – controleer dat directe toegang beperkt is (bijv. `.htaccess`, Nginx config)

---

## 4. Inline Commentaar – Analyse & Optimalisaties

### 4.1 Huidige Stand

**Sterke punten:**
- `rules.js`: Duidelijke regels gedocumenteerd
- `rotation.js`: Rotatielogica uitgelegd
- `api.php`: Korte uitleg bij `validMatchId`
- Flow-commentaar bij setup-/wissel-logica

**Zwakke punten:**
- Veel functies zonder uitleg
- Inconsistent Nederlands/Engels
- Geen JSDoc bij complexe functies
- Onduidelijke businessregels in scoring

### 4.2 Aanbevolen Commentaarstijl

1. **Bestandsheader** (elk bestand):
   ```javascript
   /**
    * [Naam bestand] - [Korte beschrijving]
    * [Belangrijke afhankelijkheden of gedrag]
    */
   ```

2. **Publieke functies** met niet-triviale logica:
   ```javascript
   /**
    * Bepaalt wie het punt krijgt bij een gegeven rally-einde.
    * Ace = serverende partij; Out/In net na setup = tegenstander.
    * @param {string} description - bv. 'Ace', 'Out', 'Smash'
    * @returns {boolean} true = punt thuis
    */
   function getPointWinnerForOutcome(description) { ... }
   ```

3. **Businesslogica in één taal** – bij voorkeur Nederlands, of consistent Engels.

### 4.3 Prioriteiten voor Commentaar

| Prioriteit | Locatie | Suggestie |
|------------|---------|-----------|
| Hoog | `getPointWinnerForOutcome()` | Uitleg rally-einde → puntwinner |
| Hoog | `getRallyState()` | Uitleg `phaseEvents`, `lastGehouden` |
| Hoog | `canSwapForWissel()` | Regelbeperkingen (rol, max 6) |
| Midden | `applyScoreEdit()` | Omgang met rallies bij score-aanpassing |
| Midden | `aggregate()` | Structuur van output-object |

### 4.4 Te Verwijderen / Samenvatten

- Overbodige herhalingen (“zelfde als hierboven”)
- Losse `// TODO` zonder ticket/plan

---

## 5. Architectuur & Structuur

### 5.1 Positief

- Duidelijke scheiding PHP (API) vs JavaScript (UI)
- Logische mappen: `js/`, `css/`, `data/`, `config/`
- Losse modules: rules, rotation, dialog, setup, match

### 5.2 Verbeterpunten

- **Geen buildproces** – geen minificatie, bundling, transpilatie
- **Geen tests** – geen unit-, integratie- of E2E-tests
- **State** – alles rond `matchState`; overweeg duidelijke state-layer
- **API-structuur** – één `api.php`; bij groei splitsen per domein

---

## 6. Prestatie

| Onderwerp | Huidige situatie | Mogelijke optimalisatie |
|-----------|------------------|--------------------------|
| `saveMatch()` | Wordt frequent aangeroepen | Debounce (bijv. 1–2 sec) |
| `match.js` | ~1400 regels, één bestand | Code-splitting / lazy loading |
| API `list` | Volledige JSON per match gelezen | Metadata-cache of index |
| Chart.js | Altijd geladen op report-pagina | Lazy load bij eerste zichtbare grafiek |

---

## 7. Actieplan (Prioriteit)

### P0 – Direct

1. **XSS in overview.php** – Escapen van `teamA`, `teamB`, `scoreStr`, `meta` vóór `innerHTML`.
2. **API-fouten** – Bij mislukte save feedback naar gebruiker (alert/dialog).
3. **`@` in api.php** – Vervangen door `try/catch` en gerichte foutafhandeling.

### P1 – Korte termijn

4. **escapeHtml-utilities** – Centraliseren in `js/utils.js`.
5. **Constanten** – Max subs, max players in `rules.js` of `constants.js`.
6. **Commentaar** – Uitleg bij `getPointWinnerForOutcome`, `getRallyState`, `canSwapForWissel`.

### P2 – Middellange termijn

7. **Grote functies** – `givePoint`, `aggregate` opsplitsen.
8. **CORS** – Beperken tot productiedomein.
9. **Debounce saveMatch** – Minder serverbelasting.

### P3 – Langer termijn

10. **Tests** – Basis unit tests voor rules en kritieke match-logica.
11. **Buildproces** – Minificatie en eventueel bundling.

---

## 8. Bestandsoverzicht

```
volleyball-scout/
├── api.php           # API endpoints (load, save, list, export)
├── index.php         # Setup wizard
├── match.php         # Wedstrijdscherm
├── matchreport.php   # Rapport-pagina
├── overview.php      # Wedstrijdenoverzicht
├── manifest.json     # PWA manifest
├── config/
│   └── systems.json
├── css/
│   └── style.css     # Monoliet ~1300 regels
├── data/             # JSON-bestanden (matchdata)
└── js/
    ├── match.js      # Kernlogica (~1400 regels)
    ├── setup.js      # Setup + wissel-flow
    ├── matchreport.js # Analytics/rapportage
    ├── rules.js      # Volleybalregels
    ├── rotation.js   # Rotatielogica
    └── dialog.js     # Alert/confirm overlay
```

---

## Bijlage A: Voorbeeld inline commentaar-optimalisatie

**Voor** (`match.js` – getPointWinnerForOutcome):
```javascript
function getPointWinnerForOutcome(description) {
  if (description === 'Ace') {
    return matchState.servingTeam === 'home';
  }
  // ... 30 regels complexe logica
}
```

**Na**:
```javascript
/**
 * Bepaalt wie het punt krijgt bij een rally-einde.
 * - Ace: serverende partij wint
 * - Out/In net zonder pass/aanval: ontvangende partij (tegenstander van server)
 * - Na setup: laatste aanval bepaalt wie wint bij Out/Drop
 * @param {string} description - bv. 'Ace', 'Out', 'Smash'
 * @returns {boolean} true = punt voor thuisploeg
 */
function getPointWinnerForOutcome(description) {
  if (description === 'Ace') {
    return matchState.servingTeam === 'home';
  }
  // ...
}
```

---

---

## 9. Geïmplementeerde optimalisaties (na rapport)

*Laatste update: Februari 2025*

| Prioriteit | Item | Status |
|------------|------|--------|
| P0 | XSS overview.php – escapeHtml voor teamA, teamB, etc. | ✅ |
| P0 | saveMatch error feedback – showAlert bij API-fout | ✅ |
| P0 | api.php @ verwijderd | ✅ |
| P1 | utils.js – escapeHtml, escapeAttr, generateMatchId, nameToPlayer | ✅ |
| P1 | Constants in rules.js – MAX_SUBS_PER_SET, MAX_PLAYERS, LIBERO_BENCH_POSITION | ✅ |
| P1 | JSDoc – getPointWinnerForOutcome, getRallyState, canSwapForWissel, applyScoreEdit, aggregate | ✅ |
| P2 | Debounce saveMatch (1.5s) + immediate bij navigatie | ✅ |
| P2 | matchreport loadMatch – response.ok check | ✅ |
| P2 | matchreport conversion table – escapeHtml | ✅ |

---

*Rapport gegenereerd op basis van statische code-analyse en handmatige review.*
