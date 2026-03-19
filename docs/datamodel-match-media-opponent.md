# Datamodel: `match_id`, tegenstander en media-koppeling

**Doel:** Één plek waar concept + database + runtime-gedrag samenkomen. Aanvulling op [05-api-nevobo.md](./technical/05-api-nevobo.md), [06-api-social-media-and-reel.md](./technical/06-api-social-media-and-reel.md) en [11-cross-cutting-decisions.md](./technical/11-cross-cutting-decisions.md).

---

## 1. Wat is `match_id`?

- **Bron:** Nevobo RSS-item `guid` — in code wordt het **laatste path-segment** na de laatste `/` gebruikt (`parseMatchItem` in `server/routes/nevobo.js`).
- **Type:** `TEXT` in SQLite (`posts.match_id`, `match_media.match_id`, `carpool_offers.match_id`, …).
- **Semantiek:** Stabiele sleutel voor **dezelfde wedstrijd** over programma- en resultaten-feeds, zolang Nevobo dezelfde guid hanteert.

**Valkuil:** Als een item **geen** bruikbare guid heeft, valt merge/dedup in sommige paden terug op `title` als sleutel — minder betrouwbaar.

---

## 2. Waar komen thuis/uit-teams vandaan?

`parseMatchItem` vult o.a.:

| Veld | Schedule-titel | Results-titel |
|------|----------------|---------------|
| `home_team`, `away_team` | Na prefix `^\d+ \w+ \d+:\d+:\s*` | Tekst vóór `, Uitslag:` (case-insensitive) |
| Split | `^(.+?)\s+-\s+(.+)$` op de teamstring | idem |

Daarnaast: **description** parsing voor uitslag (`Uitslag: x-y`), setstanden, speellocatie, en **poulecode** (alleen als `Wedstrijd:`-waarde **geen** ` - ` bevat — bij resultaten staat daar vaak "Team A - Team B").

**Gevolg voor media:** Tegenstander staat **niet** als aparte kolom in `match_media`; je leidt af uit `feed_cache.data_json` → `matches[]` waar `match_id` gelijk is, en vergelijkt `home_team` / `away_team` met `teams.display_name` (zie upload-flow hieronder).

---

## 3. Tabellen (relevante fragmenten)

### `posts`

- `team_id`, `match_id` optioneel.
- Media-posts: `type = 'media'`, caption in `body`.

### `match_media`

- `post_id` → parent post.
- `user_id` (mag `NULL` na user-delete — migratie in `db.js`).
- `match_id` —zelfde string als Nevobo; koppelt foto/video aan wedstrijd **voor feeds en carpool-context**.
- `blur_regions` (JSON) voor herhaalde blur zonder opnieuw te detecteren.

Er zijn **geen** aparte kolommen `match_home_team` / `match_away_team` in de huidige `schema.sql` van deze repo; teamnamen komen uit **cache/API**, niet uit de media-rij.

### `feed_cache`

- `cache_key` o.a. `schedule:club:…`, `results:club:…`, team-variants.
- `data_json` bevat o.a. `{ matches: [ { match_id, home_team, away_team, datetime, … } ] }` — dit is de bron voor **team-resolutie bij upload zonder `team_id`**.

### `club_opponents`

- Persistent cache: welke Nevobo-tegenstanders een club in poules tegenkomt (niet hetzelfde als één wedstrijd-media-koppeling).

---

## 4. Upload-flow (`POST /api/social/upload`)

1. Client stuurt `match_id`, optioneel `team_id`, bestanden + caption.
2. **`effectiveTeamId`:**  
   - Als `team_id` gezet → gebruik die.  
   - Anders, als `match_id` gezet: scan **alle** `feed_cache` rijen, parse JSON, zoek object met `m.match_id === match_id`, vergelijk `home_team`/`away_team` (lowercase) met `display_name` van teams waar de uploader lid van is → eerste match wint.
3. **Face blur:** Alleen zinvol met teamcontext; `teamHasAnonymousMembers(effectiveTeamId)` bepaalt of kwaliteitscheck + `blurFacesIfNeeded(path, effectiveTeamId)` draaien.
4. **DB:** Post krijgt `effectiveTeamId || null` en `match_id`; elke `match_media`-rij krijgt dezelfde `match_id`.

**Implicatie:** Als de wedstrijd **niet** in `feed_cache` staat (TTL verlopen, andere club-feed), kan `team_id` leeg blijven → geen automatische blur voor anonieme teamleden.

---

## 5. Feeds die `match_id` gebruiken

- `GET /api/social/match/:matchId/media` — direct op `match_media.match_id`.
- Team/home feeds in `social.js` — complexe SQL met `match_id` + `posts.team_id` + optioneel `match_id`-set uit `feed_cache` voor “wedstrijden van dit team”.

Zie code in `server/routes/social.js` (zoek op `cacheMatchIds`, `feed_cache`).

---

## 6. Checklist voor agents

- [ ] `parseMatchItem` en titel-formaten begrijpen (schedule vs results).
- [ ] Weten dat tegenstander **afgeleid** wordt, niet uit `match_media` gelezen.
- [ ] `mediaCount()` vs `list.length` voor paginering (embeds) — [11](./technical/11-cross-cutting-decisions.md).
- [ ] Bij schema-wijzigingen: `feed_cache`-shape en upload-resolutie blijven consistent.

---

## Zie ook

- [15-nevobo-rss-parse-and-merge.md](./technical/15-nevobo-rss-parse-and-merge.md) — RSS-varianten en merge.
- [14-api-endpoint-inventory.md](./technical/14-api-endpoint-inventory.md) — route-lijst.
