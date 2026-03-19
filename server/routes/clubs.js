const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');

const parser = new RSSParser({
  customFields: { item: [['description', 'description']] },
});

const NEVOBO_BASE = 'https://api.nevobo.nl/export';

// ─── Extract the club's own team names from its Nevobo RSS ────────────────────
// The Nevobo RSS for a club code only contains matches involving that club.
// Each match has both a home and away team. The club's OWN teams appear in every
// match, while opponent teams each appear only once or twice.
// Strategy: count appearances → teams appearing >= 2 times are the club's own teams.
async function syncTeamsFromNevobo(clubId, nevoboCode) {
  const frequency = new Map(); // teamName -> count

  try {
    const [schedFeed, resFeed] = await Promise.allSettled([
      parser.parseURL(`${NEVOBO_BASE}/vereniging/${nevoboCode}/programma.rss`),
      parser.parseURL(`${NEVOBO_BASE}/vereniging/${nevoboCode}/resultaten.rss`),
    ]);

    for (const result of [schedFeed, resFeed]) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items || []) {
        const title = item.title || '';
        const withDatePrefix = title.match(/^\d+\s+\w+\s+\d+:\d+:\s*(.+)$/);
        const teamsStr = withDatePrefix
          ? withDatePrefix[1]
          : title.replace(/,\s*(Uitslag|uitslag):.+$/i, '').trim();
        const splitMatch = teamsStr.match(/^(.+?)\s+-\s+(.+)$/);
        if (splitMatch) {
          const home = splitMatch[1].trim();
          const away = splitMatch[2].trim();
          frequency.set(home, (frequency.get(home) || 0) + 1);
          frequency.set(away, (frequency.get(away) || 0) + 1);
        }
      }
    }
  } catch (_) {}

  // Only keep teams that appear in 8+ matches — these are the club's own teams.
  // The club's teams appear in every match (15-25 times), while opponents appear ≤6 times.
  // This gap cleanly separates own teams from all opponents.
  const MIN_APPEARANCES = 8;
  const ownTeams = Array.from(frequency.entries())
    .filter(([, count]) => count >= MIN_APPEARANCES)
    .map(([name]) => name)
    .sort();

  const existing = db.prepare('SELECT display_name FROM teams WHERE club_id = ?').all(clubId);
  const existingNames = new Set(existing.map(t => t.display_name));

  let added = 0;
  for (const name of ownTeams) {
    if (!existingNames.has(name)) {
      try {
        db.prepare('INSERT INTO teams (club_id, nevobo_team_type, nevobo_number, display_name) VALUES (?, ?, ?, ?)')
          .run(clubId, '', 0, name);
        added++;
      } catch (_) {}
    }
  }

  return { synced: ownTeams.length, added, ownTeams };
}

// ─── Detect & save the club's home address from its home match venues ─────────
// Looks at all home matches in the RSS feed, finds the venue_address that appears
// most often, and saves it to clubs.home_address (only if not already set).
async function detectAndSaveHomeAddress(clubId, nevoboCode, ownTeamNames) {
  try {
    const { parseMatchItem } = require('./nevobo'); // reuse existing parser
    const feeds = await Promise.allSettled([
      (new RSSParser({ customFields: { item: [['description', 'description']] } }))
        .parseURL(`${NEVOBO_BASE}/vereniging/${nevoboCode}/programma.rss`),
      (new RSSParser({ customFields: { item: [['description', 'description']] } }))
        .parseURL(`${NEVOBO_BASE}/vereniging/${nevoboCode}/resultaten.rss`),
    ]);

    const ownNamesLower = new Set((ownTeamNames || []).map(n => n.toLowerCase()));
    const addressFreq = new Map();

    for (const result of feeds) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items || []) {
        const m = parseMatchItem(item);
        if (!m || !m.venue_address) continue;
        // Only count if one of this club's own teams is the HOME team
        const homeTeam = (m.home_team || '').toLowerCase();
        const isHomeMatch = [...ownNamesLower].some(n => homeTeam === n || homeTeam.endsWith(n) || homeTeam.includes(n));
        if (!isHomeMatch) continue;
        const addr = m.venue_address.trim();
        if (addr) addressFreq.set(addr, (addressFreq.get(addr) || 0) + 1);
      }
    }

    if (addressFreq.size === 0) return;
    // Pick most-frequent address
    const homeAddress = [...addressFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    db.prepare('UPDATE clubs SET home_address = ? WHERE id = ?').run(homeAddress, clubId);
  } catch (_) {}
}

// GET /api/clubs — list all clubs
router.get('/', (req, res) => {
  const clubs = db.prepare('SELECT * FROM clubs ORDER BY name ASC').all();
  res.json({ ok: true, clubs });
});

// POST /api/clubs — register a club + auto-sync teams (platform / opperbeheerder)
router.post('/', verifyToken, requireSuperAdmin, async (req, res) => {
  const { name, nevobo_code, region } = req.body;
  if (!name || !nevobo_code) {
    return res.status(400).json({ ok: false, error: 'Naam en Nevobo-code zijn verplicht' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO clubs (name, nevobo_code, region) VALUES (?, ?, ?)'
    ).run(name, nevobo_code.trim().toLowerCase(), region || '');
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(result.lastInsertRowid);

    // Sync teams in background (don't block response)
    syncTeamsFromNevobo(club.id, club.nevobo_code).then(({ ownTeams }) => {
      detectAndSaveHomeAddress(club.id, club.nevobo_code, ownTeams);
    }).catch(() => {});

    res.status(201).json({ ok: true, club });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Nevobo-code al in gebruik' });
    }
    throw err;
  }
});

// GET /api/clubs/:id — single club with teams
router.get('/:id', async (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).json({ ok: false, error: 'Club niet gevonden' });
  const teams = db.prepare('SELECT * FROM teams WHERE club_id = ? ORDER BY display_name ASC').all(club.id);

  // If home_address is not yet set, try to detect it in the background
  if (!club.home_address) {
    const ownTeamNames = teams.map(t => t.display_name);
    detectAndSaveHomeAddress(club.id, club.nevobo_code, ownTeamNames).catch(() => {});
  }

  res.json({ ok: true, club, teams });
});

// GET /api/clubs/:id/teams?userId=  — teams with follow state for a user
router.get('/:id/teams', (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).json({ ok: false, error: 'Club niet gevonden' });

  const userId = req.query.userId ? parseInt(req.query.userId) : null;
  const teams = db.prepare('SELECT * FROM teams WHERE club_id = ? ORDER BY display_name ASC').all(club.id);

  if (userId) {
    const followedTeamIds = new Set(
      db.prepare("SELECT followee_id FROM user_follows WHERE follower_id = ? AND followee_type = 'team'")
        .all(userId).map(f => f.followee_id)
    );
    const memberTeamIds = new Set(
      db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?')
        .all(userId).map(r => r.team_id)
    );
    return res.json({
      ok: true,
      teams: teams.map(t => ({
        ...t,
        is_following: followedTeamIds.has(t.id),
        is_own_team: memberTeamIds.has(t.id),
      })),
    });
  }

  res.json({ ok: true, teams });
});

// GET /api/clubs/:id/teams/:teamId — single team detail with members and stats
router.get('/:id/teams/:teamId', async (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).json({ ok: false, error: 'Club niet gevonden' });

  const team = db.prepare('SELECT * FROM teams WHERE id = ? AND club_id = ?').get(req.params.teamId, club.id);
  if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });

  const members = db.prepare(`
    SELECT DISTINCT u.id, u.name, u.avatar_url, u.level, u.xp,
      COALESCE(tm.membership_type, u.role) AS membership_type
    FROM users u
    LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = ?
    WHERE u.team_id = ? OR tm.team_id = ?
    ORDER BY
      CASE COALESCE(tm.membership_type, u.role)
        WHEN 'player' THEN 1
        WHEN 'coach'  THEN 2
        WHEN 'staff'  THEN 3
        WHEN 'parent' THEN 4
        ELSE 5
      END,
      u.xp DESC
  `).all(team.id, team.id, team.id);

  const followerCount = db.prepare(
    "SELECT COUNT(*) AS n FROM user_follows WHERE followee_type = 'team' AND followee_id = ?"
  ).get(team.id)?.n || 0;

  const userId = req.query.userId ? parseInt(req.query.userId) : null;
  let isFollowing = false;
  let isOwnTeam = false;
  if (userId) {
    isFollowing = !!db.prepare(
      "SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_type = 'team' AND followee_id = ?"
    ).get(userId, team.id);
    isOwnTeam = !!db.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ?').get(userId, team.id);
  }

  // Ensure home_address is populated (detect if missing)
  if (!club.home_address) {
    await detectAndSaveHomeAddress(club.id, club.nevobo_code, [team.display_name]);
    // Re-fetch club to get the newly saved address
    const updatedClub = db.prepare('SELECT * FROM clubs WHERE id = ?').get(club.id);
    Object.assign(club, updatedClub);
  }

  res.json({ ok: true, team, club, members, followerCount, isFollowing, isOwnTeam });
});

// POST /api/clubs/:id/teams — manually add a team
router.post('/:id/teams', verifyToken, (req, res) => {
  const { nevobo_team_type, nevobo_number, display_name } = req.body;
  if (!display_name) {
    return res.status(400).json({ ok: false, error: 'Teamnaam is verplicht' });
  }
  const result = db.prepare(
    'INSERT INTO teams (club_id, nevobo_team_type, nevobo_number, display_name) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, nevobo_team_type || '', nevobo_number || 0, display_name);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, team });
});

// POST /api/clubs/:id/sync-teams — re-sync teams from Nevobo RSS
router.post('/:id/sync-teams', verifyToken, async (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).json({ ok: false, error: 'Club niet gevonden' });
  try {
    const result = await syncTeamsFromNevobo(club.id, club.nevobo_code);
    // Also refresh home address
    detectAndSaveHomeAddress(club.id, club.nevobo_code, result.ownTeams).catch(() => {});
    const teams = db.prepare('SELECT * FROM teams WHERE club_id = ? ORDER BY display_name ASC').all(club.id);
    res.json({ ok: true, ...result, teams });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// GET /api/clubs/:id/members
router.get('/:id/members', (req, res) => {
  const members = db.prepare(
    'SELECT id, name, avatar_url, level, xp, team_id FROM users WHERE club_id = ? ORDER BY xp DESC'
  ).all(req.params.id);
  res.json({ ok: true, members });
});

module.exports = router;
module.exports.syncTeamsFromNevobo = syncTeamsFromNevobo;
