const express = require('express');
const router = express.Router();
const db = require('../db/db');
const {
  verifyToken,
  hasSuperAdmin,
  hasClubAdmin,
  hasTeamAdmin,
  requireSuperAdmin,
  requireClubAdmin,
  requireTeamAdmin,
} = require('../middleware/auth');

// All admin routes require a valid token
router.use(verifyToken);

// ─── User search (super admin only) ──────────────────────────────────────────
// GET /api/admin/users?q=...
router.get('/users', requireSuperAdmin, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const users = db.prepare(`
    SELECT id, name, email, club_id, team_id, role, created_at
    FROM users WHERE name LIKE ? OR email LIKE ?
    ORDER BY name ASC LIMIT 50
  `).all(q, q);
  res.json({ ok: true, users });
});

// ─── Role assignment / revocation ────────────────────────────────────────────

// POST /api/admin/roles — assign a role
router.post('/roles', (req, res) => {
  const { user_id, role, club_id = null, team_id = null } = req.body;
  const granterId = req.user.id;

  if (!user_id || !role) return res.status(400).json({ ok: false, error: 'user_id en role zijn verplicht' });
  if (!['super_admin', 'club_admin', 'team_admin'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig roltype' });
  }

  // Hierarchy enforcement
  if (role === 'super_admin') {
    if (!hasSuperAdmin(granterId)) return res.status(403).json({ ok: false, error: 'Alleen opperbeheerders mogen opperbeheerders aanmaken' });
  } else if (role === 'club_admin') {
    if (!hasSuperAdmin(granterId)) return res.status(403).json({ ok: false, error: 'Alleen opperbeheerders mogen clubbeheerders aanmaken' });
    if (!club_id) return res.status(400).json({ ok: false, error: 'club_id is verplicht voor club_admin' });
  } else if (role === 'team_admin') {
    if (!team_id) return res.status(400).json({ ok: false, error: 'team_id is verplicht voor team_admin' });
    const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(team_id);
    if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });
    if (!hasClubAdmin(granterId, team.club_id) && !hasSuperAdmin(granterId)) {
      return res.status(403).json({ ok: false, error: 'Geen rechten om teambeheerders aan te stellen voor deze club' });
    }
  }

  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  try {
    const result = db.prepare(
      'INSERT INTO user_roles (user_id, role, club_id, team_id, granted_by) VALUES (?, ?, ?, ?, ?)'
    ).run(user_id, role, club_id, team_id, granterId);
    const newRole = db.prepare('SELECT * FROM user_roles WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ok: true, role: newRole });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Deze gebruiker heeft deze rol al' });
    }
    throw err;
  }
});

// DELETE /api/admin/roles/:id — revoke a role
router.delete('/roles/:id', (req, res) => {
  const roleRow = db.prepare('SELECT * FROM user_roles WHERE id = ?').get(req.params.id);
  if (!roleRow) return res.status(404).json({ ok: false, error: 'Rol niet gevonden' });

  const granterId = req.user.id;

  // Only super admins can revoke super_admin / club_admin roles
  if (['super_admin', 'club_admin'].includes(roleRow.role)) {
    if (!hasSuperAdmin(granterId)) return res.status(403).json({ ok: false, error: 'Alleen opperbeheerders mogen deze rol intrekken' });
  } else if (roleRow.role === 'team_admin') {
    const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(roleRow.team_id);
    if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });
    if (!hasClubAdmin(granterId, team.club_id) && !hasSuperAdmin(granterId)) {
      return res.status(403).json({ ok: false, error: 'Geen rechten om deze rol in te trekken' });
    }
  }

  db.prepare('DELETE FROM user_roles WHERE id = ?').run(roleRow.id);
  res.json({ ok: true });
});

// ─── Club admin views ─────────────────────────────────────────────────────────

// GET /api/admin/clubs/:clubId/admins — list all admins (club + team level) for a club
router.get('/clubs/:clubId/admins', requireClubAdmin('clubId'), (req, res) => {
  const clubId = parseInt(req.params.clubId);

  const clubAdmins = db.prepare(`
    SELECT ur.*, u.name, u.email, u.avatar_url, NULL AS team_name
    FROM user_roles ur JOIN users u ON u.id = ur.user_id
    WHERE ur.role = 'club_admin' AND ur.club_id = ?
  `).all(clubId);

  const teamAdmins = db.prepare(`
    SELECT ur.*, u.name, u.email, u.avatar_url, t.display_name AS team_name
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN teams t ON t.id = ur.team_id
    WHERE ur.role = 'team_admin' AND t.club_id = ?
  `).all(clubId);

  const teams = db.prepare('SELECT id, display_name FROM teams WHERE club_id = ? ORDER BY display_name').all(clubId);

  res.json({ ok: true, club_admins: clubAdmins, team_admins: teamAdmins, teams });
});

// GET /api/admin/clubs/:clubId/users — list/search users associated with a club
router.get('/clubs/:clubId/users', requireClubAdmin('clubId'), (req, res) => {
  const clubId = parseInt(req.params.clubId);
  const q = req.query.q !== undefined ? `%${req.query.q}%` : null;
  let users;
  if (q) {
    // Search mode (for adding team members/admins)
    users = db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email, u.avatar_url,
        GROUP_CONCAT(DISTINCT t.display_name) AS team_names
      FROM users u
      LEFT JOIN team_memberships tm ON tm.user_id = u.id
      LEFT JOIN teams t ON t.id = tm.team_id AND t.club_id = ?
      WHERE (u.club_id = ? OR tm.team_id IN (SELECT id FROM teams WHERE club_id = ?))
        AND (u.name LIKE ? OR u.email LIKE ?)
      GROUP BY u.id
      ORDER BY u.name ASC LIMIT 30
    `).all(clubId, clubId, clubId, q, q);
  } else {
    // Full list mode (for user management)
    users = db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email, u.avatar_url,
        GROUP_CONCAT(DISTINCT t.display_name) AS team_names
      FROM users u
      LEFT JOIN team_memberships tm ON tm.user_id = u.id
      LEFT JOIN teams t ON t.id = tm.team_id AND t.club_id = ?
      WHERE u.club_id = ?
         OR tm.team_id IN (SELECT id FROM teams WHERE club_id = ?)
      GROUP BY u.id
      ORDER BY u.name ASC
    `).all(clubId, clubId, clubId);
  }
  res.json({ ok: true, users });
});

// ─── Team admin views ─────────────────────────────────────────────────────────

// GET /api/admin/teams/:teamId/members
router.get('/teams/:teamId/members', requireTeamAdmin('teamId'), (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const members = db.prepare(`
    SELECT tm.*, u.name, u.email, u.avatar_url, u.level, u.xp,
           u.birth_date,
           tm.shirt_number, tm.position
    FROM team_memberships tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY tm.membership_type, u.name
  `).all(teamId);

  const team = db.prepare(`
    SELECT t.*, c.name AS club_name FROM teams t
    JOIN clubs c ON c.id = t.club_id WHERE t.id = ?
  `).get(teamId);

  res.json({ ok: true, members, team });
});

// POST /api/admin/teams/:teamId/members — add by userId or email
router.post('/teams/:teamId/members', requireTeamAdmin('teamId'), (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const { email, userId, membership_type = 'player' } = req.body;
  if (!email && !userId) return res.status(400).json({ ok: false, error: 'userId of e-mailadres is verplicht' });
  if (!['player', 'coach', 'staff', 'parent'].includes(membership_type)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig lidmaatschapstype' });
  }

  const user = userId
    ? db.prepare('SELECT id, name, email, avatar_url FROM users WHERE id = ?').get(parseInt(userId))
    : db.prepare('SELECT id, name, email, avatar_url FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) return res.status(404).json({ ok: false, error: 'Geen gebruiker gevonden' });

  try {
    db.prepare(
      'INSERT INTO team_memberships (team_id, user_id, membership_type, added_by) VALUES (?, ?, ?, ?)'
    ).run(teamId, user.id, membership_type, req.user.id);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Gebruiker is al lid van dit team' });
    }
    throw err;
  }
});

// PATCH /api/admin/teams/:teamId/members/:userId — update membership fields
router.patch('/teams/:teamId/members/:userId', requireTeamAdmin('teamId'), (req, res) => {
  const { membership_type, shirt_number, position } = req.body;
  const teamId = req.params.teamId;
  const userId = req.params.userId;

  const fields = [];
  const vals   = [];

  if (membership_type !== undefined) {
    if (!['player', 'coach', 'staff', 'parent'].includes(membership_type)) {
      return res.status(400).json({ ok: false, error: 'Ongeldig roltype' });
    }
    fields.push('membership_type = ?');
    vals.push(membership_type);
  }
  if (shirt_number !== undefined) {
    fields.push('shirt_number = ?');
    vals.push(shirt_number === '' || shirt_number === null ? null : parseInt(shirt_number));
  }
  if (position !== undefined) {
    fields.push('position = ?');
    vals.push(position || null);
  }

  if (!fields.length) return res.status(400).json({ ok: false, error: 'Geen velden om bij te werken' });

  vals.push(teamId, userId);
  db.prepare(`UPDATE team_memberships SET ${fields.join(', ')} WHERE team_id = ? AND user_id = ?`).run(...vals);
  res.json({ ok: true });
});

// DELETE /api/admin/teams/:teamId/members/:userId
router.delete('/teams/:teamId/members/:userId', requireTeamAdmin('teamId'), (req, res) => {
  db.prepare('DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?')
    .run(req.params.teamId, req.params.userId);
  res.json({ ok: true });
});

// GET /api/admin/users/:userId/profile — fetch current profile data
router.get('/users/:userId/profile', (req, res) => {
  const requesterId = req.user.id;
  const targetId = parseInt(req.params.userId);

  const target = db.prepare('SELECT id, name, email, birth_date FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  const userTeams = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(targetId).map(r => r.team_id);
  const userClub  = db.prepare('SELECT club_id FROM users WHERE id = ?').get(targetId);
  const canView   = hasSuperAdmin(requesterId) ||
    (userClub && hasClubAdmin(requesterId, userClub.club_id)) ||
    userTeams.some(tid => hasTeamAdmin(requesterId, tid));
  if (!canView) return res.status(403).json({ ok: false, error: 'Geen rechten' });

  res.json({ ok: true, user: target });
});

// POST /api/admin/users/:userId/profile — edit user fields incl. optional password reset
// Accessible by: super_admin, club_admin of de betreffende club, team_admin van een team waar de speler in zit
router.post('/users/:userId/profile', async (req, res) => {
  const requesterId = req.user.id;
  const targetId = parseInt(req.params.userId);
  const { name, email, birth_date, password } = req.body;

  // Authorization: check if requester has any admin role over this user
  const userTeams = db.prepare(
    'SELECT team_id FROM team_memberships WHERE user_id = ?'
  ).all(targetId).map(r => r.team_id);

  const userClub = db.prepare('SELECT club_id FROM users WHERE id = ?').get(targetId);

  const canEdit =
    hasSuperAdmin(requesterId) ||
    (userClub && hasClubAdmin(requesterId, userClub.club_id)) ||
    userTeams.some(tid => hasTeamAdmin(requesterId, tid));

  if (!canEdit) {
    return res.status(403).json({ ok: false, error: 'Geen rechten om dit profiel te bewerken' });
  }

  // Validate email uniqueness if changed
  if (email) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), targetId);
    if (existing) return res.status(409).json({ ok: false, error: 'Dit e-mailadres is al in gebruik' });
  }

  const fields = [];
  const vals = [];
  if (name !== undefined)         { fields.push('name = ?');         vals.push(name.trim()); }
  if (email !== undefined)        { fields.push('email = ?');        vals.push(email.trim().toLowerCase()); }
  if (birth_date !== undefined)   { fields.push('birth_date = ?');   vals.push(birth_date || null); }

  // Password reset — only allowed for club_admin or super_admin (not team_admin)
  if (password !== undefined && password.trim() !== '') {
    const canResetPassword = hasSuperAdmin(requesterId) ||
      (userClub && hasClubAdmin(requesterId, userClub.club_id));
    if (!canResetPassword) {
      return res.status(403).json({ ok: false, error: 'Alleen clubbeheerders mogen wachtwoorden resetten' });
    }
    if (password.trim().length < 6) {
      return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 6 tekens zijn' });
    }
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password.trim(), 10);
    fields.push('password_hash = ?');
    vals.push(hash);
  }

  if (!fields.length) return res.status(400).json({ ok: false, error: 'Geen velden om te bewerken' });

  vals.push(targetId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);

  const updated = db.prepare(
    'SELECT id, name, email, birth_date FROM users WHERE id = ?'
  ).get(targetId);

  res.json({ ok: true, user: updated });
});

// ─── Current user's own admin context (used by frontend to render correct tabs) ─
// GET /api/admin/my-roles — returns roles + enriched context
router.get('/my-roles', (req, res) => {
  const userId = req.user.id;
  const roles = db.prepare(`
    SELECT ur.*,
      c.name AS club_name, c.nevobo_code,
      t.display_name AS team_name, t.club_id AS team_club_id
    FROM user_roles ur
    LEFT JOIN clubs c ON c.id = ur.club_id
    LEFT JOIN teams t ON t.id = ur.team_id
    WHERE ur.user_id = ?
    ORDER BY ur.role, c.name, t.display_name
  `).all(userId);
  res.json({ ok: true, roles });
});

// DELETE /api/admin/users/:userId — permanently delete a user and all their data
router.delete('/users/:userId', (req, res) => {
  const requesterId = req.user.id;
  const targetId = parseInt(req.params.userId);

  if (targetId === requesterId) {
    return res.status(400).json({ ok: false, error: 'Je kunt jezelf niet verwijderen' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  // Authorization: super_admin OR club_admin of de club waar de user bij hoort
  const targetClubId = target.club_id;
  const targetTeams = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(targetId).map(r => r.team_id);
  const targetClubIds = [
    targetClubId,
    ...db.prepare(`SELECT DISTINCT club_id FROM teams WHERE id IN (${targetTeams.length ? targetTeams.map(() => '?').join(',') : 'NULL'})`).all(...targetTeams).map(r => r.club_id),
  ].filter(Boolean);

  const canDelete = hasSuperAdmin(requesterId) ||
    targetClubIds.some(cid => hasClubAdmin(requesterId, cid));

  if (!canDelete) {
    return res.status(403).json({ ok: false, error: 'Geen rechten om deze gebruiker te verwijderen' });
  }

  // Clean up physical files before DB delete
  const fs = require('fs');
  const path = require('path');
  const uploadsBase = path.join(__dirname, '../../public');

  // Delete face reference files (privacy data)
  const faceRefs = db.prepare('SELECT file_path FROM face_references WHERE user_id = ?').all(targetId);
  for (const { file_path } of faceRefs) {
    try {
      const abs = path.join(uploadsBase, file_path);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (_) {}
  }

  // Delete avatar if it's a local upload
  if (target.avatar_url && target.avatar_url.startsWith('/uploads/')) {
    try {
      const abs = path.join(uploadsBase, target.avatar_url);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (_) {}
  }

  // Disown media uploaded by this user — files stay, uploader reference becomes NULL
  // (SQLite doesn't support ALTER COLUMN, so we do this manually before delete)
  db.prepare('UPDATE match_media SET user_id = NULL WHERE user_id = ?').run(targetId);
  db.prepare('UPDATE posts SET user_id = NULL WHERE user_id = ?').run(targetId);

  // Delete user — all related rows cascade automatically (foreign_keys = ON)
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  res.json({ ok: true, message: `Gebruiker "${target.name}" verwijderd` });
});

module.exports = router;
