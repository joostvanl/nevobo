const db = new (require('better-sqlite3'))('/app/data/volleyball.db');

// match 1923427 = MB3 vs Utrecht MB5 → team_id should be MB3 (1211)
// match 1900634 = MA2 vs Thor → team_id should be MA2 (1207)

const fixes = [
  { match_id: '1923427', correct_team_id: 1211, team_name: 'MB3' },
  { match_id: '1900634', correct_team_id: 1207, team_name: 'MA2' },
];

for (const fix of fixes) {
  const wrong = db.prepare('SELECT id, team_id FROM posts WHERE match_id = ? AND team_id = 1196').all(fix.match_id);
  console.log(`Match ${fix.match_id} → ${fix.team_name}: ${wrong.length} wrong posts`);
  if (wrong.length > 0) {
    const result = db.prepare('UPDATE posts SET team_id = ? WHERE match_id = ? AND team_id = 1196').run(fix.correct_team_id, fix.match_id);
    console.log(`  Fixed ${result.changes} posts to team_id ${fix.correct_team_id}`);
  }
}

// Verify: HR1 should now have 0 posts
const remaining = db.prepare('SELECT id, match_id FROM posts WHERE team_id = 1196').all();
console.log('Remaining HR1 posts:', remaining.length, JSON.stringify(remaining));
