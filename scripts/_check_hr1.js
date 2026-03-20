const db = new (require('better-sqlite3'))('/app/data/volleyball.db');

// Get all distinct match_ids linked to HR1 posts
const hr1Posts = db.prepare("SELECT DISTINCT match_id FROM posts WHERE team_id = 1196 AND match_id IS NOT NULL").all();
console.log('HR1 match_ids:', hr1Posts.map(p => p.match_id));

// Check each match in feed_cache
const cacheRows = db.prepare("SELECT data_json FROM feed_cache").all();
const matchMap = {};
for (const row of cacheRows) {
  try {
    const d = JSON.parse(row.data_json);
    for (const m of (d.matches || [])) {
      if (m.match_id) matchMap[m.match_id] = { home: m.home_team, away: m.away_team };
    }
  } catch(e) {}
}

// Show which matches are NOT HR1 matches
for (const p of hr1Posts) {
  const m = matchMap[p.match_id];
  if (m) {
    const isHR1 = (m.home || '').toLowerCase().includes('hr') || (m.away || '').toLowerCase().includes('hr');
    console.log(p.match_id, '-', m.home, 'vs', m.away, isHR1 ? '✓ HR1' : '✗ WRONG TEAM');
  } else {
    console.log(p.match_id, '- not in cache');
  }
}
