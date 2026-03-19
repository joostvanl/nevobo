# 05 — API: NeVoBo (feeds en wedstrijddata)

## Verantwoordelijk bestand

`server/routes/nevobo.js` — groot bestand: RSS-parser, caching, merge logica. **Diepgaand:** [15-nevobo-rss-parse-and-merge.md](./15-nevobo-rss-parse-and-merge.md).

## Databronnen

- **RSS:** `https://api.nevobo.nl/export/vereniging/{code}/programma.rss` en `.../resultaten.rss`  
- **Parsing:** `parseMatchItem(item)` — uit `title`/`description` worden o.a. gehaald:
  - `match_id` — suffix van `guid` na laatste `/`
  - `home_team`, `away_team` — uit titel (`Team A - Team B`)
  - `datetime`, scores, sets, locatie uit description waar mogelijk

**Koppeling media ↔ wedstrijd:** [../datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md).

## Caching: `withFeedCache` + `feed_cache` tabel

1. In-memory Map (korte TTL)  
2. SQLite `feed_cache` (`cache_key`, `data_json`, `fetched_at`, `ttl_ms`)  
3. Bij miss: fetch RSS → parse → schrijf DB + memory

**Reden:** NeVoBo rate limits / traagheid; server herstart behoudt cache.  
**TTL:** o.a. gekoppeld aan **volgende wedstrijd** (cache verloopt rond de dag vóór aftrap); details in [15](./15-nevobo-rss-parse-and-merge.md).

## Belangrijke routes (selectie)

| Route | Doel |
|-------|------|
| `GET /club/:code/schedule` | Toekomstige wedstrijden (na filter oude/gespeeld) |
| `GET /club/:code/results` | Uitslagen |
| `GET /team/:code/:type/:number/schedule|results|calendar` | Team-specifieke feeds |
| `GET /team-by-name` | Zoek team op naam + code; combined schedule/results voor deep links |
| `GET /poule-stand`, `/poule/.../standings` | Standen |
| `GET /geocode`, `/travel-time` | Kaarten / reistijd (externe of cached logica) |
| `GET /search`, `/opponent-clubs` | Zoeken |
| `GET /cache-stats`, `DELETE /cache` | Operatie (admin-achtig gebruik) |

## `match_id` en de app

- Frontend **`encodeMatchId(match)`** — `encodeURIComponent(match.match_id || …)` voor URL’s en upload  
- **Risico:** opgeslagen `match_media.match_id` moet **dezelfde stringvariant** gebruiken als in queries; Express decode’t URL-params → soms mismatch met DB als encoding inconsistent is.

## Zie ook

- `docs/datamodel-match-media-opponent.md`  
- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)  
- [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)
