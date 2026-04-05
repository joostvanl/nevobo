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
| `server/routes/social/mount-routes.js` | 1300+ | Alle HTTP-handlers nog in één mount; wel opgesplitst: `social/helpers.js`, `paths.js`, `multer-upload.js`, `parse-social-url.js`, `index.js` |
| `public/js/pages/matches.js` | ~1360 | Wedstrijd-UI, kaart, gallery, carpool — opponent-lookup uitgelicht naar `matches-opponent-lookup.js` |
| `public/js/reel-viewer.js` | 980+ | Fullscreen reel + interacties in één module |
| `public/js/pages/team.js` | ~910 | Compacte wedstrijdregels uitgelicht naar `team-schedule-helpers.js` |
| `server/routes/training.js` | ~2370 | Trainingsplanner + oefeningen + sessies + AI in één router — zie §6 |
| `public/js/pages/training-planner.js` | ~2970 | Volledige planner-UI in één module — zie §6 |

**Mogelijke richting:** `mount-routes.js` verder knippen (feed / media / follow), `matches.js` en `reel-viewer.js` verder modulair maken.

---

## 2. Geautomatiseerde tests

- **`npm test`** — `node --test` over:
  - [`test/html-escape.test.mjs`](../../test/html-escape.test.mjs) — `escHtml` (frontend-module; Node kan een module-type waarschuwing tonen)
  - [`test/api-app.test.cjs`](../../test/api-app.test.cjs) — **supertest** tegen `require('../server/app')`: 404 op onbekende `/api/*`, publieke gamification/clubs-routes, SPA `/`, 401 op `/api/platform/settings` zonder JWT
  - [`test/auth-api.test.cjs`](../../test/auth-api.test.cjs) — register, login, `/api/auth/me`, `PATCH /api/auth/profile`, 404 club
  - [`test/feature-settings-parse.test.cjs`](../../test/feature-settings-parse.test.cjs) — `parseStoredValue` (`featureSettings.js`), geen HTTP
- **Eerste run / CI:** bij eerste `require('../server/app')` opent `server/db/db.js` `data/volleyball.db` (map + bestand + schema/migraties).
- **Nog niet afgedekt:** auth-flows, uploads, Nevobo-fetch, E2E browser — uitbreiden naar wens.

**Zie ook:** [01-architecture-overview.md](./01-architecture-overview.md) (`server/app.js` vs `index.js`).

---

## 3. Frontend: XSS-oppervlak

- **HTML als template strings** over vrijwel alle `public/js/pages/*.js` — elke nieuwe interpolatie van gebruikersdata vraagt bewuste escaping.
- **Gedeelde helper:** [`public/js/escape-html.js`](../../public/js/escape-html.js) exporteert `escHtml` — gebruikt door o.a. `app.js`, `reel-viewer.js`, home/team/matches/social/admin/profile. **Uitzondering:** `public/js/scout/match.js` is een IIFE zonder ES-import; houdt een lokale `escapeHtml`.
- **`onclick="navigate(...)"` en vergelijkbare inline handlers** — werkt met globale `navigate`, maar bindt aan [CSP uit te houden](./10-deployment-pwa-and-caching.md) en maakt refactors lastiger.
- **Gedeelde guard:** [`public/js/dom-guards.js`](../../public/js/dom-guards.js) — `isDetached(el)` na async navigatie (o.a. matches, social, reel blur-editor, team).

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

## 6. Trainingsplanner (teamplanner)

**Locatie:** o.a. [`server/routes/training.js`](../../server/routes/training.js), [`server/lib/training-week-resolve.js`](../../server/lib/training-week-resolve.js), [`public/js/pages/training-planner.js`](../../public/js/pages/training-planner.js). Uitgebreide architectuur: [22-teamplanner-architecture-and-data-flows.md](./22-teamplanner-architecture-and-data-flows.md).

| Thema | Schuld / risico | Suggestie |
|-------|-----------------|-----------|
| **Modulegrootte** | `training.js` en `training-planner.js` zijn elk **~2300–3000 regels** (snapshot 2026); veel verantwoordelijkheid in één bestand. | Splitsen: blauwdrukken, defaults/publish, week/exceptions, snapshots/AI, sessies/oefeningen in aparte routers of partials. |
| **Automatische tests** | Alleen **smoke** (`routes-smoke.test.cjs`) op `/api/training/*`; geen gerichte tests op `resolveBlueprintIdForWeek`, draft/publish, teampagina-schedule. | Unit/integration tests voor resolve + published/draft-fallback + `GET /team/:id/schedule`. |
| **Inconsistente consumers** | **`/api/export/training`** gebruikt **`ensureActiveBlueprint`**, niet **`resolveBlueprintIdForWeek`** — export kan afwijken van “effectieve week”-logica. | Export laten hangen aan dezelfde resolve + weekparameter, of documenteren als bewuste “club-actieve set export”. |
| **Dubbele fallback-logica** | Published→draft-fallback voor export staat **inline** in `export.js`; dezelfde semantiek zit in **`training-week-resolve.js`**. | Helper uit `training-week-resolve` hergebruiken in export. |
| **Concept vs live buiten defaults** | Alleen **`training_defaults` / `_published`** zijn gesplitst; **locaties, velden, inhuur** zijn niet “concept-first” — wijzigingen daar zijn direct “structureel” per blauwdruk. | Productkeuze; bij uitbreiding expliciet ontwerp (of accepteren). |
| **Publish API-scope** | **`POST .../defaults/publish`** werkt alleen voor **club-actieve** blauwdruk (`ensureActiveBlueprint`). | Optioneel `blueprint_id` voor admins die zonder dropdown-switch willen publiceren. |
| **Deels gepubliceerd** | Als `training_defaults_published` **niet leeg** is maar **per team** geen rijen heeft terwijl draft wél heeft, gebruikt de team-route **geen** fallback (published “wint” op setniveau in `getDefaultTrainingsPublishedOrDraft`). | Zeldzaam; bij problemen: fallback per team of “lege published = fallback” aanscherpen. |
| **UX-split week vs blauwdruk** | In **weekmodus** toont de kaart de **effectieve** blauwdruk; in **blauwdrukmodus** bewerk je de **club-actieve** set — kan tegelijk verschillen. | UI-waarschuwing of editor-BP koppelen aan context (bekend patroon; zie doc 22). |

---

## 7. Dependencies en runtime

- **`node-fetch` v2** staat nog in `package.json`; Node ≥18 heeft ingebouwde `fetch`. Migratie kan afhankelijkheden vereenvoudigen (geen haast zolang v2 onderhouden blijft).
- **TensorFlow.js / face-api in dezelfde Node-process** als de API — zwaar; fouten worden gelogd maar het proces blijft draaien. Dat is een bewuste trade-off ([01](./01-architecture-overview.md)), geen “verborgen” debt, wel een **capaciteits- en observability**-aandachtspunt.

---

## 8. Geen `TODO` / `FIXME` in de hoofd-tree

Een zoekactie op `TODO`/`FIXME` in de app-code leverde **geen treffers** in `Team/` (los van subproject `volleyball-scout`). Dat kan betekenen: nette codebase, of **onzichtbare** schuld (werk zonder traceerbare comments). Deze inventaris en code-review blijven nodig.

---

## Onderhoud van dit document

- Bij grote refactors (splitsen `social.js`, introductie testrunner): secties aanpassen of items verwijderen.
- Nieuwe structurele problemen: kort toevoegen met **symptoom**, **locatie**, **suggestie** — geen duplicaat van elke bugfix.

## Zie ook

- [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)  
- [12-expectations-expert-vs-documentation.md](./12-expectations-expert-vs-documentation.md)  
- [22-teamplanner-architecture-and-data-flows.md](./22-teamplanner-architecture-and-data-flows.md)  
- [INDEX.md](./INDEX.md)
