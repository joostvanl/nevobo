/**
 * Scout API routes — JSON-based match storage (phase 1)
 * GET    /api/scout/sessions               — list all scout sessions for the user's teams
 * GET    /api/scout/status/:matchId        — check if session exists, lock status, completed
 * GET    /api/scout/match/:matchId         — load match JSON
 * POST   /api/scout/match/:matchId         — save match JSON
 * POST   /api/scout/match/:matchId/complete — mark match as completed (no further scouting)
 * POST   /api/scout/match/:matchId/lock    — acquire exclusive scout lock
 * POST   /api/scout/match/:matchId/unlock  — release scout lock
 * POST   /api/scout/match/:matchId/heartbeat — keep lock alive
 */
const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const { verifyToken, optionalToken } = require('../middleware/auth');
const db       = require('../db/db');
const { isScoutEnabled } = require('../lib/featureSettings');

router.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/') return next();
  if (!isScoutEnabled()) {
    return res.status(403).json({ ok: false, error: 'Scouting is uitgeschakeld door de beheerder.' });
  }
  next();
});

const DATA_DIR = path.join(__dirname, '../../server/data/scout');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── In-memory scout locks (matchId → { userId, userName, tabId, lockedAt, lastHeartbeat }) ─
const scoutLocks = new Map();
const LOCK_TIMEOUT_MS = 45_000; // lock expires after 45s without heartbeat

function isLockActive(matchId) {
  const lock = scoutLocks.get(matchId);
  if (!lock) return null;
  if (Date.now() - lock.lastHeartbeat > LOCK_TIMEOUT_MS) {
    scoutLocks.delete(matchId);
    return null;
  }
  return lock;
}

function getUserName(userId) {
  try {
    const row = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    return row?.name || 'Onbekend';
  } catch (_) { return 'Onbekend'; }
}

function scoutFile(matchId) {
  return path.join(DATA_DIR, `${matchId}.json`);
}

function validMatchId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

// ── Check if a user is a coach/team-admin for any team ───────────────────────
function isCoachOrAdmin(userId) {
  const row = db.prepare(`
    SELECT 1 FROM user_roles
    WHERE user_id = ?
      AND role IN ('super_admin','club_admin','team_admin','coach')
    LIMIT 1
  `).get(userId);
  if (row) return true;
  // Also coaches via team_memberships
  const row2 = db.prepare(`
    SELECT 1 FROM team_memberships
    WHERE user_id = ? AND membership_type = 'coach'
    LIMIT 1
  `).get(userId);
  return !!row2;
}

// ── GET /api/scout — health check (verifies router is mounted)
router.get('/', (req, res) => {
  res.json({ ok: true, msg: 'scout-api' });
});

// ── GET /api/scout/sessions — list sessions the current user owns ─────────────
router.get('/sessions', verifyToken, (req, res) => {
  const userId = req.user.id;
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const sessions = [];
    for (const f of files) {
      try {
        const raw  = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
        const data = JSON.parse(raw);
        if (data.createdBy === userId || data.coachId === userId) {
          sessions.push({
            matchId:   data.matchId || f.replace('.json',''),
            teamA:     data.teamA || '',
            teamB:     data.teamB || '',
            matchDate: data.matchDate || '',
            completed: !!data.completed,
            nevoboMatchId: data.nevoboMatchId || null,
          });
        }
      } catch (_) {}
    }
    sessions.sort((a, b) => (b.matchDate || '').localeCompare(a.matchDate || ''));
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Kon sessies niet lezen' });
  }
});

// ── GET /api/scout/status/:matchId — check session + lock status ────────────
router.get('/status/:matchId', optionalToken, (req, res) => {
  const matchId = req.params.matchId;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const lock = isLockActive(matchId);
  const currentUserId = req.user?.id || null;

  const file = scoutFile(matchId);
  if (!fs.existsSync(file)) {
    return res.json({
      ok: true, exists: false, completed: false,
      locked: !!lock,
      lockedBy: lock ? lock.userName : null,
      lockedByMe: lock ? lock.userId === currentUserId : false,
    });
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({
      ok: true, exists: true, completed: !!data.completed,
      locked: !!lock,
      lockedBy: lock ? lock.userName : null,
      lockedByMe: lock ? lock.userId === currentUserId : false,
    });
  } catch (_) {
    res.json({
      ok: true, exists: true, completed: false,
      locked: !!lock,
      lockedBy: lock ? lock.userName : null,
      lockedByMe: lock ? lock.userId === currentUserId : false,
    });
  }
});

// ── POST /api/scout/match/:matchId/lock — acquire exclusive lock ────────────
router.post('/match/:matchId/lock', verifyToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const userId = req.user.id;
  const tabId  = req.body?.tabId || null;
  if (!isCoachOrAdmin(userId)) {
    return res.status(403).json({ ok: false, error: 'Alleen coaches mogen scouten' });
  }

  const existing = isLockActive(matchId);
  if (existing) {
    // Same user + same tab → allow re-lock (refresh, set-lineup return)
    // Same user + different tab/device → block
    // Different user → block
    const sameSession = existing.userId === userId && existing.tabId && existing.tabId === tabId;
    if (!sameSession && (existing.userId !== userId || existing.tabId !== tabId)) {
      const who = existing.userId === userId ? 'jij op een ander apparaat/tab' : existing.userName;
      return res.status(423).json({
        ok: false,
        error: `Wordt al gescouted door ${who}`,
        lockedBy: existing.userName,
        lockedBySelf: existing.userId === userId,
      });
    }
  }

  const now = Date.now();
  scoutLocks.set(matchId, {
    userId,
    userName: getUserName(userId),
    tabId,
    lockedAt: existing?.lockedAt || now,
    lastHeartbeat: now,
  });
  res.json({ ok: true });
});

// ── POST /api/scout/match/:matchId/unlock — release lock ────────────────────
// Supports both normal auth-header requests and sendBeacon (token in body)
router.post('/match/:matchId/unlock', optionalToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  let userId = req.user?.id;
  const tabId = req.body?.tabId || null;

  // sendBeacon fallback: token may be in the request body
  if (!userId && req.body?.token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET || 'dev-secret');
      userId = decoded.id;
    } catch (_) {}
  }

  if (userId) {
    const lock = scoutLocks.get(matchId);
    // Only release if this is the same user+tab that holds the lock
    if (lock && lock.userId === userId && (!lock.tabId || !tabId || lock.tabId === tabId)) {
      scoutLocks.delete(matchId);
    }
  }
  res.json({ ok: true });
});

// ── POST /api/scout/match/:matchId/heartbeat — keep lock alive ──────────────
router.post('/match/:matchId/heartbeat', verifyToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const tabId = req.body?.tabId || null;
  const lock = scoutLocks.get(matchId);
  if (!lock || lock.userId !== req.user.id || (lock.tabId && lock.tabId !== tabId)) {
    return res.status(423).json({ ok: false, error: 'Lock niet gevonden of van iemand anders' });
  }
  lock.lastHeartbeat = Date.now();
  res.json({ ok: true });
});

// ── GET /api/scout/match/:matchId — load match JSON ──────────────────────────
router.get('/match/:matchId', verifyToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const file = scoutFile(matchId);
  if (!fs.existsSync(file)) {
    return res.json({
      matchId,
      matchDate: new Date().toISOString().slice(0, 10),
      teamA: '',
      teamB: '',
      completed: false,
      sets: [],
    });
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(data);
  } catch (_) {
    res.status(500).json({ ok: false, error: 'Kon wedstrijd niet laden' });
  }
});

// ── POST /api/scout/match/:matchId — save match JSON ─────────────────────────
router.post('/match/:matchId', verifyToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const userId = req.user.id;
  if (!isCoachOrAdmin(userId)) {
    return res.status(403).json({ ok: false, error: 'Alleen coaches mogen scouten' });
  }

  const file = scoutFile(matchId);

  // If file exists and is completed, block further saves
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (existing.completed) {
        return res.status(409).json({ ok: false, error: 'Scout sessie is afgesloten' });
      }
    } catch (_) {}
  }

  const body = req.body;
  const data = {
    ...body,
    matchId,
    coachId:   userId,
    createdBy: body.createdBy || userId,
    savedAt:   new Date().toISOString(),
    completed: !!body.completed,
  };

  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    res.json({ ok: true, savedAt: data.savedAt });
  } catch (_) {
    res.status(500).json({ ok: false, error: 'Kon wedstrijd niet opslaan' });
  }
});

// ── POST /api/scout/match/:matchId/complete — finalize session ───────────────
router.post('/match/:matchId/complete', verifyToken, (req, res) => {
  const { matchId } = req.params;
  if (!validMatchId(matchId)) return res.status(400).json({ ok: false, error: 'Ongeldig matchId' });

  const userId = req.user.id;
  if (!isCoachOrAdmin(userId)) {
    return res.status(403).json({ ok: false, error: 'Alleen coaches mogen scouten' });
  }

  const file = scoutFile(matchId);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ ok: false, error: 'Scout sessie niet gevonden' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.completed   = true;
    data.completedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    scoutLocks.delete(matchId);
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ ok: false, error: 'Kon sessie niet afsluiten' });
  }
});

module.exports = router;
