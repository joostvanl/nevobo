const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/volleyball.db');
const db = new Database(dbPath);

const vmRows = db.prepare(`
  SELECT id, team_id, platform, url, embed_id, created_at
  FROM team_social_links
  WHERE platform = 'tiktok' AND (url LIKE '%vm.tiktok%' OR embed_id LIKE 'vm:%')
  ORDER BY id DESC
`).all();

const resolvedRows = db.prepare(`
  SELECT id, team_id, platform, url, embed_id, created_at
  FROM team_social_links
  WHERE platform = 'tiktok' AND url LIKE '%tiktok.com/@%' AND embed_id NOT LIKE 'vm:%' AND length(embed_id) > 0
  ORDER BY id DESC
  LIMIT 10
`).all();

console.log('--- TikTok vm (niet geresolvd) ---');
console.log(JSON.stringify(vmRows, null, 2));
console.log('\n--- TikTok geresolvd (volledige URL + numeriek embed_id) ---');
console.log(JSON.stringify(resolvedRows, null, 2));
db.close();
