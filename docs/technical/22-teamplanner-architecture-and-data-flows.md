# 22 — Teamplanner (trainingsplanner): architectuur, data en valkuilen

**Doel:** Eén referentie voor een junior ontwikkelaar of AI-agent om de **trainingsplanner** (`training-planner` route, `/api/training/*` rond blauwdruk/week/rooster) snel en **zonder verkeerde aannames** te begrijpen. Dit document is **uitputtend voor de planner-laag**; oefeningenbibliotheek en trainingssessies blijven beknopt (zie [21-training-module-planner-and-exercises.md](./21-training-module-planner-and-exercises.md)).

**Primaire bronbestanden (lees deze bij twijfel):**

| Bestand | Rol |
|---------|-----|
| [`server/routes/training.js`](../../server/routes/training.js) | Alle planner-API’s (blauwdrukken, defaults, week, uitzonderingen, snapshots, inhuur, import, AI). |
| [`server/lib/training-week-resolve.js`](../../server/lib/training-week-resolve.js) | **Welke blauwdruk geldt voor welke ISO-week** + published/draft-keuze voor standaardtrainingen. |
| [`server/lib/training-blueprint.js`](../../server/lib/training-blueprint.js) | `clubs.active_training_blueprint_id`, `ensureActiveBlueprint`, FK-checks locatie/veld ↔ blauwdruk. |
| [`public/js/pages/training-planner.js`](../../public/js/pages/training-planner.js) | UI: blauwdruk- vs weekmodus, data laden, publiceren/concept. |
| [`public/css/training-planner.css`](../../public/css/training-planner.css) | Layout, toolbar, timeline. |
| [`server/routes/public-training.js`](../../server/routes/public-training.js) | Publieke week-API (zelfde resolve als ingelogde week). |
| [`server/routes/export.js`](../../server/routes/export.js) | Export trainingsschema (published → fallback draft). |
| [`server/lib/training-schedule-availability.js`](../../server/lib/training-schedule-availability.js) | Basisvenster minus `training_venue_unavailability` → vrije intervallen per veld/dag (auto-schedule). |
| [`server/lib/training-schedule-validate.js`](../../server/lib/training-schedule-validate.js) | Harde regels H-01–H-08 + zachte Z-01–Z-03 voor het lokale rooster. |
| [`server/lib/training-schedule-solve.js`](../../server/lib/training-schedule-solve.js) | Greedy planner (modi **new** / **complete**). |
| [`server/lib/training-schedule-planner-inputs.js`](../../server/lib/training-schedule-planner-inputs.js) | Zelfde data-assemblage als AI-hook + coach-constraints uit `team_memberships`. |
| [`server/lib/training-schedule-resolve-ids.js`](../../server/lib/training-schedule-resolve-ids.js) | Team- en veldnamen → id’s voor snapshots (gedeeld met `ai-optimize`). |

---

## 1. Terminologie

| Term | Betekenis |
|------|-----------|
| **Blauwdruk (blueprint)** | Een named **set** binnen een club: eigen `training_locations`, `training_venues`, `training_venue_unavailability`, concept-rooster (`training_defaults`) en gepubliceerd rooster (`training_defaults_published`), plus snapshots gekoppeld aan `blueprint_id`. |
| **Club-actieve blauwdruk** | `clubs.active_training_blueprint_id`. Bepaalt **waar de planner naartoe schrijft** bij bewerken van het vaste weekrooster (defaults) en welke set je in de **Blauwdruk**-tab bewerkt. **Niet** automatisch “wat teams deze week zien”. |
| **Effectieve blauwdruk voor week X** | Uitkomst van `resolveBlueprintIdForWeek(db, clubId, isoWeek)` — hangt af van `scope` (standaard vs afwijkend), `priority`, en voor afwijkende sets de koppeling in `training_blueprint_weeks`. |
| **Concept (draft)** | Tabel `training_defaults` — bewerkbaar in de planner. |
| **Gepubliceerd (live voor teams)** | Tabel `training_defaults_published` — bron voor **weergave** waar de code expliciet published+draft-fallback gebruikt (zie §4). |
| **Uitzonderingsweek** | Rij in `training_exception_weeks` + bijbehorende `training_exceptions` voor die `iso_week` — overschrijft het standaardrooster voor die week (club-breed in resolve). |
| **Inhuur / niet-beschikbaar** | `training_venue_unavailability` — visueel op de tijdlijn; los van draft/published. |

---

## 2. Twee onafhankelijke assen (veel gemaakte fout)

### As A — Editor: welke blauwdruk bewerk je?

- Vastgelegd in **`clubs.active_training_blueprint_id`**.
- Wijzigen via **`POST /api/training/blueprints/:id/activate`** (dropdown in planner).
- Endpoints zoals **`GET/POST/PATCH/DELETE /api/training/defaults`**, publish/discard, snapshots voor “actieve set”, gebruiken **`ensureActiveBlueprint`** → dat is **deze** id.

### As B — Weergave voor een kalenderweek: welke blauwdruk is “van kracht”?

- Berekend met **`resolveBlueprintIdForWeek`** — **geen** directe kopie van de club-actieve blauwdruk.
- Gebruikt door:
  - **`GET /api/training/week/:isoWeek`**
  - **`resolveTrainingWeekForClub`** (dus ook **`GET /api/public/training/week/:isoWeek`**)
  - **`GET /api/training/team/:teamId/schedule`** (baseline voor de teampagina, met `?date=` → ISO-week)

**Gevolg voor ontwikkelaars:** als je code schrijft “teams moeten het rooster zien”, **niet** `ensureActiveBlueprint` gebruiken tenzij het echt om de editor-set gaat. Gebruik **`resolveBlueprintIdForWeek`** + published/draft helpers (§4).

---

## 3. Hoe `resolveBlueprintIdForWeek` werkt (stap voor stap)

Bestand: [`server/lib/training-week-resolve.js`](../../server/lib/training-week-resolve.js).

1. Haal alle `training_blueprints` van de club op (`id`, `name`, `priority`, `scope`).
2. Bouw kandidatenlijst:
   - **`scope !== 'exceptional'`** (standaard): altijd kandidaat.
   - **`scope === 'exceptional'`**: alleen kandidaat als er een rij in **`training_blueprint_weeks`** bestaat met die `blueprint_id` en de gevraagde **genormaliseerde** ISO-week (`normalizeIsoWeek`).
3. Als **geen** kandidaat (bijv. alleen afwijkende sets maar geen week-match): val terug op **standaard**-blauwdrukken, sorteer op **`priority` DESC**, pak de eerste; als die er niet is → `ensureActiveBlueprint`.
4. Als er wél kandidaten zijn: sorteer op **`priority` DESC**, hoogste wint.

**ISO-week normalisatie:** `2026-w3`, `2026-W3`, `2026_03` worden waar mogelijk naar `2026-W03`. Route-parameters en DB-vergelijkingen gebruiken vaak `lower(trim(...))` op `iso_week` om SQLite-case issues te beperken.

---

## 4. Draft vs gepubliceerd (standaardtrainingen)

### Tabellen

- **`training_defaults`** — concept; alle mutaties vanuit de planner (POST/PATCH/DELETE defaults, restore, snapshot activate overschrijft draft).
- **`training_defaults_published`** — wat als “live” bedoeld is voor **consumers** zodra er rijen zijn.

### Leespad (published eerst, anders draft)

Deze functies centraliseren dat gedrag:

| Functie | Gebruik |
|---------|---------|
| `getDefaultTrainingsPublishedOrDraft` | Volledige joined rijen voor alle teams (week-resolve default branch). |
| `getDefaultTrainingTuplesPublishedOrDraft` | Minimale tuples — o.a. **seed** bij `POST /week/:isoWeek/override`. |
| `getTeamScheduleDefaultsPublishedOrDraft` | Per team — **`GET /team/:teamId/schedule`** baseline. |

**Semantiek:** staat er **iets** in published voor die `(club_id, blueprint_id)` (respectievelijk per team voor team-helper), dan wordt **alleen** published gebruikt. Is published **leeg**, dan val je terug op draft (compatibiliteit / nog niet gepubliceerd).

### Schrijfpad

- **`POST /api/training/defaults/publish`** — kopieert draft → published voor **club-actieve** blauwdruk (transactie: delete published, insert uit draft).
- **`POST /api/training/defaults/discard-draft`** — published → draft (draft vervangen).

**Snapshots:** opslaan leest **draft**; activeren overschrijft **draft**. Teams zien wijzigingen pas betrouwbaar na **publiceren** (of via draft-fallback als published leeg is).

---

## 5. Uitzonderingsweken vs blauwdrukkeuze

1. Als er een **`training_exception_weeks`**-rij is voor de club + gevraagde week:
   - `resolveTrainingWeekForClub` zet `source: 'exception'` en laadt **`training_exceptions`** voor die week (niet de defaults-query).
2. **Teampagina** (`GET /team/:teamId/schedule`): laadt per team exception-rijen; vergelijkt met **defaults van de effectieve blauwdruk** (resolve + published/draft). Als de tuple-set gelijk is aan defaults, wordt geen “afwijkend” getoond (implementatiedetail: `toKey` vergelijking).

**Override aanmaken:** `POST /week/:isoWeek/override` vult exceptions initieel van **`getDefaultTrainingTuplesPublishedOrDraft`** voor de **effectieve** blauwdruk van die week (`resolveBlueprintIdForWeek`).

---

## 6. API-overzicht (planner-relevant)

Alles onder **`/api/training`** in [`training.js`](../../server/routes/training.js), tenzij anders vermeld. Authenticatie: **`verifyToken`** (JWT), behalve waar anders aangegeven. Schrijven: typisch **`canEditTraining`** (club-admin of super_admin).

### Blauwdrukken

| Methode | Pad | Kort |
|---------|-----|------|
| GET | `/blueprints` | Lijst + `active_blueprint_id` + `weeks[]` per afwijkende set. |
| POST | `/blueprints` | Nieuw; optioneel `copy_from_blueprint_id`; `activate: false` mogelijk. |
| POST | `/blueprints/:id/activate` | Zet club-actieve blauwdruk. |
| PATCH | `/blueprints/:id` | Naam, `scope`, `priority`. |
| DELETE | `/blueprints/:id` | Cascade via `deleteBlueprintCascade` (draft + published + …). |
| POST/DELETE | `/blueprints/:id/weeks` | Koppel/ontkoppel ISO-week (alleen `scope === exceptional`). |

### Locaties, velden, inhuur

- **`GET /locations`**, **`GET /venues`**, **`GET /venue-unavailability`**: optionele query **`?blueprint_id=`** — als geldig voor de club, gebruikt die id; **anders** `ensureActiveBlueprint`.
- **POST/PATCH/DELETE** op locaties/venues/unavailability: **`blueprint_id`** in body of query (zie `resolveBlueprintIdFromBodyOrQuery`).

Zo kan de **weekweergave** in de UI locaties/velden van de **effectieve** blauwdruk tonen (`loadAndRender` zet `?blueprint_id=` op basis van `effective_blueprint`), terwijl defaults in blauwdruk-tab uit **`/defaults`** komen (altijd actieve set).

### Defaults (concept-rooster)

| Methode | Pad |
|---------|-----|
| GET | `/defaults` — draft + `draft_differs_from_published` |
| POST | `/defaults/publish`, `/defaults/discard-draft` |
| POST/PATCH | `/defaults`, `/defaults/:id` |
| DELETE | `/defaults/all`, `/defaults/:id` |
| POST | `/defaults/restore` — bulk replace draft (undo-stack in UI) |

### Week & team

| Methode | Pad |
|---------|-----|
| GET | `/week/:isoWeek` — `resolveTrainingWeekForClub` + `effective_blueprint` + `active_blueprint` (editor) |
| POST/DELETE | `/week/:isoWeek/override` |
| GET | `/team/:teamId/schedule` — optioneel `?date=` (bepaalt ISO-week) |

### Snapshots, import, AI

- Snapshots: `/snapshots`, `/snapshots/active`, `POST /snapshots`, `POST /snapshots/:id/activate`, enz. — gekoppeld aan **club-actieve** `blueprint_id`.
- `POST /import`, `POST /ai-optimize` — zie code; AI maakt vaak een snapshot, geen directe draft-mutatie zonder activeren.

### Overig (planner UI)

- `GET /nevobo-match-fields/:isoWeek` — thuiswedstrijden op velden (weekmodus).
- `GET /teams`, `PATCH /teams/:id` — o.a. `trainings_per_week` voor constraints in UI.

---

## 7. Frontend: `training-planner.js`

### Route & shell

- Geregistreerd in [`public/js/app.js`](../../public/js/app.js) als **`training-planner`**.
- Zet **`#app.app-shell.tp-fullwidth`** voor brede layout ([21](./21-training-module-planner-and-exercises.md)).

### Modus

- **`mode === 'blueprint'`**: laadt **`GET /api/training/defaults`** (draft van **actieve** blauwdruk). Toont banner **Publiceren** / **Concept verwerpen** als `draft_differs_from_published`.
- **`mode === 'week'`**: laadt **`GET /api/training/week/:isoWeek`**. Toont **gepubliceerde** (of fallback) standaardtrainingen voor **effectieve** blauwdruk, of exception-set.

### `loadAndRender` (kern)

1. Parallel: snapshots active, blueprints, week **of** defaults.
2. **`effectiveBpId`**: in weekmodus = `weekData.effective_blueprint.id` (fallback: actieve id); in blauwdrukmodus = **altijd** `activeBlueprintId`.
3. Daarna: **`/locations`**, **`/venues`**, **`/venue-unavailability`** met **`?blueprint_id=${effectiveBpId}`** zodat de getoonde kaart/inhuur bij de **week** hoort.

**Belangrijk:** bewerken van trainingblokken in blauwdrukmodus gaat naar **draft** van de **actieve** set — niet per se naar de set die in weekmodus getoond wordt.

### Rechten

- `can_edit` komt van de API; op smalle viewports forceert CSS/JS **read-only** gedrag (zie comments bij `isPlannerMobileViewport`).

---

## 8. Consumers buiten de planner

| Consumer | Pad / bestand | Blauwdruk | Defaults-bron |
|----------|----------------|-----------|---------------|
| Teampagina trainingen | `GET /api/training/team/:teamId/schedule` → [`team.js`](../../public/js/pages/team.js) | `resolveBlueprintIdForWeek` voor betreffende week | `getTeamScheduleDefaultsPublishedOrDraft` |
| Publieke week-API | `GET /api/public/training/week/:isoWeek` | Zelfde als `resolveTrainingWeekForClub` | Zelfde |
| Export | `GET/POST /api/export/training` | `ensureActiveBlueprint` (club default export) | Published, fallback draft |

---

## 9. Database (planner-tabellen, kort)

Zie ook [02-database-and-migrations.md](./02-database-and-migrations.md) voor volledige context.

| Tabel | Planner-relevant |
|-------|------------------|
| `training_blueprints` | `club_id`, `name`, `scope` (`standard`/`exceptional`), `priority`. |
| `training_blueprint_weeks` | `blueprint_id`, `iso_week` — welke weken een **afwijkende** set dekt. |
| `clubs.active_training_blueprint_id` | Editor-focus. |
| `training_locations`, `training_venues` | Per `blueprint_id`. |
| `training_defaults` | Draft-rooster. |
| `training_defaults_published` | Gepubliceerd rooster. |
| `training_venue_unavailability` | Inhuur / geblokkeerde slots; `blueprint_id`. |
| `training_exception_weeks`, `training_exceptions` | Afwijkende kalenderweken. |
| `training_snapshots` | JSON-archief per blauwdruk; `is_active` vlag. |

Migratie **`training_defaults_published_v1`** in [`server/db/db.js`](../../server/db/db.js): eenmalige kopie van bestaande defaults naar published.

---

## 10. Checklist: wijzigingen zonder regressies

Voordat je PR opent, controleer minstens:

- [ ] **Nieuwe “wat zien teams?”-feature:** gebruik **`resolveBlueprintIdForWeek`** + **`getTeamScheduleDefaultsPublishedOrDraft`** of **`getDefaultTrainingsPublishedOrDraft`**, niet alleen `ensureActiveBlueprint`.
- [ ] **Nieuwe planner-schrijfactie op rooster:** schrijf naar **`training_defaults`** (draft) tenzij je expres published beheert; overweeg of **`training_defaults_published`** gesynchroniseerd moet blijven.
- [ ] **Nieuwe route die “standaardtrainingen” leest:** published-eerst, draft-fallback **consistent** met `training-week-resolve.js`.
- [ ] **ISO-week uit query/user input:** normaliseren met **`normalizeIsoWeek`** waar vergelijking met DB nodig is.
- [ ] **Blauwdruk verwijderen/kopiëren:** `deleteBlueprintCascade` / `copyTrainingBlueprint` ook **`training_defaults_published`** bijwerken (al in code; bij uitbreiding tabellen niet vergeten).
- [ ] **Frontend week vs blauwdruk:** als je API’s wijzigt, check zowel **`loadAndRender`**-paden als **teampagina** (`team.js`).

---

## 11. Lokale auto-schedule (naast AI)

- **`POST /api/training/auto-schedule`** — deterministische invuller; body: `mode` (`new` \| `complete`), optioneel `blueprint_id` (anders club-actieve blauwdruk), optioneel **`iso_week`** (dan worden week-specifieke blokkades meegenomen), optioneel **`create_snapshot`** (archief + zelfde activeer-patroon als AI).
- Response o.a. `schedule`, `validation` (harde/zachte), `failures`, **`shortfall`** (ontbrekende minuten per team), `advice`, optioneel `snapshot` / `snapshot_apply_errors`.
- **Frontend:** werkbalk-knop **Automatisch** naast **AI-assistent** (`training-planner.js`).
- Functionele regels: [teamplanning-use-cases-en-vereisten.md](../teamplanning-use-cases-en-vereisten.md) §5–§7.

---

## 12. Testen

- **`test/routes-smoke.test.cjs`** — raakt veel `/api/training/*` routes (geen 500); uitbreiden bij nieuwe endpoints.
- Handmatig: club met **twee** blauwdrukken (één standaard, één afwijkend met gekoppelde week); controleer weekmodus vs blauwdruk-tab vs teampagina voor dezelfde ISO-week.

---

## 13. Gerelateerde documenten

- [21-training-module-planner-and-exercises.md](./21-training-module-planner-and-exercises.md) — routes, CSS, oefeningen/sessies, AI-hook.
- [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) — volledige routelijst.
- [02-database-and-migrations.md](./02-database-and-migrations.md) — SQLite-schema.
- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md) — `navigate`, service worker.
