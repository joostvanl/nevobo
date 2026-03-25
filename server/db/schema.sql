-- Volleyball Team App — SQLite Schema

PRAGMA foreign_keys = ON;

-- ─── Clubs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clubs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  nevobo_code  TEXT NOT NULL UNIQUE,
  region       TEXT NOT NULL DEFAULT '',
  logo_url     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Teams (per club, linked to Nevobo team type/number) ─────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id             INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nevobo_team_type    TEXT NOT NULL,   -- e.g. 'dames-senioren', 'jongens-a'
  nevobo_number       INTEGER NOT NULL DEFAULT 1,
  display_name        TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id       INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  role          TEXT NOT NULL DEFAULT 'player',  -- 'player' | 'coach' | 'admin'
  is_npc        INTEGER NOT NULL DEFAULT 0,      -- 1 = placeholder (no real login)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Follow system ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_follows (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_type  TEXT NOT NULL,   -- 'user' | 'team' | 'club'
  followee_id    INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(follower_id, followee_type, followee_id)
);

-- ─── Posts / Social feed ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  match_id    TEXT,   -- Nevobo match identifier (string from RSS)
  type        TEXT NOT NULL DEFAULT 'post',  -- 'post' | 'match_result' | 'badge' | 'media'
  body        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Media (photos / videos attached to posts or matches) ────────────────────
CREATE TABLE IF NOT EXISTS match_media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id    TEXT,
  file_path   TEXT NOT NULL,
  file_type   TEXT NOT NULL DEFAULT 'image',  -- 'image' | 'video'
  caption     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  match_home_team TEXT,  -- stored at upload for opponent label in reel (no feed_cache dependency)
  match_away_team TEXT
);

-- ─── Carpool ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carpool_offers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id         TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seats_available  INTEGER NOT NULL DEFAULT 1,
  departure_point  TEXT,
  departure_time   TEXT,
  note             TEXT,
  team_id          INTEGER REFERENCES teams(id),
  coach_planned    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(match_id, user_id)
);

CREATE TABLE IF NOT EXISTS carpool_bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id   INTEGER NOT NULL REFERENCES carpool_offers(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(offer_id, user_id)
);

-- ─── Badges ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_emoji  TEXT NOT NULL DEFAULT '🏆',
  xp_reward   INTEGER NOT NULL DEFAULT 50,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_badges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, badge_id)
);

-- ─── Goals / Challenges ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,
  icon_emoji    TEXT NOT NULL DEFAULT '🎯',
  target_value  INTEGER NOT NULL DEFAULT 1,
  xp_reward     INTEGER NOT NULL DEFAULT 25,
  badge_id      INTEGER REFERENCES badges(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id      INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  progress     INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  UNIQUE(user_id, goal_id)
);

-- ─── XP level thresholds ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS xp_levels (
  level         INTEGER PRIMARY KEY,
  xp_required   INTEGER NOT NULL,
  label         TEXT NOT NULL
);

-- ─── Seed: default badges ────────────────────────────────────────────────────
INSERT OR IGNORE INTO badges (slug, label, description, icon_emoji, xp_reward, sort_order) VALUES
  ('first_match',       'Eerste Wedstrijd',      'Aanwezig bij je eerste wedstrijd',         '🏐', 50,  1),
  ('five_matches',      '5 Wedstrijden',          '5 wedstrijden bijgewoond',                 '⭐', 75,  2),
  ('ten_matches',       '10 Wedstrijden',         '10 wedstrijden bijgewoond',                '🌟', 100, 3),
  ('first_win',         'Eerste Winst!',          'Gewonnen van je eerste wedstrijd',         '🎉', 100, 4),
  ('photo_uploader',    'Fotograaf',              'Je eerste foto geüpload',                  '📸', 50,  5),
  ('five_photos',       'Fotoalbum',              '5 foto''s geüpload',                       '🖼️', 75,  6),
  ('social_butterfly',  'Sociale Vlinder',        '5 mensen gevolgd',                         '🦋', 50,  7),
  ('carpool_hero',      'Carpool Held',           'Je eerste carpool aangeboden',             '🚗', 50,  8),
  ('team_player',       'Teamspeler',             'Lid van een team',                         '🤝', 25,  9),
  ('fan',               'Fan',                    'Een team gevolgd buiten je eigen club',    '📣', 50, 10);

-- ─── Seed: goals ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO goals (slug, label, description, icon_emoji, target_value, xp_reward, sort_order) VALUES
  ('attend_1_match',   'Eerste aanwezigheid',  'Wees aanwezig bij 1 wedstrijd',   '🏐', 1,   25, 1),
  ('attend_5_matches', '5 wedstrijden',        'Wees aanwezig bij 5 wedstrijden', '⭐', 5,   50, 2),
  ('upload_1_photo',   'Eerste foto',          'Upload je eerste foto',           '📸', 1,   25, 3),
  ('follow_3_teams',   'Volg 3 teams',         'Volg 3 teams of clubs',           '📣', 3,   50, 4),
  ('carpool_1',        'Eerste carpool',       'Bied een lift aan',               '🚗', 1,   25, 5);

-- ─── Seed: XP levels ─────────────────────────────────────────────────────────
INSERT OR IGNORE INTO xp_levels (level, xp_required, label) VALUES
  (1,    0,     'Nieuwkomer'),
  (2,    100,   'Aspirant'),
  (3,    250,   'Speler'),
  (4,    500,   'Talent'),
  (5,    1000,  'Specialist'),
  (6,    2000,  'Expert'),
  (7,    3500,  'Veteraan'),
  (8,    5000,  'Meester'),
  (9,    7500,  'Legende'),
  (10,   10000, 'Volleybal God');
