# 15 — NeVoBo-router: RSS-parse, caches en merge-logica

**Bestand:** `server/routes/nevobo.js` (~1400+ regels).  
**Aanvulling op:** [05-api-nevobo.md](./05-api-nevobo.md).

---

## 1. Twee parsers naast elkaar

### Standaard `RSSParser` (bovenaan bestand)

```js
new RSSParser({
  customFields: {
    item: [
      ['description', 'description'],
      ['nevobo:status', 'nevoboStatus'],
    ],
  },
});
```

- Gebruikt voor **programma**- en **resultaten**-RSS van vereniging en team.
- `parseMatchItem(item)` leest `title`, `description`, `nevoboStatus` → `status` (`gepland` / `gespeeld` / `onbekend`), `match_id` uit `guid`, datetime, teams, score, sets, locatie, poule.

### Aparte parser voor **poule-stand** RSS

- In `fetchPouleStand` (o.a. rond regel 764): `new RSSParser({ customFields: { item: [['description', 'description'], ['title', 'title']] } })`.
- **Niet** hetzelfde object als de globale `parser` — alleen voor stand-feeds.

### ICS (kalender)

- `node-ical` voor `programma.ics` per team — ander pad dan RSS; levert kalender-events i.p.v. `parseMatchItem`.

### LD+JSON

- `ldGet()` voor Hydra/JSON-LD endpoints op `https://api.nevobo.nl` (o.a. competitieteams, paginering). Los van RSS.

---

## 2. `parseMatchItem` — titelvarianten

| Bron | Titelpatroon | Gedrag |
|------|----------------|--------|
| Programma | `10 mrt 19:00: Team A - Team B` | Prefix met datum/tijd wordt gestript; daarna split op ` - ` |
| Resultaten | `Team A - Team B, Uitslag: 3-2` | Alles vóór `, Uitslag:` (case-insensitive) wordt teamstring |

**Description:** comma-gescheiden velden; regex voor `Uitslag`, `Setstanden`, `Speellocatie`, `Wedstrijd` (poulecode alleen zonder ` - ` in de waarde).

---

## 3. Drie-laags cache: `withFeedCache`

1. **Memory** — `feedMemCache` Map, TTL per entry (`ttlMs`).
2. **SQLite** — tabel `feed_cache` (`cache_key`, `data_json`, `fetched_at`, `ttl_ms`).
3. **Fetch** — `fetchFn()` naar Nevobo; bij succes wordt TTL berekend en opgeslagen.

**Bij fout:** serveer **stale** data uit memory of DB; alleen als beide ontbreken → error doorgeven.

**Smart TTL:**

- `scheduleSmartTtl(matches)` — korter als er binnenkort een wedstrijd is of net gespeeld (4 uur venster → 5 min); anders 1 h / 24 h.
- `resultsSmartTtl(matches)` — afhankelijk van leeftijd laatste wedstrijd + weekend (max 30 min op weekend).

---

## 4. Merge programma + resultaten (team-recent / team-by-name pad)

In het blok dat parallel **alle** `programma.rss` + `resultaten.rss` per Nevobo-code in `codesToSearch` ophaalt (rond regel 881–917):

1. FlatMap per club: twee `parseURL` calls (schedule + results).
2. Elke item → `parseMatchItem`, filter met `matchFilter` (team hoort bij gevraagde naam).
3. **Deduplicatie:** `key = match_id || title`; eerste wint (`Set seen`).
4. **Bucket:**  
   - Uit **schedule-feed:** als `status === 'gespeeld'` OF starttijd >2 uur geleden → in **results**-array; anders **schedule**.  
   - Uit **results-feed:** altijd **results**.

5. Sort: schedule oplopend op datum, results aflopend.

Dit is **anders** dan de eenvoudige club-endpoints `/club/:code/schedule` en `/club/:code/results`, die **één** RSS elk cachen zonder deze multi-club merge.

---

## 5. Club/team schedule endpoints (enkelvoudige feed)

- `/club/:code/schedule` — alleen `programma.rss`, daarna filter: geen `gespeeld`, geen start >2 uur geleden.
- `/club/:code/results` — alleen `resultaten.rss`.
- Zelfde filterpatroon voor `/team/.../schedule`.

**Enrichment:** `enrichWithClubCodes(matches)` vult/clustert clubcodes voor kaarten/tegenstanders (zie verderop in bestand — teamCodes maps, opponent discovery).

---

## 6. Overige caches (kort)

| Cache | TTL / opmerking |
|--------|------------------|
| `teamsCache` | 30 min — competition teams per nevobo code |
| `competition_teams` DB | 24 h + validatie tegen API `totalItems` |
| `club_opponents` | 7 dagen |
| `opponentClubsCache` | 6 uur memory |
| `standCache` | stand RSS |
| `travelTimeCache` | memory voor OSRM-resultaten |

---

## 7. Foutafhandeling richting client

Veel routes: `502` met `{ ok: false, error: 'Nevobo API onbereikbaar', detail }` — bij cache-miss en fetch-fout zonder stale fallback.

---

## Onderhoud

Bij wijzigingen in Nevobo HTML/RSS: begin altijd bij `parseMatchItem` + titelregexen; daarna merge-keys (`match_id || title`).

**Zie ook:** [datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md).
