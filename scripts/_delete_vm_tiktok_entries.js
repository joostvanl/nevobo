const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/volleyball.db');
const db = new Database(dbPath);

const deleted = db.prepare(`
  DELETE FROM team_social_links
  WHERE platform = 'tiktok' AND (url LIKE '%vm.tiktok%' OR embed_id LIKE 'vm:%')
`).run();

console.log('Verwijderd:', deleted.changes, 'vm TikTok entries');
db.close();
