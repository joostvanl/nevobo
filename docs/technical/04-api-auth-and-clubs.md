# 04 — API: auth en clubs

## Authenticatie (`server/routes/auth.js` + `middleware/auth.js`)

### JWT

- **Secret:** `process.env.JWT_SECRET` (fallback `dev_secret_change_me` — **niet** in productie laten staan)  
- Payload bevat minimaal `user.id`; routes gebruiken `req.user`

### Middleware

| Functie | Gedrag |
|---------|--------|
| `verifyToken` | 401 zonder token; 403 bij ongeldige JWT |
| `optionalToken` | Zet `req.user` als Bearer geldig is; anders door |

### Rollen (`user_roles`)

- `super_admin` — alles  
- `club_admin` + `club_id` — club-scope  
- `team_admin` + `team_id` — team-scope (of club_admin van de club van het team)

**`hasTeamAdmin` / `requireTeamAdmin`** — gebruikt in admin- en sommige social-routes.

### Endpoints (auth)

| Methode | Pad | Auth | Doel |
|---------|-----|------|------|
| POST | `/api/auth/register` | — | Nieuw account + club |
| POST | `/api/auth/login` | — | Token + user object |
| GET | `/api/auth/me` | verify | Huidige user + uitbreidingen |
| GET | `/api/auth/memberships` | verify | `team_memberships` |
| POST | `/api/auth/memberships` | verify | Lid worden van team |
| DELETE | `/api/auth/memberships/:teamId` | verify | Verlaten |
| PATCH | `/api/auth/profile` | verify | Profielvelden |
| POST | `/api/auth/avatar` | verify | Multer upload avatar |
| POST | `/api/auth/face-reference` | verify | Referentie voor blur-matching |
| … | face-references | verify | Lijst/verwijderen referenties |

## Clubs (`server/routes/clubs.js`)

- **GET `/api/clubs`** — publiek: lijst clubs (o.a. registratieformulier)  
- **GET `/api/clubs/:id`**, **`/:id/teams`**, **`/:id/teams/:teamId`** — detail + teams  
- **POST** routes — `verifyToken`; sync met NeVoBo (`sync-teams`) voor actuele teamlijst

**Afhankelijkheid:** NeVoBo-routes/data voor `nevobo_code` validatie/sync.

## Waarom `users.team_id` én `team_memberships`?

Historisch: simpele default team op user. **Bron van waarheid voor rechten en feeds:** `team_memberships` + follows. UI moet bij multi-team geen `myTeams[0]` blind gebruiken (zie matches-upload).

## Zie ook

- [05-api-nevobo.md](./05-api-nevobo.md)  
- [07-api-carpool-gamification-admin.md](./07-api-carpool-gamification-admin.md) (admin)
