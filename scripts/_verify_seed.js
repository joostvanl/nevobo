const db = require('../server/db/db');

const club = db.prepare("SELECT id FROM clubs WHERE nevobo_code = 'ckl9x7n'").get();
if (!club) { console.log('No club'); process.exit(1); }

const teamNames = [
  'JB 1','MB 1','DS 3','HS 4','MB 3','DS 6','HS 5','N5 1','MC 1','DS 4','HS 1',
  'MC 2','DS 5','HS 6','MA 1','JA 1','MC 3','DS 2','MB 2','HS 2','DS 1','HS 3',
  'N5 3','DS 7','MB 1','DS 8','DS 4','HS 2','HS 3','HS 6','JA 1','DS 7',
  'MC 1','MA 1','MC 3','DS 6','MB 3','MB 1','DS 2','DS 3','HS 4','MC 1',
  'MB 2','JA 1','MC 1','MA 1','MC 3','DS 6','MB 3','MB 1',
];
const unique = [...new Set(teamNames)];
const stmt = db.prepare('SELECT id, display_name FROM teams WHERE club_id = ? AND display_name = ?');
const missing = [];
for (const name of unique) {
  const row = stmt.get(club.id, name);
  if (!row) missing.push(name);
}
if (missing.length) {
  console.log('MISSING teams:', missing);

  const all = db.prepare('SELECT display_name FROM teams WHERE club_id = ? ORDER BY display_name').all(club.id);
  console.log('\nAll team names:');
  for (const t of all) console.log(' ', t.display_name);
} else {
  console.log('All team names resolve OK');
}
