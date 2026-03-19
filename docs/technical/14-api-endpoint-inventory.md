# 14 — API-endpoint inventory

**Doel:** Machine- en mens-leesbaar overzicht van alle gemounte routes.  
**Prefix:** elk pad hieronder is relatief ten opzichte van de mount in `server/app.js` (Express-app; `server/index.js` start alleen de server).

**Legenda middleware (afkorting):**  
- `V` = `verifyToken`  
- `O` = `optionalToken`  
- `SA` = `requireSuperAdmin`  
- `CA` = `requireClubAdmin`  
- `TA` = `requireTeamAdmin`  
- `—` = geen auth middleware op route (publiek tenzij router-level middleware)

---

## `/api/auth` — `routes/auth.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| POST | `/register` | — |
| POST | `/login` | — |
| GET | `/me` | V |
| GET | `/memberships` | V |
| POST | `/memberships` | V |
| DELETE | `/memberships/:teamId` | V |
| PATCH | `/profile` | V |
| POST | `/avatar` | V (+ multer) |
| POST | `/face-reference` | V (+ multer) |
| DELETE | `/face-reference/:id` | V |
| GET | `/face-references` | V |

---

## `/api/clubs` — `routes/clubs.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/` | — |
| POST | `/` | V + `requireSuperAdmin` |
| GET | `/:id` | — |
| GET | `/:id/teams` | — |
| GET | `/:id/teams/:teamId` | — |
| POST | `/:id/teams` | V |
| POST | `/:id/sync-teams` | V |
| GET | `/:id/members` | — |

---

## `/api/nevobo` — `routes/nevobo.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/team-by-name` | — |
| GET | `/poule-stand` | — |
| GET | `/team-recent-results` | — |
| GET | `/club/:code/schedule` | — |
| GET | `/club/:code/results` | — |
| GET | `/team/:code/:type/:number/schedule` | — |
| GET | `/team/:code/:type/:number/results` | — |
| GET | `/team/:code/:type/:number/calendar` | — |
| GET | `/poule/:regio/:poule/standings` | — |
| GET | `/geocode` | — |
| GET | `/travel-time` | — |
| GET | `/search` | — |
| GET | `/opponent-clubs` | — |
| POST | `/validate` | — |
| GET | `/cache-stats` | — |
| DELETE | `/cache` | — |
| DELETE | `/cache/:code` | — |

---

## `/api/carpool` — `routes/carpool.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/:matchId/summary` | — |
| GET | `/:matchId` | V |
| POST | `/:matchId/offer` | V |
| DELETE | `/offer/:offerId` | V |
| POST | `/offer/:offerId/book` | V |
| DELETE | `/booking/:bookingId` | V |

---

## `/api/social` — `routes/social/` (`index.js` + `mount-routes.js`, helpers in zelfde map)

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/feed` | V |
| GET | `/club/:clubId/feed` | — |
| POST | `/post` | V |
| POST | `/upload` | V (+ multer array) |
| GET | `/match/:matchId/media` | — |
| POST | `/media/:id/view` | — |
| POST | `/media/:id/like` | V |
| GET | `/media/:id/comments` | — |
| POST | `/media/:id/comments` | V |
| GET | `/my-media` | V |
| DELETE | `/media/:id` | V |
| GET | `/media/:id/has-original` | V |
| POST | `/media/:id/revert-blur` | V |
| POST | `/media/:id/reblur` | V |
| GET | `/media/:id/detect-faces` | V |
| POST | `/media/:id/toggle-face-blur` | V |
| POST | `/media/:id/blur-at-point` | V |
| POST | `/follow` | V |
| DELETE | `/follow` | V |
| GET | `/following` | V |
| GET | `/home-summary` | V |
| GET | `/media-feed` | V |
| GET | `/team-media/:teamId` | O |
| GET | `/followers/:userId` | — |
| POST | `/teams/:teamId/social-links` | V |
| DELETE | `/teams/:teamId/social-links/:linkId` | V |
| POST | `/social-links/:id/view` | — |

---

## `/api/gamification` — `routes/gamification.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/badges` | — |
| GET | `/goals` | — |
| GET | `/my` | V |
| GET | `/leaderboard/:clubId` | — |
| POST | `/award-xp` | V |
| POST | `/check-badges` | V |
| POST | `/goal-progress` | V |

---

## `/api/admin` — `routes/admin.js`

**Router-level:** `router.use(verifyToken)` — **alle** onderstaande routes vereisen JWT.

| Methode | Pad | Extra |
|---------|-----|--------|
| GET | `/users` | SA |
| POST | `/roles` | (intern: hierarchy checks) |
| DELETE | `/roles/:id` | (intern) |
| GET | `/clubs/:clubId/admins` | CA |
| GET | `/clubs/:clubId/users` | CA |
| GET | `/teams/:teamId/members` | TA |
| POST | `/teams/:teamId/members` | TA |
| PATCH | `/teams/:teamId/members/:userId` | TA |
| DELETE | `/teams/:teamId/members/:userId` | TA |
| GET | `/users/:userId/profile` | (intern: rechten) |
| POST | `/users/:userId/profile` | (intern) |
| GET | `/my-roles` | — |
| DELETE | `/users/:userId` | (intern) |
| GET | `/teams/:teamId/social-links` | TA |
| POST | `/teams/:teamId/social-links` | TA |
| DELETE | `/teams/:teamId/social-links/:linkId` | TA |

**Profiel (`GET`/`POST /users/:userId/profile`) en user-delete (`DELETE /users/:userId`):** volledige regels staan in [16-admin-authorization-detailed.md](./16-admin-authorization-detailed.md) (super / club / team admin, wachtwoord-reset alleen club+).

---

## `/api/platform/*` — `server/app.js`

**Middleware:** `verifyToken` + `requireSuperAdmin` per route.

| Methode | Pad (volledig) | Extra |
|---------|----------------|--------|
| GET | `/api/platform/settings` | Lijst feature toggles |
| PATCH | `/api/platform/settings` | Body: `{ scout_enabled, … }` of `{ settings: { … } }` |

---

## `/api/scout` — `routes/scout.js`

| Methode | Pad | Middleware |
|---------|-----|------------|
| GET | `/` | — |
| GET | `/sessions` | V |
| GET | `/status/:matchId` | O |
| POST | `/match/:matchId/lock` | V |
| POST | `/match/:matchId/unlock` | O |
| POST | `/match/:matchId/heartbeat` | V |
| GET | `/match/:matchId` | V |
| POST | `/match/:matchId` | V |
| POST | `/match/:matchId/complete` | V |

---

## Onderhoud

Bij nieuwe routes: deze lijst bijwerken of opnieuw genereren uit `grep router\.(get|post|delete|patch)` in `server/routes/`.
