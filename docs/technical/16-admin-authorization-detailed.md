# 16 — Admin-API: autorisatie in detail

**Router:** `server/routes/admin.js`  
**Globaal:** `router.use(verifyToken)` — **elke** `/api/admin/*` call vereist geldige JWT.

**Inventory:** [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) (bijgewerkt; profile/delete hieronder volledig).

---

## 1. Rollen toewijzen / intrekken

### `POST /api/admin/roles`

| Nieuwe rol | Wie mag? | Extra |
|------------|----------|--------|
| `super_admin` | Alleen `hasSuperAdmin(granter)` | — |
| `club_admin` | Alleen super_admin | `club_id` verplicht |
| `team_admin` | Super_admin **of** `hasClubAdmin(granter, team.club_id)` | `team_id` verplicht, team moet bestaan |

Duplicate role → `409` UNIQUE.

### `DELETE /api/admin/roles/:id`

| Rol op regel | Wie mag intrekken? |
|--------------|-------------------|
| `super_admin`, `club_admin` | Alleen super_admin |
| `team_admin` | Super_admin **of** club_admin van het team zijn club |

---

## 2. Super-admin only

### `GET /api/admin/users?q=`

- `requireSuperAdmin` — zoek users op naam/e-mail (max 50).

---

## 3. Club admin (`requireClubAdmin('clubId')`)

### `GET /api/admin/clubs/:clubId/admins`

- Lijst club_admins + team_admins binnen die club + teamnamen.

### `GET /api/admin/clubs/:clubId/users`

- Zoek/filter users die bij de club horen (via `users.club_id` of teamlidmaatschap in club) — zie query in broncode voor exacte filters.

---

## 4. Team admin (`requireTeamAdmin('teamId')`)

### Leden

- `GET/POST /api/admin/teams/:teamId/members`
- `PATCH /api/admin/teams/:teamId/members/:userId`
- `DELETE /api/admin/teams/:teamId/members/:userId`

### Team social links

- `GET/POST /api/admin/teams/:teamId/social-links`
- `DELETE /api/admin/teams/:teamId/social-links/:linkId`

---

## 5. Profiel van willekeurige user (geen vaste middleware — logica **in** handler)

### `GET /api/admin/users/:userId/profile`

**Mag bekijken** als **één van**:

1. `hasSuperAdmin(requester)`
2. Target heeft `users.club_id` en `hasClubAdmin(requester, die club)`
3. Target is lid van minstens één team waarvoor `hasTeamAdmin(requester, team_id)`

Anders `403`. Onbekende user → `404`.

### `POST /api/admin/users/:userId/profile`

Body: `name`, `email`, `birth_date`, optioneel `password`.

**Mag bewerken** (zelfde drie voorwaarden als GET — super, club admin van user's club, of team admin van een team waar de target in zit).

**E-mail:** uniek; conflict → `409`.

**Wachtwoord reset:** alleen als `password` non-empty:

- Toegestaan: **super_admin** of **club_admin** van de club van de target (`users.club_id`).
- **Niet** toegestaan: team_admin alleen → `403` "Alleen clubbeheerders mogen wachtwoorden resetten".
- Lengte ≥ 6 anders `400`.

Geen velden → `400`.

---

## 6. `GET /api/admin/my-roles`

- Alleen `verifyToken` (via router) — elke ingelogde user ziet eigen `user_roles` + context.

---

## 7. User delete

### `DELETE /api/admin/users/:userId`

1. Zelf verwijderen → `400`.
2. Target bestaat niet → `404`.
3. **Mag verwijderen** als:
   - `hasSuperAdmin(requester)`, **of**
   - `hasClubAdmin(requester, cid)` voor **minstens één** `cid` in `targetClubIds`:
     - `users.club_id` van target
     - plus alle `club_id`'s van teams waar de target in zit (via `team_memberships` → `teams`).

4. **Team_admin zonder club_admin** kan **niet** verwijderen → `403`.

**Side effects vóór `DELETE FROM users`:**

- Face-reference bestanden fysiek verwijderen onder `public/`.
- Lokale avatar onder `/uploads/` verwijderen.
- `match_media.user_id` en `posts.user_id` op `NULL` (media blijft staan).
- Daarna `DELETE FROM users` — overige rijen via FK cascade (waar van toepassing).

---

## 8. Samenvatting matrix

| Actie | Super | Club admin* | Team admin* |
|-------|-------|-------------|-------------|
| Zoek users | ✓ | — | — |
| Rollen super/club | ✓ | — | — |
| Rol team_admin geven | ✓ | ✓ (eigen club) | — |
| Club users/admins inzien | ✓ | ✓ (eigen club) | — |
| Team leden CRUD | ✓ | ✓** | ✓ (eigen team) |
| Profiel lezen/bewerken (naam, email, geboorte) | ✓ | ✓ | ✓ (als teamlid) |
| Wachtwoord reset | ✓ | ✓ (club van user) | ✗ |
| User delete | ✓ | ✓ (club-scope) | ✗ |
| Team social links | ✓ | ✓** | ✓ (eigen team) |

\* *eigen club/team*  
\** afhankelijk van implementatie `requireClubAdmin` — club admin heeft bredere club-scope; exacte overlap: code `admin.js`.

---

## Zie ook

- `server/middleware/auth.js` — `hasSuperAdmin`, `hasClubAdmin`, `hasTeamAdmin`, `require*`.
- [13-environment-security-and-secrets.md](./13-environment-security-and-secrets.md).
