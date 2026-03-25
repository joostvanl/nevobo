# 21 — Trainingsmodule, planner, oefeningen en sessies

**Doel:** Functioneel en technisch overzicht van training gerelateerde UI (`public/js/pages/training-*.js`), styling en API (`server/routes/training.js`). Aanvulling op [02-database-and-migrations.md](./02-database-and-migrations.md) (tabellen) en [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) (route-lijst).

---

## Frontend-routes (`navigate` / header-menu)

| Route | Module | Wie | Kort |
|-------|--------|-----|------|
| `training-planner` | `training-planner.js` | Clubbeheerders (`user.roles` niet leeg), club vereist | Blauwdruk + weekweergave, locaties/velden, snapshots, NeVoBo-koppeling, AI-optimalisatie (webhook). |
| `training-module` | `training-module.js` | Zelfde als planner | Full-screen **beheerderscockpit**: goedkeuringsworkflow (privé → club), oefeningenbibliotheek, tags, richtlijnen + lokale clubnotities. |
| `training-session` | `training-session.js` | Ingelogd + teamlid (via teampagina) | Eén concrete training: aanwezigheid, notities, programma (oefeningen uit bibliotheek), gasten, `request-share` voor privé-oefeningen. |

**Navigatie naar sessie:** vanaf `team.js` — klik op regel in het trainingsschema → `navigate('training-session', { teamId, date, startTime, … })`.

---

## Full-width shell (zoals planner)

`training-planner.js` en `training-module.js` zetten bij render **`document.getElementById('app')?.classList.add('tp-fullwidth')`**. In `public/css/training-planner.css` breekt `#app.app-shell.tp-fullwidth` de smalle mobiele `max-width` van de app-shell.

`navigate()` in `app.js` verwijdert `tp-fullwidth` vóór elke pagina-load; de betreffende pagina zet de class weer als die actief wordt.

---

## Stylesheets

| Bestand | Gebruik |
|---------|---------|
| `public/css/training-planner.css` | Planner: rooster, contextbalk, teamkleuren, panels. |
| `public/css/training-module.css` | Trainingsmodule: hero, tabs, workflow/bibliotheek/drawer, richtlijnen. |

Beide worden in `index.html` na `app.css` gelinkt.

---

## Trainingsmodule (clubbeheer) — gedrag

- **Workflow:** openstaande `pending-share`-aanvragen; goedkeuren zet `scope` op `club`, afwijzen zet `share_status` op `rejected` (zie API).
- **Bibliotheek:** alleen club-oefeningen (`scope === 'club'`); zoeken, filters op tag/moeilijkheid, sorteren; zij-drawer voor bewerken (PATCH), dupliceren (POST), verwijderen, JSON-export. **Vastpinnen** en **clubnotities (richtlijnen-tab)** leven in **`localStorage`** per `club_id` (`volley_tm_pins_*`, `volley_tm_guidelines_*`) — niet gesynchroniseerd tussen apparaten.
- **Vaardigheden:** CRUD op `training_skill_tags` (server).
- **Richtlijnen:** statische accordion-secties in de UI + optionele clubnotities (lokaal).

---

## Oefeningen — scopes en delen

- **`club`:** zichtbaar voor iedereen in de club in de bibliotheek; aanmaken/wijzigen/verwijderen via clubbeheer (en API-regels).
- **`private`:** zichtbaar voor maker + gebruik in sessies; **delen** via `POST .../request-share` met `share_pitch` (min. 20 tekens); beheer keurt goed/af.

Zie ook [OWASP-rapport](../owasp-security-report.md) (trainingssessies gekoppeld aan teamlidmaatschap).

---

## AI / N8N (planner)

Webhook en prompt-opbouw: `server/routes/training.js`; systeemprompts (revisies, omgeving dev/prod) worden beheerd via **trainingsplanner → knop AI-prompts** (alleen opperbeheerders), niet via de beheerderspagina. Functionele beschrijving: [../n8n-training-optimizer-prompt.md](../n8n-training-optimizer-prompt.md).

---

## Zie ook

- [02-database-and-migrations.md](./02-database-and-migrations.md) — `training_*` tabellen  
- [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) — `/api/training/*`  
- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md) — routing en SW/cache
