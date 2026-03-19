# 13 — Omgeving, secrets en security-kader

## Environment-variabelen (bron: `.env.example`)

| Variabele | Doel | Gevoelig? |
|-----------|------|-----------|
| `PORT` | HTTP-poort (default 3000 in code als ontbreekt) | Nee |
| `NODE_ENV` | o.a. `production` | Nee |
| `JWT_SECRET` | Ondertekening/verificatie JWT | **Ja — lang, uniek, nooit committen** |
| `FACE_BLUR_ENABLED` | `true`/`false` — automatische blur bij upload (modellen vereist) | Nee |
| `FACE_BLUR_THRESHOLD` | Afstandsdrempel face-matching (zie comment in .env.example) | Nee |
| `SOCIAL_EMBEDS_ENABLED` | `false` schakelt TikTok/IG interleave in feeds uit | Nee |
| `CLOUDFLARE_TUNNEL_TOKEN` | Tunnel naar productie | **Ja** |
| `PI_*` | Alleen voor `scripts/pull-from-pi` lokaal | Host/user/path |

**Niet in .env.example maar in code:**

- `FACE_BLUR_DEBUG` — string `'true'` geeft extra upload-debug naar client (`social.js`).

## Bestanden die nooit in git horen

- `.env`  
- `data/volleyball.db` (+ `-wal`, `-shm`)  
- `public/uploads/**` (user content)  
- Grote `server/models/*.bin` (face weights) — vaak `.gitignore`; download via `node server/scripts/download-models.js`

## Authenticatie (samenvatting)

- **JWT** in header `Authorization: Bearer <token>`.  
- **Admin-router:** `router.use(verifyToken)` op **alle** `/api/admin/*` routes — dus altijd ingelogd; daarnaast `requireSuperAdmin` / `requireClubAdmin` / `requireTeamAdmin` per route.

## Publiek vs. beschermd (indicatief — altijd code verifiëren)

**Vaak publiek / geen JWT:**

- `GET /api/clubs` (lijst), veel `GET /api/clubs/:id/...`  
- `GET /api/nevobo/*` (feeds; let op rate/PII in responses)  
- `GET /api/social/match/:matchId/media`  
- `GET /api/social/team-media/:teamId` (optioneel token voor `liked_by_me`)  
- `GET /api/social/club/:clubId/feed`  
- `POST /api/social/media/:id/view`, `POST .../social-links/:id/view`  
- `GET /api/carpool/:matchId/summary`  
- `GET /api/gamification/badges`, `/goals`, `/leaderboard/:clubId`  
- Statische files + SPA fallback

**JWT vereist (voorbeelden):**

- `/api/auth/me`, memberships, profile  
- `/api/social/upload`, `/media-feed`, `/follow`, delete media, blur endpoints  
- `/api/admin/*` (altijd + rol)

**Risico’s om te kennen:**

- **Helmet CSP uit** — XSS mitigatie vooral door geen `eval` van user input en sanitization in templates (veel hand-built HTML strings — review bij wijzigingen).  
- **CORS open** — API is niet “verborgen”; bescherming = auth op gevoelige routes.  
- **Match-media publiek** — wie de `matchId` raadt kan media-lijst ophalen (overweging privacy).  
- **Scout JSON op schijf** — permissies op `server/data/scout/`; backup toegang.

## Zie ook

- [12-expectations-expert-vs-documentation.md](./12-expectations-expert-vs-documentation.md)  
- [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md)  
- [16-admin-authorization-detailed.md](./16-admin-authorization-detailed.md)
