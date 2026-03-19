const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/volleyball.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema migration on startup
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Incremental migrations: add columns that may not exist in older DBs
const migrations = [
  `ALTER TABLE goals ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE clubs ADD COLUMN home_address TEXT`,
  `CREATE TABLE IF NOT EXISTS media_views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    viewed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS media_likes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(media_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS media_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    club_id    INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique
   ON user_roles(user_id, role, IFNULL(club_id,0), IFNULL(team_id,0))`,
  `CREATE TABLE IF NOT EXISTS team_memberships (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_type TEXT NOT NULL DEFAULT 'player',
    added_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, user_id)
  )`,
  // Persistent cache: competition team data per Nevobo club code (survives server restarts)
  `CREATE TABLE IF NOT EXISTS competition_teams (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    club_nevobo_code  TEXT NOT NULL,
    team_path         TEXT NOT NULL,
    team_naam         TEXT,
    standpositietekst TEXT,
    fetched_at        INTEGER NOT NULL,
    UNIQUE(club_nevobo_code, team_path)
  )`,
  // Persistent cache: which opponent codes a club encounters in its competition poules
  `CREATE TABLE IF NOT EXISTS club_opponents (
    club_nevobo_code     TEXT NOT NULL,
    opponent_nevobo_code TEXT NOT NULL,
    fetched_at           INTEGER NOT NULL,
    PRIMARY KEY(club_nevobo_code, opponent_nevobo_code)
  )`,
  // Metadata for competition_teams cache — stores total_count to detect incomplete caches
  // (clubs with >50 teams require pagination; this ensures we always re-fetch if incomplete)
  `CREATE TABLE IF NOT EXISTS competition_teams_meta (
    club_nevobo_code  TEXT PRIMARY KEY,
    total_count       INTEGER NOT NULL DEFAULT 0,
    fetched_at        INTEGER NOT NULL
  )`,
  // Persistent feed cache: RSS feeds and LD+JSON (schedule, results, standings, indelingen)
  // TTL is stored alongside the data so smart per-entry expiry works after restart.
  `CREATE TABLE IF NOT EXISTS feed_cache (
    cache_key  TEXT PRIMARY KEY,
    data_json  TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    ttl_ms     INTEGER NOT NULL
  )`,
  // Player profile fields (PII — only accessible by admins and the user themselves)
  `ALTER TABLE users ADD COLUMN shirt_number  INTEGER`,
  `ALTER TABLE users ADD COLUMN position      TEXT`,
  `ALTER TABLE users ADD COLUMN birth_date    TEXT`,
  // Privacy: anonymous mode + face reference photo for auto-blur
  `ALTER TABLE users ADD COLUMN anonymous_mode     INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN face_reference_path TEXT`,
  // Store bounding boxes of blurred faces so re-blur can skip face detection + matching
  `ALTER TABLE match_media ADD COLUMN blur_regions TEXT`,
  // shirt_number and position belong to the team membership, not the user
  `ALTER TABLE team_memberships ADD COLUMN shirt_number INTEGER`,
  `ALTER TABLE team_memberships ADD COLUMN position TEXT`,
  // Social media embeds per team (TikTok / Instagram)
  `CREATE TABLE IF NOT EXISTS team_social_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL CHECK(platform IN ('tiktok','instagram')),
    url        TEXT NOT NULL,
    embed_id   TEXT NOT NULL,
    added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, embed_id)
  )`,
  `ALTER TABLE team_social_links ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];
for (const migration of migrations) {
  try { db.exec(migration); } catch (_) { /* column already exists */ }
}

// Allow match_media.user_id to be NULL so media survives user deletion.
// Only run if user_id is still NOT NULL (check pragma).
try {
  const col = db.prepare("PRAGMA table_info(match_media)").all().find(c => c.name === 'user_id');
  if (col && col.notnull === 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS match_media_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        match_id    TEXT,
        file_path   TEXT NOT NULL,
        file_type   TEXT NOT NULL DEFAULT 'image',
        caption     TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        blur_regions TEXT
      );
      INSERT INTO match_media_new SELECT id, post_id, user_id, match_id, file_path, file_type, caption, created_at, blur_regions FROM match_media;
      DROP TABLE match_media;
      ALTER TABLE match_media_new RENAME TO match_media;
    `);
  }
} catch (e) { console.error('[db] match_media nullable migration failed:', e.message); }

// Fix broken foreign key references to match_media_old caused by prior rename migration.
// media_views/likes/comments may still reference "match_media_old" instead of "match_media".
try {
  const needsFix = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_views'"
  ).get();
  if (needsFix && needsFix.sql && needsFix.sql.includes('match_media_old')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE media_views_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        viewed_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO media_views_new SELECT * FROM media_views;
      DROP TABLE media_views;
      ALTER TABLE media_views_new RENAME TO media_views;

      CREATE TABLE media_likes_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(media_id, user_id)
      );
      INSERT INTO media_likes_new SELECT * FROM media_likes;
      DROP TABLE media_likes;
      ALTER TABLE media_likes_new RENAME TO media_likes;

      CREATE TABLE media_comments_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id   INTEGER NOT NULL REFERENCES match_media(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO media_comments_new SELECT * FROM media_comments;
      DROP TABLE media_comments;
      ALTER TABLE media_comments_new RENAME TO media_comments;
    `);
    db.pragma('foreign_keys = ON');
    console.log('[db] Fixed media_views/likes/comments references to match_media');
  }
} catch (e) { console.error('[db] media refs fix failed:', e.message); }

// Multiple face references per anonymous user
db.exec(`
  CREATE TABLE IF NOT EXISTS face_references (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path   TEXT    NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);
// Migrate existing single reference photos into the new table
db.exec(`
  INSERT OR IGNORE INTO face_references (user_id, file_path)
  SELECT id, face_reference_path FROM users
  WHERE face_reference_path IS NOT NULL AND face_reference_path != ''
    AND NOT EXISTS (
      SELECT 1 FROM face_references fr WHERE fr.user_id = users.id AND fr.file_path = users.face_reference_path
    )
`);

module.exports = db;
