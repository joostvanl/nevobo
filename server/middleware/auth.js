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

/** Coach or trainer team membership (used for roster/NPC merge access). */
function hasTeamCoachOrTrainer(userId, teamId) {
  return !!db.prepare(
    `SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ? AND membership_type IN ('coach','trainer')`
  ).get(userId, teamId);
}

/** Club admin, team admin, or coach/trainer on this team — read team roster / NPC tools. */
function canViewTeamRoster(userId, teamId) {
  const tid = parseInt(teamId, 10);
  if (!tid) return false;
  if (hasSuperAdmin(userId)) return true;
  const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(tid);
  if (!team) return false;
  if (hasClubAdmin(userId, team.club_id)) return true;
  if (hasTeamAdmin(userId, tid)) return true;
  return hasTeamCoachOrTrainer(userId, tid);
}

/** Edit another user's profile when they share a team where requester is team_admin or coach/trainer, or club_admin. */
function canTeamStaffEditUser(requesterId, targetUserId) {
  if (hasSuperAdmin(requesterId)) return true;
  const targetClub = db.prepare('SELECT club_id FROM users WHERE id = ?').get(targetUserId);
  if (targetClub?.club_id && hasClubAdmin(requesterId, targetClub.club_id)) return true;
  const teams = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(targetUserId);
  for (const { team_id } of teams) {
    if (hasTeamAdmin(requesterId, team_id)) return true;
    if (hasTeamCoachOrTrainer(requesterId, team_id)) return true;
  }
  return false;
}

/**
 * Teamcarpool op wedstrijdniveau beheren (passagier eruit, geplande lift verwijderen):
 * coach-lidmaatschap, team_admin, club_admin of super_admin.
 */
function canManageTeamCarpool(userId, teamId) {
  const tid = parseInt(teamId, 10);
  if (!tid) return false;
  if (hasSuperAdmin(userId)) return true;
  const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(tid);
  if (!team) return false;
  if (hasClubAdmin(userId, team.club_id)) return true;
  if (hasTeamAdmin(userId, tid)) return true;
  return !!db.prepare(
    "SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ? AND membership_type = 'coach'"
  ).get(userId, tid);
}

/** Alleen teamcoach (lidmaatschap) mag seizoens-carpool genereren en coach-planner-API gebruiken. */
function canPlanTeamCarpoolSeason(userId, teamId) {
  const tid = parseInt(teamId, 10);
  if (!tid) return false;
  return !!db.prepare(
    "SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ? AND membership_type = 'coach'"
  ).get(userId, tid);
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

/** Team admin OR club admin OR coach/trainer on team (view roster, NPC merge; not add/remove members). */
function requireTeamAdminOrCoach(teamIdParam = 'teamId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const teamId = parseInt(req.params[teamIdParam] || req.body?.team_id);
    if (!teamId || !canViewTeamRoster(req.user.id, teamId)) {
      return res.status(403).json({ ok: false, error: 'Geen rechten voor dit team' });
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
  hasTeamCoachOrTrainer,
  canViewTeamRoster,
  canTeamStaffEditUser,
  canManageTeamCarpool,
  canPlanTeamCarpoolSeason,
  requireSuperAdmin,
  requireClubAdmin,
  requireTeamAdmin,
  requireTeamAdminOrCoach,
};
