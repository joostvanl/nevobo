# 07 — API: carpool, gamification, admin

## Carpool (`server/routes/carpool.js`)

- **Identificatie wedstrijd:** `match_id` (string, zelfde als NeVoBo/upload)  
- **GET `/:matchId/summary`** — publiek: vrije plekken etc.  
- **GET `/:matchId`** — detail (auth)  
- **POST `/:matchId/offer`** — aanbod plaatsen  
- **DELETE `/offer/:offerId`**, **POST `/offer/:offerId/book`**, **DELETE `/booking/:bookingId`**

**Reden aparte router:** los van social maar wel zelfde `match_id` als wedstrijdpagina.

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

- [04-api-auth-and-clubs.md](./04-api-auth-and-clubs.md)  
- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)
