const express = require('express');
const router = express.Router();
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');
const ical = require('node-ical');

const parser = new RSSParser({
  customFields: {
    item: [
      ['description', 'description'],
      ['nevobo:status', 'nevoboStatus'],
    ],
  },
});

const NEVOBO_BASE = 'https://api.nevobo.nl/export';

// ─── Parse match data from Nevobo RSS ─────────────────────────────────────────
// Schedule description format:
//   "Wedstrijd: 3000MA1H2 GE, Datum: dinsdag 10 maart, 19:00, Speellocatie: De Zebra, Goverwellesingel 10, 2807DZ Gouda"
// Schedule title format:
//   "10 mrt 19:00: VollinGo MA 1 - VTC Woerden MA 2"
// Results description format:
//   "Wedstrijd: OKV MA 1 - VTC Woerden MA 1, Uitslag: 3-2, Setstanden: 13-25, 25-22, 12-25, 25-21, 15-11"
// Results title format:
//   "UVV-Sphynx MB 2 - VTC Woerden MB 2, Uitslag: 0-4"

function parseMatchItem(item) {
  const title = item.title || '';
  const desc = item.description || '';
  const status = item.nevoboStatus || 'onbekend';
  const datetime = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null);
  const matchId = item.guid ? item.guid.replace(/.*\//, '') : null;
  const link = item.link || item.guid || null;

  const match = {
    match_id: matchId,
    link,
    title,
    datetime,
    status,           // 'gepland' | 'gespeeld' | 'onbekend'
    home_team: null,
    away_team: null,
    score: null,       // e.g. "0-4"
    score_home: null,
    score_away: null,
    sets: [],          // e.g. ["19-25", "13-25", "18-25", "19-25"]
    poule_code: null,
    venue_name: null,
    venue_address: null,
    raw_description: desc,
  };

  // ── Parse teams from title ──
  // Schedule title: "10 mrt 19:00: TeamA X - TeamB Y"  →  after the colon
  // Results title:  "TeamA X - TeamB Y, Uitslag: 3-2"  →  before the comma
  if (title) {
    // Remove leading date/time prefix for schedule: "10 mrt 19:00: ..."
    const afterColon = title.match(/^\d+\s+\w+\s+\d+:\d+:\s*(.+)$/);
    const teamsStr = afterColon ? afterColon[1] : title.replace(/,\s*Uitslag:.+$/, '').replace(/,\s*uitslag:.+$/i, '').trim();

    // Split on " - " to get home/away
    const teamMatch = teamsStr.match(/^(.+?)\s+-\s+(.+)$/);
    if (teamMatch) {
      match.home_team = teamMatch[1].trim();
      match.away_team = teamMatch[2].trim();
    }
  }

  // ── Parse description fields ──
  // Fields are comma-separated: "Key: Value, Key: Value, ..."
  if (desc) {
    // Score from results: "Uitslag: 3-2"
    const scoreMatch = desc.match(/Uitslag:\s*(\d+)-(\d+)/i);
    if (scoreMatch) {
      match.score = `${scoreMatch[1]}-${scoreMatch[2]}`;
      match.score_home = parseInt(scoreMatch[1]);
      match.score_away = parseInt(scoreMatch[2]);
    }

    // Sets: "Setstanden: 25-17, 23-25, 25-15, 25-22"
    const setsMatch = desc.match(/Setstanden:\s*([0-9,\s-]+)/i);
    if (setsMatch) {
      match.sets = setsMatch[1].trim().split(/,\s*/).filter(s => s.match(/\d+-\d+/));
    }

    // Venue: "Speellocatie: De Zebra, Goverwellesingel 10, 2807DZ Gouda"
    // Everything after "Speellocatie:" to end of string
    const venueMatch = desc.match(/Speellocatie:\s*(.+)$/i);
    if (venueMatch) {
      const venueFull = venueMatch[1].trim();
      // First part before first comma is the hall name, rest is address
      const commaIdx = venueFull.indexOf(',');
      if (commaIdx > 0) {
        match.venue_name = venueFull.slice(0, commaIdx).trim();
        match.venue_address = venueFull.slice(commaIdx + 1).trim();
      } else {
        match.venue_name = venueFull;
      }
    }

    // Poule code: "Wedstrijd: 3000MA1H2 GE" → the code after "Wedstrijd:"
    // For results this is "Wedstrijd: TeamA - TeamB" — skip if it contains " - "
    const poulejMatch = desc.match(/Wedstrijd:\s*([A-Z0-9]+[A-Z0-9\s]+?)(?:,|$)/i);
    if (poulejMatch && !poulejMatch[1].includes(' - ')) {
      match.poule_code = poulejMatch[1].trim();
    }
  }

  return match;
}

// ─── Geocode address via Nominatim (OSM) ──────────────────────────────────────
async function geocodeAddress(address) {
  if (!address) return null;
  // Normalise whitespace (Nevobo sometimes has double spaces)
  const cleaned = address.replace(/\s+/g, ' ').trim();
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned)}&format=json&limit=1&countrycodes=nl`,
      { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } }
    );
    const data = await resp.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
    }
    // Fallback: try without postcode (in case of formatting issues)
    const withoutPostcode = cleaned.replace(/\b\d{4}\s*[A-Z]{2}\b\s*/g, '').trim();
    if (withoutPostcode !== cleaned) {
      const resp2 = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(withoutPostcode)}&format=json&limit=1&countrycodes=nl`,
        { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } }
      );
      const data2 = await resp2.json();
      if (data2 && data2[0]) {
        return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon), display: data2[0].display_name };
      }
    }
  } catch (_) {}
  return null;
}

// Drive-time in minutes between two addresses using OSRM (free, no API key)
const travelTimeCache = new Map();
async function travelTimeMinutes(fromAddress, toAddress) {
  const key = `${fromAddress.replace(/\s+/g,' ').trim()}||${toAddress.replace(/\s+/g,' ').trim()}`;
  if (travelTimeCache.has(key)) return travelTimeCache.get(key);
  const [from, to] = await Promise.all([geocodeAddress(fromAddress), geocodeAddress(toAddress)]);
  if (!from || !to) {
    console.log('[travel-time] geocode failed — from:', !!from, 'to:', !!to);
    return null;
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } });
    const data = await resp.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const minutes = Math.round(data.routes[0].duration / 60);
      travelTimeCache.set(key, minutes);
      return minutes;
    }
    console.log('[travel-time] OSRM unexpected response:', data.code);
  } catch (err) {
    console.log('[travel-time] OSRM error:', err.message);
  }
  return null;
}

// ─── Club search via volleybal.nl ─────────────────────────────────────────────
// volleybal.nl has POST /api/search with {q, type:"content"}
// Returns news + club pages. We filter for club/association pages.
async function searchClubs(query) {
  const resp = await fetch('https://www.volleybal.nl/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ q: query, type: 'content' }),
  });
  if (!resp.ok) throw new Error(`Volleybal.nl search error: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data.message || 'Search failed');

  // Filter to club/vereniging results only — their URL contains /club/ or /vereniging/
  const clubs = (data.data || []).filter(item =>
    item.url && (item.url.includes('/club/') || item.url.includes('/vereniging/'))
  );
  return clubs;
}

// ─── Validate a nevobo code by actually fetching the feed ─────────────────────
async function validateCode(code) {
  const url = `${NEVOBO_BASE}/vereniging/${code}/programma.rss`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } });
  return resp.ok;
}

const NEVOBO_API = 'https://api.nevobo.nl';

// ─── Poule lookup helpers ─────────────────────────────────────────────────────

// Parse the poule stand RSS description into an array of standing rows.
// Description format:
//   "# Team<br />1. VollinGo MA 1, wedstr: 5, punten: 24<br />2. ..."
function parseStandDescription(desc) {
  const rows = [];
  const lines = desc.split(/<br\s*\/?>/i);
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s+(.+?),\s+wedstr:\s*(\d+),\s+punten:\s*(\d+)/);
    if (m) {
      rows.push({
        positie:     parseInt(m[1]),
        team:        m[2].trim(),
        wedstrijden: parseInt(m[3]),
        punten:      parseInt(m[4]),
      });
    }
  }
  return rows;
}

// ── TTL constants ────────────────────────────────────────────────────────────
const MEM_TTL_MS            = 30 * 60_000;           // 30 min — competition teams mem cache
const DB_TEAMS_TTL_MS       = 24 * 3600_000;         // 24 h   — competition_teams DB
const DB_OPP_TTL_MS         = 7  * 24 * 3600_000;   // 7 days — club_opponents DB
const OPPONENT_CACHE_TTL_MS = 6  * 3600_000;         // 6 h    — opponentClubsCache mem
const CACHE_TTL_MS          = 3600_000;              // 1 h    — stand RSS cache

// Smart TTL for schedule feeds: how long until the next match?
function scheduleSmartTtl(matches) {
  const now = Date.now();
  const futureTimes = (matches || [])
    .map(m => m.datetime ? new Date(m.datetime).getTime() : 0)
    .filter(t => t > now)
    .sort((a, b) => a - b);

  // Check if any match was very recently played (within 4 hours) — refresh often so it disappears
  const recentlyPlayed = (matches || []).some(m => {
    if (!m.datetime) return false;
    const t = new Date(m.datetime).getTime();
    return t < now && t > now - 4 * 3600_000;
  });
  if (recentlyPlayed) return 5 * 60_000; // 5 min — need to pick up result quickly

  if (futureTimes.length === 0) return 24 * 3600_000; // no upcoming → 24 h
  const nextMs = futureTimes[0] - now;
  if (nextMs <  3 * 3600_000) return  5 * 60_000;    // next match within 3 h  → 5 min
  if (nextMs < 24 * 3600_000) return      3600_000;   // next match today/soon  → 1 h
  return 24 * 3600_000;                               // match far away         → 24 h
}

// Smart TTL for results feeds: how fresh is the latest result?
function resultsSmartTtl(matches) {
  const isWeekend = [0, 6].includes(new Date().getDay());
  const times = (matches || [])
    .map(m => m.datetime ? new Date(m.datetime).getTime() : 0)
    .filter(Boolean)
    .sort((a, b) => b - a);
  if (times.length === 0) return 6 * 3600_000;
  const ageMs = Date.now() - times[0];
  let ttl;
  if (ageMs < 24 * 3600_000)      ttl = 30 * 60_000;  // result from today    → 30 min
  else if (ageMs < 48 * 3600_000) ttl =  2 * 3600_000; // result from yesterday → 2 h
  else                             ttl =  6 * 3600_000; // older result          → 6 h
  // On weekends matches are happening — check more often
  return isWeekend ? Math.min(ttl, 30 * 60_000) : ttl;
}

// ── Two-layer feed cache (memory + SQLite) ───────────────────────────────────
// Applies to RSS schedule/results feeds, stand RSS, and LD+JSON pouleindelingen.
// On Nevobo API errors we fall back to stale cached data to stay resilient.
const feedMemCache = new Map(); // key → { data, fetchedAt, ttlMs }

async function withFeedCache(key, fetchFn, ttlFn) {
  const db = require('../db/db');
  const now = Date.now();

  // Layer 1: in-memory
  const mem = feedMemCache.get(key);
  if (mem && now - mem.fetchedAt < mem.ttlMs) {
    return { data: mem.data, stale: false };
  }

  // Layer 2: DB (survives server restarts)
  let dbRow;
  try {
    dbRow = db.prepare('SELECT data_json, fetched_at, ttl_ms FROM feed_cache WHERE cache_key = ?').get(key);
  } catch (_) {}
  if (dbRow && now - dbRow.fetched_at < dbRow.ttl_ms) {
    const data = JSON.parse(dbRow.data_json);
    feedMemCache.set(key, { data, fetchedAt: dbRow.fetched_at, ttlMs: dbRow.ttl_ms });
    return { data, stale: false };
  }

  // Layer 3: fetch from Nevobo API
  try {
    const data = await fetchFn();
    const ttlMs = ttlFn ? ttlFn(data) : 3600_000;
    feedMemCache.set(key, { data, fetchedAt: now, ttlMs });
    try {
      db.prepare('INSERT OR REPLACE INTO feed_cache (cache_key, data_json, fetched_at, ttl_ms) VALUES (?, ?, ?, ?)')
        .run(key, JSON.stringify(data), now, ttlMs);
    } catch (_) {} // non-fatal
    return { data, stale: false };
  } catch (err) {
    // Serve stale if we have anything at all
    if (mem)   return { data: mem.data,                       stale: true };
    if (dbRow) return { data: JSON.parse(dbRow.data_json),    stale: true };
    throw err; // truly nothing available
  }
}

// In-memory caches (fast layer; reset on server restart)
const teamsCache = new Map(); // nevoboCode → { teams, fetchedAt }

const ldHeaders = { 'User-Agent': 'VolleyballTeamApp/1.0', 'Accept': 'application/ld+json' };

async function ldGet(path) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const r = await fetch(`${NEVOBO_API}${path}`, { headers: ldHeaders, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

/**
 * Fetch all competition teams for a club — three-layer cache:
 *   1. In-memory (30 min)  — fastest, lost on server restart
 *   2. SQLite DB (24 h)    — survives server restarts
 *   3. Nevobo API with pagination — fetches ALL pages to handle clubs with >50 teams
 *
 * Clubs with many youth + senior + recreational teams can easily exceed 50.
 * We paginate until all teams are retrieved and compare the DB count against
 * hydra:totalItems before accepting a cached result as complete.
 */
async function fetchClubCompetitionTeams(nevoboCode) {
  // Layer 1: in-memory
  const mem = teamsCache.get(nevoboCode);
  if (mem && Date.now() - mem.fetchedAt < MEM_TTL_MS) return mem.teams;

  const db = require('../db/db');

  // Layer 2: SQLite — only trust cache if row count matches the API total
  // We store totalItems alongside the cache so we can validate completeness.
  const rows = db.prepare(
    `SELECT team_path, team_naam, standpositietekst, fetched_at
     FROM competition_teams WHERE club_nevobo_code = ? ORDER BY id`
  ).all(nevoboCode);
  const totalRow = db.prepare(
    `SELECT total_count, fetched_at FROM competition_teams_meta WHERE club_nevobo_code = ?`
  ).get(nevoboCode);

  const dbComplete = totalRow &&
    rows.length >= (totalRow.total_count || 0) &&
    Date.now() - totalRow.fetched_at < DB_TEAMS_TTL_MS;

  if (dbComplete) {
    const teams = rows.map(r => ({
      '@id': r.team_path,
      naam: r.team_naam,
      standpositietekst: r.standpositietekst,
    }));
    teamsCache.set(nevoboCode, { teams, fetchedAt: totalRow.fetched_at });
    return teams;
  }

  // Layer 3: Nevobo API with pagination
  // NOTE: the API may return fewer than PAGE_SIZE items per page even when more pages exist.
  // Always use hydra:totalItems as the authoritative stop condition, not items.length.
  const PAGE_SIZE = 50;
  let allTeams = [];
  let page = 1;
  let totalItems = Infinity; // will be set on first response

  while (allTeams.length < totalItems) {
    const data = await ldGet(
      `/competitie/teams.jsonld?vereniging=/relatiebeheer/verenigingen/${nevoboCode}&limit=${PAGE_SIZE}&page=${page}`
    );
    if (!data) break;
    const items = data?.['hydra:member'] || [];
    if (items.length === 0) break;
    if (totalItems === Infinity) totalItems = data['hydra:totalItems'] ?? items.length;
    allTeams = allTeams.concat(items);
    page++;
    if (page > 10) break; // safety guard against infinite loop
  }

  const now = Date.now();

  // Write to DB (replace old data + store total count for cache validation)
  db.transaction(() => {
    db.prepare('DELETE FROM competition_teams WHERE club_nevobo_code = ?').run(nevoboCode);
    const ins = db.prepare(
      `INSERT INTO competition_teams (club_nevobo_code, team_path, team_naam, standpositietekst, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const t of allTeams) ins.run(nevoboCode, t['@id'] || '', t.naam || null, t.standpositietekst || null, now);
    db.prepare(
      `INSERT OR REPLACE INTO competition_teams_meta (club_nevobo_code, total_count, fetched_at)
       VALUES (?, ?, ?)`
    ).run(nevoboCode, totalItems ?? allTeams.length, now);
  })();

  teamsCache.set(nevoboCode, { teams: allTeams, fetchedAt: now });
  return allTeams;
}

// Cache: nevoboCode → { clubs: Map, teamCodes: Map, fetchedAt }
const opponentClubsCache = new Map();

// Normalize a team name for consistent lookup (lower-case, apostrophes, trim)
function normalizeName(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Build a team-name → club-code lookup from the competition_teams table.
 * This covers ALL clubs that have ever been lazy-discovered, regardless of whether
 * they're stored in club_opponents for a specific requesting club.
 * Result is cached in-memory for 5 minutes.
 */
let _teamCodeDbCache = null;
let _teamCodeDbCacheAt = 0;
const TEAM_CODE_DB_TTL_MS = 5 * 60 * 1000;

function buildTeamCodeDbLookup() {
  if (_teamCodeDbCache && Date.now() - _teamCodeDbCacheAt < TEAM_CODE_DB_TTL_MS) {
    return _teamCodeDbCache;
  }
  const db = require('../db/db');
  const rows = db.prepare('SELECT club_nevobo_code, team_naam FROM competition_teams WHERE team_naam IS NOT NULL').all();
  const map = new Map();
  for (const row of rows) {
    const norm = normalizeName(row.team_naam);
    if (norm && !map.has(norm)) map.set(norm, row.club_nevobo_code);
  }
  _teamCodeDbCache = map;
  _teamCodeDbCacheAt = Date.now();
  return map;
}

/**
 * Enrich match objects with home_club_code / away_club_code from the DB.
 * This is a post-cache step so cached matches get fresh codes on every request.
 */
function enrichWithClubCodes(matches) {
  if (!matches?.length) return matches;
  const lookup = buildTeamCodeDbLookup();
  return matches.map(m => {
    const homeCode = m.home_club_code || lookup.get(normalizeName(m.home_team)) || null;
    const awayCode = m.away_club_code || lookup.get(normalizeName(m.away_team)) || null;
    if (homeCode === m.home_club_code && awayCode === m.away_club_code) return m;
    return { ...m, home_club_code: homeCode, away_club_code: awayCode };
  });
}

/**
 * Returns opponent club info for a given Nevobo club code.
 * Club info (name, logo) is loaded from the DB — no Nevobo API calls for club details.
 * Clubs are added to the DB lazily via resolveClubCodeForTeam().
 *
 * Returns: { clubs: Map<clubCode, {clubCode,clubName,logoUrl}>, teamCodes: Map<teamNameLower, clubCode> }
 */
async function fetchOpponentClubs(nevoboCode) {
  const cached = opponentClubsCache.get(nevoboCode);
  if (cached && Date.now() - cached.fetchedAt < OPPONENT_CACHE_TTL_MS) {
    return { clubs: cached.clubs, teamCodes: cached.teamCodes };
  }

  const clubs    = new Map(); // clubCode → { clubCode, clubName, logoUrl }
  const teamCodes = new Map(); // teamName (normalized) → clubCode

  try {
    const db = require('../db/db');

    // 1. Own club's teams → add to teamCodes (uses three-layer cache)
    const myTeams = await fetchClubCompetitionTeams(nevoboCode);
    for (const t of myTeams) {
      if (t.naam) teamCodes.set(normalizeName(t.naam), nevoboCode);
    }

    // 2. Load opponent codes — from DB if fresh, otherwise walk poule structure
    const storedOpp = db.prepare(
      `SELECT opponent_nevobo_code, fetched_at FROM club_opponents WHERE club_nevobo_code = ? ORDER BY rowid`
    ).all(nevoboCode);

    let clubCodesSeen;
    if (storedOpp.length > 0 && Date.now() - storedOpp[0].fetched_at < DB_OPP_TTL_MS) {
      // Serve from DB — no API calls needed
      clubCodesSeen = new Set(storedOpp.map(r => r.opponent_nevobo_code));
    } else {
      // Discover via poule traversal (only on cold start / weekly refresh)
      const poulesSeen = new Set();
      await Promise.all(myTeams.map(async (team) => {
        const d = await ldGet(`/competitie/pouleindelingen.jsonld?team=${encodeURIComponent(team['@id'])}&limit=10`);
        for (const ind of d?.['hydra:member'] || []) poulesSeen.add(ind.poule);
      }));

      clubCodesSeen = new Set();
      await Promise.all([...poulesSeen].map(async (poulePath) => {
        const d = await ldGet(`/competitie/pouleindelingen.jsonld?poule=${encodeURIComponent(poulePath)}&limit=50`);
        for (const ind of d?.['hydra:member'] || []) {
          const code = ind.team?.split('/')?.[3];
          if (code && code !== nevoboCode) clubCodesSeen.add(code);
        }
      }));

      // Persist to DB so subsequent server restarts skip the traversal
      if (clubCodesSeen.size > 0) {
        const now = Date.now();
        db.transaction(() => {
          db.prepare('DELETE FROM club_opponents WHERE club_nevobo_code = ?').run(nevoboCode);
          const ins = db.prepare(
            `INSERT OR IGNORE INTO club_opponents (club_nevobo_code, opponent_nevobo_code, fetched_at)
             VALUES (?, ?, ?)`
          );
          for (const code of clubCodesSeen) ins.run(nevoboCode, code, now);
        })();
      }
    }

    // 3. Initialise clubs Map entries
    for (const code of clubCodesSeen) {
      clubs.set(code, { clubCode: code, clubName: null, logoUrl: null });
    }

    // 4. Load club names/logos from DB (written by resolveClubCodeForTeam on first visit)
    if (clubCodesSeen.size > 0) {
      const ph = [...clubCodesSeen].map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT nevobo_code, name AS clubName, logo_url AS logoUrl FROM clubs WHERE nevobo_code IN (${ph})`
      ).all([...clubCodesSeen]);
      for (const row of rows) {
        if (row.clubName) {
          clubs.set(row.nevobo_code, { clubCode: row.nevobo_code, clubName: row.clubName, logoUrl: row.logoUrl || null });
        }
      }
    }

    // 5. For DB-known clubs, populate teamCodes from in-memory teamsCache (no API calls)
    for (const [code, club] of clubs) {
      if (!club.clubName) continue;
      const cached = teamsCache.get(code);
      if (cached?.teams) {
        for (const t of cached.teams) {
          if (t.naam) teamCodes.set(normalizeName(t.naam), code);
        }
      }
    }
  } catch (_) {}

  opponentClubsCache.set(nevoboCode, { clubs, teamCodes, fetchedAt: Date.now() });
  return { clubs, teamCodes };
}

// Map team-type abbreviations (RSS format) to Nevobo URL path segments
const TEAM_TYPE_MAP = {
  ds: 'dames', hs: 'heren', dr: 'dames-recreatief', hr: 'heren-recreatief',
  dm: 'dames-master', xr: 'mix-recreatief',
  ma: 'meiden-a', mb: 'meiden-b', mc: 'meiden-c', md: 'meiden-d', me: 'meiden-e',
  ja: 'jongens-a', jb: 'jongens-b', jc: 'jongens-c', jd: 'jongens-d',
  n5: 'mix-5-hoog', n6: 'mix-6-hoog',
};

/**
 * Lazy on-demand club code discovery.
 *
 * When a user navigates to an unknown team (e.g. "Go'97 MA 1"), this function:
 *   1. Checks the DB (instant — covers repeat visits)
 *   2. Walks only the relevant same-type competition poules for ownCode's club
 *   3. For each opponent code in those poules, checks if any team name matches
 *   4. Saves the discovered club to the DB so future visits are instant
 *
 * Returns the discovered nevoboCode, or null if not found.
 */
const lazyCodeCache = new Map(); // teamName (normalized) → code (or null)

async function resolveClubCodeForTeam(teamName, ownCode) {
  const norm = normalizeName(teamName);
  if (lazyCodeCache.has(norm)) return lazyCodeCache.get(norm);

  const db = require('../db/db');

  // 1. Check DB teams table for a known match
  const dbTeamMatch = db.prepare(
    `SELECT c.nevobo_code FROM teams t
     JOIN clubs c ON c.id = t.club_id
     WHERE LOWER(t.display_name) = ? AND c.nevobo_code IS NOT NULL`
  ).get(norm);
  if (dbTeamMatch?.nevobo_code) {
    lazyCodeCache.set(norm, dbTeamMatch.nevobo_code);
    return dbTeamMatch.nevobo_code;
  }

  // 2. Check already-cached team lists (in teamsCache) for any known club
  for (const [code, entry] of teamsCache) {
    if (!entry?.teams) continue;
    for (const t of entry.teams) {
      if (normalizeName(t.naam) === norm) {
        lazyCodeCache.set(norm, code);
        return code;
      }
    }
  }

  // 3. Extract team type (e.g. "meiden-a") and number from the team name.
  //    "Go'97 MA 1" → type "meiden-a", number "1"
  const typeMatch = teamName.match(/\b([A-Za-z]{2})\s+(\d+)(?:\s*$|,)/);
  if (!typeMatch) {
    lazyCodeCache.set(norm, null);
    return null;
  }
  const typeAbbr   = typeMatch[1].toLowerCase();
  const teamNumber = typeMatch[2];
  const nevoboType = TEAM_TYPE_MAP[typeAbbr];
  if (!nevoboType) {
    lazyCodeCache.set(norm, null);
    return null;
  }

  // 4. Get ownCode's teams of the same type
  const myTeams = await fetchClubCompetitionTeams(ownCode);
  const sameTypeTeams = myTeams.filter(t => t['@id']?.includes(`/${nevoboType}/`));
  if (sameTypeTeams.length === 0) {
    lazyCodeCache.set(norm, null);
    return null;
  }

  // 5. Find regular-competition poules for those same-type teams
  const relevantPoules = new Set();
  await Promise.all(sameTypeTeams.map(async (team) => {
    const d = await ldGet(`/competitie/pouleindelingen.jsonld?team=${encodeURIComponent(team['@id'])}&limit=10`);
    for (const ind of d?.['hydra:member'] || []) {
      if (!ind.poule?.includes('bekertoernooi')) relevantPoules.add(ind.poule);
    }
  }));

  // 6. Collect opponent codes from those poules
  const opponentCodes = new Set();
  await Promise.all([...relevantPoules].map(async (poulePath) => {
    const d = await ldGet(`/competitie/pouleindelingen.jsonld?poule=${encodeURIComponent(poulePath)}&limit=50`);
    for (const ind of d?.['hydra:member'] || []) {
      const code = ind.team?.split('/')?.[3];
      if (code && code !== ownCode) opponentCodes.add(code);
    }
  }));

  // 7. For each opponent code, fetch their competition teams and check for a name match
  for (const code of opponentCodes) {
    const oppTeams = await fetchClubCompetitionTeams(code);
    for (const t of (oppTeams || [])) {
      if (normalizeName(t.naam) === norm) {
        // Match found — persist the club to DB so future visits are instant
        lazyCodeCache.set(norm, code);
        try {
          const info = await ldGet(`/relatiebeheer/verenigingen/${code}.jsonld`);
          const clubName = info?.naam || info?.officielenaam || code.toUpperCase();
          const logoUrl  = info?._links?.logo_url?.href ? `https:${info._links.logo_url.href}` : null;
          db.prepare(`INSERT OR IGNORE INTO clubs (name, nevobo_code, logo_url) VALUES (?, ?, ?)`)
            .run(clubName, code, logoUrl);
          // Also add directly to club_opponents so it shows up in opponent-clubs
          // without requiring a full poule re-traversal
          db.prepare(
            `INSERT OR IGNORE INTO club_opponents (club_nevobo_code, opponent_nevobo_code, fetched_at) VALUES (?, ?, ?)`
          ).run(ownCode, code, Date.now());
          // Invalidate in-memory caches
          opponentClubsCache.delete(ownCode);
          _teamCodeDbCache = null; // force rebuild of DB lookup
        } catch (_) {}
        return code;
      }
    }
  }

  lazyCodeCache.set(norm, null);
  return null;
}

// Build a flat lookup: clubCode → club info (including own club)
async function buildTeamNameLookup(nevoboCode) {
  const { clubs: opClubs } = await fetchOpponentClubs(nevoboCode);
  const myInfo = await ldGet(`/relatiebeheer/verenigingen/${nevoboCode}.jsonld`);
  const myLogo = myInfo?._links?.logo_url?.href ? `https:${myInfo._links.logo_url.href}` : null;

  const lookup = new Map(opClubs);
  lookup.set(nevoboCode, {
    clubCode: nevoboCode,
    clubName: myInfo?.naam || 'Jouw club',
    logoUrl: myLogo,
  });
  return lookup;
}

// Cache: afkorting → { standRows, omschrijving, standUrl }
const standCache = new Map();

// Derive poule afkorting from the RSS poule code e.g. "3000MA1H2 GE" → "ma1h2"
function afkortingFromPouleCode(pouleCode) {
  return pouleCode.replace(/^\d{4}/, '').split(' ')[0].toLowerCase();
}

// Known competition slug patterns in Nevobo (cover most common competitions)
const NEVOBO_REGIO_SLUGS   = [
  'regio-west', 'regio-midden', 'regio-noord', 'regio-oost', 'regio-zuidwest', 'regio-zuid',
  'nationaal',
];
const NEVOBO_COMP_PATTERNS = [
  // Youth — first/second half competitions
  'tweede-helft-a-jeugdcompetitie-2',
  'tweede-helft-a-jeugdcompetitie-1',
  'eerste-helft-a-jeugdcompetitie-2',
  'eerste-helft-a-jeugdcompetitie-1',
  'tweede-helft-b-jeugdcompetitie-2',
  'tweede-helft-b-jeugdcompetitie-1',
  'eerste-helft-b-jeugdcompetitie-2',
  'eerste-helft-b-jeugdcompetitie-1',
  'tweede-helft-c-jeugdcompetitie-2',
  'tweede-helft-c-jeugdcompetitie-1',
  'eerste-helft-c-jeugdcompetitie-2',
  'eerste-helft-c-jeugdcompetitie-1',
  'tweede-helft-jeugdcompetitie-2',
  'tweede-helft-jeugdcompetitie-1',
  'eerste-helft-jeugdcompetitie-2',
  'eerste-helft-jeugdcompetitie-1',
  // Seniors
  'seniorencompetitie-1',
  'competitie-seniorencompetitie-1',
  'eerste-divisie-1',
  'eredivisie-1',
  // Recreants
  'recreantencompetitie-1',
  'recreantencompetitie-2',
  // National / Promotieklasse fallbacks
  'promotie-1',
  'promotieklasse-1',
];
const MAX_POULE_N = 20; // Try poule suffixes 1..20

// Brute-force search for stand RSS URL using known URL patterns.
// First call per afkorting may take 1-5 seconds depending on which iteration matches.
async function findStandRssUrl(afkorting) {
  for (const regio of NEVOBO_REGIO_SLUGS) {
    for (const comp of NEVOBO_COMP_PATTERNS) {
      for (let n = 1; n <= MAX_POULE_N; n++) {
        const url = `${NEVOBO_API}/export/poule/${regio}/${comp}/${regio}-${afkorting}-${n}/stand.rss`;
        const r = await fetch(url, { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } });
        if (r.ok) return url;
      }
    }
  }
  return null;
}

// Returns { rows, compTitle } where compTitle is derived from the RSS item title
// e.g. "Stand Meiden A 1e Klasse G Tweede helft Regio West" → "Meiden A 1e Klasse G Tweede helft"
async function fetchStandRows(standRssUrl) {
  const RSSParser = require('rss-parser');
  const standParser = new RSSParser({ customFields: { item: [['description', 'description'], ['title', 'title']] } });
  const feed = await standParser.parseURL(standRssUrl).catch(() => null);
  if (!feed) return { rows: [], compTitle: '' };
  const rows = parseStandDescription(feed.items[0]?.description || '');
  // "Stand Meiden A 1e Klasse G Tweede helft Regio West" → strip "Stand " and " Regio ..."
  const rawTitle = feed.items[0]?.title || '';
  const compTitle = rawTitle.replace(/^Stand\s+/i, '').replace(/\s+Regio\s+\S+$/i, '').trim();
  return { rows, compTitle };
}

// Find the best matching competition team for a given display name within a club.
// Uses normalizeName() so apostrophe variants and stray backslashes don't cause mismatches.
function findMatchingTeam(competitionTeams, displayName) {
  if (!displayName || !competitionTeams.length) return null;
  const norm = normalizeName(displayName);

  // 1. Exact match (normalized)
  let found = competitionTeams.find(t => normalizeName(t.naam) === norm);
  if (found) return found;

  // 2. The API name ends with our display name (sponsor prefix stripped)
  found = competitionTeams.find(t => normalizeName(t.naam).endsWith(norm));
  if (found) return found;

  // 3. Our display name ends with the API name (we have a suffix)
  found = competitionTeams.find(t => norm.endsWith(normalizeName(t.naam)));
  if (found) return found;

  // 4. Substring in either direction
  found = competitionTeams.find(t => {
    const tn = normalizeName(t.naam);
    return tn.includes(norm) || norm.includes(tn);
  });
  return found || null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/nevobo/team-by-name?name=VTC+Woerden+HS+2&code=ckl9x7n&userId=1
// Returns schedule, results, record and follow state for any team by display name.
// Aggregates matches from ALL registered clubs' feeds so opponent results are complete.
router.get('/team-by-name', async (req, res) => {
  const { code, userId } = req.query;
  // Strip stray backslashes that may come from broken HTML attribute escaping in old cached JS
  const name = (req.query.name || '').replace(/\\/g, '');
  if (!name || !code) return res.status(400).json({ ok: false, error: 'name en code zijn verplicht' });

  const db = require('../db/db');
  // Normalize the requested team name (apostrophes, whitespace) so RSS feed names
  // always match regardless of which Unicode apostrophe variant the caller used.
  const normTeamName = normalizeName(name);

  const matchFilter = m => {
    const home = normalizeName(m.home_team);
    const away = normalizeName(m.away_team);
    return home === normTeamName || away === normTeamName
      || home.endsWith(normTeamName) || away.endsWith(normTeamName)
      || home.includes(normTeamName) || away.includes(normTeamName);
  };

  // Collect all unique nevobo codes to search — requested code + all registered clubs
  const allClubs = db.prepare('SELECT nevobo_code FROM clubs WHERE nevobo_code IS NOT NULL').all();
  const codesToSearch = new Set([code.toLowerCase(), ...allClubs.map(c => c.nevobo_code).filter(Boolean)]);

  // Resolve the team's actual Nevobo club code (in priority order):
  //   A) DB team→club lookup (instant)
  //   B) teamCodes map from fetchOpponentClubs (fast, DB-backed)
  //   C) Lazy poule-structure discovery — resolveClubCodeForTeam (on first visit only)
  let resolvedNevoboCode = code.toLowerCase();

  // Method A: check the teams table in DB
  const dbTeamRow = db.prepare(
    `SELECT c.nevobo_code FROM teams t
     JOIN clubs c ON c.id = t.club_id
     WHERE LOWER(t.display_name) = ? AND c.nevobo_code IS NOT NULL`
  ).get(normTeamName);
  if (dbTeamRow?.nevobo_code) {
    resolvedNevoboCode = dbTeamRow.nevobo_code;
    codesToSearch.add(resolvedNevoboCode);
  }

  // Method B: teamCodes map (covers own teams + DB-cached opponents)
  if (resolvedNevoboCode === code.toLowerCase()) {
    try {
      const { teamCodes } = await fetchOpponentClubs(code.toLowerCase());
      const found = teamCodes.get(normTeamName);
      if (found) {
        resolvedNevoboCode = found;
        codesToSearch.add(found);
      }
    } catch (_) {}
  }

  // Method C: lazy discovery — only triggered when code is still unresolved
  if (resolvedNevoboCode === code.toLowerCase()) {
    try {
      const discovered = await resolveClubCodeForTeam(name, code.toLowerCase());
      if (discovered && discovered !== code.toLowerCase()) {
        resolvedNevoboCode = discovered;
        codesToSearch.add(discovered);
      }
    } catch (_) {}
  }

  try {
    // Fetch all clubs' schedule + results feeds in parallel
    const fetches = Array.from(codesToSearch).flatMap(clubCode => [
      parser.parseURL(`${NEVOBO_BASE}/vereniging/${clubCode}/programma.rss`)
        .then(feed => ({ type: 'schedule', items: feed.items || [] }))
        .catch(() => ({ type: 'schedule', items: [] })),
      parser.parseURL(`${NEVOBO_BASE}/vereniging/${clubCode}/resultaten.rss`)
        .then(feed => ({ type: 'results', items: feed.items || [] }))
        .catch(() => ({ type: 'results', items: [] })),
    ]);

    const feeds = await Promise.all(fetches);

    // Merge and deduplicate by match_id (or title fallback)
    const seen = new Set();
    const schedule = [];
    const results  = [];

    const now = Date.now();
    for (const { type, items } of feeds) {
      for (const item of items) {
        const m = parseMatchItem(item);
        if (!matchFilter(m)) continue;
        const key = m.match_id || m.title || '';
        if (seen.has(key)) continue;
        seen.add(key);
        if (type === 'schedule') {
          // Filter out already-played matches or matches that started more than 2 hours ago
          if (m.status === 'gespeeld') continue;
          if (m.datetime && new Date(m.datetime).getTime() < now - 2 * 3600_000) continue;
          schedule.push(m);
        } else {
          results.push(m);
        }
      }
    }

    // Sort: schedule ascending by date, results descending
    schedule.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    results.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    // Compute W/L/D
    let wins = 0, losses = 0, draws = 0;
    results.forEach(m => {
      if (m.score_home === null) return;
      const isHome = normalizeName(m.home_team).includes(normTeamName);
      const myScore  = isHome ? m.score_home : m.score_away;
      const oppScore = isHome ? m.score_away : m.score_home;
      if (myScore > oppScore) wins++;
      else if (myScore < oppScore) losses++;
      else draws++;
    });

    // Check if this team exists in our DB
    const dbTeam = db.prepare(
      'SELECT t.*, c.name AS club_name, c.nevobo_code FROM teams t JOIN clubs c ON c.id = t.club_id WHERE LOWER(t.display_name) = ?'
    ).get(normTeamName);

    let isFollowing = false;
    let isOwnTeam   = false;
    let followerCount = 0;
    if (userId) {
      const uid = parseInt(userId);
      if (dbTeam) {
        isFollowing = !!db.prepare(
          "SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_type = 'team' AND followee_id = ?"
        ).get(uid, dbTeam.id);
        const u = db.prepare('SELECT team_id FROM users WHERE id = ?').get(uid);
        isOwnTeam = u?.team_id === dbTeam.id ||
          !!db.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ?').get(uid, dbTeam.id);
        followerCount = db.prepare(
          "SELECT COUNT(*) AS n FROM user_follows WHERE followee_type = 'team' AND followee_id = ?"
        ).get(dbTeam.id)?.n || 0;
      } else {
        // External team — check if user follows by name-based auto-created record
        const externalTeam = db.prepare(
          "SELECT t.id FROM teams t WHERE LOWER(t.display_name) = ?"
        ).get(normTeamName);
        if (externalTeam) {
          isFollowing = !!db.prepare(
            "SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_type = 'team' AND followee_id = ?"
          ).get(uid, externalTeam.id);
          followerCount = db.prepare(
            "SELECT COUNT(*) AS n FROM user_follows WHERE followee_type = 'team' AND followee_id = ?"
          ).get(externalTeam.id)?.n || 0;
        }
      }
    }

    const members = dbTeam
      ? db.prepare(`
          SELECT DISTINCT u.id, u.name, u.avatar_url, u.level, u.xp,
            COALESCE(tm.membership_type, u.role) AS membership_type
          FROM users u
          LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = ?
          WHERE u.team_id = ? OR tm.team_id = ?
          ORDER BY
            CASE COALESCE(tm.membership_type, u.role)
              WHEN 'player' THEN 1
              WHEN 'coach'  THEN 2
              WHEN 'staff'  THEN 3
              WHEN 'parent' THEN 4
              ELSE 5
            END,
            u.xp DESC
        `).all(dbTeam.id, dbTeam.id, dbTeam.id)
      : [];

    res.json({
      ok: true,
      teamName: name,
      nevoboCode: code,
      resolvedNevoboCode: resolvedNevoboCode,
      dbTeam: dbTeam || null,
      schedule,
      results,
      wins, losses, draws,
      isFollowing, isOwnTeam, followerCount,
      members,
      pouleCodes: [...new Set([...schedule, ...results].map(m => m.poule_code).filter(Boolean))],
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar', detail: err.message });
  }
});

// Convert a competition URL slug to a readable name
// e.g. "tweede-helft-b-jeugdcompetitie-2" → "Tweede helft B jeugdcompetitie 2"
function compSlugToName(slug) {
  return slug
    .replace(/^competitie-/, '')
    .replace(/-/g, ' ')
    .replace(/\b([a-z])/g, (_, c, i) => i === 0 ? c.toUpperCase() : c);
}

// Sort priority for competition phases (highest = most recent/active)
function compPriority(poulePath) {
  const slug = poulePath.split('/')[4] || '';
  if (slug.includes('tweede-helft')) return 200;
  if (slug.includes('eerste-helft')) return 100;
  const m = slug.match(/-(\d+)$/);
  return m ? parseInt(m[1]) * 10 : 50;
}

// GET /api/nevobo/poule-stand?teamName=VTC+Woerden+MA+2&nevoboCode=ckl9x7n
// Returns standings for ALL competition phases the team participates in,
// sorted newest-first. Beker poules are excluded.
router.get('/poule-stand', async (req, res) => {
  let { teamName, nevoboCode } = req.query;
  if (!teamName || !nevoboCode) return res.status(400).json({ ok: false, error: 'teamName en nevoboCode zijn verplicht' });
  teamName = teamName.replace(/\\/g, '');
  try {
    // Step 1: find the team in the competition teams list
    let competitionTeams = [];
    try {
      competitionTeams = await fetchClubCompetitionTeams(nevoboCode);
    } catch (e) {
      console.error('[poule-stand] fetchClubCompetitionTeams failed:', e.message);
    }
    const match = findMatchingTeam(competitionTeams, teamName);
    if (!match) {
      console.warn(`[poule-stand] Team "${teamName}" niet gevonden voor club ${nevoboCode} (${competitionTeams.length} teams opgehaald)`);
      return res.status(404).json({ ok: false, error: 'Team niet gevonden in Nevobo competitie' });
    }

    // Step 2: get ALL regular competition poules for this team
    const teamPath = match['@id'];
    const indelingenKey = `pouleindeling:${teamPath}`;
    let indelingen = null;
    try {
      const result = await withFeedCache(
        indelingenKey,
        () => ldGet(`/competitie/pouleindelingen.jsonld?team=${encodeURIComponent(teamPath)}&limit=20`),
        () => 6 * 3600_000,
      );
      indelingen = result.data;
    } catch (e) {
      console.error('[poule-stand] withFeedCache (indelingen) failed:', e.message);
    }
    const regularMembers = (indelingen?.['hydra:member'] || [])
      .filter(ind => ind.poule && !ind.poule.includes('bekertoernooi'));

    if (regularMembers.length === 0) {
      return res.json({ ok: true, teamApiName: match.naam, competitions: [] });
    }

    // Sort: newest/most-active competition first
    regularMembers.sort((a, b) => {
      const diff = compPriority(b.poule) - compPriority(a.poule);
      if (diff !== 0) return diff;
      return (a.gespeeld || 0) - (b.gespeeld || 0);
    });

    // Step 3: fetch standings for each competition in parallel (cached per poulePath)
    const competitions = await Promise.all(regularMembers.map(async (member, idx) => {
      const poulePath = member.poule;

      const rawOmschrijving = member.omschrijving || '';
      const compName = rawOmschrijving
        ? rawOmschrijving.replace(/^\d+e\s+in\s+/i, '').trim()
        : compSlugToName(poulePath.split('/')[4] || '');

      const positieTekst = member.positie
        ? `${member.positie}e — ${member.gespeeld} gespeeld, ${member.punten} pnt`
        : '';

      const cached = standCache.get(poulePath);
      let standRows = [], resolvedCompName = compName;
      try {
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          standRows = cached.rows;
          resolvedCompName = cached.compTitle || compName;
        } else {
          const standRssUrl = `${NEVOBO_API}/export/poule/${poulePath.replace('/competitie/poules/', '')}/stand.rss`;
          const { data: standData } = await withFeedCache(
            `stand:${poulePath}`,
            () => fetchStandRows(standRssUrl),
            () => CACHE_TTL_MS,
          );
          standRows = standData?.rows || [];
          resolvedCompName = standData?.compTitle || compName;
          standCache.set(poulePath, { rows: standRows, compTitle: resolvedCompName, fetchedAt: Date.now() });
        }
      } catch (e) {
        console.error(`[poule-stand] fetchStandRows failed for ${poulePath}:`, e.message);
      }

      return {
        compName: resolvedCompName,
        positieTekst,
        gespeeld:  member.gespeeld  || 0,
        positie:   member.positie   || null,
        punten:    member.punten    || 0,
        isActive:  idx === 0,
        standRows,
      };
    }));

    const active = competitions[0];
    res.json({
      ok: true,
      teamApiName:       match.naam,
      standpositietekst: match.standpositietekst || '',
      omschrijving:      (match.standpositietekst || '').replace(/^\d+e\s+in\s+/i, '').trim(),
      standRows:         active?.standRows || [],
      competitions,
    });
  } catch (err) {
    console.error('[poule-stand] unexpected error:', err.message, err.stack);
    res.status(502).json({ ok: false, error: 'Nevobo API fout', detail: err.message });
  }
});

// GET /api/nevobo/club/:code/schedule
router.get('/club/:code/schedule', async (req, res) => {
  const code = req.params.code;
  try {
    const { data, stale } = await withFeedCache(
      `schedule:club:${code}`,
      async () => {
        const feed = await parser.parseURL(`${NEVOBO_BASE}/vereniging/${code}/programma.rss`);
        return { matches: (feed.items || []).map(parseMatchItem), club_name: feed.title };
      },
      d => scheduleSmartTtl(d.matches),
    );
    // Filter out matches that have already been played or are more than 2 hours in the past
    const now = Date.now();
    const filtered = enrichWithClubCodes(data.matches).filter(m => {
      if (m.status === 'gespeeld') return false;
      if (m.datetime) {
        const matchTime = new Date(m.datetime).getTime();
        // Keep if match is in the future or started less than 2 hours ago
        if (matchTime < now - 2 * 3600_000) return false;
      }
      return true;
    });
    res.json({ ok: true, ...data, matches: filtered, stale });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar of ongeldige code', detail: err.message });
  }
});

// GET /api/nevobo/club/:code/results
router.get('/club/:code/results', async (req, res) => {
  const code = req.params.code;
  try {
    const { data, stale } = await withFeedCache(
      `results:club:${code}`,
      async () => {
        const feed = await parser.parseURL(`${NEVOBO_BASE}/vereniging/${code}/resultaten.rss`);
        return { matches: (feed.items || []).map(parseMatchItem) };
      },
      d => resultsSmartTtl(d.matches),
    );
    res.json({ ok: true, ...data, matches: enrichWithClubCodes(data.matches), stale });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar', detail: err.message });
  }
});

// GET /api/nevobo/team/:code/:type/:number/schedule
router.get('/team/:code/:type/:number/schedule', async (req, res) => {
  const { code, type, number } = req.params;
  try {
    const { data, stale } = await withFeedCache(
      `schedule:team:${code}:${type}:${number}`,
      async () => {
        const feed = await parser.parseURL(`${NEVOBO_BASE}/team/${code}/${type}/${number}/programma.rss`);
        return { matches: (feed.items || []).map(parseMatchItem) };
      },
      d => scheduleSmartTtl(d.matches),
    );
    const now = Date.now();
    const filtered = enrichWithClubCodes(data.matches).filter(m => {
      if (m.status === 'gespeeld') return false;
      if (m.datetime && new Date(m.datetime).getTime() < now - 2 * 3600_000) return false;
      return true;
    });
    res.json({ ok: true, ...data, matches: filtered, stale });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar', detail: err.message });
  }
});

// GET /api/nevobo/team/:code/:type/:number/results
router.get('/team/:code/:type/:number/results', async (req, res) => {
  const { code, type, number } = req.params;
  try {
    const { data, stale } = await withFeedCache(
      `results:team:${code}:${type}:${number}`,
      async () => {
        const feed = await parser.parseURL(`${NEVOBO_BASE}/team/${code}/${type}/${number}/resultaten.rss`);
        return { matches: (feed.items || []).map(parseMatchItem) };
      },
      d => resultsSmartTtl(d.matches),
    );
    res.json({ ok: true, ...data, matches: enrichWithClubCodes(data.matches), stale });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar', detail: err.message });
  }
});

// GET /api/nevobo/team/:code/:type/:number/calendar  (ICS)
router.get('/team/:code/:type/:number/calendar', async (req, res) => {
  try {
    const { code, type, number } = req.params;
    const url = `${NEVOBO_BASE}/team/${code}/${type}/${number}/programma.ics`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const icsText = await resp.text();
    const parsed = ical.parseICS(icsText);
    const events = Object.values(parsed)
      .filter(e => e.type === 'VEVENT')
      .map(e => ({
        uid: e.uid,
        summary: e.summary,
        start: e.start,
        end: e.end,
        location: e.location || null,
        description: e.description || null,
      }));
    res.json({ ok: true, events });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'ICS feed niet beschikbaar', detail: err.message });
  }
});

// GET /api/nevobo/poule/:regio/:poule/standings
router.get('/poule/:regio/:poule/standings', async (req, res) => {
  try {
    const { regio, poule } = req.params;
    const url = `${NEVOBO_BASE}/poule/${regio}/${poule}/stand.rss`;
    const feed = await parser.parseURL(url);
    res.json({ ok: true, standings: feed.items || [] });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo API onbereikbaar', detail: err.message });
  }
});

// GET /api/nevobo/geocode?address=...
router.get('/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ ok: false, error: 'address parameter required' });
  const location = await geocodeAddress(address);
  if (!location) return res.status(404).json({ ok: false, error: 'Locatie niet gevonden' });
  res.json({ ok: true, location });
});

// GET /api/nevobo/travel-time?from=...&to=...
router.get('/travel-time', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ ok: false, error: 'from en to zijn verplicht' });
  console.log('[travel-time] from:', from, '→ to:', to);
  const minutes = await travelTimeMinutes(from, to);
  console.log('[travel-time] result:', minutes, 'min');
  if (minutes === null) return res.status(404).json({ ok: false, error: 'Reistijd kon niet worden berekend' });
  res.json({ ok: true, minutes });
});

// GET /api/nevobo/search?q=amsterdam  — search clubs via volleybal.nl
// Note: volleybal.nl search only returns news articles, not club pages.
// We return a helpful guide instead and let users validate their code directly.
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.status(400).json({ ok: false, error: 'Minimaal 2 tekens invoeren' });

  // Try to find news/results mentioning this club name that might contain the code
  try {
    const resp = await fetch('https://www.volleybal.nl/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ q, type: 'content' }),
    });
    const data = await resp.json();
    const results = (data.data || []).slice(0, 6).map(item => ({
      title: item.title,
      url: item.url,
      date: item.date,
      type: item.type,
    }));
    res.json({ ok: true, results, guide: 'Ga naar volleybal.nl → zoek je club → klik op Programma → klik "Exporteren" → kopieer de code uit de RSS Feed URL (bijv. ckl9x7n)' });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Zoekfout', detail: err.message });
  }
});

// GET /api/nevobo/opponent-clubs?code=ckl9x7n
// Returns clubs and a teamName→clubCode lookup for all clubs in the same poules.
// Response: { ok, clubs: [{clubCode,clubName,logoUrl}], teamCodes: {teamNameLower: clubCode} }
router.get('/opponent-clubs', async (req, res) => {
  const code = (req.query.code || '').toLowerCase().trim();
  if (!code) return res.status(400).json({ ok: false, error: 'code parameter verplicht' });

  try {
    const { clubs: clubMap, teamCodes } = await fetchOpponentClubs(code);
    const clubs = [...clubMap.values()].filter(c => c.clubName);
    res.json({ ok: true, clubs, teamCodes: Object.fromEntries(teamCodes) });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Kon clubs niet ophalen', detail: err.message });
  }
});

// POST /api/nevobo/validate — validate a nevobo code
router.post('/validate', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: 'Code is verplicht' });
  const valid = await validateCode(code.trim().toLowerCase());
  if (!valid) return res.status(404).json({ ok: false, error: 'Ongeldige Nevobo-code of club niet gevonden' });

  // Fetch the feed to get the first match and confirm club name
  try {
    const feed = await parser.parseURL(`${NEVOBO_BASE}/vereniging/${code.trim().toLowerCase()}/programma.rss`);
    // Extract club name from the first match title (it appears in most team names)
    res.json({ ok: true, code: code.trim().toLowerCase() });
  } catch (_) {
    res.json({ ok: true, code: code.trim().toLowerCase() });
  }
});

// GET /api/nevobo/cache-stats — summary of all feed cache entries (admin/debug)
router.get('/cache-stats', async (req, res) => {
  const db = require('../db/db');
  const now = Date.now();
  let rows = [];
  try { rows = db.prepare('SELECT cache_key, fetched_at, ttl_ms FROM feed_cache ORDER BY fetched_at DESC').all(); } catch (_) {}
  const entries = rows.map(r => {
    const ageMs  = now - r.fetched_at;
    const expiresIn = r.ttl_ms - ageMs;
    return {
      key:       r.cache_key,
      age:       `${Math.round(ageMs  / 60_000)} min`,
      expiresIn: expiresIn > 0 ? `${Math.round(expiresIn / 60_000)} min` : 'EXPIRED',
      ttl:       `${Math.round(r.ttl_ms / 60_000)} min`,
      hot:       feedMemCache.has(r.cache_key),
    };
  });
  res.json({ ok: true, entries, memEntries: feedMemCache.size, dbEntries: rows.length });
});

// DELETE /api/nevobo/cache — flush all feed cache entries (admin/debug)
router.delete('/cache', async (req, res) => {
  const db = require('../db/db');
  feedMemCache.clear();
  standCache.clear();
  try { db.prepare('DELETE FROM feed_cache').run(); } catch (_) {}
  res.json({ ok: true, message: 'Feed cache geleegd' });
});

// GET /api/nevobo/debug-teams?nevoboCode=ckl9x7n — show raw team list from cache/API
router.get('/debug-teams', async (req, res) => {
  const { nevoboCode } = req.query;
  if (!nevoboCode) return res.status(400).json({ ok: false, error: 'nevoboCode verplicht' });
  try {
    const teams = await fetchClubCompetitionTeams(nevoboCode);
    res.json({ ok: true, count: teams.length, teams: teams.map(t => ({ naam: t.naam, id: t['@id'] })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.parseMatchItem = parseMatchItem;
