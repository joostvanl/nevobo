#!/usr/bin/env node
/**
 * Diagnose why MB3 media (e.g. Friday 13 March) might not appear in the reel.
 * Run from project root: node scripts/_debug_mb3_media.js
 *
 * Checks:
 * 1. match_media around 13 March + their post team_id and match_id
 * 2. Teams with MB3 in name and their id
 * 3. feed_cache matches containing MB3 around that date
 * 4. Whether team-media query would return those rows
 */

const path = require('path');
const dbPath = path.join(__dirname, '../data/volleyball.db');
const db = require('better-sqlite3')(dbPath);

console.log('=== Teams with MB3 in display_name ===');
const mb3Teams = db.prepare(`
  SELECT t.id, t.display_name, c.nevobo_code, c.name AS club_name
  FROM teams t JOIN clubs c ON c.id = t.club_id
  WHERE LOWER(t.display_name) LIKE '%mb%3%' OR LOWER(t.display_name) LIKE '%mb3%'
`).all();
console.log(mb3Teams);

console.log('\n=== match_media created 12–15 March (any year) ===');
const mediaMarch = db.prepare(`
  SELECT mm.id, mm.match_id, mm.post_id, mm.created_at, mm.file_type,
         p.team_id AS post_team_id, t.display_name AS post_team_name
  FROM match_media mm
  LEFT JOIN posts p ON p.id = mm.post_id
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE mm.created_at LIKE '%-03-12%' OR mm.created_at LIKE '%-03-13%'
     OR mm.created_at LIKE '%-03-14%' OR mm.created_at LIKE '%-03-15%'
  ORDER BY mm.created_at
`).all();
console.log(mediaMarch);
if (mediaMarch.length === 0) {
  console.log('(No match_media in that date range; trying last 60 days)');
  const recent = db.prepare(`
    SELECT mm.id, mm.match_id, mm.post_id, mm.created_at, mm.file_type,
           p.team_id AS post_team_id, t.display_name AS post_team_name
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    LEFT JOIN teams t ON t.id = p.team_id
    ORDER BY mm.created_at DESC LIMIT 30
  `).all();
  console.log(recent);
}

const mb3Id = mb3Teams[0]?.id;
if (mb3Id) {
  console.log('\n=== Team-media count for MB3 (team_id=' + mb3Id + ') ===');
  const teamRow = db.prepare(`
    SELECT t.display_name, c.nevobo_code FROM teams t JOIN clubs c ON c.id = t.club_id WHERE t.id = ?
  `).get(mb3Id);
  const cacheMatchIds = new Set();
  const cacheKeys = db.prepare(
    "SELECT cache_key, data_json FROM feed_cache WHERE cache_key LIKE ? OR cache_key LIKE ?"
  ).all(`schedule:club:${teamRow.nevobo_code}`, `results:club:${teamRow.nevobo_code}`);
  for (const row of cacheKeys) {
    try {
      const data = JSON.parse(row.data_json);
      for (const m of (data.matches || [])) {
        if (m.match_id && ((m.home_team || '').toLowerCase().includes('mb3') || (m.away_team || '').toLowerCase().includes('mb3')))
          cacheMatchIds.add(m.match_id);
      }
    } catch (_) {}
  }
  console.log('feed_cache match_ids where MB3 plays:', [...cacheMatchIds].slice(0, 20));

  const direct = db.prepare(`
    SELECT COUNT(*) AS n FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE p.team_id = ?
  `).get(mb3Id);
  console.log('Media with post.team_id = MB3:', direct.n);

  if (cacheMatchIds.size > 0) {
    const ph = [...cacheMatchIds].map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT mm.match_id, COUNT(*) AS n, p.team_id, t.display_name AS post_team_name
      FROM match_media mm
      LEFT JOIN posts p ON p.id = mm.post_id
      LEFT JOIN teams t ON t.id = p.team_id
      WHERE mm.match_id IN (${ph})
      GROUP BY mm.match_id, p.team_id
    `).all(...cacheMatchIds);
    console.log('match_media per match_id (in cache) and post team:', rows);
  }
}

console.log('\n=== Done ===');
