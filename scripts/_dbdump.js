// Runs INSIDE the volleyapp Docker container via: docker exec volleyapp node /tmp/dbdump.js
// Checkpoints WAL and creates a clean backup at /tmp/vapp-db-clean.db
const Database = require('better-sqlite3');
const db = new Database('/app/data/volleyball.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.backup('/tmp/vapp-db-clean.db')
  .then(() => { db.close(); process.stdout.write('OK\n'); })
  .catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
