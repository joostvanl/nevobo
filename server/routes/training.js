const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken, hasClubAdmin, hasSuperAdmin, requireSuperAdmin } = require('../middleware/auth');
const trainingAiPrompts = require('../lib/training-ai-prompts');
const { dependencyFetch, DEPS } = require('../lib/dependencyFetch');
const { resolveTrainingWeekForClub, normalizeIsoWeek } = require('../lib/training-week-resolve');

function getClubId(userId) {
  const row = db.prepare('SELECT club_id FROM users WHERE id = ?').get(userId);
  return row?.club_id || null;
}

function canEditTraining(userId, clubId) {
  return hasClubAdmin(userId, clubId) || hasSuperAdmin(userId);
}

// ─── AI webhook + systeemprompts (vroeg geregistreerd) ───────────────────────
// Zie server/lib/training-ai-prompts.js — /bundled vóór /ai-prompts-config (specifiekere pad eerst).

router.get('/ai-webhook-status', verifyToken, (req, res) => {
  res.json({ ok: true, configured: !!process.env.N8N_TRAINING_WEBHOOK_URL });
});

router.get('/ai-prompts-config/bundled', verifyToken, requireSuperAdmin, (req, res) => {
  try {
    const { config, fromFile, bundledError } = trainingAiPrompts.readBundledTrainingAiPromptsConfig();
    res.json({ ok: true, config, fromFile, bundledError: bundledError || undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Fout' });
  }
});

router.get('/ai-prompts-config', verifyToken, requireSuperAdmin, (req, res) => {
  try {
    const { config, source } = trainingAiPrompts.loadTrainingAiPromptsConfig();
    const bundled = trainingAiPrompts.readBundledTrainingAiPromptsConfig();
    const src = trainingAiPrompts.getConfigSourcePath();
    res.json({
      ok: true,
      config,
      meta: {
        activeFileSource: source,
        resolvedEnvironment: trainingAiPrompts.getResolvedPromptEnvironment(),
        dataPath: trainingAiPrompts.DATA_PATH,
        bundledPath: trainingAiPrompts.BUNDLED_PATH,
        bundledReadable: bundled.fromFile,
        liveFileExists: !!src.path && src.kind === 'data',
      },
    });
  } catch (e) {
    console.error('[ai-prompts-config]', e);
    res.status(500).json({ ok: false, error: e.message || 'Fout bij laden prompts' });
  }
});

router.put('/ai-prompts-config', verifyToken, requireSuperAdmin, (req, res) => {
  try {
    const { environment, mode, prompt, note } = req.body || {};
    const out = trainingAiPrompts.saveNewRevision(environment, mode, prompt, note);
    const { config, source } = trainingAiPrompts.loadTrainingAiPromptsConfig();
    res.json({ ok: true, ...out, config, meta: { activeFileSource: source } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Opslaan mislukt' });
  }
});

router.post('/ai-prompts-config/activate', verifyToken, requireSuperAdmin, (req, res) => {
  try {
    const { environment, mode, version } = req.body || {};
    const out = trainingAiPrompts.activateRevision(environment, mode, version);
    const { config, source } = trainingAiPrompts.loadTrainingAiPromptsConfig();
    res.json({ ok: true, ...out, config, meta: { activeFileSource: source } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Activeren mislukt' });
  }
});

router.post('/ai-prompts-config/import-bundled', verifyToken, requireSuperAdmin, (req, res) => {
  try {
    if (!req.body?.confirm) {
      return res.status(400).json({ ok: false, error: 'Zet confirm: true om live data te overschrijven met de release-bundel' });
    }
    const out = trainingAiPrompts.importBundledToLive();
    const { config, source } = trainingAiPrompts.loadTrainingAiPromptsConfig();
    res.json({ ok: true, ...out, config, meta: { activeFileSource: source } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Importeren mislukt' });
  }
});

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

router.delete('/defaults/all', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const info = db.prepare('DELETE FROM training_defaults WHERE club_id = ?').run(clubId);
  res.json({ ok: true, deleted: info.changes });
});

router.post('/defaults/restore', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const items = req.body.trainings;
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'trainings array verplicht' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM training_defaults WHERE club_id = ?').run(clubId);
    const ins = db.prepare(
      'INSERT INTO training_defaults (club_id, team_id, venue_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const t of items) {
      ins.run(clubId, t.team_id, t.venue_id, t.day_of_week, t.start_time, t.end_time);
    }
  });
  tx();
  res.json({ ok: true });
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
  const data = resolveTrainingWeekForClub(db, clubId, isoWeek);
  res.json({ ok: true, ...data });
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

  function dateToIsoWeek(d) {
    // Treat Sunday as the start of the next week (Sun-Sat view)
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    const dayNum = d.getDay() || 7;
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 4 - dayNum);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    return `${thursday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  const dateStr = req.query.date;
  const isoWeek = dateStr ? dateToIsoWeek(new Date(dateStr)) : dateToIsoWeek(new Date());

  const clubId = team.club_id;
  const canonicalWeek = normalizeIsoWeek(isoWeek);
  const exWeek = db.prepare(`
    SELECT * FROM training_exception_weeks
    WHERE club_id = ? AND lower(trim(iso_week)) = lower(trim(?))
  `).get(clubId, canonicalWeek || isoWeek);

  const defaults = db.prepare(`
    SELECT d.*, v.name AS venue_name, l.name AS location_name
    FROM training_defaults d
    LEFT JOIN training_venues v ON v.id = d.venue_id
    LEFT JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ? AND d.team_id = ?
    ORDER BY d.day_of_week, d.start_time
  `).all(clubId, teamId);

  let trainings = defaults;
  let teamHasException = false;

  if (exWeek) {
    const exceptions = db.prepare(`
      SELECT e.*, v.name AS venue_name, l.name AS location_name
      FROM training_exceptions e
      LEFT JOIN training_venues v ON v.id = e.venue_id
      LEFT JOIN training_locations l ON l.id = v.location_id
      WHERE e.club_id = ? AND lower(trim(e.iso_week)) = lower(trim(?)) AND e.team_id = ?
      ORDER BY e.day_of_week, e.start_time
    `).all(clubId, exWeek.iso_week, teamId);

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

// ─── Skill tags & exercises library ───────────────────────────────────────────

function isClubCoach(userId, clubId) {
  const row = db.prepare(`
    SELECT 1 FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ? AND t.club_id = ? AND tm.membership_type = 'coach'
    LIMIT 1
  `).get(userId, clubId);
  return !!row;
}

function exerciseRowToJson(row, tags) {
  const out = {
    id: row.id,
    club_id: row.club_id,
    created_by_user_id: row.created_by_user_id,
    name: row.name,
    description: row.description || '',
    default_duration_minutes: row.default_duration_minutes,
    difficulty: row.difficulty,
    scope: row.scope,
    share_status: row.share_status,
    share_pitch: row.share_pitch != null ? String(row.share_pitch) : '',
    created_at: row.created_at,
    tags: tags || [],
    private_in_library: Number(row.private_in_library) === 1,
  };
  if (row.author_name != null) out.author_name = row.author_name;
  return out;
}

function loadExerciseTags(exerciseId) {
  return db.prepare(`
    SELECT t.id, t.name FROM training_skill_tags t
    JOIN training_exercise_tags m ON m.tag_id = t.id
    WHERE m.exercise_id = ?
    ORDER BY t.name
  `).all(exerciseId);
}

function setExerciseTags(exerciseId, tagIds) {
  db.prepare('DELETE FROM training_exercise_tags WHERE exercise_id = ?').run(exerciseId);
  if (!tagIds?.length) return;
  const ins = db.prepare('INSERT INTO training_exercise_tags (exercise_id, tag_id) VALUES (?, ?)');
  const clubRow = db.prepare('SELECT club_id FROM training_exercises WHERE id = ?').get(exerciseId);
  for (const tid of tagIds) {
    const tag = db.prepare('SELECT id FROM training_skill_tags WHERE id = ? AND club_id = ?').get(tid, clubRow.club_id);
    if (tag) ins.run(exerciseId, tid);
  }
}

router.get('/skill-tags', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const tags = db.prepare(
    'SELECT id, name FROM training_skill_tags WHERE club_id = ? ORDER BY name'
  ).all(clubId);
  res.json({ ok: true, tags });
});

router.post('/skill-tags', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  try {
    const r = db.prepare(
      'INSERT INTO training_skill_tags (club_id, name) VALUES (?, ?)'
    ).run(clubId, name);
    const tag = db.prepare('SELECT id, name FROM training_skill_tags WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ ok: true, tag });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ ok: false, error: 'Deze tag bestaat al' });
    }
    throw e;
  }
});

router.delete('/skill-tags/:id', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const tag = db.prepare('SELECT * FROM training_skill_tags WHERE id = ? AND club_id = ?').get(req.params.id, clubId);
  if (!tag) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  db.prepare('DELETE FROM training_skill_tags WHERE id = ?').run(tag.id);
  res.json({ ok: true });
});

router.get('/exercises/pending-share', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const rows = db.prepare(`
    SELECT e.*, u.name AS author_name
    FROM training_exercises e
    JOIN users u ON u.id = e.created_by_user_id
    WHERE e.club_id = ? AND e.scope = 'private' AND e.share_status = 'pending'
    ORDER BY e.created_at DESC
  `).all(clubId);
  const exercises = rows.map((r) => exerciseRowToJson(r, loadExerciseTags(r.id)));
  res.json({ ok: true, exercises });
});

router.get('/exercises', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const q = (req.query.q || '').trim();
  const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;

  let sql = `
    SELECT e.* FROM training_exercises e
    WHERE e.club_id = ? AND (
      e.scope = 'club'
      OR (e.scope = 'private' AND e.created_by_user_id = ? AND e.private_in_library = 1)
    )`;
  const params = [clubId, req.user.id];
  if (q) {
    sql += ' AND (e.name LIKE ? OR e.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (tagId) {
    sql += ' AND EXISTS (SELECT 1 FROM training_exercise_tags m WHERE m.exercise_id = e.id AND m.tag_id = ?)';
    params.push(tagId);
  }
  sql += ' ORDER BY e.name';
  const rows = db.prepare(sql).all(...params);
  const exercises = rows.map((r) => exerciseRowToJson(r, loadExerciseTags(r.id)));
  res.json({ ok: true, exercises });
});

router.post('/exercises', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });

  const {
    name, description, default_duration_minutes: dur, difficulty, scope, tag_ids: tagIds,
    private_in_library: privateInLibrary,
  } = req.body || {};
  const scopeVal = scope === 'club' ? 'club' : 'private';
  const pinLib = scopeVal === 'private' ? (privateInLibrary === true ? 1 : 0) : 0;

  if (scopeVal === 'club') {
    if (!canEditTraining(req.user.id, clubId)) {
      return res.status(403).json({ ok: false, error: 'Alleen beheerders kunnen club-oefeningen aanmaken' });
    }
  } else if (!isClubCoach(req.user.id, clubId) && !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Alleen coaches kunnen privé-oefeningen aanmaken' });
  }

  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  const d = parseInt(dur, 10);
  if (!Number.isFinite(d) || d < 1 || d > 480) {
    return res.status(400).json({ ok: false, error: 'Ongeldige duur (1–480 min)' });
  }
  const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';

  const r = db.prepare(`
    INSERT INTO training_exercises (
      club_id, created_by_user_id, name, description, default_duration_minutes, difficulty, scope, share_status, private_in_library
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?)
  `).run(
    clubId,
    req.user.id,
    name.trim(),
    (description || '').trim(),
    d,
    diff,
    scopeVal,
    pinLib
  );
  const id = r.lastInsertRowid;
  setExerciseTags(id, tagIds);
  const row = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(id);
  res.status(201).json({ ok: true, exercise: exerciseRowToJson(row, loadExerciseTags(id)) });
});

router.patch('/exercises/:id', verifyToken, (req, res) => {
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const clubId = getClubId(req.user.id);
  if (!clubId || ex.club_id !== clubId) return res.status(403).json({ ok: false, error: 'Geen toegang' });

  if (ex.scope === 'club') {
    if (!canEditTraining(req.user.id, clubId)) {
      return res.status(403).json({ ok: false, error: 'Geen toegang' });
    }
  } else if (ex.created_by_user_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const {
    name, description, default_duration_minutes: dur, difficulty, tag_ids: tagIds,
    private_in_library: privateInLibrary,
  } = req.body || {};
  const fields = [];
  const vals = [];
  if (name != null) { fields.push('name = ?'); vals.push(String(name).trim()); }
  if (description != null) { fields.push('description = ?'); vals.push(String(description).trim()); }
  if (dur != null) {
    const d = parseInt(dur, 10);
    if (!Number.isFinite(d) || d < 1 || d > 480) {
      return res.status(400).json({ ok: false, error: 'Ongeldige duur' });
    }
    fields.push('default_duration_minutes = ?'); vals.push(d);
  }
  if (difficulty != null && ['easy', 'medium', 'hard'].includes(difficulty)) {
    fields.push('difficulty = ?'); vals.push(difficulty);
  }
  if (privateInLibrary != null && ex.scope === 'private') {
    fields.push('private_in_library = ?'); vals.push(privateInLibrary === true || privateInLibrary === 1 ? 1 : 0);
  }
  if (fields.length) {
    vals.push(ex.id);
    db.prepare(`UPDATE training_exercises SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }
  if (tagIds != null) setExerciseTags(ex.id, tagIds);
  const row = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(ex.id);
  res.json({ ok: true, exercise: exerciseRowToJson(row, loadExerciseTags(ex.id)) });
});

router.delete('/exercises/:id', verifyToken, (req, res) => {
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const clubId = getClubId(req.user.id);
  if (!clubId || ex.club_id !== clubId) return res.status(403).json({ ok: false, error: 'Geen toegang' });

  if (ex.scope === 'club') {
    if (!canEditTraining(req.user.id, clubId)) {
      return res.status(403).json({ ok: false, error: 'Geen toegang' });
    }
  } else if (ex.created_by_user_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const used = db.prepare('SELECT 1 FROM training_session_exercises WHERE exercise_id = ? LIMIT 1').get(ex.id);
  if (used) {
    return res.status(400).json({ ok: false, error: 'Oefening is nog gekoppeld aan trainingen; verwijder eerst uit sessies' });
  }
  db.prepare('DELETE FROM training_exercises WHERE id = ?').run(ex.id);
  res.json({ ok: true });
});

router.post('/exercises/:id/request-share', verifyToken, (req, res) => {
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const clubId = getClubId(req.user.id);
  if (!clubId || ex.club_id !== clubId) return res.status(403).json({ ok: false, error: 'Geen toegang' });
  if (ex.created_by_user_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Alleen de maker kan delen' });
  }
  if (ex.scope !== 'private') {
    return res.status(400).json({ ok: false, error: 'Alleen privé-oefeningen kunnen worden aangeboden' });
  }
  if (ex.share_status === 'pending') {
    return res.status(400).json({ ok: false, error: 'Er loopt al een aanvraag voor deze oefening' });
  }
  const pitch = String(req.body?.share_pitch ?? req.body?.pitch ?? '').trim();
  if (pitch.length < 20) {
    return res.status(400).json({
      ok: false,
      error: 'Leg in minimaal 20 tekens uit waarom deze oefening in de clubbibliotheek past',
    });
  }
  if (pitch.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Toelichting mag maximaal 2000 tekens zijn' });
  }
  db.prepare('UPDATE training_exercises SET share_status = ?, share_pitch = ? WHERE id = ?').run('pending', pitch, ex.id);
  const row = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(ex.id);
  res.json({ ok: true, exercise: exerciseRowToJson(row, loadExerciseTags(ex.id)) });
});

router.post('/exercises/:id/approve-share', verifyToken, (req, res) => {
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId) || ex.club_id !== clubId) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  if (ex.share_status !== 'pending') {
    return res.status(400).json({ ok: false, error: 'Geen open aanvraag' });
  }
  db.prepare('UPDATE training_exercises SET scope = ?, share_status = ?, share_pitch = ? WHERE id = ?').run('club', 'none', '', ex.id);
  const row = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(ex.id);
  res.json({ ok: true, exercise: exerciseRowToJson(row, loadExerciseTags(ex.id)) });
});

router.post('/exercises/:id/reject-share', verifyToken, (req, res) => {
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId) || ex.club_id !== clubId) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  if (ex.share_status !== 'pending') {
    return res.status(400).json({ ok: false, error: 'Geen open aanvraag' });
  }
  db.prepare('UPDATE training_exercises SET share_status = ?, share_pitch = ? WHERE id = ?').run('rejected', '', ex.id);
  const row = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(ex.id);
  res.json({ ok: true, exercise: exerciseRowToJson(row, loadExerciseTags(ex.id)) });
});

// ─── Training sessions (attendance + notes) ─────────────────────────────────

function getTeamMembership(userId, teamId) {
  return db.prepare(
    'SELECT membership_type FROM team_memberships WHERE user_id = ? AND team_id = ?'
  ).get(userId, teamId);
}

router.get('/session/:id/attendance-list', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership) return res.status(403).json({ ok: false, error: 'Geen lid van dit team' });

  const attendance = db.prepare(`
    SELECT a.user_id, a.status, u.name, u.avatar_url,
           COALESCE(tm.membership_type, 'guest') AS membership_type
    FROM training_attendance a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN team_memberships tm ON tm.user_id = a.user_id AND tm.team_id = ?
    WHERE a.session_id = ?
    ORDER BY CASE COALESCE(tm.membership_type, 'guest') WHEN 'coach' THEN 0 WHEN 'player' THEN 1 ELSE 2 END, u.name
  `).all(session.team_id, session.id);

  res.json({ ok: true, attendance });
});

router.get('/session/:id/search-club-members', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, results: [] });

  const results = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, t.display_name AS team_name
    FROM users u
    LEFT JOIN team_memberships tm2 ON tm2.user_id = u.id
    LEFT JOIN teams t ON t.id = tm2.team_id
    WHERE u.club_id = ? AND u.name LIKE ? AND u.id NOT IN (
      SELECT user_id FROM training_attendance WHERE session_id = ?
    )
    ORDER BY u.name
    LIMIT 15
  `).all(session.club_id, `%${q}%`, session.id);

  res.json({ ok: true, results });
});

router.post('/session/:id/add-guest', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const userId = req.body.user_id;
  if (!userId) return res.status(400).json({ ok: false, error: 'user_id verplicht' });

  const user = db.prepare('SELECT id, name, club_id FROM users WHERE id = ?').get(userId);
  if (!user || user.club_id !== session.club_id) {
    return res.status(400).json({ ok: false, error: 'Gebruiker niet gevonden in deze club' });
  }
  db.prepare(`
    INSERT OR IGNORE INTO training_attendance (session_id, user_id, status) VALUES (?, ?, 'present')
  `).run(session.id, userId);
  res.json({ ok: true });
});

router.delete('/session/:id/guest/:userId', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const guestUserId = parseInt(req.params.userId, 10);
  const isTeamMember = db.prepare(
    'SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ?'
  ).get(guestUserId, session.team_id);
  if (isTeamMember) {
    return res.status(400).json({ ok: false, error: 'Kan geen vast teamlid verwijderen' });
  }
  db.prepare('DELETE FROM training_attendance WHERE session_id = ? AND user_id = ?').run(session.id, guestUserId);
  res.json({ ok: true });
});

function canUseExercise(userId, exercise) {
  if (!exercise) return false;
  if (exercise.scope === 'club') return true;
  return exercise.created_by_user_id === userId;
}

function getSessionExercisesForResponse(sessionId, isCoach, userId) {
  const rows = db.prepare(`
    SELECT se.id AS link_id, se.duration_minutes, se.sort_order, se.performance_rating, se.performance_note,
           e.id AS exercise_id, e.name, e.description, e.default_duration_minutes, e.difficulty,
           e.scope AS exercise_scope, e.share_status, e.created_by_user_id, e.share_pitch, e.private_in_library
    FROM training_session_exercises se
    JOIN training_exercises e ON e.id = se.exercise_id
    WHERE se.session_id = ?
    ORDER BY se.sort_order ASC, se.id ASC
  `).all(sessionId);
  return rows.map((r) => {
    const tags = loadExerciseTags(r.exercise_id);
    const base = {
      id: r.link_id,
      exercise_id: r.exercise_id,
      name: r.name,
      description: r.description || '',
      default_duration_minutes: r.default_duration_minutes,
      duration_minutes: r.duration_minutes,
      difficulty: r.difficulty,
      tags,
      sort_order: r.sort_order,
    };
    if (isCoach) {
      base.performance_rating = r.performance_rating;
      base.performance_note = r.performance_note || '';
      base.exercise_scope = r.exercise_scope;
      base.share_status = r.share_status;
      base.created_by_user_id = r.created_by_user_id;
      base.share_pitch = r.share_pitch != null ? String(r.share_pitch) : '';
      base.private_in_library = Number(r.private_in_library) === 1;
      base.can_request_share = r.exercise_scope === 'private'
        && r.share_status === 'none'
        && r.created_by_user_id === userId;
    }
    return base;
  });
}

router.post('/session/:id/exercises', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const exerciseId = parseInt(req.body.exercise_id, 10);
  if (!exerciseId) return res.status(400).json({ ok: false, error: 'exercise_id verplicht' });
  const ex = db.prepare('SELECT * FROM training_exercises WHERE id = ?').get(exerciseId);
  if (!ex || ex.club_id !== session.club_id) {
    return res.status(404).json({ ok: false, error: 'Oefening niet gevonden' });
  }
  if (!canUseExercise(req.user.id, ex)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze oefening' });
  }
  const dup = db.prepare(
    'SELECT 1 FROM training_session_exercises WHERE session_id = ? AND exercise_id = ?'
  ).get(session.id, exerciseId);
  if (dup) return res.status(400).json({ ok: false, error: 'Deze oefening staat al in het programma' });

  let dur = ex.default_duration_minutes;
  if (req.body.duration_minutes != null) {
    const d = parseInt(req.body.duration_minutes, 10);
    if (!Number.isFinite(d) || d < 1 || d > 480) {
      return res.status(400).json({ ok: false, error: 'Ongeldige duur' });
    }
    dur = d;
  }
  const maxRow = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM training_session_exercises WHERE session_id = ?'
  ).get(session.id);
  let sortOrder = maxRow.m + 1;
  if (req.body.sort_order != null) {
    const s = parseInt(req.body.sort_order, 10);
    if (Number.isFinite(s)) sortOrder = s;
  }
  const ins = db.prepare(`
    INSERT INTO training_session_exercises (session_id, exercise_id, duration_minutes, sort_order, performance_note)
    VALUES (?, ?, ?, ?, '')
  `).run(session.id, exerciseId, dur, sortOrder);
  const linkId = ins.lastInsertRowid;
  const row = db.prepare(`
    SELECT se.id AS link_id, se.duration_minutes, se.sort_order, se.performance_rating, se.performance_note,
           e.id AS exercise_id, e.name, e.description, e.default_duration_minutes, e.difficulty,
           e.scope AS exercise_scope, e.share_status, e.created_by_user_id, e.share_pitch, e.private_in_library
    FROM training_session_exercises se
    JOIN training_exercises e ON e.id = se.exercise_id
    WHERE se.id = ?
  `).get(linkId);
  const one = {
    id: row.link_id,
    exercise_id: row.exercise_id,
    name: row.name,
    description: row.description || '',
    default_duration_minutes: row.default_duration_minutes,
    duration_minutes: row.duration_minutes,
    difficulty: row.difficulty,
    tags: loadExerciseTags(row.exercise_id),
    sort_order: row.sort_order,
    performance_rating: row.performance_rating,
    performance_note: row.performance_note || '',
    exercise_scope: row.exercise_scope,
    share_status: row.share_status,
    created_by_user_id: row.created_by_user_id,
    share_pitch: row.share_pitch != null ? String(row.share_pitch) : '',
    private_in_library: Number(row.private_in_library) === 1,
    can_request_share: row.exercise_scope === 'private'
      && row.share_status === 'none'
      && row.created_by_user_id === req.user.id,
  };
  res.status(201).json({ ok: true, exercise: one });
});

router.patch('/session/:id/exercises/:linkId', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const linkId = parseInt(req.params.linkId, 10);
  const link = db.prepare(
    'SELECT * FROM training_session_exercises WHERE id = ? AND session_id = ?'
  ).get(linkId, session.id);
  if (!link) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  const { duration_minutes: durIn, sort_order: sortIn, performance_rating: pr, performance_note: pn } = req.body || {};
  const fields = [];
  const vals = [];
  if (durIn != null) {
    const d = parseInt(durIn, 10);
    if (!Number.isFinite(d) || d < 1 || d > 480) {
      return res.status(400).json({ ok: false, error: 'Ongeldige duur' });
    }
    fields.push('duration_minutes = ?'); vals.push(d);
  }
  if (sortIn != null) {
    const s = parseInt(sortIn, 10);
    if (Number.isFinite(s)) { fields.push('sort_order = ?'); vals.push(s); }
  }
  if (pr !== undefined) {
    if (pr === null) {
      fields.push('performance_rating = ?'); vals.push(null);
    } else {
      const p = parseInt(pr, 10);
      if (!Number.isFinite(p) || p < 1 || p > 5) {
        return res.status(400).json({ ok: false, error: 'Score 1–5 of leeg' });
      }
      fields.push('performance_rating = ?'); vals.push(p);
    }
  }
  if (pn !== undefined) {
    fields.push('performance_note = ?'); vals.push(String(pn));
  }
  if (fields.length) {
    vals.push(linkId);
    db.prepare(`UPDATE training_session_exercises SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }
  const row = db.prepare(`
    SELECT se.id AS link_id, se.duration_minutes, se.sort_order, se.performance_rating, se.performance_note,
           e.id AS exercise_id, e.name, e.description, e.default_duration_minutes, e.difficulty,
           e.scope AS exercise_scope, e.share_status, e.created_by_user_id, e.share_pitch, e.private_in_library
    FROM training_session_exercises se
    JOIN training_exercises e ON e.id = se.exercise_id
    WHERE se.id = ?
  `).get(linkId);
  const one = {
    id: row.link_id,
    exercise_id: row.exercise_id,
    name: row.name,
    description: row.description || '',
    default_duration_minutes: row.default_duration_minutes,
    duration_minutes: row.duration_minutes,
    difficulty: row.difficulty,
    tags: loadExerciseTags(row.exercise_id),
    sort_order: row.sort_order,
    performance_rating: row.performance_rating,
    performance_note: row.performance_note || '',
    exercise_scope: row.exercise_scope,
    share_status: row.share_status,
    created_by_user_id: row.created_by_user_id,
    share_pitch: row.share_pitch != null ? String(row.share_pitch) : '',
    private_in_library: Number(row.private_in_library) === 1,
    can_request_share: row.exercise_scope === 'private'
      && row.share_status === 'none'
      && row.created_by_user_id === req.user.id,
  };
  res.json({ ok: true, exercise: one });
});

router.delete('/session/:id/exercises/:linkId', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches' });
  }
  const linkId = parseInt(req.params.linkId, 10);
  const info = db.prepare('DELETE FROM training_session_exercises WHERE id = ? AND session_id = ?').run(linkId, session.id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  res.json({ ok: true });
});

router.get('/session/:teamId/:date/:startTime', verifyToken, (req, res) => {
  const teamId = parseInt(req.params.teamId, 10);
  const { date, startTime } = req.params;
  if (!teamId || !date || !startTime) return res.status(400).json({ ok: false, error: 'Ongeldige parameters' });

  const membership = getTeamMembership(req.user.id, teamId);
  if (!membership) return res.status(403).json({ ok: false, error: 'Geen lid van dit team' });
  const isCoach = membership.membership_type === 'coach';

  const team = db.prepare('SELECT id, club_id, display_name FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });

  let session = db.prepare(
    'SELECT * FROM training_sessions WHERE team_id = ? AND date = ? AND start_time = ?'
  ).get(teamId, date, startTime);

  if (!session) {
    const info = db.prepare(`
      INSERT INTO training_sessions (club_id, team_id, date, start_time, end_time, venue_name, location_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(team.club_id, teamId, date, startTime, req.query.end_time || '', req.query.venue || '', req.query.location || '');
    session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(info.lastInsertRowid);

    const members = db.prepare(
      `SELECT user_id FROM team_memberships WHERE team_id = ? AND membership_type IN ('player', 'coach')`
    ).all(teamId);
    const insertAtt = db.prepare('INSERT OR IGNORE INTO training_attendance (session_id, user_id, status) VALUES (?, ?, ?)');
    for (const m of members) insertAtt.run(session.id, m.user_id, 'unknown');
  }

  const attendance = db.prepare(`
    SELECT a.user_id, a.status, u.name, u.avatar_url,
           COALESCE(tm.membership_type, 'guest') AS membership_type
    FROM training_attendance a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN team_memberships tm ON tm.user_id = a.user_id AND tm.team_id = ?
    WHERE a.session_id = ?
    ORDER BY CASE COALESCE(tm.membership_type, 'guest') WHEN 'coach' THEN 0 WHEN 'player' THEN 1 ELSE 2 END, u.name
  `).all(teamId, session.id);

  res.json({
    ok: true,
    session: {
      id: session.id,
      team_id: session.team_id,
      team_name: team.display_name,
      date: session.date,
      start_time: session.start_time,
      end_time: session.end_time,
      venue_name: session.venue_name,
      location_name: session.location_name,
      notes: isCoach ? (session.notes || '') : undefined,
    },
    attendance,
    is_coach: isCoach,
    exercises: getSessionExercisesForResponse(session.id, isCoach, req.user.id),
  });
});

router.patch('/session/:id', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches kunnen notities bewerken' });
  }
  const notes = req.body.notes ?? '';
  db.prepare('UPDATE training_sessions SET notes = ? WHERE id = ?').run(notes, session.id);
  res.json({ ok: true });
});

router.patch('/session/:id/attendance', verifyToken, (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessie niet gevonden' });
  const membership = getTeamMembership(req.user.id, session.team_id);
  if (!membership || membership.membership_type !== 'coach') {
    return res.status(403).json({ ok: false, error: 'Alleen coaches kunnen aanwezigheid bijwerken' });
  }
  const { user_id, status } = req.body;
  if (!user_id || !['present', 'absent', 'unknown'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'Ongeldige parameters' });
  }
  db.prepare(`
    INSERT INTO training_attendance (session_id, user_id, status, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `).run(session.id, user_id, status);
  res.json({ ok: true });
});

// ─── Club teams list (for planner dropdowns) ────────────────────────────────

router.get('/teams', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId) return res.status(400).json({ ok: false, error: 'Geen club gekoppeld' });
  const teams = db.prepare('SELECT id, display_name, trainings_per_week, min_training_minutes, max_training_minutes FROM teams WHERE club_id = ? ORDER BY display_name').all(clubId);
  res.json({ ok: true, teams });
});

router.patch('/teams/:id', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND club_id = ?').get(req.params.id, clubId);
  if (!team) return res.status(404).json({ ok: false, error: 'Team niet gevonden' });

  const { trainings_per_week, min_training_minutes, max_training_minutes } = req.body;
  const updates = [];
  const params = [];
  if (trainings_per_week != null && [0, 1, 2, 3, 4, 5].includes(trainings_per_week)) {
    updates.push('trainings_per_week = ?'); params.push(trainings_per_week);
  }
  if (min_training_minutes != null && min_training_minutes >= 60 && min_training_minutes <= 180) {
    updates.push('min_training_minutes = ?'); params.push(min_training_minutes);
  }
  if (max_training_minutes != null && max_training_minutes >= 60 && max_training_minutes <= 180) {
    updates.push('max_training_minutes = ?'); params.push(max_training_minutes);
  }
  if (!updates.length) return res.status(400).json({ ok: false, error: 'Geen geldige velden' });
  params.push(req.params.id, clubId);
  db.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ? AND club_id = ?`).run(...params);
  res.json({ ok: true });
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

  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?');
  const venueExists = db.prepare('SELECT 1 FROM training_venues WHERE id = ?');
  const valid = entries.filter(e => teamExists.get(e.team_id) && venueExists.get(e.venue_id));
  const skipped = entries.length - valid.length;

  const activate = db.transaction(() => {
    db.prepare('UPDATE training_snapshots SET is_active = 0 WHERE club_id = ?').run(clubId);
    db.prepare('UPDATE training_snapshots SET is_active = 1 WHERE id = ?').run(snap.id);
    db.prepare('DELETE FROM training_defaults WHERE club_id = ?').run(clubId);
    const ins = db.prepare(
      'INSERT INTO training_defaults (club_id, team_id, venue_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const e of valid) {
      ins.run(clubId, e.team_id, e.venue_id, e.day_of_week, e.start_time, e.end_time);
    }
  });
  activate();

  res.json({ ok: true, activated: snap.name, loaded: valid.length, skipped });
});

router.patch('/snapshots/:id', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  db.prepare('UPDATE training_snapshots SET name = ? WHERE id = ? AND club_id = ?').run(name, req.params.id, clubId);
  res.json({ ok: true, name });
});

router.delete('/snapshots/:id', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  db.prepare('DELETE FROM training_snapshots WHERE id = ? AND club_id = ?').run(req.params.id, clubId);
  res.json({ ok: true });
});

// ─── JSON import (authenticated, from planner UI) ──────────────────────

router.post('/import', verifyToken, (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const { name, schedule } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Naam is verplicht' });
  if (!Array.isArray(schedule) || !schedule.length) {
    return res.status(400).json({ ok: false, error: 'Schedule array is verplicht' });
  }

  const dayMap = { maandag: 0, dinsdag: 1, woensdag: 2, donderdag: 3, vrijdag: 4, zaterdag: 5, zondag: 6 };
  const teamStmt = db.prepare('SELECT id FROM teams WHERE club_id = ? AND display_name = ?');
  const venueStmt = db.prepare(`
    SELECT v.id FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? AND v.name = ? AND l.name = ?
  `);

  const errors = [];
  const resolved = [];

  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const dow = typeof entry.day_of_week === 'number'
      ? entry.day_of_week
      : (typeof entry.day === 'string' ? dayMap[entry.day.toLowerCase()] : undefined);

    if (dow === undefined || dow < 0 || dow > 6) { errors.push({ index: i, error: `Ongeldige dag: ${entry.day || entry.day_of_week}` }); continue; }
    if (!entry.start_time || !entry.end_time) { errors.push({ index: i, error: 'start_time of end_time ontbreekt' }); continue; }

    const team = teamStmt.get(clubId, entry.team);
    if (!team) { errors.push({ index: i, error: `Team niet gevonden: "${entry.team}"` }); continue; }

    const venue = venueStmt.get(clubId, entry.venue, entry.location);
    if (!venue) { errors.push({ index: i, error: `Veld niet gevonden: "${entry.venue}" op "${entry.location}"` }); continue; }

    resolved.push({ team_id: team.id, venue_id: venue.id, day_of_week: dow, start_time: entry.start_time, end_time: entry.end_time });
  }

  if (!resolved.length) {
    return res.status(400).json({ ok: false, error: 'Geen geldige entries', errors });
  }

  const data = JSON.stringify(resolved);
  const result = db.prepare(
    'INSERT INTO training_snapshots (club_id, name, data, is_active) VALUES (?, ?, ?, 0)'
  ).run(clubId, name.trim(), data);

  res.status(201).json({
    ok: true,
    snapshot: { id: result.lastInsertRowid, name: name.trim(), entries: resolved.length },
    errors: errors.length ? errors : undefined,
  });
});

// ─── AI optimization prompt + webhook proxy ─────────────────────────────
// Systeemprompts: server/config/training-planner-ai-prompts.json + data/training-planner-ai-prompts.json
// Zie server/lib/training-ai-prompts.js

function buildAiUserMessage(mode, extraMessage) {
  const modeLabel = { new: 'VOLLEDIG NIEUW', complete: 'AANVULLEN', optimize: 'OPTIMALISEREN' }[mode] || 'AANVULLEN';
  let msg = `MODUS: ${modeLabel}

De trainingsplanning staat in het "training" veld van de webhook data.

`;
  if (extraMessage) {
    msg += `══ EXTRA OPDRACHT ══\n${extraMessage}\n\n`;
  }
  msg += `══ STAPPEN ══
1. Haal EERST alle teams, spelers en coaches op via de tool — VERPLICHT
2. Voer fase 2 t/m 4 uit zoals beschreven in het system prompt
3. Antwoord UITSLUITEND met een JSON object. Begin met { en eindig met }.`;
  return msg;
}

router.post('/ai-optimize', verifyToken, async (req, res) => {
  const clubId = getClubId(req.user.id);
  if (!clubId || !canEditTraining(req.user.id, clubId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const webhookUrl = process.env.N8N_TRAINING_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(503).json({ ok: false, error: 'N8N webhook URL is niet geconfigureerd (N8N_TRAINING_WEBHOOK_URL)' });
  }

  const club = db.prepare('SELECT id, name, nevobo_code FROM clubs WHERE id = ?').get(clubId);
  if (!club) return res.status(400).json({ ok: false, error: 'Club niet gevonden' });

  // Assemble teams data
  const teamRows = db.prepare('SELECT id, display_name, nevobo_team_type, nevobo_number, trainings_per_week, min_training_minutes, max_training_minutes FROM teams WHERE club_id = ? ORDER BY display_name').all(clubId);
  const memberStmt = db.prepare(`
    SELECT u.id, u.name, u.email, u.shirt_number, u.position, tm.membership_type
    FROM team_memberships tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND tm.membership_type IN ('player', 'coach')
    ORDER BY tm.membership_type, u.name
  `);
  const teamsPayload = {
    club: { name: club.name, nevobo_code: club.nevobo_code },
    teams: teamRows.map(t => ({
      id: t.id, name: t.display_name, type: t.nevobo_team_type, number: t.nevobo_number, trainings_per_week: t.trainings_per_week,
      members: memberStmt.all(t.id).map(m => ({ id: m.id, name: m.name, email: m.email, shirt_number: m.shirt_number, position: m.position, role: m.membership_type })),
    })),
  };

  // Assemble training data
  const dayNames = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
  const locations = db.prepare('SELECT id, name, nevobo_venue_name FROM training_locations WHERE club_id = ? ORDER BY name').all(clubId);
  const venues = db.prepare(`
    SELECT v.id, v.name, v.type, l.name AS location_name
    FROM training_venues v JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? ORDER BY l.name, v.name
  `).all(clubId);
  const defaults = db.prepare(`
    SELECT d.day_of_week, d.start_time, d.end_time, t.display_name AS team_name, v.name AS venue_name, l.name AS location_name
    FROM training_defaults d
    JOIN teams t ON t.id = d.team_id JOIN training_venues v ON v.id = d.venue_id JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ? ORDER BY d.day_of_week, d.start_time
  `).all(clubId);

  const trainingPayload = {
    club: { name: club.name, nevobo_code: club.nevobo_code },
    locations: locations.map(l => ({ name: l.name, nevobo_venue_name: l.nevobo_venue_name, is_primary: !!l.nevobo_venue_name })),
    venues: venues.map(v => ({ name: v.name, location: v.location_name, type: v.type })),
    teams: teamRows.map(t => ({ name: t.display_name, trainings_per_week: t.trainings_per_week, min_training_minutes: t.min_training_minutes, max_training_minutes: t.max_training_minutes })),
    schedule: defaults.map(d => ({ day: dayNames[d.day_of_week], day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, team: d.team_name, venue: d.venue_name, location: d.location_name })),
  };

  const mode = ['new', 'complete', 'optimize'].includes(req.body.mode) ? req.body.mode : 'complete';
  const systemPrompt = trainingAiPrompts.getActiveSystemPrompt(mode);
  const userMessage = buildAiUserMessage(mode, req.body.message || '');

  try {
    const response = await dependencyFetch(DEPS.n8n_webhook, webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, userMessage, teams: teamsPayload, training: trainingPayload }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[ai-optimize] Webhook returned ${response.status}:`, text.slice(0, 500));
      return res.status(502).json({ ok: false, error: `N8N webhook fout (HTTP ${response.status}): ${text.slice(0, 300)}` });
    }

    let result;
    const rawText = await response.text();
    console.log('[ai-optimize] Raw webhook response (first 1000 chars):', rawText.slice(0, 1000));
    console.log('[ai-optimize] Raw webhook response length:', rawText.length);
    try {
      result = JSON.parse(rawText);
    } catch (_) {
      console.error('[ai-optimize] Webhook returned non-JSON:', rawText.slice(0, 500));
      return res.status(502).json({ ok: false, error: 'N8N webhook gaf geen geldige JSON terug. Check de N8N workflow output.' });
    }

    console.log('[ai-optimize] Parsed result keys:', Object.keys(result));
    console.log('[ai-optimize] result.schedule is array?', Array.isArray(result.schedule), 'length:', result.schedule?.length);

    // N8N may wrap the response in an array or nested object — unwrap if needed
    if (!result.schedule && Array.isArray(result) && result.length > 0) {
      console.log('[ai-optimize] Result is array, unwrapping first element');
      result = result[0];
    }
    if (!result.schedule && result.output) {
      console.log('[ai-optimize] Result has .output, trying to parse');
      try {
        const inner = typeof result.output === 'string' ? JSON.parse(result.output.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()) : result.output;
        if (inner.schedule) result = inner;
      } catch (_) {}
    }
    if (!result.schedule && result.text) {
      console.log('[ai-optimize] Result has .text, trying to parse');
      try {
        const inner = typeof result.text === 'string' ? JSON.parse(result.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()) : result.text;
        if (inner.schedule) result = inner;
      } catch (_) {}
    }

    if (result.schedule && Array.isArray(result.schedule)) {
      const dayMap = { maandag: 0, dinsdag: 1, woensdag: 2, donderdag: 3, vrijdag: 4, zaterdag: 5, zondag: 6 };
      const teamStmt = db.prepare('SELECT id FROM teams WHERE club_id = ? AND display_name = ?');
      const venueStmt = db.prepare(`
        SELECT v.id FROM training_venues v
        JOIN training_locations l ON l.id = v.location_id
        WHERE v.club_id = ? AND v.name = ? AND l.name = ?
      `);

      const errors = [];
      const resolved = [];

      for (let i = 0; i < result.schedule.length; i++) {
        const entry = result.schedule[i];
        const dow = typeof entry.day_of_week === 'number'
          ? entry.day_of_week
          : (typeof entry.day === 'string' ? dayMap[entry.day.toLowerCase()] : undefined);

        if (dow === undefined || dow < 0 || dow > 6) { errors.push({ index: i, error: `Ongeldige dag: ${entry.day || entry.day_of_week}` }); continue; }
        if (!entry.start_time || !entry.end_time) { errors.push({ index: i, error: 'start_time of end_time ontbreekt' }); continue; }

        const team = teamStmt.get(clubId, entry.team);
        if (!team) { errors.push({ index: i, error: `Team niet gevonden: "${entry.team}"` }); continue; }

        const venue = venueStmt.get(clubId, entry.venue, entry.location);
        if (!venue) { errors.push({ index: i, error: `Veld niet gevonden: "${entry.venue}" op "${entry.location}"` }); continue; }

        resolved.push({ team_id: team.id, venue_id: venue.id, day_of_week: dow, start_time: entry.start_time, end_time: entry.end_time });
      }

      if (resolved.length) {
        const snapName = result.name || `AI-optimalisatie ${new Date().toLocaleDateString('nl-NL')}`;
        const data = JSON.stringify(resolved);
        const snap = db.prepare(
          'INSERT INTO training_snapshots (club_id, name, data, is_active) VALUES (?, ?, ?, 0)'
        ).run(clubId, snapName, data);

        return res.json({
          ok: true,
          advice: result.advice || null,
          snapshot: { id: snap.lastInsertRowid, name: snapName, entries: resolved.length },
          errors: errors.length ? errors : undefined,
        });
      }

      return res.status(400).json({ ok: false, error: 'Geen geldige entries in AI response', errors });
    }

    return res.json({ ok: true, advice: result.advice || JSON.stringify(result), snapshot: null });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ ok: false, error: 'Webhook timeout (120s)' });
    }
    return res.status(502).json({ ok: false, error: `Webhook fout: ${err.message}` });
  }
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
          const r = await dependencyFetch(DEPS.nevobo_match_page, url, { timeout: 5000 });
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
        const r = await dependencyFetch(DEPS.nevobo_match_page, url, { timeout: 5000 });
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
