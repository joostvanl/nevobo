# TikTok-profiel scraper (on demand)

## Doel

Een scraper die **op afroep** draait en voor een gegeven TikTok-gebruikerspagina (bijv. `https://www.tiktok.com/@vtcwoerdenmb2`) de **eigen geüploade filmpjes** van dat account ophaalt en als social links aan een team koppelt. Die video’s verschijnen daarna in de reel player (team- en home-feed).

## Huidige integratie

- **Tabel:** `team_social_links` (`team_id`, `platform`, `url`, `embed_id`, `added_by`, …).
- **Reel:** Items met `platform = 'tiktok'` en `embed_id` worden in de reel als TikTok-embed getoond (iframe `https://www.tiktok.com/player/v1/{embed_id}...`).
- **Handmatig:** Teambeheerders kunnen nu per video een TikTok-URL plakken; die wordt geparsed en opgeslagen. De scraper **automatiseert** het ontdekken van alle video’s van een gebruikerspagina.

## Aanpak

1. **Input:** TikTok-username (bijv. `vtcwoerdenmb2`) + `team_id`. Geen login.
2. **Ophalen profielpagina:** `GET https://www.tiktok.com/@{username}` met een browser-achtige User-Agent (en evt. andere headers) om dezelfde HTML te krijgen als in de browser.
3. **Data uit HTML:** TikTok stopt profiel- en videodata in een `<script>` in de pagina:
   - **`__UNIVERSAL_DATA_FOR_REHYDRATION__`** (aanbevolen): JSON met o.a. `__DEFAULT_SCOPE__.webapp.user-detail.userInfo.itemList[]`; elk item heeft een `id` (video-id).
   - **`SIGI_STATE`** (fallback): vergelijkbare data, andere structuur; o.a. gebruikt door yt-dlp.
4. **Video-IDs:** Uit `itemList` (of equivalent) alle `id`’s halen → dat zijn de TikTok-video-IDs.
5. **Opslaan:** Voor elke video-id:
   - URL = `https://www.tiktok.com/@{username}/video/{id}`,
   - `embed_id` = `id` (zoals nu al in de app gebruikt).
   - `INSERT` in `team_social_links` voor het opgegeven `team_id`, `platform = 'tiktok'`, met `UNIQUE(team_id, embed_id)` zodat dubbele video’s niet dubbel worden opgeslagen.
6. **Uitvoer:** Aantal nieuw toegevoegd, evt. totaal gevonden. Geen duplicaten.

## Risico’s en beperkingen

- **TikTok ToS:** Scrapen kan in strijd zijn met de gebruiksvoorwaarden. Alleen eigen/team-accounts en beperkt, op afroep, draaien verkleint het risico.
- **Blokkades:** TikTok kan:
  - Andere HTML geven zonder de gewenste script-tags (bijv. bij “te veel” requests of andere User-Agent).
  - CAPTCHA of login eisen → dan stopt de scraper of moet je een browser (Puppeteer) gebruiken.
- **Structuur wijzigt:** Sleutel-paden zoals `webapp.user-detail.userInfo.itemList` kunnen in de toekomst veranderen; dan moet de parser worden aangepast (zoals ook yt-dlp geregeld moet updaten).
- **Alleen eerste pagina:** De eerste HTML-response bevat vaak alleen de eerste ~30 video’s. Voor meer video’s is paginatie nodig (TikTok interne API met `sec_uid` + cursor), wat complexer en kwetsbaarder is. Voor veel teams is “laatste ~30 video’s” voldoende.

## Uitvoering “op afroep”

- **CLI-script:** `scripts/sync-tiktok-profile.js` — `node scripts/sync-tiktok-profile.js <username> --team-id=<id>` (eventueel `--dry-run`). Vereist **`server/lib/tiktok-scraper.js`** (export o.a. `fetchProfileVideoIds`). Als die module ontbreekt in je checkout, faalt het script met `Cannot find module`.
- **Admin-API (gepland / documentatie):** `POST /api/admin/teams/:teamId/sync-tiktok` staat **niet** in `server/routes/admin.js` in de standaard codebase — er is **geen** HTTP-endpoint voor profiel-sync; alleen handmatig toevoegen van losse video-URL’s via bestaande social-links-routes. Voeg dit endpoint pas toe als je de scraper deelt en wilt exposen (let op rate limits en ToS).

### Implementatiestatus (samenvatting)

| Onderdeel | Status |
|-----------|--------|
| Handmatige TikTok/Instagram URL → `team_social_links` | **Aanwezig** (`admin.js` / `social.js` parse) |
| `server/lib/tiktok-scraper.js` (profiel + evt. vm-redirect) | **Optioneel / lokaal** — niet gegarandeerd in repo |
| `scripts/sync-tiktok-profile.js` | **Aanwezig** — hangt af van bovenstaande module |
| `POST .../sync-tiktok` | **Niet geïmplementeerd** in admin-router (conform huidige code) |
| Reel player (`embed_id`, iframe) | **Aanwezig** |

## Technische keuzes

- **Geen Puppeteer standaard:** Eerst gewone HTTP-request (fetch) + parsing van de bestaande script-tags. Minder zwaar en voldoende zolang TikTok die data in de eerste response blijft stoppen.
- **Fallback:** Als er geen `__UNIVERSAL_DATA_FOR_REHYDRATION__` of geen `itemList` in de response zit, kan later een Puppeteer-variant worden toegevoegd (zelfde contract: username + team_id → lijst embed_id’s → DB-inserts).
- **Rate limiting:** Scraper niet in een strakke cron zetten; alleen handmatig of via “Sync TikTok”-knop. Eventueel 1x per dag per team is redelijk.

## Samenvatting

- Scraper draait **on demand** (script en/of admin-endpoint).
- Scrapet **gebruikerspagina** → haalt **eigen geüploade video’s** uit de ingebedde JSON.
- **Eén team per run:** alle gevonden video’s worden aan het opgegeven team gekoppeld en in de **reel player** getoond via de bestaande `team_social_links`- en embed-logica.
