const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken, hasClubAdmin, hasSuperAdmin } = require('../middleware/auth');

function getClubId(userId) {
  const row = db.prepare('SELECT club_id FROM users WHERE id = ?').get(userId);
  return row?.club_id || null;
}

function canEditTraining(userId, clubId) {
  return hasClubAdmin(userId, clubId) || hasSuperAdmin(userId);
}

// ─── Locations ──────────────────────────────────────────────────────────────

router.get('/locations', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const locations = db.prepare('SELECT * FROM training_locations WHERE club_id = ? ORDER BY name').all(clubId);
  res.json({ ok: true, locations });
});

router.post('/locations', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { name, nevobo_venue_name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  const result = db.prepare(
    'INSERT INTO training_locations (club_id, name, nevobo_venue_name) VALUES (?, ?, ?)'
  ).run(clubId, name.trim(), nevobo_venue_name?.trim() || null);
  const location = db.prepare('SELECT * FROM training_locations WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, location });
});

router.patch('/locations/:id', verifyToken, (req, res) => {
  const loc = db.prepare('SELECT * FROM training_locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, loc.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { name, nevobo_venue_name } = req.body || {};
  db.prepare(
    `UPDATE training_locations SET
      name = COALESCE(?, name),
      nevobo_venue_name = COALESCE(?, nevobo_venue_name)
    WHERE id = ?`
  ).run(
    name?.trim() || null,
    nevobo_venue_name !== undefined ? (nevobo_venue_name?.trim() || null) : null,
    loc.id
  );
  res.json({ ok: true, location: db.prepare('SELECT * FROM training_locations WHERE id = ?').get(loc.id) });
});

router.delete('/locations/:id', verifyToken, (req, res) => {
  const loc = db.prepare('SELECT * FROM training_locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, loc.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_locations WHERE id = ?').run(loc.id);
  res.json({ ok: true });
});

// ─── Venues (courts/fields within a location) ──────────────────────────────

router.get('/venues', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const venues = db.prepare(`
    SELECT v.*, l.name AS location_name, l.nevobo_venue_name
    FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ?
    ORDER BY l.name, v.name
  `).all(clubId);
  res.json({ ok: true, venues });
});

router.post('/venues', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { location_id, name, type, nevobo_field_slug } = req.body || {};
  if (!location_id) return res.status(400).json({ ok: false, error: 'Locatie is verplicht' });
  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  const loc = db.prepare('SELECT id FROM training_locations WHERE id = ? AND club_id = ?').get(location_id, clubId);
  if (!loc) return res.status(404).json({ ok: false, error: 'Locatie niet gevonden' });
  const vType = type === 'field' ? 'field' : 'hall';
  const result = db.prepare(
    'INSERT INTO training_venues (club_id, location_id, name, type, nevobo_field_slug) VALUES (?, ?, ?, ?, ?)'
  ).run(clubId, location_id, name.trim(), vType, nevobo_field_slug?.trim() || null);
  const venue = db.prepare(`
    SELECT v.*, l.name AS location_name, l.nevobo_venue_name
    FROM training_venues v JOIN training_locations l ON l.id = v.location_id
    WHERE v.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, venue });
});

router.patch('/venues/:id', verifyToken, (req, res) => {
  const venue = db.prepare('SELECT * FROM training_venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, venue.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { name, type, location_id } = req.body || {};
  db.prepare(
    `UPDATE training_venues SET
      name = COALESCE(?, name),
      type = COALESCE(?, type),
      location_id = COALESCE(?, location_id)
    WHERE id = ?`
  ).run(
    name?.trim() || null,
    type === 'field' ? 'field' : type === 'hall' ? 'hall' : null,
    location_id || null,
    venue.id
  );
  const updated = db.prepare(`
    SELECT v.*, l.name AS location_name, l.nevobo_venue_name
    FROM training_venues v JOIN training_locations l ON l.id = v.location_id
    WHERE v.id = ?
  `).get(venue.id);
  res.json({ ok: true, venue: updated });
});

router.delete('/venues/:id', verifyToken, (req, res) => {
  const venue = db.prepare('SELECT * FROM training_venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, venue.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_venues WHERE id = ?').run(venue.id);
  res.json({ ok: true });
});

// ─── Defaults (blauwdruk) ───────────────────────────────────────────────────

router.get('/defaults', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const rows = db.prepare(`
    SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_defaults d
    JOIN teams t ON t.id = d.team_id
    JOIN training_venues v ON v.id = d.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ?
    ORDER BY d.day_of_week, d.start_time
  `).all(clubId);
  res.json({ ok: true, defaults: rows });
});

router.post('/defaults', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { team_id, venue_id, day_of_week, start_time, end_time } = req.body || {};
  if (!team_id || !venue_id || day_of_week == null || !start_time || !end_time) {
    return res.status(400).json({ ok: false, error: 'Alle velden zijn verplicht' });
  }
  const dow = parseInt(day_of_week, 10);
  if (dow < 0 || dow > 6) return res.status(400).json({ ok: false, error: 'Ongeldige dag' });
  const result = db.prepare(
    'INSERT INTO training_defaults (club_id, team_id, venue_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(clubId, team_id, venue_id, dow, start_time, end_time);
  const row = db.prepare(`
    SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_defaults d
    JOIN teams t ON t.id = d.team_id
    JOIN training_venues v ON v.id = d.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE d.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, training: row });
});

router.patch('/defaults/:id', verifyToken, (req, res) => {
  const row = db.prepare('SELECT * FROM training_defaults WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, row.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { team_id, venue_id, day_of_week, start_time, end_time } = req.body || {};
  db.prepare(`
    UPDATE training_defaults SET
      team_id = COALESCE(?, team_id),
      venue_id = COALESCE(?, venue_id),
      day_of_week = COALESCE(?, day_of_week),
      start_time = COALESCE(?, start_time),
      end_time = COALESCE(?, end_time)
    WHERE id = ?
  `).run(
    team_id || null, venue_id || null,
    day_of_week != null ? parseInt(day_of_week, 10) : null,
    start_time || null, end_time || null,
    row.id
  );
  const updated = db.prepare(`
    SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_defaults d
    JOIN teams t ON t.id = d.team_id
    JOIN training_venues v ON v.id = d.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE d.id = ?
  `).get(row.id);
  res.json({ ok: true, training: updated });
});

router.delete('/defaults/:id', verifyToken, (req, res) => {
  const row = db.prepare('SELECT * FROM training_defaults WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, row.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_defaults WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ─── Week view (resolved) ───────────────────────────────────────────────────

router.get('/week/:isoWeek', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });

  const isoWeek = req.params.isoWeek;
  const exWeek = db.prepare(
    'SELECT * FROM training_exception_weeks WHERE club_id = ? AND iso_week = ?'
  ).get(clubId, isoWeek);

  let trainings;
  if (exWeek) {
    trainings = db.prepare(`
      SELECT e.*, t.display_name AS team_name, v.name AS venue_name,
             l.name AS location_name, l.nevobo_venue_name
      FROM training_exceptions e
      JOIN teams t ON t.id = e.team_id
      JOIN training_venues v ON v.id = e.venue_id
      JOIN training_locations l ON l.id = v.location_id
      WHERE e.club_id = ? AND e.iso_week = ?
      ORDER BY e.day_of_week, e.start_time
    `).all(clubId, isoWeek);
  } else {
    trainings = db.prepare(`
      SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
             l.name AS location_name, l.nevobo_venue_name
      FROM training_defaults d
      JOIN teams t ON t.id = d.team_id
      JOIN training_venues v ON v.id = d.venue_id
      JOIN training_locations l ON l.id = v.location_id
      WHERE d.club_id = ?
      ORDER BY d.day_of_week, d.start_time
    `).all(clubId);
  }

  res.json({
    ok: true,
    iso_week: isoWeek,
    is_exception: !!exWeek,
    exception_label: exWeek?.label || null,
    trainings,
    source: exWeek ? 'exception' : 'default',
  });
});

// ─── Exception week management ──────────────────────────────────────────────

router.post('/week/:isoWeek/override', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const isoWeek = req.params.isoWeek;
  const existing = db.prepare(
    'SELECT 1 FROM training_exception_weeks WHERE club_id = ? AND iso_week = ?'
  ).get(clubId, isoWeek);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Week is al afwijkend' });
  }

  const label = req.body?.label?.trim() || null;

  const createOverride = db.transaction(() => {
    db.prepare(
      'INSERT INTO training_exception_weeks (club_id, iso_week, label) VALUES (?, ?, ?)'
    ).run(clubId, isoWeek, label);

    const defaults = db.prepare(
      'SELECT team_id, venue_id, day_of_week, start_time, end_time FROM training_defaults WHERE club_id = ?'
    ).all(clubId);
    const ins = db.prepare(
      'INSERT INTO training_exceptions (club_id, team_id, venue_id, iso_week, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const d of defaults) {
      ins.run(clubId, d.team_id, d.venue_id, isoWeek, d.day_of_week, d.start_time, d.end_time);
    }
  });
  createOverride();

  const trainings = db.prepare(`
    SELECT e.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_exceptions e
    JOIN teams t ON t.id = e.team_id
    JOIN training_venues v ON v.id = e.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE e.club_id = ? AND e.iso_week = ?
    ORDER BY e.day_of_week, e.start_time
  `).all(clubId, isoWeek);

  res.status(201).json({ ok: true, iso_week: isoWeek, is_exception: true, trainings });
});

router.delete('/week/:isoWeek/override', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const isoWeek = req.params.isoWeek;
  db.prepare('DELETE FROM training_exceptions WHERE club_id = ? AND iso_week = ?').run(clubId, isoWeek);
  db.prepare('DELETE FROM training_exception_weeks WHERE club_id = ? AND iso_week = ?').run(clubId, isoWeek);
  res.json({ ok: true });
});

// ─── Exception trainings (within override week) ─────────────────────────────

router.post('/exceptions', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { iso_week, team_id, venue_id, day_of_week, start_time, end_time } = req.body || {};
  if (!iso_week || !team_id || !venue_id || day_of_week == null || !start_time || !end_time) {
    return res.status(400).json({ ok: false, error: 'Alle velden zijn verplicht' });
  }
  const exWeek = db.prepare(
    'SELECT 1 FROM training_exception_weeks WHERE club_id = ? AND iso_week = ?'
  ).get(clubId, iso_week);
  if (!exWeek) {
    return res.status(400).json({ ok: false, error: 'Week is niet afwijkend — maak eerst een afwijkende week aan' });
  }
  const result = db.prepare(
    'INSERT INTO training_exceptions (club_id, team_id, venue_id, iso_week, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(clubId, team_id, venue_id, iso_week, parseInt(day_of_week, 10), start_time, end_time);
  const row = db.prepare(`
    SELECT e.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_exceptions e
    JOIN teams t ON t.id = e.team_id
    JOIN training_venues v ON v.id = e.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE e.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, training: row });
});

router.patch('/exceptions/:id', verifyToken, (req, res) => {
  const row = db.prepare('SELECT * FROM training_exceptions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, row.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { team_id, venue_id, day_of_week, start_time, end_time } = req.body || {};
  db.prepare(`
    UPDATE training_exceptions SET
      team_id = COALESCE(?, team_id),
      venue_id = COALESCE(?, venue_id),
      day_of_week = COALESCE(?, day_of_week),
      start_time = COALESCE(?, start_time),
      end_time = COALESCE(?, end_time)
    WHERE id = ?
  `).run(
    team_id || null, venue_id || null,
    day_of_week != null ? parseInt(day_of_week, 10) : null,
    start_time || null, end_time || null,
    row.id
  );
  const updated = db.prepare(`
    SELECT e.*, t.display_name AS team_name, v.name AS venue_name,
           l.name AS location_name, l.nevobo_venue_name
    FROM training_exceptions e
    JOIN teams t ON t.id = e.team_id
    JOIN training_venues v ON v.id = e.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE e.id = ?
  `).get(row.id);
  res.json({ ok: true, training: updated });
});

router.delete('/exceptions/:id', verifyToken, (req, res) => {
  const row = db.prepare('SELECT * FROM training_exceptions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (!canEditTraining(req.user.id, row.club_id)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_exceptions WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ─── Team page: resolved schedule for a team ────────────────────────────────

router.get('/team/:teamId/schedule', verifyToken, (req, res) => {
  const teamId = parseInt(req.params.teamId, 10);
  if (!teamId) return res.status(400).json({ ok: false, error: 'Ongeldig team' });
  const team = db.prepare('SELECT club_id FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });

  const dateStr = req.query.date;
  let isoWeek;
  if (dateStr) {
    const d = new Date(dateStr);
    const dayNum = d.getDay() || 7;
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 4 - dayNum);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    isoWeek = `${thursday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  } else {
    const now = new Date();
    const dayNum = now.getDay() || 7;
    const thursday = new Date(now);
    thursday.setDate(now.getDate() + 4 - dayNum);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    isoWeek = `${thursday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  const clubId = team.club_id;
  const exWeek = db.prepare(
    'SELECT * FROM training_exception_weeks WHERE club_id = ? AND iso_week = ?'
  ).get(clubId, isoWeek);

  const defaults = db.prepare(`
    SELECT d.*, v.name AS venue_name, l.name AS location_name
    FROM training_defaults d
    JOIN training_venues v ON v.id = d.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ? AND d.team_id = ?
    ORDER BY d.day_of_week, d.start_time
  `).all(clubId, teamId);

  let trainings = defaults;
  let teamHasException = false;

  if (exWeek) {
    const exceptions = db.prepare(`
      SELECT e.*, v.name AS venue_name, l.name AS location_name
      FROM training_exceptions e
      JOIN training_venues v ON v.id = e.venue_id
      JOIN training_locations l ON l.id = v.location_id
      WHERE e.club_id = ? AND e.iso_week = ? AND e.team_id = ?
      ORDER BY e.day_of_week, e.start_time
    `).all(clubId, isoWeek, teamId);

    const toKey = (rows) => rows.map(r => `${r.day_of_week}|${r.start_time}|${r.end_time}|${r.venue_id}`).join(';');
    if (toKey(exceptions) !== toKey(defaults)) {
      trainings = exceptions;
      teamHasException = true;
    }
  }

  res.json({
    ok: true,
    iso_week: isoWeek,
    is_exception: teamHasException,
    exception_label: teamHasException ? (exWeek?.label || null) : null,
    trainings,
  });
});

// ─── Club teams list (for planner dropdowns) ────────────────────────────────

router.get('/teams', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const teams = db.prepare('SELECT id, display_name FROM teams WHERE club_id = ? ORDER BY display_name').all(clubId);
  res.json({ ok: true, teams });
});

// ─── Blueprint snapshots ────────────────────────────────────────────────

router.get('/snapshots', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const rows = db.prepare(
    'SELECT id, name, is_active, created_at FROM training_snapshots WHERE club_id = ? ORDER BY created_at DESC'
  ).all(clubId);
  res.json({ ok: true, snapshots: rows });
});

router.get('/snapshots/active', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const row = db.prepare(
    'SELECT id, name FROM training_snapshots WHERE club_id = ? AND is_active = 1'
  ).get(clubId);
  res.json({ ok: true, active: row || null });
});

router.post('/snapshots', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });

  const defaults = db.prepare(
    'SELECT team_id, venue_id, day_of_week, start_time, end_time FROM training_defaults WHERE club_id = ? ORDER BY day_of_week, start_time'
  ).all(clubId);

  const data = JSON.stringify(defaults);
  const save = db.transaction(() => {
    db.prepare('UPDATE training_snapshots SET is_active = 0 WHERE club_id = ?').run(clubId);
    return db.prepare(
      'INSERT INTO training_snapshots (club_id, name, data, is_active) VALUES (?, ?, ?, 1)'
    ).run(clubId, name.trim(), data);
  });
  const result = save();

  res.status(201).json({ ok: true, snapshot: { id: result.lastInsertRowid, name: name.trim(), count: defaults.length } });
});

router.post('/snapshots/:id/activate', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const snap = db.prepare(
    'SELECT * FROM training_snapshots WHERE id = ? AND club_id = ?'
  ).get(req.params.id, clubId);
  if (!snap) return res.status(404).json({ ok: false, error: 'Snapshot niet gevonden' });

  let entries;
  try { entries = JSON.parse(snap.data); } catch (_) {
    return res.status(500).json({ ok: false, error: 'Ongeldige snapshot data' });
  }

  const activate = db.transaction(() => {
    db.prepare('UPDATE training_snapshots SET is_active = 0 WHERE club_id = ?').run(clubId);
    db.prepare('UPDATE training_snapshots SET is_active = 1 WHERE id = ?').run(snap.id);
    db.prepare('DELETE FROM training_defaults WHERE club_id = ?').run(clubId);
    const ins = db.prepare(
      'INSERT INTO training_defaults (club_id, team_id, venue_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const e of entries) {
      ins.run(clubId, e.team_id, e.venue_id, e.day_of_week, e.start_time, e.end_time);
    }
  });
  activate();

  res.json({ ok: true, activated: snap.name, loaded: entries.length });
});

router.delete('/snapshots/:id', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_snapshots WHERE id = ? AND club_id = ?').run(req.params.id, clubId);
  res.json({ ok: true });
});

// ─── Nevobo venue discovery ─────────────────────────────────────────────

router.get('/nevobo-venues', verifyToken, async (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const club = db.prepare('SELECT nevobo_code, name FROM clubs WHERE id = ?').get(clubId);
  if (!club?.nevobo_code) return res.json({ ok: true, venues: [] });

  try {
    const RSSParser = require('rss-parser');
    const parser = new RSSParser({ customFields: { item: [['description', 'description']] } });
    const feed = await parser.parseURL(`https://api.nevobo.nl/export/vereniging/${club.nevobo_code}/programma.rss`);
    const fetch = require('node-fetch');
    const clubLower = (club.name || '').toLowerCase();

    const isRecreanten = (str) => /\b[HD]R\s+\d/.test(str);

    // Collect home match detail URLs grouped by venue name
    const venueMatches = {};
    for (const item of feed.items || []) {
      const content = item.description || item.contentSnippet || item.content || '';
      const locMatch = content.match(/Speellocatie:\s*([^,]+)/);
      if (!locMatch) continue;
      const venueName = locMatch[1].trim();
      const title = item.title || '';
      const afterColon = title.match(/^\d+\s+\w+\s+\d+:\d+:\s*(.+)$/);
      const teamsStr = afterColon ? afterColon[1] : title;
      if (isRecreanten(teamsStr)) continue;
      const isHome = teamsStr.toLowerCase().startsWith(clubLower);
      if (!isHome) continue;
      if (!venueMatches[venueName]) venueMatches[venueName] = [];
      venueMatches[venueName].push(item.link || item.guid);
    }

    // For each venue, fetch a sample of match detail pages to discover fields
    const venues = [];
    for (const [venueName, urls] of Object.entries(venueMatches)) {
      const fieldSet = new Set();
      const sample = urls.slice(0, 8);
      await Promise.all(sample.map(async (url) => {
        try {
          const r = await fetch(url, { timeout: 5000 });
          const text = await r.text();
          const sv = text.match(/"speelveld":"([^"]+)"/);
          if (sv) fieldSet.add(sv[1].split('/').pop());
        } catch (_) {}
      }));
      const fields = [...fieldSet].sort().map(slug => ({
        slug,
        name: slug.replace(/-/g, ' ').replace(/^(.)/, c => c.toUpperCase()),
      }));
      venues.push({ name: venueName, match_count: urls.length, fields });
    }

    venues.sort((a, b) => b.match_count - a.match_count);
    res.json({ ok: true, venues });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Kon Nevobo-locaties niet ophalen', detail: err.message });
  }
});

// Get match→field mapping for a specific week (used by planner)
router.get('/nevobo-match-fields/:isoWeek', verifyToken, async (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const club = db.prepare('SELECT nevobo_code, name FROM clubs WHERE id = ?').get(clubId);
  if (!club?.nevobo_code) return res.json({ ok: true, matches: [] });

  try {
    const RSSParser = require('rss-parser');
    const parser = new RSSParser({ customFields: { item: [['description', 'description']] } });
    const feed = await parser.parseURL(`https://api.nevobo.nl/export/vereniging/${club.nevobo_code}/programma.rss`);
    const fetch = require('node-fetch');
    const clubLower = (club.name || '').toLowerCase();

    const isoWeek = req.params.isoWeek;
    const [y, w] = isoWeek.split('-W').map(Number);
    const jan4 = new Date(y, 0, 4);
    const dow = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dow + 1 + (w - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59);

    const weekItems = (feed.items || []).filter(item => {
      if (!item.isoDate) return false;
      const dt = new Date(item.isoDate);
      if (dt < monday || dt > sunday) return false;
      const title = item.title || '';
      const afterColon = title.match(/^\d+\s+\w+\s+\d+:\d+:\s*(.+)$/);
      const teamsStr = afterColon ? afterColon[1] : title;
      if (/\b[HD]R\s+\d/.test(teamsStr)) return false;
      return teamsStr.toLowerCase().startsWith(clubLower);
    });

    const results = await Promise.all(weekItems.map(async (item) => {
      const content = item.description || item.contentSnippet || item.content || '';
      const locMatch = content.match(/Speellocatie:\s*([^,]+)/);
      const venueName = locMatch ? locMatch[1].trim() : null;
      const title = item.title || '';
      const afterColon = title.match(/^\d+\s+\w+\s+\d+:\d+:\s*(.+)$/);
      const teamsStr = afterColon ? afterColon[1] : title;
      const teamMatch = teamsStr.match(/^(.+?)\s+-\s+(.+)$/);

      let fieldSlug = null;
      try {
        const url = item.link || item.guid;
        const r = await fetch(url, { timeout: 5000 });
        const text = await r.text();
        const sv = text.match(/"speelveld":"([^"]+)"/);
        if (sv) fieldSlug = sv[1].split('/').pop();
      } catch (_) {}

      return {
        datetime: item.isoDate,
        home_team: teamMatch ? teamMatch[1].trim() : null,
        away_team: teamMatch ? teamMatch[2].trim() : null,
        venue_name: venueName,
        field_slug: fieldSlug,
      };
    }));

    res.json({ ok: true, matches: results });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Nevobo onbereikbaar', detail: err.message });
  }
});

module.exports = router;
