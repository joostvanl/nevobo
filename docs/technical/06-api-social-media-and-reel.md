# 06 — API: social, media, reel

## Router

`server/routes/social.js` — multer uploads naar `public/uploads/YYYY/MM/`.

## Upload (`POST /api/social/upload`)

- **Auth:** `verifyToken`  
- **Rollen:** alleen `player` of `coach` op het team (`team_memberships`) — geen parent/staff voor team-upload  
- **Body:** `files`, `caption`, `match_id`, `team_id` — team wordt zo nodig afgeleid uit `feed_cache` + lidmaatschappen (zie [datamodel](../datamodel-match-media-opponent.md))  
- **Flow:** kwaliteitscheck → optioneel face blur → `posts` + `match_media` rijen  
- **Afhankelijkheden:** `faceBlur.js`, Sharp, DB

## Match-media (`GET /api/social/match/:matchId/media`)

- **Publiek** (optioneel `userId` query voor like-status)  
- **WHERE `mm.match_id = ?`** — `req.params.matchId` (Express decoded)  
- Verrijking tegenstander: query params **`home_team`**, **`away_team`** (van matchpagina) **en/of** `feed_cache` via `match_id` — niet uit vaste DB-kolommen op `match_media` in baseline schema  
- **Query params:** `home_team`, `away_team` — matchpagina stuurt deze mee zodat tegenstander zichtbaar is zonder cache-hit

## Home reel: `GET /api/social/media-feed`

- **Auth:** `verifyToken`  
- **Filter:** `posts` waar `p.team_id` in (lid + gevolgde teams) **of** `p.club_id` in relevante clubs  
- **ORDER BY `mm.created_at DESC`** + `LIMIT`/`OFFSET`  
- **Eerste pagina (`offset===0`):** TikTok/Instagram uit `team_social_links` worden **ingesloten** om de 4e positie (interleave). Response = `combined` array.  
- **`next_media_offset`:** `offset + media.length` vóór interleave — volgende SQL-offset voor paginatie (client gebruikt ook `countReelSqlOffsetItems` in `reel-viewer.js` op de slide-lijst).  
- **Tegenstander:** `addMatchOpponentToMediaItems` gebruikt `feed_cache` + query-context; zie `social.js` en [datamodel](../datamodel-match-media-opponent.md)

## Team reel: `GET /api/social/team-media/:teamId`

- **Auth:** `optionalToken` (likes)  
- **Filter:** complexe OR:
  1. `p.team_id = teamId`
  2. Zelfde `match_id` als andere posts van dit team
  3. `match_id` in set uit `feed_cache` waar teamnaam in home/away voorkomt **én** `p.team_id = teamId`

**Reden:** media moet bij het team blijven hangen via post-team; match-ids uit cache helpen consistentie.  
Response bevat ook **`next_media_offset`** (zelfde betekenis als bij `media-feed`).

## Overige social endpoints (hoofdlijnen)

| Gebied | Endpoints |
|--------|-----------|
| Feed | `GET /feed`, `GET /club/:clubId/feed`, `POST /post` |
| Media interactie | view, like, comments, delete |
| Blur editor | has-original, revert-blur, reblur, detect-faces, toggle-face-blur, blur-at-point |
| Volgen | `POST/DELETE /follow`, `GET /following`, `GET /followers/:userId` |
| Home bundle | `GET /home-summary` |
| Social links (team) | `POST/DELETE /teams/:teamId/social-links` (player/coach); view count `POST /social-links/:id/view` |

## TikTok korte links

- `server/lib/tiktok-scraper.js` — `resolveVmTiktokToVideoId` voor `vm.tiktok.com`  
- Gebruikt in `social.js` en `admin.js` bij toevoegen team social link  
- Timeout + try/catch zodat ontbrekende/broken TikTok de server niet crasht

## Frontend reel (`reel-viewer.js`, `reel-strip.js`)

- **Types:** `image`, `video`, `tiktok`, `instagram`  
- TikTok: lazy iframe `src` alleen voor huidige slide ±1 (minder console-noise van hun React)  
- **`fetchMore(mediaCount())`** — zie [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)  
- **Strip:** horizontale thumbnails (home / team / wedstrijd) delen `buildReelStripCardsHtml` + `setupReelStripVideoAutoplay` in `public/js/reel-strip.js`

## Zie ook

- [09-services-face-blur-and-libs.md](./09-services-face-blur-and-libs.md)  
- [11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)
