# 12 — Verwachtingen: documentatie vs. “expert”

## Kort antwoord

**Nee — alleen deze documentatie lezen maakt een agent (of mens) geen volledige expert.**  
De docs zijn bedoeld als **versnellingsbaan**: snel de architectuur, modules, valkuilen en waar je in de code moet kijken. **Expertise** komt pas bij:

1. **Concrete code lezen** — vooral `social.js`, `nevobo.js`, `reel-viewer.js`, `faceBlur.js` (groot / veel edge cases).  
2. **Runtime gedrag** — netwerk, DB-inhoud, caches, productie-env.  
3. **Iteratie** — bugs oplossen, PR’s reviewen, NeVoBo/TikTok-gedrag dat verandert.

## Wat de technische docs **wel** bieden

- Mentale kaart van repo, entrypoints, routers, DB-lagen.  
- **Waarom**-keuzes en bekende bugs (pagination, `match_id`, embeds).  
- Verwijzingen naar diepere docs (`datamodel-match-media-opponent`).  
- **[13](./13-environment-security-and-secrets.md)** — env-variabelen en security-kader.  
- **[14](./14-api-endpoint-inventory.md)** — volledige route-lijst (machine-leesbaar overzicht).  
- **[datamodel](../datamodel-match-media-opponent.md)**, **[15](./15-nevobo-rss-parse-and-merge.md)**, **[16](./16-admin-authorization-detailed.md)**, **[17](./17-functional-documentation-scope.md)**, **[18](./18-face-blur-thresholds-and-error-paths.md)** — diepgaande onderwerpen.

## Wat **niet** (volledig) in markdown staat en je uit de code moet halen

| Onderwerp | Waar kijken |
|-----------|-------------|
| Exacte request/response JSON per endpoint | Handlers in `server/routes/*.js` |
| Alle SQL-queries en indexen | Zelfde + `db.js` migraties |
| Elke UI-string en CSS-regel | `public/js/pages/*`, `app.css` |
| Gedrag bij elke foutcode | `res.status(...).json` in routes |
| Prestaties en schaal | Meten, niet gedocumenteerd |
| Juridische/AVG-interpretatie | Juridisch kader, niet technisch doc |

## Aanbevolen “expert checklist” voor een agent

Na het lezen van `INDEX.md` + 01–11 + **13** + **14**:

1. Open `server/index.js` en bevestig alle `app.use('/api/...')` mounts.  
2. Traceer één user flow end-to-end (bijv. home reel → `media-feed` → `reel-viewer` → `fetchMore`).  
3. Traceer één upload flow (`POST /upload` → `posts` + `match_media`).  
4. Lees `middleware/auth.js` en één `requireTeamAdmin` route volledig door.  
5. Bekijk `FUNCTIONELE_DOCUMENTATIE.md` in repo-root (functioneel, niet technisch) voor gebruikersperspectief.

**Conclusie:** Met docs + bovenstaande code-paden ben je **sterk voorbereid**; “expert” is een continu proces, geen eenmalige leesactie.
