# 20 — Carpool: gedrag, autorisatie en frontend (agent-handleiding)

**Doel:** Een junior AI-agent (of ontwikkelaar) kan **zonder code te raden** begrijpen hoe carpool werkt, **waar** regels enforced worden, en **wat** bij wijzigingen kapot gaat.

**Lees dit vóór** je `carpool.js`, `carpool-coach.js`, `matches.js` of `middleware/auth.js` voor carpool-taken aanpast.

---

## 1. Mental model

- Een **wedstrijd** wordt overal met dezelfde **`match_id`** (string) aangeduid als op de NeVoBo-/wedstrijdpagina (`encodeMatchId` in frontend).
- Een **lift** = rij in `carpool_offers`. Optioneel gekoppeld aan een **team** via `team_id`:
  - **`team_id` gezet** → vaak **teamcarpool** (door coach gegenereerd, `coach_planned = 1`).
  - **`team_id` NULL** → **privé-aanbod** (gebruiker biedt zelf een lift).
- **Boekingen** = `carpool_bookings` gekoppeld aan `offer_id`.

**Privacy / segmentatie:** gebruikers mogen **geen** carpool-details zien van teams waar ze **geen onderdeel van zijn** (met uitzonderingen voor beheer en eigen data). De server **filtert**; de frontend verbergt extra UI waar nodig.

---

## 2. Bestanden (single source of truth)

| Pad | Rol |
|-----|-----|
| `server/app.js` | **Mount-volgorde:** eerst `app.use('/api/carpool/coach', …)`, daarna `app.use('/api/carpool', …)`. Zie §3. |
| `server/routes/carpool.js` | Offers, bookings, summary, `viewerMaySeeCarpoolOffer`. |
| `server/routes/carpool-coach.js` | Seizoensplanner (coach-only), stats, PATCH coach-aanbod. |
| `server/middleware/auth.js` | `canManageTeamCarpool`, `canPlanTeamCarpoolSeason`, `optionalToken`, `verifyToken`. |
| `public/js/pages/carpool.js` | Route `carpool`: lijst eigen teams, coach-kaart, detail per wedstrijd. |
| `public/js/pages/matches.js` | Carpool-badge, summary-fetch met **Bearer**, detailblok wedstrijd. |
| `public/js/pages/team.js` | Link “Carpool →” bij eigen team; carpool staat ook in de bottom-nav (`public/index.html`). |
| `public/index.html` | `app.js?v=…` cache-bust. |
| `public/sw.js` | `CACHE_NAME` — bump bij relevante static wijzigingen. |

---

## 3. Kritiek: Express-mount en route-conflicten

**Probleem dat we hebben opgelost:** als alle routes in **één** router zitten, kan `GET /:matchId` soms vóór of in plaats van `GET /coach/teams` worden gematcht (omgeving/versioning).

**Oplossing:** coach-endpoints staan in **`carpool-coach.js`** en worden in `app.js` **vóór** de algemene carpool-router gemount:

```text
/api/carpool/coach/*  →  routes/carpool-coach.js  (paden: /teams, /plan-season, …)
/api/carpool/*        →  routes/carpool.js        (paden: /:matchId/summary, /:matchId, …)
```

**Volledige URL-voorbeelden:**

- `GET /api/carpool/coach/teams`
- `POST /api/carpool/coach/plan-season`
- `GET /api/carpool/<matchId>/summary`
- `GET /api/carpool/<matchId>`

**Plan-season algoritme** (per wedstrijd):

1. Bestaande capaciteit tellen — `SUM(1 + seats_available)` over handmatige team-aanbiedingen (`coach_planned = 0`). Dit zijn chauffeur + passagiersplekken per auto.
2. Oude coach-geplande liften verwijderen (`coach_planned = 1`).
3. Geen nieuwe auto’s als bestaande capaciteit ≥ `total_travelers`.
4. Anders: `shortfall = total_travelers − bestaande capaciteit`, `nieuwe_auto’s = ceil(shortfall / seats_per_car)`.
5. Chauffeurs kiezen uit de pool, met uitsluiting van leden die al een handmatig aanbod hebben voor diezelfde wedstrijd (voorkomt dubbele toewijzing). Eerlijkste verdeling: wie minst vaak gereden heeft gaat eerst.
6. Elk nieuw aanbod krijgt `seats_available = seats_per_car − 1` (volledige passagierscapaciteit).

**Agent-check:** wijzig je `app.js` mount-volgorde niet zonder dit te begrijpen.

---

## 4. Twee verschillende “wie mag wat?”-functies

Beide staan in `server/middleware/auth.js`. **Niet door elkaar halen.**

| Functie | Bedoeling | Wie krijgt `true` (kort) |
|---------|-----------|---------------------------|
| **`canPlanTeamCarpoolSeason(userId, teamId)`** | Seizoensplanner + coach-API voor **één team** | Alleen als `team_memberships` voor dat team `membership_type = 'coach'`. |
| **`canManageTeamCarpool(userId, teamId)`** | Liften/boekingen **beheren** op wedstrijdpagina (verwijderen, passagier eruit) voor **teamcarpool** | Super admin, club admin van die club, team admin van dat team, **of** coach-lidmaatschap op dat team. |

**Regel voor agents:**  
- “**Genereer carpool** / plan-season / coach stats / PATCH coach-offer” → **`canPlanTeamCarpoolSeason`**.  
- “**Moderatie** op bestaande team-liften (DELETE offer/booking als niet-eigenaar)” → **`canManageTeamCarpool`**.

---

## 5. Zichtbaarheid van liften: `viewerMaySeeCarpoolOffer`

**Locatie:** `server/routes/carpool.js` (functie + gebruik in summary, GET offers, POST book).

Een gebruiker **ziet** een aanbod als **één van** het volgende waar is:

1. **Eigen aanbod** (`offer.user_id === viewerId`).
2. **Teamcarpool** (`offer.team_id` gezet):  
   - viewer is **lid** van dat team (`team_memberships`), **of**  
   - viewer mag team beheren (`canManageTeamCarpool` voor dat `team_id`).
3. **Privé-lift** (`offer.team_id` NULL):  
   - viewer deelt **minstens één team** met de chauffeur (join `team_memberships` op `team_id`).

**Zonder ingelogde gebruiker** op summary: de API geeft **geen** chauffeurs terug (lege lijst) — geen openbare leak van club-interne carpool.

**`GET /:matchId/summary`:** gebruikt **`optionalToken`** — stuur **`Authorization: Bearer <jwt>`** vanaf de client om gefilterde data te krijgen. Zie `matches.js`: `fetchCarpoolSummaries` en `loadCarpoolDetail` zetten die header als `state.token` bestaat.

---

## 6. Coach-API: `GET /api/carpool/coach/teams`

**Implementatie:** `server/routes/carpool-coach.js`.

Response heeft **twee** onderdelen (frontend gebruikt beide):

| Veld | Inhoud | Frontend-gebruik |
|------|--------|-------------------|
| **`teams`** | Teams waar de gebruiker **coach** is (+ `members`, `club_id`) | Dropdown “Teamcarpool plannen”, seizoens-UI. |
| **`moderation_team_ids`** | Team-IDs waar `canManageTeamCarpool` true is | Alleen voor **UI** op carpool-wedstrijddetail: knoppen bewerken/verwijderen liften. |

**Waarom split?** Een **clubbeheerder** is niet per se **coach** van elk team: die ziet geen planner voor teams waar hij geen coach is, maar kan wél (via moderation) liften beheren waar hij rechten voor heeft.

---

## 7. Frontend-gedrag (kort)

### `public/js/pages/carpool.js`

- Hoofdlijst **uitwedstrijden:** gefilterd op **jouw team(s)** in de club (lidmaatschappen + coach-teams + fallback `user.team_id`), niet “hele club”.
- **Coach-kaart** alleen als `teams.length > 0` (je bent coach van minstens één team).
- Detail per wedstrijd: `manageable` = `new Set(moderation_team_ids)` voor coach-UI op aanbiedingen.

### `public/js/pages/matches.js`

- **Programma “hele club”:** carpool-samenvattingen worden **alleen** opgehaald voor wedstrijden waar **jouw team** in speelt (`canInteractFor`), niet voor alle clubwedstrijden.
- **Gevolgde teams:** **geen** carpool-fetch (geen teamlid → geen carpool-info in die view).
- **Summary-calls:** altijd **Bearer** meegeven als er een token is.

### `public/js/pages/team.js`

- Link naar carpool op **“Aankomende wedstrijden”** alleen bij **eigen team** (`isOwnTeam`).

---

## 8. Operatie: wijzigingen “zien” in de browser

**Algemeen (hele app, niet alleen carpool):** na edits in **`server/`** altijd de **Node-server herstarten**; anders blijft oud gedrag actief. Zie [01-architecture-overview.md](./01-architecture-overview.md) § “Node-proces” en [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md) §9.

Daarnaast voor de **frontend:** `app.js?v=` + `sw.js` `CACHE_NAME` bumpen waar nodig ([10](./10-deployment-pwa-and-caching.md)), harde refresh / PWA-cache.

**Carpool-specifiek:** `GET …/summary` zonder JWT geeft een leeg overzicht; met `Authorization: Bearer` gefilterde data. Zie §5.

---

## 9. Veelgemaakte fouten (voor agents)

| Fout | Gevolg |
|------|--------|
| Coach-routes weer in dezelfde router als `/:matchId` zonder aparte mount | `404` op `/api/carpool/coach/teams` of verkeerde handler. |
| Summary zonder `Authorization` verwachten dat gebruikers data zien | Altijd lege lijst voor anonieme calls; ingelogde app **moet** header sturen. |
| `canManageTeamCarpool` gebruiken voor plan-season | Te ruim (admins plannen voor teams waar ze geen coach zijn) — gebruik **`canPlanTeamCarpoolSeason`**. |
| Alleen frontend filteren, server niet | API blijft lekken — **server is leidend** voor zichtbaarheid en book. |

---

## 10. Zie ook

- [07-api-carpool-gamification-admin.md](./07-api-carpool-gamification-admin.md) — korte API-overzicht + gamification/admin.  
- [14-api-endpoint-inventory.md](./14-api-endpoint-inventory.md) — volledige routematrix incl. `O`/`V`.  
- [13-environment-security-and-secrets.md](./13-environment-security-and-secrets.md) — publiek vs. JWT, carpool-summary.  
- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md) — `navigate`, `state`, pagina’s.

---

*Toegevoegd als agent-gerichte deep-dive voor carpool; houd dit bestand synchroon bij gedragswijzigingen.*
