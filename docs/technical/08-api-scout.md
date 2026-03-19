# 08 — API: Scout (wedstrijd scouting)

## Router

`server/routes/scout.js`

## Opslag

- **Directory:** `server/data/scout/` (onder repo; wordt aangemaakt indien nodig)  
- **Bestandsnaam:** `<matchId>.json` — `matchId` moet voldoen aan `validMatchId` (alphanumeriek + `_-`, max 128)

**Waarom geen SQLite voor scout JSON:** grote/gespecialiseerde documentstructuur (rotaties, events); file-based is eenvoudig te backuppen en te debuggen. Trade-off: geen relationele queries over scout-data.

## Locks (concurrent edit)

- **In-memory `Map`** `scoutLocks` — **niet** gedeeld over meerdere server-processen (geen clustering)  
- Lock bevat `userId`, `userName`, `tabId`, `lastHeartbeat`  
- **Timeout:** 45s zonder heartbeat → lock vrij  
- Endpoints: `lock`, `unlock`, `heartbeat`

**Reden:** voorkomen dat twee trainers tegelijk dezelfde file overschrijven. Op meerdere Node-instances zou Redis o.i.d. nodig zijn.

## Endpoints (samenvatting)

| Methode | Pad | Auth | Doel |
|---------|-----|------|------|
| GET | `/api/scout/` | — | Health |
| GET | `/sessions` | verify | Lijst JSON-files voor user’s context |
| GET | `/status/:matchId` | optional | Lock + completed |
| GET | `/match/:matchId` | verify | Lees JSON |
| POST | `/match/:matchId` | verify | Schrijf JSON |
| POST | `/match/:matchId/complete` | verify | Markeer afgerond |
| POST | `/match/.../lock|unlock|heartbeat` | verify/optional | Lock lifecycle |

## Toegang

`isCoachOrAdmin(userId)` — rollen in `user_roles` of `team_memberships.membership_type = 'coach'`.

## Frontend (huidige branch)

In **`public/js/app.js`** (dynamische imports + `registerRoute`):

| Route-id | Label | Page-module |
|----------|-------|-------------|
| `scout-setup` | 🏐 Scout setup | `./pages/scout-setup.js` |
| `scout-match` | 🏐 Scouting | `./pages/scout-match.js` |

**Client-hulpmodules:** `public/js/scout/utils.js`, `rotation.js`, `dialog.js`, `rules.js`, `match.js` (door pages geïmporteerd).

**Afwijkingen:** Andere branches kunnen extra scout-routes of menu-items toevoegen — diff `app.js` en `pages/scout-*.js` bij merge.

## Zie ook

- [01-architecture-overview.md](./01-architecture-overview.md)  
- [02-database-and-migrations.md](./02-database-and-migrations.md)
