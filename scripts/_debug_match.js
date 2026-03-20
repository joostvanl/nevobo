const db = new (require('better-sqlite3'))('/app/data/volleyball.db');

// Find match 1902631 in feed cache
const rows = db.prepare('SELECT cache_key, data_json FROM feed_cache').all();
for (const row of rows) {
  try {
    const d = JSON.parse(row.data_json);
    const m = (d.matches || []).find(x => x.match_id === '1902631');
    if (m) {
      console.log('Found in cache key:', row.cache_key);
      console.log(JSON.stringify(m, null, 2));
    }
  } catch(e) {}
}

// Also show what match 1902631 title says in the posts
const post = db.prepare('SELECT id, match_id, team_id, match_home_team, match_away_team FROM posts WHERE match_id = ?').all('1902631');
console.log('Posts for 1902631:', JSON.stringify(post));
