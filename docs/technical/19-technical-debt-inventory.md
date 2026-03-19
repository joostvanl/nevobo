# 19 — Technical debt: inventaris

**Doel:** Bewuste lijst van **structurele** last, risico’s en verbeterkansen in de VolleyApp-repo (`Team/`). Geen vervanging van [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md) (operationele valkuilen blijven daar); hier vooral **schaal, onderhoudbaarheid en proces**.

**Scope:** Hoofdapp in repo-root. Submap **`volleyball-scout/`** heeft een eigen rapport: `volleyball-scout/docs/TECHNICAL_DEBT_REPORT.md`.

**Methode (snapshot):** statische review — o.a. `package.json`, bestandsgrootte, herhaalde patronen, afwezigheid van tests, kruisverwijzing met bestaande docs. Geen runtime-profiling.

---

## Al gedocumenteerd elders (kort)

| Onderwerp | Waar |
|-----------|------|
| Reel-paginatie vs geïnterleefde TikTok/IG | [11 §1](./11-cross-cutting-decisions.md) |
| `match_id` encoding / tegenstander uit RSS | [11 §2–3](./11-cross-cutting-decisions.md), [datamodel](../datamodel-match-media-opponent.md) |
| Scout-locks alleen in-memory | [11 §6](./11-cross-cutting-decisions.md) |
| SQLite WAL / backup | [11 §7](./11-cross-cutting-decisions.md) |
| Service worker + `app.js?v=` handmatig bumpen | [10](./10-deployment-pwa-and-caching.md), [11 §8](./11-cross-cutting-decisions.md) |
| CSP uit, CORS open, hand-built HTML | [10](./10-deployment-pwa-and-caching.md), [13](./13-environment-security-and-secrets.md) |
| `uncaughtException` / `unhandledRejection` stoppen proces niet | [01](./01-architecture-overview.md), `server/index.js` |

---

## 1. Onderhoudbaarheid: grote modules

Enkele bestanden concentreren veel verantwoordelijkheid (regels bij benadering, maart 2026):

| Bestand | ~regels | Risico |
|---------|---------|--------|
| `server/routes/social.js` | 1400+ | Moeilijk te reviewen; upload, feed, blur, comments, follow, embeds in één router |
| `public/js/pages/matches.js` | 1450+ | Wedstrijd-UI, kaart, gallery, carpool-touchpoints door elkaar |
| `public/js/reel-viewer.js` | 980+ | Fullscreen reel + interacties in één module |
| `public/js/pages/team.js` | 970+ | Team hero, media, results, modals |

**Mogelijke richting:** router/helpers splitsen (`social` → o.a. media-upload, feed, comments), pagina’s opknippen in kleinere imports (zonder verplichte build-stap als ES-modules behouden blijven).

---

## 2. Geautomatiseerde tests

- **`npm test`** — `node --test` over:
  - [`test/html-escape.test.mjs`](../../test/html-escape.test.mjs) — `escHtml` (frontend-module; Node kan een module-type waarschuwing tonen)
  - [`test/api-app.test.cjs`](../../test/api-app.test.cjs) — **supertest** tegen `require('../server/app')`: 404 op onbekende `/api/*`, publieke gamification/clubs-routes, SPA `/`, 401 op `/api/platform/settings` zonder JWT
  - [`test/feature-settings-parse.test.cjs`](../../test/feature-settings-parse.test.cjs) — `parseStoredValue` (`featureSettings.js`), geen HTTP
- **Eerste run / CI:** bij eerste `require('../server/app')` opent `server/db/db.js` `data/volleyball.db` (map + bestand + schema/migraties).
- **Nog niet afgedekt:** auth-flows, uploads, Nevobo-fetch, E2E browser — uitbreiden naar wens.

**Zie ook:** [01-architecture-overview.md](./01-architecture-overview.md) (`server/app.js` vs `index.js`).

---

## 3. Frontend: XSS-oppervlak

- **HTML als template strings** over vrijwel alle `public/js/pages/*.js` — elke nieuwe interpolatie van gebruikersdata vraagt bewuste escaping.
- **Gedeelde helper:** [`public/js/escape-html.js`](../../public/js/escape-html.js) exporteert `escHtml` — gebruikt door o.a. `app.js`, `reel-viewer.js`, home/team/matches/social/admin/profile. **Uitzondering:** `public/js/scout/match.js` is een IIFE zonder ES-import; houdt een lokale `escapeHtml`.
- **`onclick="navigate(...)"` en vergelijkbare inline handlers** — werkt met globale `navigate`, maar bindt aan [CSP uit te houden](./10-deployment-pwa-and-caching.md) en maakt refactors lastiger.

---

## 4. Navigatie-races (async + SPA)

De homepagina start meerdere **niet-geawait** loaders (`loadNextMatch`, `loadMedia`, `loadResults`). Na een `await` kan `#hm-*` al uit de boom zijn als de gebruiker intussen route wisselt.

- **Mitigatie (home):** `loadMedia` (incl. `resolveMediaTeamNames` + `el.querySelector('#hm-reel-track')`), `loadNextMatch`, `loadResults`, `loadClubFallback` (`isConnected` op doel-elementen).
- **Team-media:** `loadTeamMedia` na `await api` + `el.querySelector('#team-reel-track')`.
- **Wedstrijd-gallery:** `loadMatchGallery` na fetch + `renderMatchReel` met guard op `reelTrack`.
- **Resterend risico:** andere async pagina’s zonder `isConnected`-check na `await`; bij nieuwe features het patroon herhalen.

---

## 5. Documentatie vs code

- **[14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md)** is **handmatig**; nieuwe routes in `server/app.js` of `server/routes/*` kunnen daarvan afwijken tot iemand de lijst bijwerkt.
- **Functionele doc** §14 *Bekende beperkingen* ([`FUNCTIONELE_DOCUMENTATIE.md`](../../FUNCTIONELE_DOCUMENTATIE.md)) beschrijft vooral product/UX; technische schuld hoort primair in deze technische set (11 + 19).

---

## 6. Dependencies en runtime

- **`node-fetch` v2** staat nog in `package.json`; Node ≥18 heeft ingebouwde `fetch`. Migratie kan afhankelijkheden vereenvoudigen (geen haast zolang v2 onderhouden blijft).
- **TensorFlow.js / face-api in dezelfde Node-process** als de API — zwaar; fouten worden gelogd maar het proces blijft draaien. Dat is een bewuste trade-off ([01](./01-architecture-overview.md)), geen “verborgen” debt, wel een **capaciteits- en observability**-aandachtspunt.

---

## 7. Geen `TODO` / `FIXME` in de hoofd-tree

Een zoekactie op `TODO`/`FIXME` in de app-code leverde **geen treffers** in `Team/` (los van subproject `volleyball-scout`). Dat kan betekenen: nette codebase, of **onzichtbare** schuld (werk zonder traceerbare comments). Deze inventaris en code-review blijven nodig.

---

## Onderhoud van dit document

- Bij grote refactors (splitsen `social.js`, introductie testrunner): secties aanpassen of items verwijderen.
- Nieuwe structurele problemen: kort toevoegen met **symptoom**, **locatie**, **suggestie** — geen duplicaat van elke bugfix.

## Zie ook

- [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)  
- [12-expectations-expert-vs-documentation.md](./12-expectations-expert-vs-documentation.md)  
- [INDEX.md](./INDEX.md)
