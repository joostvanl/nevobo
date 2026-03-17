# Datamodel: wedstrijd, media en tegenstander

Dit document legt uit hoe wedstrijd-media en tegenstandersinformatie in de app werken, en waarom “tegenstander in de reel” soms ontbreekt.

---

## 1. Waar komt wedstrijdinformatie vandaan?

### 1.1 NeVoBo RSS

- **Bron:** NeVoBo API (`https://api.nevobo.nl/export/...`) — o.a. `programma.rss` en `resultaten.rss`.
- **Parsing:** `server/routes/nevobo.js` → `parseMatchItem(item)`:
  - `match_id` = `item.guid` met alles vóór het laatste `/` weggelaten (dus alleen het ID-deel).
  - `home_team` en `away_team` worden uit de **titel** gehaald (tekst vóór en na ` - `).
- **Cache:** Responses worden opgeslagen in de tabel **`feed_cache`** (en in-memory):
  - `cache_key` bv. `schedule:club:XYZ`, `results:club:XYZ`, `schedule:team:CODE:M:1`, enz.
  - `data_json` = JSON met o.a. `{ matches: [ { match_id, home_team, away_team, ... } ] }`.

Dus: **wedstrijdnaam en tegenstander** bestaan alleen in die RSS-afgeleide data (titel → home/away). Er is geen aparte “wedstrijden”-tabel met teamnamen.

### 1.2 Match-ID in de app

- **Frontend:** `encodeMatchId(match)` (o.a. in `matches.js` en `home.js`):
  - `encodeURIComponent(match.match_id || match.link?.replace(/.*\//, '') || match.title?.slice(0, 40) || 'onbekend')`.
- **Gebruik:** Dit geëncodeerde ID wordt o.a. gebruikt in:
  - URL van de wedstrijdpagina (`matchId` in de route).
  - Request bij upload: `match_id` in de body.
  - Request voor media van een wedstrijd: `GET /api/social/match/:matchId/media`.

Belangrijk: in de **database** staat in `match_media.match_id` en `posts.match_id` exact wat de **client** meestuurde (meestal het geëncodeerde ID). De server decodeert URL-params; bij een ID met bijv. `/` of `%` kan het zijn dat we in de DB encoded opslaan maar in queries decoded gebruiken (of omgekeerd), wat tot mismatches kan leiden.

---

## 2. Tabellen die er toe doen

### 2.1 `match_media`

- Bevat per foto/video: `id`, `post_id`, `user_id`, **`match_id`** (TEXT), `file_path`, `file_type`, `caption`, `created_at`, `blur_regions`.
- **Geen** `home_team` of `away_team` in de tabel (tot we die toevoegen). Tegenstander moet dus elders vandaan komen.

### 2.2 `posts`

- Bevat o.a. `match_id` (TEXT) voor posts/media die aan een wedstrijd hangen.
- Geen teamnamen; alleen koppeling aan wedstrijd via `match_id`.

### 2.3 `feed_cache`

- Bevat per cache-entry o.a. `data_json` met een array `matches`, elk met `match_id`, `home_team`, `away_team`.
- **Probleem:** De key in die JSON is het **ruwe** `match_id` uit de RSS (na `guid.replace(/.*\//, '')`). De app gebruikt vaak een **geëncodeerd** ID (encodeURIComponent). Als we in de API op `req.params.matchId` (decoded) zoeken, of op een andere variant dan in de cache staat, vindt de lookup geen entry → geen home/away → geen tegenstander.

---

## 3. Waar halen we “tegenstander” nu vandaan?

### 3.1 GET `/api/social/match/:matchId/media`

- **Doel:** Alle media voor één wedstrijd + like-counts, teamnaam, clublogo, en **tegenstander/label** voor de reel.
- **Stappen:**
  1. Query: `SELECT ... FROM match_media mm ... WHERE mm.match_id = ?` met `req.params.matchId` (door Express vaak al decoded).
  2. **match_home_team / match_away_team** worden bepaald via:
     - **Eerst:** queryparams `home_team` en `away_team` (als de matchpagina die meestuurt).
     - **Anders:** `getMatchTeamsMap(db)`:
       - Leest **alle** `feed_cache`-rijen, parset `data_json`, loopt over `data.matches`.
       - Bouwt een map `match_id → { home_team, away_team }` (en ook `encodeURIComponent(match_id)` als key).
       - Lookup: `matchMap[req.params.matchId]` of `matchMap[decodeURIComponent(req.params.matchId)]`.
  3. Response: elk media-item krijgt o.a. `match_home_team`, `match_away_team`, `match_opponent_team = "${matchHome} – ${matchAway}"` (of leeg als geen home/away).

Waarom het kan mislukken:

- **feed_cache:** Geen hit als:
  - Die wedstrijd nog niet in een opgehaalde feed zit (andere club/team, andere cache_key).
  - `match_id` in cache anders is dan wat we in de URL/DB gebruiken (raw vs encoded vs decoded).
- **Queryparams:** Alleen gezet als de **matchpagina** de gallery laadt en `match` (met `home_team`/`away_team`) doorgeeft aan `loadMatchGallery(matchId, canInteract, match)`. Bij direct openen van reel vanaf homepage/team-pagina zijn er geen queryparams voor deze endpoint.
- **Consistentie:** Zonder vaste afspraak over één vorm van `match_id` (encoded vs raw) kunnen DB, feed_cache en URL uit elkaar lopen.

### 3.2 Reel-viewer

- **Input:** De array `items` die de **match-gallery** van de API terugkrijgt (zelfde objecten, inclusief `match_home_team`, `match_away_team`, `match_opponent_team`).
- **Weergave:** In de reel-badge o.a. `match_opponent_team` (en eventueel teamnaam) voor het label “Teamnaam vs. Tegenstander” of “Thuis – Uit”.
- Als de API voor die media **geen** home/away/opponent zet (omdat lookup én queryparams falen), blijft het label leeg.

---

## 4. Waarom we wél de juiste media tonen maar niet de tegenstander

- **Media filteren:** We filteren op `mm.match_id = ?`. Als dezelfde `match_id`-string (of een vorm die in de DB voorkomt) wordt gebruikt, krijgen we precies de media van die wedstrijd. Dat kan ook als er kleine varianten in het ID zijn (bijv. alleen bij media zonder speciale tekens).
- **Tegenstander:** Die komt **niet** uit `match_media`, maar uit:
  1. Queryparams (alleen bij laden vanaf matchpagina), of  
  2. feed_cache-lookup op datzelfde `match_id`.  
Als de feed_cache geen entry heeft voor de gebruikte `match_id`-variant, of de matchpagina geen home/away meestuurt, is er geen tegenstander — terwijl de media zelf wél kloppen.

Kortom: **welk media bij welke wedstrijd hoort** weten we uit de DB (`match_id`). **Welke teams bij die wedstrijd horen** weten we alleen uit RSS/cache of uit wat de matchpagina meestuurt; dat is broos.

---

## 5. Aanbevolen oplossing: teamnamen bij media opslaan

- **match_media** uitbreiden met optionele velden **`match_home_team`** en **`match_away_team`** (TEXT).
- **Bij upload** (vooral vanaf de wedstrijdpagina): als de client `home_team` en `away_team` meestuurt (uit dezelfde match-objecten die we al voor de UI gebruiken), deze op de server in `match_media` opslaan.
- **Bij alle endpoints** die media teruggeven (o.a. `GET /api/social/match/:matchId/media`): voor elk item **eerst** de opgeslagen `match_home_team` / `match_away_team` gebruiken; alleen als die leeg zijn, fallback naar feed_cache of queryparams.

Dan is voor elke foto/video **één duidelijke bron** voor “welke wedstrijd” en “welke teams”: de eigen rij in `match_media`. De reel kan dan altijd de tegenstander tonen voor media die met teamnamen zijn geüpload, onafhankelijk van feed_cache of matchpagina-queryparams.

---

## 6. Overzicht dataflow (kort)

```
NeVoBo RSS → parseMatchItem → match_id, home_team, away_team
       ↓
feed_cache (data_json met matches[])
       ↓
Matchpagina: schedule/results API → match object → renderMatchDetail → loadMatchGallery(matchId, canInteract, match)
       ↓
GET /api/social/match/:matchId/media?home_team=...&away_team=...
       ↓
Server: match_id filter op match_media; home/away uit query OF getMatchTeamsMap(feed_cache)
       ↓
Response: media[] met o.a. match_opponent_team
       ↓
Reel: openReelViewer(items, …) → badge toont match_opponent_team (of teamnaam)
```

De zwakke schakels zijn: (1) feed_cache bevat niet altijd deze match of niet onder dezelfde ID-vorm, (2) queryparams zijn er alleen bij laden vanaf matchpagina. Opslaan van home/away in `match_media` bij upload maakt tegenstander-in-reel betrouwbaar.
