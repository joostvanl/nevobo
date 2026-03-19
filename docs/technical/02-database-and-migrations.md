# 02 — Database en migraties

## Locatie

- **Bestand:** `data/volleyball.db` (relatief t.o.v. projectroot; in Docker vaak gemount volume)  
- **Driver:** `better-sqlite3` in `server/db/db.js`  
- **PRAGMA:** `journal_mode=WAL`, `foreign_keys=ON`

## Twee lagen schema

1. **`server/db/schema.sql`**  
   Wordt bij start met `db.exec(schema)` uitgevoerd (`CREATE TABLE IF NOT EXISTS`). Bevat o.a.:
   - `clubs`, `teams`, `users`, `user_follows`
   - `posts`, `match_media`
   - `carpool_offers`, `carpool_bookings`
   - `badges`, `user_badges`, `goals`, `user_goals`, `xp_levels`
   - Seed data voor badges/goals/levels

2. **Migraties in `db.js` (array `migrations`)**  
   `try { db.exec(migration) } catch { }` — idempotent voor “column bestaat al”. Voegt o.a. toe:
   - `media_views`, `media_likes`, `media_comments`
   - `user_roles`, `team_memberships`
   - `competition_teams`, `club_opponents`, `competition_teams_meta`
   - `feed_cache`
   - `team_social_links`
   - `face_references`
   - Kolommen o.a. op `match_media` (`blur_regions`), nullable `user_id` op `match_media` (re-migratie) — **geen** vaste `match_home_team` / `match_away_team` kolommen in baseline `schema.sql`/`db.js`; teamnamen komen uit `feed_cache` / API (zie [datamodel](../datamodel-match-media-opponent.md))

**Waarom zo:** SQLite heeft geen ingebouwde migratie-tool; dit patroon is eenvoudig maar vereist discipline: nieuwe kolommen via `ALTER TABLE` in de migrations-array.

## Kern-tabellen (kort)

| Tabel | Doel |
|-------|------|
| `clubs` | Vereniging + `nevobo_code` (uniek) |
| `teams` | Team binnen club; `display_name`, NeVoBo type/nummer |
| `users` | Account; `club_id`, `team_id` (legacy default team), XP/level |
| `team_memberships` | User ↔ team met `membership_type` (player, coach, parent, …) |
| `user_roles` | `super_admin`, `club_admin`, `team_admin`, … |
| `user_follows` | Volgen van user/team/club |
| `posts` | Social post of parent van media; `team_id`, `club_id`, `match_id` (NeVoBo string) |
| `match_media` | Foto/video; `post_id`, `user_id`, `match_id`, `blur_regions`, … |
| `feed_cache` | Gecachte NeVoBo JSON (`cache_key`, `data_json`, `ttl_ms`) |
| `team_social_links` | TikTok/Instagram embed per team (`embed_id`, `url`) |

## `feed_cache`

- **Sleutels** zoals `schedule:club:CODE`, `results:club:CODE`, team-specifieke varianten  
- **`data_json`:** o.a. `{ matches: [ { match_id, home_team, away_team, datetime, … } ] }`  
- Gebruikt voor: snelle wedstrijdlijsten, **tegenstander-resolutie** bij media (`getMatchTeamsMap` in `social.js`), team-media filter (match_ids waar team speelt)

## Scout-data (niet in SQLite)

Scout-wedstrijdstate staat in **`server/data/scout/<matchId>.json`** (zie [08-api-scout.md](./08-api-scout.md)).

## Backups / git

- `data/` en `public/uploads/` staan typisch in `.gitignore`  
- Productie: volume-backup van `volleyball.db` + uploads

## Zie ook

- `docs/datamodel-match-media-opponent.md` — match_id vs home/away op media  
- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)
