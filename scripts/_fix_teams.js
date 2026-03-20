const db = new (require('better-sqlite3'))('/app/data/volleyball.db');

// Find the MB2 team ID
const mb2 = db.prepare("SELECT id, display_name FROM teams WHERE display_name LIKE '%MB%2%'").all();
console.log('MB2 teams:', JSON.stringify(mb2));

// Find posts for match 1902631 that are incorrectly set to HR1 (team_id=1196)
const wrong = db.prepare("SELECT id, team_id, match_id FROM posts WHERE match_id = '1902631' AND team_id = 1196").all();
console.log('Wrong posts:', JSON.stringify(wrong));

// Fix: set team_id to MB2 (1210) for these posts
if (wrong.length > 0) {
  const stmt = db.prepare("UPDATE posts SET team_id = 1210 WHERE match_id = '1902631' AND team_id = 1196");
  const result = stmt.run();
  console.log('Fixed', result.changes, 'posts');
}

// Also fix match 1900634 — check what that match is
const rows2 = db.prepare("SELECT cache_key, data_json FROM feed_cache").all();
for (const row of rows2) {
  try {
    const d = JSON.parse(row.data_json);
    const m = (d.matches || []).find(x => x.match_id === '1900634');
    if (m) console.log('Match 1900634:', m.home_team, 'vs', m.away_team);
  } catch(e) {}
}

const wrong2 = db.prepare("SELECT id, team_id, match_id FROM posts WHERE match_id = '1900634' AND team_id = 1196").all();
console.log('Posts for 1900634 with HR1:', JSON.stringify(wrong2));
