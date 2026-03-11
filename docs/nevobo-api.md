# Nevobo API – Technische Documentatie

> Interne referentie voor de integratie met de Nevobo/volleybal.nl API in deze app.  
> Bijgewerkt: maart 2026

---

## Overzicht

Nevobo biedt **geen officiële publieke REST API**. De app maakt gebruik van drie ongedocumenteerde/semi-publieke endpoints:

| Type | Base URL | Formaat |
|------|----------|---------|
| RSS Export | `https://api.nevobo.nl/export/...` | RSS 2.0 XML |
| ICS Export | `https://api.nevobo.nl/export/...` | iCalendar |
| LD+JSON API | `https://api.nevobo.nl/...` | JSON-LD (Hydra) |

---

## 1. RSS Export Feeds

### Club-niveau feeds

```
GET https://api.nevobo.nl/export/vereniging/{clubCode}/programma.rss
GET https://api.nevobo.nl/export/vereniging/{clubCode}/resultaten.rss
```

- `{clubCode}` = Nevobo-verenigingscode in **lowercase**, bijv. `ckl9x7n`
- `programma.rss` = aankomende wedstrijden
- `resultaten.rss` = gespeelde wedstrijden (uitslagen)
- Bevat **alle teams** van die club in één feed

**Voorbeeld van een schedule item (title / description):**
```
title:       "10 mrt 19:00: VollinGo MA 1 - VTC Woerden MA 2"
description: "Wedstrijd: 3000MA1H2 GE, Datum: maandag 10 maart, 19:00, Speellocatie: De Zebra, Goverwellesingel 10, 2807DZ Gouda"
```

**Voorbeeld van een resultaat item:**
```
title:       "OKV MA 1 - VTC Woerden MA 1, Uitslag: 3-2"
description: "Wedstrijd: OKV MA 1 - VTC Woerden MA 1, Uitslag: 3-2, Setstanden: 13-25, 25-22, 12-25, 25-21, 15-11"
```

### Team-niveau feeds

```
GET https://api.nevobo.nl/export/team/{clubCode}/{teamType}/{teamNumber}/programma.rss
GET https://api.nevobo.nl/export/team/{clubCode}/{teamType}/{teamNumber}/resultaten.rss
GET https://api.nevobo.nl/export/team/{clubCode}/{teamType}/{teamNumber}/programma.ics
```

- `{clubCode}` = Nevobo-code **UPPERCASE**, bijv. `CKL9X7N`
- `{teamType}` = team-categorie in API-formaat, bijv. `meiden-a`, `heren`, `dames`
- `{teamNumber}` = teamnummer, bijv. `1`, `2`
- Bevat uitsluitend wedstrijden van dat specifieke team

**Let op:** de teamType-waarden in de API komen niet altijd overeen met de displaynamen. Gebruik de LD+JSON API om het juiste `@id`-pad te vinden (zie §2).

### Poule-stand feeds

```
GET https://api.nevobo.nl/export/poule/{regio}/{competitie}/{poule-slug}/stand.rss
```

- De URL-structuur spiegelt exact de LD+JSON poule-paden (zie §2)
- **Voorbeeld:** `/export/poule/regio-west/competitie-seniorencompetitie-2/regio-west-3bd-11/stand.rss`

> **Belangrijk:** De stand-URL is direct af te leiden van het poule-pad in de LD+JSON API.  
> Er is **geen brute-force** meer nodig. Zie §3.3 voor de aanpak.

---

## 2. LD+JSON API (Hydra)

### Headers vereist
```
Accept: application/ld+json
User-Agent: VolleyballTeamApp/1.0
```

Alle LD+JSON responses zijn Hydra-collecties met:
- `hydra:member` – array van objecten
- `hydra:totalItems` – totaal aantal items
- `hydra:view` – paginering info

### 2.1 Club/vereniging info ophalen

```
GET https://api.nevobo.nl/relatiebeheer/verenigingen/{clubCode}.jsonld
```

Response bevat:
- `naam` / `officielenaam` – clubnaam
- `_links.logo_url.href` – relatieve URL naar clublogo (prefix met `https:`)

**Logo URL patroon:**
```
https://assets.nevobo.nl/organisatie/logo/{CLUBCODE_UPPERCASE}.jpg
```
Voorbeeld: `https://assets.nevobo.nl/organisatie/logo/CKL9X7N.jpg`

> **Let op:** Er is **geen zoek-API** op clubnaam of -code. Zoeken op `?naam=` of `?zoekterm=`  
> werkt niet — de API retourneert altijd de eerste 30 resultaten ongeacht de parameter.

### 2.2 Competitieteams van een club ophalen

```
GET https://api.nevobo.nl/competitie/teams.jsonld?vereniging=/relatiebeheer/verenigingen/{clubCode}&limit=50
```

Elk item in `hydra:member` heeft:
- `@id` – volledig pad naar dit team, bijv. `/competitie/teams/ckl9x7n/meiden-b/1`
- `naam` – officiële teamnaam, bijv. `VTC Woerden MB 1`
- `standpositietekst` – huidige competitiepositie, bijv. `5e in Meiden B Hoofdklasse B Tweede helft`

### 2.3 Poule-indelingen van een team ophalen

```
GET https://api.nevobo.nl/competitie/pouleindelingen.jsonld?team={teamPath}&limit=10
```

- `{teamPath}` = het `@id` van het team (URL-encoded)
- Elk item bevat het `poule` veld — volledig pad in slug-formaat

**Poule-pad formaat:**
```
/competitie/poules/{regio}/{competitie-slug}/{regio-poule-slug}
```
Voorbeeld: `/competitie/poules/regio-west/tweede-helft-b-jeugdcompetitie-2/regio-west-mb1h2-10`

Elk item bevat ook de **actuele standings-data voor dit team**:

| Veld | Betekenis |
|------|-----------|
| `positie` | Huidige rangpositie in de poule |
| `gespeeld` | Aantal gespeelde wedstrijden |
| `punten` | Behaalde punten |
| `wedstrijdenWinst` | Gewonnen wedstrijden |
| `wedstrijdenVerlies` | Verloren wedstrijden |
| `setsVoor` / `setsTegen` | Sets gewonnen / verloren |
| `puntenVoor` / `puntenTegen` | Scorepunten gewonnen / verloren |
| `kampioen` | Boolean: is dit team kampioen? |
| `indelingsletter` | Groepsletter (bijv. `A`, `B`) |

### 2.4 Alle teams in een poule ophalen

```
GET https://api.nevobo.nl/competitie/pouleindelingen.jsonld?poule={poulePath}&limit=50
```

- Retourneert dezelfde structuur als §2.3 maar voor **alle teams** in de poule
- Elk item heeft een `team` veld: pad naar het team, bijv. `/competitie/teams/ckm0b84/meiden-a/1`
- De **clubcode** is het derde segment van dit pad: `ckm0b84`

> **Bekertoernooien** zijn herkenbaar aan `bekertoernooi` in het poule-pad.  
> De app filtert deze doorgaans uit voor de reguliere competitiestand.

### 2.5 Team-type afkortingen → Nevobo URL-segmenten

| RSS-afkorting | Nevobo type-segment | Voorbeeld teamnaam |
|---------------|--------------------|--------------------|
| DS | `dames` | VTC Woerden DS 1 |
| HS | `heren` | VTC Woerden HS 1 |
| DR | `dames-recreatief` | |
| HR | `heren-recreatief` | |
| DM | `dames-master` | |
| XR | `mix-recreatief` | |
| MA | `meiden-a` | VTC Woerden MA 1 |
| MB | `meiden-b` | VTC Woerden MB 1 |
| MC | `meiden-c` | |
| JA | `jongens-a` | |
| JB | `jongens-b` | |
| N5 | `mix-5-hoog` | |
| N6 | `mix-6-hoog` | |

---

## 3. Clubcode-discovery

### 3.1 Eigen club

De eigen Nevobo-clubcode wordt door de gebruiker handmatig ingevoerd bij registratie.  
Er is geen Nevobo zoek-API. Instructie aan gebruiker:
1. Ga naar [volleybal.nl](https://volleybal.nl) → zoek je club
2. Klik op "Programma" → "Exporteren"
3. Kopieer de code uit de RSS Feed URL (bijv. `ckl9x7n`)

### 3.2 `fetchOpponentClubs(nevoboCode)` — tegenstanders via poule-traversal

Ontdekt alle tegenstander-clubcodes door de poule-structuur te doorlopen.  
**Geen API-calls voor club-details** — clubinfo wordt uitsluitend uit de DB geladen.

```
eigen club → competitieteams → poule-indelingen → poule-teamlijst → clubcodes
↓
DB-lookup → clubnaam + logo (opgeslagen door lazy discovery)
```

**Stap-voor-stap:**

1. **`/competitie/teams.jsonld?vereniging=...`** → eigen teams (gecached 30 min)
2. **`/competitie/pouleindelingen.jsonld?team={teamPath}`** per eigen team → poule-paden
3. **`/competitie/pouleindelingen.jsonld?poule={poulePath}`** per poule → tegenstander-codes uit team-paden
4. **DB-lookup** voor bekende codes → clubnaam + logo (gratis, geen API-call)
5. Voor DB-bekende clubs: voeg teamnamen toe aan `teamCodes` map (uit `teamsCache` indien aanwezig)

> Clubs die **niet** in de DB staan verschijnen zonder naam/logo totdat de gebruiker  
> hun teampagina bezoekt (lazy discovery, zie §3.3).

### 3.3 `resolveClubCodeForTeam(teamName, ownCode)` — lazy on-demand discovery

Wordt aangeroepen vanuit de `team-by-name` endpoint wanneer een teamcode niet in DB of  
teamCodes-map staat. Spaart API-calls door alleen relevante poules te bevragen.

**Aanpak:**
1. DB-check: `teams JOIN clubs WHERE display_name = ?` (instant)
2. `teamsCache`-check: doorzoek alle al geladen teamlijsten (geen API-call)
3. Extraheer team-type uit naam: `"Go'97 MA 1"` → type `meiden-a`, nummer `1`
4. Haal alleen eigen teams van hetzelfde type op (bijv. alleen MA-teams)
5. Haal poules op voor díe teams (1-3 API-calls)
6. Verzamel tegenstander-codes uit die poules (1-3 API-calls)
7. Per tegenstander-code: haal competitieteams op en controleer teamnaam (5-6 calls)
8. Bij match: sla club op in DB (`clubs` tabel) + zet `opponentClubsCache` ongeldig

**Resultaat:**
- Eerste bezoek aan onbekend team: ~10–15 API-calls, ~3–12 seconden
- Elk volgend bezoek: 0 API-calls (DB-cache), <500ms

**Cache:** `lazyCodeCache` (in-memory Map, geen TTL) — teamname → clubCode

### 3.4 Code-resolutie in `team-by-name` endpoint

De `/api/nevobo/team-by-name` endpoint probeert in volgorde:

| Methode | Bron | Snelheid |
|---------|------|----------|
| A | `teams JOIN clubs WHERE display_name = ?` | Instant (DB) |
| B | `fetchOpponentClubs(code).teamCodes` | Snel (in-memory + DB) |
| C | `resolveClubCodeForTeam(teamName, code)` | Langzaam bij eerste keer, daarna instant |

---

## 4. Wedstrijd-data ophalen voor een team

### A. Via club-feeds (gebruikt voor eigen club)
```
GET /export/vereniging/{clubCode}/programma.rss  →  filter op teamnaam
GET /export/vereniging/{clubCode}/resultaten.rss →  filter op teamnaam
```

### B. Via `team-by-name` (gebruikt voor externe teams)
De backend endpoint `/api/nevobo/team-by-name?name=...&code=...` doet:
1. Resolve de juiste clubcode via methoden A → B → C (zie §3.4)
2. Voeg de resolved code toe aan `codesToSearch` (naast alle DB-geregistreerde clubs)
3. Haal van elke code `programma.rss` + `resultaten.rss` op (parallel)
4. Filter alle items op teamnaam
5. Dedupliceer op `match_id` of `title`
6. Sorteer: geplande wedstrijden oplopend, uitslagen aflopend
7. Retourneer `resolvedNevoboCode` — de frontend gebruikt dit voor vervolgverzoeken

---

## 5. Competitiestand ophalen

**Geoptimaliseerde aanpak** — direct van poule-pad naar stand-URL:

```
1. fetchClubCompetitionTeams(nevoboCode)  →  vind team (gecached)
2. /competitie/pouleindelingen.jsonld?team={teamPath}  →  poule-pad ophalen
3. Filter: verwijder bekertoernooien uit poule-paden
4. Bouw stand-URL: /competitie/poules/{regio}/{comp}/{slug}
                 → /export/poule/{regio}/{comp}/{slug}/stand.rss
5. Fetch stand RSS → parse standings tabel
```

**Voorbeeld:**
```
Poule-pad: /competitie/poules/regio-west/tweede-helft-b-jeugdcompetitie-2/regio-west-mb1h2-10
Stand-URL: https://api.nevobo.nl/export/poule/regio-west/tweede-helft-b-jeugdcompetitie-2/regio-west-mb1h2-10/stand.rss
```

> **Geen brute-force meer nodig.** Eerdere implementatie probeerde tot 3360 URL-combinaties  
> (7 regio's × 24 competitie-patronen × 20 poule-nummers). Nu: altijd 1 directe URL.

**Cache:** `standCache` — poule-pad → standRows (TTL 30 min)

---

## 6. RSS Data Parsing

### `parseMatchItem(item)` regels

| Veld | Bronformaat | Extractiemethode |
|------|-------------|-----------------|
| `home_team` / `away_team` | `title`: `"HH:MM: TeamA - TeamB"` of `"TeamA - TeamB, Uitslag: X-Y"` | Regex op ` - ` splitsing na tijdprefix |
| `score` / `score_home` / `score_away` | `description`: `"Uitslag: 3-2"` | Regex `/Uitslag:\s*(\d+)-(\d+)/i` |
| `sets` | `description`: `"Setstanden: 25-17, 23-25, ..."` | Regex op `Setstanden:` gevolgd door `\d+-\d+` |
| `venue_name` / `venue_address` | `description`: `"Speellocatie: Naam, Adres"` | Regex op `Speellocatie:` → split op eerste komma |
| `poule_code` | `description`: `"Wedstrijd: 3000MA1H2 GE"` | Regex op `Wedstrijd:` → skip als bevat ` - ` |
| `match_id` | `guid` URL-suffix | `item.guid.replace(/.*\//, '')` |
| `status` | `nevobo:status` element | Custom RSS field |
| `datetime` | `isoDate` of `pubDate` | ISO 8601 |

### Teamnaam-normalisatie

Nevobo gebruikt inconsistente apostrofen. De app normaliseert:
```javascript
s.toLowerCase()
 .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'")
 .replace(/\s+/g, ' ')
 .trim()
```
Dit raakt o.a. `'` (U+2019), `` ` `` (U+0060), `´` (U+00B4). Altijd toepassen bij  
team-name vergelijkingen tussen RSS-data en LD+JSON-data.

---

## 7. Geocoding & Routeberekening

### Geocoding (Nominatim / OSM)
```
GET https://nominatim.openstreetmap.org/search?q={adres}&format=json&limit=1&countrycodes=nl
```
- Fallback: herhaal zoekopdracht zonder postcode als eerste poging mislukt
- Cache: in-memory `travelTimeCache` (Map)

### Routeberekening (OSRM – gratis, geen API key)
```
GET https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false
```
- Retourneert `routes[0].duration` in seconden → omrekenen naar minuten
- Gecombineerd in `travelTimeMinutes(fromAddress, toAddress)`

---

## 8. Nevobo-codes in de App

### Opslag in de DB
De `clubs` tabel bevat:
- `nevobo_code` (UNIQUE, lowercase) – de primaire identifier
- `logo_url` – gevuld bij auto-create via lazy discovery of volg-actie

### Auto-create bij lazy discovery
Wanneer `resolveClubCodeForTeam` een club vindt:
1. `INSERT OR IGNORE INTO clubs (name, nevobo_code, logo_url)` – eenmalig, op eerste bezoek
2. `opponentClubsCache` wordt ongeldig gemaakt zodat de club direct zichtbaar is
3. Alle vervolgverzoeken voor dezelfde club: DB-hit, 0 API-calls

### Auto-create bij volgen
Wanneer een gebruiker een extern team volgt (via `POST /api/social/follow`):
1. Zoek of er al een `clubs` record is met `nevobo_code`
2. Zo niet: `INSERT OR IGNORE INTO clubs` met naam + nevobo_code
3. Zoek of er al een `teams` record is met `display_name`
4. Zo niet: `INSERT INTO teams` met `club_id` en `display_name`
5. Gebruik het team-ID als `followee_id` in `user_follows`

---

## 9. Caches (server-side, in-memory)

| Cache | Variabele | TTL | Inhoud |
|-------|-----------|-----|--------|
| Club competitieteams | `teamsCache` | 30 min | `nevoboCode → { teams[], fetchedAt }` |
| Tegenstander-clubs | `opponentClubsCache` | 6 uur | `nevoboCode → { clubs: Map, teamCodes: Map, fetchedAt }` |
| Poule stands | `standCache` | 30 min | `poulePath → { rows[], fetchedAt }` |
| Reistijden | `travelTimeCache` | Geen TTL | `"fromAddr||toAddr" → minutes` |
| Lazy code discovery | `lazyCodeCache` | Geen TTL | `teamName (normalized) → clubCode\|null` |

> Alle caches worden **gereset bij server restart**. De `clubs`-tabel in SQLite fungeert  
> als **persistente cache** over restarts heen voor clubnamen en -codes.

---

## 10. App-eigen Backend Endpoints

| Endpoint | Beschrijving |
|----------|--------------|
| `GET /api/nevobo/club/:code/schedule` | Programma.rss voor een club proxyen |
| `GET /api/nevobo/club/:code/results` | Resultaten.rss voor een club proxyen |
| `GET /api/nevobo/team/:code/:type/:number/schedule` | Programma.rss voor een specifiek team |
| `GET /api/nevobo/team/:code/:type/:number/results` | Resultaten.rss voor een specifiek team |
| `GET /api/nevobo/team/:code/:type/:number/calendar` | ICS kalender voor een specifiek team |
| `GET /api/nevobo/team-by-name?name=&code=` | Wedstrijden + statistieken voor elk team op naam |
| `GET /api/nevobo/poule-stand?teamName=&nevoboCode=` | Competitiestand voor een team (direct URL, geen brute-force) |
| `GET /api/nevobo/opponent-clubs?code=` | Alle tegenstander-clubs in dezelfde poules (DB-backed) |
| `GET /api/nevobo/geocode?address=` | Adres geocoden via Nominatim |
| `GET /api/nevobo/travel-time?from=&to=` | Reistijd berekenen via OSRM |
| `GET /api/nevobo/search?q=` | Clubs zoeken via volleybal.nl |
| `POST /api/nevobo/validate` | Nevobo-code valideren |

---

## 11. Bekende Beperkingen

1. **Geen officiële API** – alle endpoints zijn semi-publiek en kunnen zonder aankondiging wijzigen.
2. **Geen zoek-API voor clubs** – clubcodes moeten handmatig worden opgezocht via volleybal.nl. Parameters `?naam=` en `?zoekterm=` op de verenigingen-endpoint werken niet als zoekopdracht.
3. **Teamnamen zijn inconsistent** – RSS feeds en LD+JSON API gebruiken soms verschillende Unicode-apostrofen. Gebruik altijd `normalizeName()` bij vergelijkingen.
4. **Eerste bezoek aan onbekende club** – de lazy discovery doet 10–15 API-calls en duurt 3–12 seconden. Daarna is de club in de DB en zijn vervolgverzoeken instant.
5. **Externe wedstrijden niet volledig** – een team dat speelt met clubs die niet in de DB zijn geregistreerd en nog niet via lazy discovery zijn gevonden, ontbreekt tijdelijk in de resultaten.
6. **Geen historische data** – de RSS feeds bevatten alleen het huidige seizoen.
7. **Bekertoernooien** – voegen veel extra clubs toe aan de poule-structuur maar zijn voor de meeste functionaliteit niet relevant. De app filtert ze consequent uit (`!poulePath.includes('bekertoernooi')`).
