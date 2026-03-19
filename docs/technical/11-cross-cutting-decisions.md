# 11 — Kruisende patronen, trade-offs en valkuilen

## 1. Reel pagination + geïnterleefde social items

**Probleem:** `media-feed` (en team-media pagina 1) retourneert een **gemengde** array: echte `match_media` + TikTok/Instagram objecten ertussen. `list.length` in de reel is dus groter dan het aantal DB-media op pagina 1.

**Fout:** `fetchMore(list.length)` als offset → SQL `OFFSET` te hoog → **media wordt overgeslagen**.

**Oplossing:** `fetchMore(mediaCount())` waar `mediaCount()` = items met `file_type` niet `tiktok`/`instagram`.

**Document:** [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md), [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md).

## 2. `match_id`: encoded vs raw vs URL-decode

NeVoBo en frontend gebruiken `encodeURIComponent` voor URL’s; DB slaat op wat de client meestuurt. Express decode’t route params. **Mismatches** kunnen leiden tot lege match-media op de wedstrijdpagina terwijl team-feed wel data heeft.

**Mitigaties:** query params `home_team`/`away_team` op match-media API; `getMatchTeamsMap` / `feed_cache` met meerdere keys. (Sommige forks kunnen extra kolommen op `match_media` hebben — niet in baseline `schema.sql`.)

**Document:** [datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md)

## 3. Tegenstander in reel vs data in DB

Teamnamen thuis/uit komen uit **RSS/`feed_cache`**, niet uit een wedstrijdentabel. Zonder cache-hit of query params is `match_opponent_team` leeg.

## 4. TikTok/Instagram console errors

Errors zoals `Consume appContext before init` en `getInstalledRelatedApps` komen uit **third-party iframes**, niet uit VolleyApp-code. Niet te “fixen” behalve embedgedrag beperken (lazy load).

## 5. Multi-team gebruikers

Upload op wedstrijdpagina moet **juiste team** kiezen (matching op home/away in teamnaam), niet `myTeams[0]`.

## 6. Scout locks

Alleen in-memory → **niet geschikt** voor horizontaal geschaalde Node zonder gedeelde store.

## 7. SQLite WAL

Meerdere readers + één writer; backups tijdens schrijven: gebruik SQLite backup API of korte lock vensters.

## 8. Service worker + HTML cache

Als alleen `sw.js` bump zonder `app.js?v=`, kunnen sommige clients toch oude entrypoint cachen — beide bumpen bij release.

---

*Voeg nieuwe valkuilen hier toe na incidenten of refactors.*
