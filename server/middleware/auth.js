const jwt = require('jsonwebtoken');
const db = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Geen toegang — inloggen vereist' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ ok: false, error: 'Ongeldig of verlopen token' });
  }
}

// Optional auth: attaches user if token present, doesn't fail if missing
function optionalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_) {}
  }
  next();
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

function getUserRoles(userId) {
  return db.prepare('SELECT * FROM user_roles WHERE user_id = ?').all(userId);
}

function hasSuperAdmin(userId) {
  return !!db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'").get(userId);
}

function hasClubAdmin(userId, clubId) {
  return hasSuperAdmin(userId) || !!db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'club_admin' AND club_id = ?"
  ).get(userId, clubId);
}

function hasTeamAdmin(userId, teamId) {
  if (hasSuperAdmin(userId)) return true;
  const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(teamId);
  if (team && hasClubAdmin(userId, team.club_id)) return true;
  return !!db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'team_admin' AND team_id = ?"
  ).get(userId, teamId);
}

// Middleware factories
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
  if (!hasSuperAdmin(req.user.id)) return res.status(403).json({ ok: false, error: 'Geen opperbeheerder rechten' });
  next();
}

function requireClubAdmin(clubIdParam = 'clubId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const clubId = parseInt(req.params[clubIdParam] || req.body?.club_id);
    if (!clubId || !hasClubAdmin(req.user.id, clubId)) {
      return res.status(403).json({ ok: false, error: 'Geen clubbeheerder rechten' });
    }
    next();
  };
}

function requireTeamAdmin(teamIdParam = 'teamId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const teamId = parseInt(req.params[teamIdParam] || req.body?.team_id);
    if (!teamId || !hasTeamAdmin(req.user.id, teamId)) {
      return res.status(403).json({ ok: false, error: 'Geen teambeheerder rechten' });
    }
    next();
  };
}

module.exports = {
  verifyToken,
  optionalToken,
  getUserRoles,
  hasSuperAdmin,
  hasClubAdmin,
  hasTeamAdmin,
  requireSuperAdmin,
  requireClubAdmin,
  requireTeamAdmin,
};
