const db = new (require('better-sqlite3'))('/app/data/volleyball.db');

// match 1923427 = MB3 wedstrijd → team_id 1211 (VTC Woerden MB 3)
// match 1900634 = MA2 wedstrijd → team_id 1207 (VTC Woerden MA 2)
// match 1902631 = MB2 wedstrijd → already fixed to 1210

const fixes = [
  { match_id: '1923427', correct_team_id: 1211, label: 'MB3' },
  { match_id: '1900634', correct_team_id: 1207, label: 'MA2' },
];

for (const fix of fixes) {
  const wrong = db.prepare('SELECT id FROM posts WHERE match_id = ? AND team_id = 1196').all(fix.match_id);
  console.log(`match ${fix.match_id} -> ${fix.label}: ${wrong.length} posts to fix`);
  if (wrong.length > 0) {
    const r = db.prepare('UPDATE posts SET team_id = ? WHERE match_id = ? AND team_id = 1196').run(fix.correct_team_id, fix.match_id);
    console.log(`  fixed ${r.changes} posts`);
  }
}

// Verify HR1 has zero posts left
const hr1 = db.prepare('SELECT id, match_id FROM posts WHERE team_id = 1196').all();
console.log('HR1 posts remaining:', hr1.length);
