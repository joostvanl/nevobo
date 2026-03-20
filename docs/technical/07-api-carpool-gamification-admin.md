# 07 — API: carpool, gamification, admin

## Carpool

**Uitgebreide gedrags- en autorisatiegids (verplicht lezen voor carpool-taken):** [20-carpool-behavior-and-authorization.md](./20-carpool-behavior-and-authorization.md)

### Wedstrijd-liften (`server/routes/carpool.js`)

- **Identificatie wedstrijd:** `match_id` (string, zelfde als NeVoBo/upload)  
- **GET `/:matchId/summary`** — `optionalToken`: zonder JWT leeg overzicht; met JWT gefilterd op teamlidmaatschap (zie doc 20)  
- **GET `/:matchId`** — detail (auth), gefilterde offers  
- **POST `/:matchId/offer`** — aanbod plaatsen  
- **DELETE `/offer/:offerId`**, **POST `/offer/:offerId/book`**, **DELETE `/booking/:bookingId`**

### Coach / seizoensplanner (`server/routes/carpool-coach.js`)

- Gemount op **`/api/carpool/coach`** in `server/app.js` **vóór** de hoofd-carpool-router (voorkomt route-conflict met `/:matchId`).  
- Endpoints o.a. `GET /teams`, `POST /plan-season`, `GET /team/:teamId/stats`, `PATCH /offer/:offerId`.

**Reden aparte carpool-router (t.o.v. social):** los van social maar wel zelfde `match_id` als wedstrijdpagina.

## Gamification (`server/routes/gamification.js`)

- Badges, goals, leaderboard per club  
- `POST /check-badges`, `/goal-progress`, `/award-xp` — server triggert uit andere flows (auth, social, carpool) via `awardBadgeIfNew` e.d.

## Admin (`server/routes/admin.js`)

- **Super admin:** user-lijst, rollen toewijzen/verwijderen, user delete  
- **Club admin:** club users, admins  
- **Team admin:** leden toevoegen/wijzigen/verwijderen, profielvelden spelers, **social links** (alternatief voor team-leden flow in `social.js`)

**Middleware:** `router.use(verifyToken)` op alle routes; daarnaast `requireSuperAdmin`, `requireClubAdmin('clubId')`, `requireTeamAdmin('teamId')` uit `middleware/auth.js`.

**Volledige matrix (profiel, wachtwoord reset, delete):** [16-admin-authorization-detailed.md](./16-admin-authorization-detailed.md).

## Zie ook

- [20-carpool-behavior-and-authorization.md](./20-carpool-behavior-and-authorization.md)  
- [04-api-auth-and-clubs.md](./04-api-auth-and-clubs.md)  
- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)
