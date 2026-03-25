const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const { verifyToken } = require('../middleware/auth');
const { getClientFeatures } = require('../lib/featureSettings');
const metrics = require('../lib/metrics');

// Multer for avatar + face reference uploads
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `user_${req.user.id}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRES = '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, club_id: user.club_id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function safeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, club_id, team_id } = req.body;
  if (!name || !email || !password) {
    metrics.recordAuthRegister('validation_error');
    return res.status(400).json({ ok: false, error: 'Naam, e-mail en wachtwoord zijn verplicht' });
  }
  if (password.length < 6) {
    metrics.recordAuthRegister('validation_error');
    return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 6 tekens zijn' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    metrics.recordAuthRegister('duplicate_email');
    return res.status(409).json({ ok: false, error: 'E-mailadres is al in gebruik' });
  }

  let regClubId = null;
  if (club_id !== undefined && club_id !== null && club_id !== '') {
    regClubId = parseInt(String(club_id), 10);
    if (Number.isNaN(regClubId) || !db.prepare('SELECT id FROM clubs WHERE id = ?').get(regClubId)) {
      metrics.recordAuthRegister('invalid_club');
      return res.status(400).json({ ok: false, error: 'Ongeldige vereniging' });
    }
  }

  const password_hash = await bcrypt.hash(password, 12);

  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, club_id, team_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, password_hash, regClubId, team_id || null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

  // Award "team_player" badge if they joined a team
  if (team_id) {
    awardBadgeIfNew(user.id, 'team_player');
  }

  const token = generateToken(user);
  metrics.recordAuthRegister('success');
  res.status(201).json({ ok: true, token, user: safeUser(user), features: getClientFeatures() });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    metrics.recordAuthLogin('validation_error');
    return res.status(400).json({ ok: false, error: 'E-mail en wachtwoord zijn verplicht' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    metrics.recordAuthLogin('invalid_credentials');
    return res.status(401).json({ ok: false, error: 'Ongeldige inloggegevens' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    metrics.recordAuthLogin('invalid_credentials');
    return res.status(401).json({ ok: false, error: 'Ongeldige inloggegevens' });
  }

  const token = generateToken(user);
  metrics.recordAuthLogin('success');
  res.json({ ok: true, token, user: safeUser(user), features: getClientFeatures() });
});

// GET /api/auth/me
router.get('/me', verifyToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  const badges = db.prepare(`
    SELECT b.*, ub.earned_at FROM badges b
    JOIN user_badges ub ON ub.badge_id = b.id
    WHERE ub.user_id = ?
    ORDER BY ub.earned_at DESC
  `).all(user.id);

  const goals = db.prepare(`
    SELECT g.*, ug.progress, ug.completed_at FROM goals g
    LEFT JOIN user_goals ug ON ug.goal_id = g.id AND ug.user_id = ?
    ORDER BY g.sort_order ASC
  `).all(user.id);

  const nextLevel = db.prepare('SELECT * FROM xp_levels WHERE xp_required > ? ORDER BY xp_required ASC LIMIT 1').get(user.xp);
  const currentLevel = db.prepare('SELECT * FROM xp_levels WHERE level = ?').get(user.level);

  const roles = db.prepare(`
    SELECT ur.*, c.name AS club_name, t.display_name AS team_name
    FROM user_roles ur
    LEFT JOIN clubs c ON c.id = ur.club_id
    LEFT JOIN teams t ON t.id = ur.team_id
    WHERE ur.user_id = ?
    ORDER BY ur.role
  `).all(user.id);

  const memberships = db.prepare(`
    SELECT tm.team_id, tm.membership_type, t.display_name AS team_name,
           t.club_id, c.name AS club_name, c.nevobo_code
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    JOIN clubs c ON c.id = t.club_id
    WHERE tm.user_id = ?
    ORDER BY c.name, t.display_name
  `).all(user.id);

  res.json({
    ok: true,
    user: { ...safeUser(user), roles, memberships },
    badges,
    goals,
    nextLevel,
    currentLevel,
    features: getClientFeatures(),
  });
});

// GET /api/auth/memberships — list own team memberships
router.get('/memberships', verifyToken, (req, res) => {
  const memberships = db.prepare(`
    SELECT tm.team_id, tm.membership_type, t.display_name AS team_name,
           t.club_id, c.name AS club_name, c.nevobo_code
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    JOIN clubs c ON c.id = t.club_id
    WHERE tm.user_id = ?
    ORDER BY c.name, t.display_name
  `).all(req.user.id);
  res.json({ ok: true, memberships });
});

// POST /api/auth/memberships — add a team membership
router.post('/memberships', verifyToken, (req, res) => {
  const { team_id, membership_type } = req.body;
  const VALID_TYPES = ['player', 'coach', 'trainer', 'parent'];
  if (!team_id) return res.status(400).json({ ok: false, error: 'team_id is verplicht' });
  if (!VALID_TYPES.includes(membership_type)) {
    return res.status(400).json({ ok: false, error: `membership_type moet één van: ${VALID_TYPES.join(', ')} zijn` });
  }

  const team = db.prepare('SELECT t.*, c.name AS club_name FROM teams t JOIN clubs c ON c.id=t.club_id WHERE t.id = ?').get(team_id);
  if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });

  const user = db.prepare('SELECT team_id, club_id FROM users WHERE id = ?').get(req.user.id);
  if (user.club_id != null && team.club_id !== user.club_id) {
    return res.status(403).json({
      ok: false,
      error: 'Je hoort al bij een andere vereniging. Pas je vereniging aan in je profiel om over te stappen.',
    });
  }

  try {
    db.prepare('INSERT OR IGNORE INTO team_memberships (team_id, user_id, membership_type) VALUES (?, ?, ?)')
      .run(team_id, req.user.id, membership_type);
  } catch (err) {
    return res.status(409).json({ ok: false, error: 'Je bent al lid van dit team' });
  }

  // Primary team + club: fill club when missing; set primary team when missing
  if (!user.club_id) {
    db.prepare('UPDATE users SET club_id = ? WHERE id = ?').run(team.club_id, req.user.id);
  }
  if (!user.team_id) {
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(team_id, req.user.id);
  }

  const memberships = db.prepare(`
    SELECT tm.team_id, tm.membership_type, t.display_name AS team_name,
           t.club_id, c.name AS club_name, c.nevobo_code
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    JOIN clubs c ON c.id = t.club_id
    WHERE tm.user_id = ?
    ORDER BY c.name, t.display_name
  `).all(req.user.id);

  res.status(201).json({ ok: true, memberships });
});

// DELETE /api/auth/memberships/:teamId — remove a team membership
router.delete('/memberships/:teamId', verifyToken, (req, res) => {
  db.prepare('DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?')
    .run(req.params.teamId, req.user.id);

  // If this was their primary team, clear it (or set to next available)
  const user = db.prepare('SELECT team_id, club_id FROM users WHERE id = ?').get(req.user.id);
  if (String(user.team_id) === String(req.params.teamId)) {
    const next = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ? LIMIT 1').get(req.user.id);
    if (next) {
      const t = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(next.team_id);
      db.prepare('UPDATE users SET team_id = ?, club_id = ? WHERE id = ?').run(next.team_id, t?.club_id, req.user.id);
    } else {
      db.prepare('UPDATE users SET team_id = NULL WHERE id = ?').run(req.user.id);
    }
  }

  const memberships = db.prepare(`
    SELECT tm.team_id, tm.membership_type, t.display_name AS team_name,
           t.club_id, c.name AS club_name, c.nevobo_code
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    JOIN clubs c ON c.id = t.club_id
    WHERE tm.user_id = ?
    ORDER BY c.name, t.display_name
  `).all(req.user.id);

  res.json({ ok: true, memberships });
});

// PATCH /api/auth/profile
router.patch('/profile', verifyToken, (req, res) => {
  const { name, team_id, club_id, anonymous_mode } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  const updates = {};
  if (name) updates.name = name;
  if (anonymous_mode !== undefined) updates.anonymous_mode = anonymous_mode ? 1 : 0;

  if (club_id !== undefined) {
    let newClubId = null;
    if (club_id === null || club_id === '') {
      newClubId = null;
    } else {
      newClubId = parseInt(String(club_id), 10);
      if (Number.isNaN(newClubId)) {
        return res.status(400).json({ ok: false, error: 'Ongeldige club' });
      }
      if (!db.prepare('SELECT id FROM clubs WHERE id = ?').get(newClubId)) {
        return res.status(400).json({ ok: false, error: 'Club niet gevonden' });
      }
    }

    const applyClubChange = db.transaction(() => {
      if (newClubId === null) {
        db.prepare('DELETE FROM team_memberships WHERE user_id = ?').run(user.id);
      } else {
        db.prepare(
          `DELETE FROM team_memberships WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE club_id != ?)`
        ).run(user.id, newClubId);
      }

      let nextTeamId = user.team_id;
      const primaryStillValid =
        newClubId !== null &&
        nextTeamId &&
        db.prepare(
          `SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = ? AND tm.team_id = ? AND t.club_id = ?`
        ).get(user.id, nextTeamId, newClubId);

      if (!primaryStillValid) {
        const next =
          newClubId === null
            ? null
            : db.prepare(
                `SELECT tm.team_id FROM team_memberships tm
                 JOIN teams t ON t.id = tm.team_id
                 WHERE tm.user_id = ? AND t.club_id = ? LIMIT 1`
              ).get(user.id, newClubId);
        nextTeamId = next ? next.team_id : null;
      }

      updates.club_id = newClubId;
      updates.team_id = nextTeamId;
    });
    applyClubChange();
  }

  if (team_id !== undefined) {
    const tid =
      team_id === null || team_id === '' ? null : parseInt(String(team_id), 10);
    if (tid !== null && Number.isNaN(tid)) {
      return res.status(400).json({ ok: false, error: 'Ongeldig team' });
    }
    const effClub = updates.club_id !== undefined ? updates.club_id : user.club_id;
    if (tid === null) {
      updates.team_id = null;
    } else {
      const t = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(tid);
      if (!t) return res.status(400).json({ ok: false, error: 'Team niet gevonden' });
      if (effClub != null && t.club_id !== effClub) {
        return res.status(400).json({ ok: false, error: 'Dit team hoort niet bij jouw vereniging' });
      }
      const mem = db.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ?').get(user.id, tid);
      if (!mem) {
        return res.status(400).json({ ok: false, error: 'Je bent geen lid van dit team' });
      }
      updates.team_id = tid;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ ok: false, error: 'Geen velden om bij te werken' });
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: safeUser(updated) });
});

// POST /api/auth/avatar — upload profile photo
router.post('/avatar', verifyToken, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Geen afbeelding ontvangen' });

  // Normalize EXIF orientation so the avatar displays correctly everywhere
  try {
    const sharp = require('sharp');
    const tmpPath = req.file.path + '.rot.tmp';
    await sharp(req.file.path).rotate().toFile(tmpPath);
    fs.renameSync(tmpPath, req.file.path);
  } catch (_) { /* keep original if rotation fails */ }

  const relativePath = '/uploads/avatars/' + req.file.filename;

  // Delete old avatar file if it was a local upload
  const existing = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
  if (existing?.avatar_url?.startsWith('/uploads/avatars/')) {
    const old = path.join(__dirname, '../../public', existing.avatar_url);
    fs.unlink(old, () => {});
  }

  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(relativePath, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, avatar_url: relativePath, user: safeUser(user) });
});

// POST /api/auth/face-reference — add a portrait reference photo (up to 5 per user)
router.post('/face-reference', verifyToken, avatarUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Geen foto ontvangen' });

  // Max 5 reference photos per user
  const count = db.prepare('SELECT COUNT(*) AS n FROM face_references WHERE user_id = ?').get(req.user.id);
  if (count.n >= 5) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ ok: false, error: 'Maximaal 5 referentiefoto\'s toegestaan' });
  }

  // Normalise EXIF orientation before storing
  const relativePath = '/uploads/avatars/' + req.file.filename;
  const absPath = path.join(__dirname, '../../public', relativePath);
  try {
    const tmpPath = absPath + '.tmp';
    await require('sharp')(absPath).rotate().toFile(tmpPath);
    fs.renameSync(tmpPath, absPath);
  } catch (_) { /* keep original if sharp fails */ }

  // Quality check: brightness, sharpness, face detection
  try {
    const { checkReferencePhotoQuality } = require('../services/faceBlur');
    const quality = await checkReferencePhotoQuality(absPath);
    if (!quality.ok && !quality.skipped) {
      fs.unlink(absPath, () => {});
      return res.status(400).json({
        ok: false,
        error: quality.issues.join(' · '),
        issues: quality.issues,
        hints:  quality.hints,
      });
    }
  } catch (_) { /* non-blocking — proceed on unexpected check error */ }

  // Insert into face_references table
  const row = db.prepare('INSERT INTO face_references (user_id, file_path) VALUES (?, ?)').run(req.user.id, relativePath);

  // Also keep legacy face_reference_path pointing to the first/latest one (backward compat)
  db.prepare('UPDATE users SET face_reference_path = ? WHERE id = ?').run(relativePath, req.user.id);

  res.json({ ok: true, id: row.lastInsertRowid, file_path: relativePath });
});

// DELETE /api/auth/face-reference/:id — remove a specific reference photo
router.delete('/face-reference/:id', verifyToken, (req, res) => {
  const ref = db.prepare('SELECT * FROM face_references WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ref) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  // Remove file from disk
  try {
    const absPath = path.join(__dirname, '../../public', ref.file_path);
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (_) {}

  // Invalidate descriptor cache
  try {
    const { invalidateCache } = require('../services/faceBlur');
    invalidateCache(ref.file_path);
  } catch (_) {}

  db.prepare('DELETE FROM face_references WHERE id = ?').run(ref.id);

  // Update legacy column to most recent remaining reference (or null)
  const remaining = db.prepare('SELECT file_path FROM face_references WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  db.prepare('UPDATE users SET face_reference_path = ? WHERE id = ?').run(remaining?.file_path ?? null, req.user.id);

  res.json({ ok: true });
});

// GET /api/auth/face-references — list all reference photos for current user
router.get('/face-references', verifyToken, (req, res) => {
  const refs = db.prepare('SELECT id, file_path, created_at FROM face_references WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
  res.json({ ok: true, refs });
});

// Helper used by other routes
function awardBadgeIfNew(userId, slug) {
  const badge = db.prepare('SELECT id FROM badges WHERE slug = ?').get(slug);
  if (!badge) return false;
  try {
    db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(userId, badge.id);
    // Add XP reward
    const b = db.prepare('SELECT xp_reward FROM badges WHERE id = ?').get(badge.id);
    if (b) db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(b.xp_reward, userId);
    updateUserLevel(userId);
    return true;
  } catch (_) {
    return false;
  }
}

function updateUserLevel(userId) {
  const user = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const level = db.prepare(
    'SELECT level FROM xp_levels WHERE xp_required <= ? ORDER BY xp_required DESC LIMIT 1'
  ).get(user.xp);
  if (level) {
    db.prepare('UPDATE users SET level = ? WHERE id = ?').run(level.level, userId);
  }
}

module.exports = router;
module.exports.awardBadgeIfNew = awardBadgeIfNew;
module.exports.updateUserLevel = updateUserLevel;
