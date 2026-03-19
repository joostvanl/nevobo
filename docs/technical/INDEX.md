# Technische documentatie — index

**Doel:** Eén startpunt voor een junior AI-agent (of ontwikkelaar) om de VolleyApp-codebase te begrijpen: modules, afhankelijkheden, API’s en **waarom** bepaalde keuzes zijn gemaakt.

**Repo-root:** projectmap `Team/` (Node + Express + vanilla ES-modules frontend + SQLite).

---

## Snel zoeken (onderwerp → document)

| Zoekterm / onderwerp | Document |
|----------------------|----------|
| Stack, entrypoint, mappenstructuur | [01-architecture-overview.md](./01-architecture-overview.md) |
| SQLite, schema, migraties, `feed_cache`, `match_media` | [02-database-and-migrations.md](./02-database-and-migrations.md) |
| `app.js`, routing, `navigate`, state, service worker | [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md) |
| Login, JWT, rollen, clubs, teams sync | [04-api-auth-and-clubs.md](./04-api-auth-and-clubs.md) |
| NeVoBo RSS, wedstrijden, `match_id`, geocoding | [05-api-nevobo.md](./05-api-nevobo.md) |
| Upload, reel, media-feed, team-media, TikTok/Instagram, blur | [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md) |
| Carpool, badges, XP, admin endpoints | [07-api-carpool-gamification-admin.md](./07-api-carpool-gamification-admin.md) |
| Scout (JSON files, locks, match state) | [08-api-scout.md](./08-api-scout.md) |
| faceBlur, TensorFlow, Sharp, tiktok-scraper | [09-services-face-blur-and-libs.md](./09-services-face-blur-and-libs.md) |
| Docker, env, CSP, cache-busting | [10-deployment-pwa-and-caching.md](./10-deployment-pwa-and-caching.md) |
| Patronen, trade-offs, bekende valkuilen | [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md) |
| Docs vs. “expert”, wat je nog in code moet lezen | [12-expectations-expert-vs-documentation.md](./12-expectations-expert-vs-documentation.md) |
| `.env`, secrets, JWT, publiek vs. beschermd, risico’s | [13-environment-security-and-secrets.md](./13-environment-security-and-secrets.md) |
| Volledige API-route-inventory (`/api/*`) | [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) |
| `match_id`, media, tegenstander (datamodel) | [../datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md) |
| NeVoBo RSS-parse, caches, merge | [15-nevobo-rss-parse-and-merge.md](./15-nevobo-rss-parse-and-merge.md) |
| Admin-autorisatie (profile, delete, rollen) | [16-admin-authorization-detailed.md](./16-admin-authorization-detailed.md) |
| `FUNCTIONELE_DOCUMENTATIE.md` — scope | [17-functional-documentation-scope.md](./17-functional-documentation-scope.md) |
| Face blur drempels & foutpaden | [18-face-blur-thresholds-and-error-paths.md](./18-face-blur-thresholds-and-error-paths.md) |

---

## Module-overzicht (bestand → rol)

### Server (`server/`)

| Pad | Rol |
|-----|-----|
| `index.js` | Express-app: middleware, static `public/`, mount van alle `/api/*` routers, SPA-fallback, faceBlur model preload |
| `db/db.js` | SQLite (`data/volleyball.db`), schema + incrementele migraties |
| `db/schema.sql` | Basis-tabellen (clubs, teams, users, posts, match_media, …) |
| `middleware/auth.js` | JWT verify/optional, `user_roles`, club/team admin checks |
| `routes/auth.js` | Register/login/me, memberships, profile, avatar, face references |
| `routes/clubs.js` | Clubs CRUD, teams, sync van NeVoBo |
| `routes/nevobo.js` | RSS/ical, `feed_cache`, schedule/results, search, travel |
| `routes/social.js` | Posts, upload, match/team/home media, likes, comments, follow, embeds |
| `routes/carpool.js` | Offers, bookings per `match_id` |
| `routes/gamification.js` | Badges, goals, leaderboard, XP |
| `routes/admin.js` | Super/club/team admin, users, social links (admin) |
| `routes/scout.js` | Scout-sessies als JSON op schijf + in-memory locks |
| `services/faceBlur.js` | Gezichtsdetectie, blur, kwaliteitscheck upload |
| `lib/tiktok-scraper.js` | Optioneel — profiel-sync / vm-URL; zie `docs/tiktok-scraper.md` |

### Frontend (`public/`)

| Pad | Rol |
|-----|-----|
| `index.html` | Shell, auth + app, externe libs (Leaflet, Chart.js, cookie consent), `app.js?v=…` cache-bust |
| `js/app.js` | State, `api()`, routing (`registerRoute` / `navigate`), toasts, team picker, badge unlock |
| `js/pages/*.js` | Eén (logische) pagina per bestand: home, matches, team, profile, admin, … |
| `js/reel-viewer.js` | Fullscreen reel: video/foto/TikTok/Instagram, lazy TikTok, `fetchMore` + `mediaCount()` |
| `js/scout/*.js` | Client scout-hulpmodules — routes: [08](./08-api-scout.md) |
| `sw.js` | Service worker: cache-naam bump, network-first voor JS/CSS |
| `css/app.css` | Styling |

### Overig

| Pad | Rol |
|-----|-----|
| `scripts/` | Onderhoud, debug, sync (niet deel van runtime app) |
| `docs/datamodel-match-media-opponent.md` | `match_id`, teams, media-koppeling, feed_cache |
| `docs/tiktok-scraper.md` | TikTok sync — **zie implementatiestatus in dat bestand** |
| `FUNCTIONELE_DOCUMENTATIE.md` (root) | Functioneel productdoc — [17](./17-functional-documentation-scope.md) |

---

## Leesvolgorde voor een “lege” agent

1. [01-architecture-overview.md](./01-architecture-overview.md)  
2. [02-database-and-migrations.md](./02-database-and-migrations.md)  
3. [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md)  
4. API-docs 04–08 afhankelijk van de taak (meestal 06 voor media/reel).  
5. [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md) voor valkuilen (pagination, `match_id`, embeds).  
6. [12-expectations-expert-vs-documentation.md](./12-expectations-expert-vs-documentation.md) — realistische verwachting “expert”.  
7. [13-environment-security-and-secrets.md](./13-environment-security-and-secrets.md) + [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) — env, security-kader, alle routes.  
8. [../datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md), [15](./15-nevobo-rss-parse-and-merge.md), [16](./16-admin-authorization-detailed.md), [17](./17-functional-documentation-scope.md), [18](./18-face-blur-thresholds-and-error-paths.md) — waar nodig voor de taak.

---

*Laatste uitbreiding: datamodel-doc + 15–18 (NeVoBo diepgaand, admin-auth, functionele doc-scope, face-blur foutpaden).*
