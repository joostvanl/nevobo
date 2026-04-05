const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { ensureActiveBlueprint } = require('../lib/training-blueprint');
const { applyBlueprintTrainingsPerWeek } = require('../lib/training-blueprint-team-settings');

const EXPORT_API_KEY = process.env.EXPORT_API_KEY;

function requireApiKey(req, res, next) {
  if (!EXPORT_API_KEY) return res.status(503).json({ ok: false, error: 'Export API key not configured' });
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== EXPORT_API_KEY) return res.status(401).json({ ok: false, error: 'Invalid API key' });
  next();
}

router.get('/teams', requireApiKey, (req, res) => {
  const clubCode = req.query.club;
  if (!clubCode) return res.status(400).json({ ok: false, error: 'Missing ?club= parameter (nevobo_code)' });

  const club = db.prepare('SELECT id, name, nevobo_code FROM clubs WHERE nevobo_code = ?').get(clubCode);
  if (!club) return res.status(404).json({ ok: false, error: 'Club not found' });

  const teams = db.prepare(`
    SELECT t.id, t.display_name, t.nevobo_team_type, t.nevobo_number, t.trainings_per_week, t.min_training_minutes, t.max_training_minutes
    FROM teams t
    WHERE t.club_id = ?
    ORDER BY t.display_name
  `).all(club.id);

  const memberStmt = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.shirt_number, u.position,
      tm.membership_type
    FROM team_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND tm.membership_type IN ('player', 'coach')
    ORDER BY tm.membership_type, u.name
  `);

  const result = teams.map(t => ({
    id: t.id,
    name: t.display_name,
    type: t.nevobo_team_type,
    number: t.nevobo_number,
    trainings_per_week: t.trainings_per_week,
    min_training_minutes: t.min_training_minutes,
    max_training_minutes: t.max_training_minutes,
    members: memberStmt.all(t.id).map(m => ({
      id: m.id,
      name: m.name,
      email: m.email,
      shirt_number: m.shirt_number,
      position: m.position,
      role: m.membership_type,
    })),
  }));

  res.json({
    ok: true,
    club: { name: club.name, nevobo_code: club.nevobo_code },
    teams: result,
    exported_at: new Date().toISOString(),
  });
});

// ─── Training schedule export ───────────────────────────────────────────────

router.get('/training', requireApiKey, (req, res) => {
  const clubCode = req.query.club;
  if (!clubCode) return res.status(400).json({ ok: false, error: 'Missing ?club= parameter (nevobo_code)' });

  const club = db.prepare('SELECT id, name, nevobo_code FROM clubs WHERE nevobo_code = ?').get(clubCode);
  if (!club) return res.status(404).json({ ok: false, error: 'Club not found' });

  const bpId = ensureActiveBlueprint(db, club.id);

  const locations = db.prepare(`
    SELECT id, name, nevobo_venue_name
    FROM training_locations WHERE club_id = ? AND blueprint_id = ?
    ORDER BY name
  `).all(club.id, bpId);

  const venues = db.prepare(`
    SELECT v.id, v.name, v.type, v.nevobo_field_slug, l.name AS location_name
    FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? AND l.blueprint_id = ?
    ORDER BY l.name, v.name
  `).all(club.id, bpId);

  const teamsRaw = db
    .prepare(
      `SELECT id, display_name, trainings_per_week, min_training_minutes, max_training_minutes FROM teams WHERE club_id = ? ORDER BY display_name`,
    )
    .all(club.id);
  const teams = applyBlueprintTrainingsPerWeek(db, bpId, teamsRaw);

  const scheduleFromPublished = db.prepare(`
    SELECT d.day_of_week, d.start_time, d.end_time,
           t.display_name AS team_name,
           v.name AS venue_name,
           l.name AS location_name
    FROM training_defaults_published d
    JOIN teams t ON t.id = d.team_id
    JOIN training_venues v ON v.id = d.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ? AND d.blueprint_id = ?
    ORDER BY d.day_of_week, d.start_time
  `);
  let defaults = scheduleFromPublished.all(club.id, bpId);
  if (defaults.length === 0) {
    defaults = db.prepare(`
      SELECT d.day_of_week, d.start_time, d.end_time,
             t.display_name AS team_name,
             v.name AS venue_name,
             l.name AS location_name
      FROM training_defaults d
      JOIN teams t ON t.id = d.team_id
      JOIN training_venues v ON v.id = d.venue_id
      JOIN training_locations l ON l.id = v.location_id
      WHERE d.club_id = ? AND d.blueprint_id = ?
      ORDER BY d.day_of_week, d.start_time
    `).all(club.id, bpId);
  }

  const dayNames = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];

  res.json({
    ok: true,
    club: { name: club.name, nevobo_code: club.nevobo_code },
    locations: locations.map(l => ({ name: l.name, nevobo_venue_name: l.nevobo_venue_name })),
    venues: venues.map(v => ({
      name: v.name,
      location: v.location_name,
      type: v.type,
    })),
    teams: teams.map(t => ({ name: t.display_name, trainings_per_week: t.trainings_per_week, min_training_minutes: t.min_training_minutes, max_training_minutes: t.max_training_minutes })),
    schedule: defaults.map(d => ({
      day: dayNames[d.day_of_week],
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
      team: d.team_name,
      venue: d.venue_name,
      location: d.location_name,
    })),
    exported_at: new Date().toISOString(),
  });
});

// ─── Training schedule import (creates a new snapshot) ──────────────────────

router.post('/training', requireApiKey, (req, res) => {
  const clubCode = req.query.club;
  if (!clubCode) return res.status(400).json({ ok: false, error: 'Missing ?club= parameter (nevobo_code)' });

  const club = db.prepare('SELECT id, name, nevobo_code FROM clubs WHERE nevobo_code = ?').get(clubCode);
  if (!club) return res.status(404).json({ ok: false, error: 'Club not found' });

  const bpId = ensureActiveBlueprint(db, club.id);

  const { name, schedule } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ ok: false, error: 'Missing "name" field (snapshot name)' });
  if (!Array.isArray(schedule) || !schedule.length) {
    return res.status(400).json({ ok: false, error: 'Missing or empty "schedule" array' });
  }

  const dayMap = { maandag: 0, dinsdag: 1, woensdag: 2, donderdag: 3, vrijdag: 4, zaterdag: 5, zondag: 6 };

  const teamStmt = db.prepare('SELECT id FROM teams WHERE club_id = ? AND display_name = ?');
  const venueStmt = db.prepare(`
    SELECT v.id FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? AND v.name = ? AND l.name = ? AND l.blueprint_id = ?
  `);

  const errors = [];
  const resolved = [];

  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const dow = typeof entry.day_of_week === 'number'
      ? entry.day_of_week
      : (typeof entry.day === 'string' ? dayMap[entry.day.toLowerCase()] : undefined);

    if (dow === undefined || dow < 0 || dow > 6) {
      errors.push({ index: i, error: `Invalid day: ${entry.day || entry.day_of_week}` });
      continue;
    }
    if (!entry.start_time || !entry.end_time) {
      errors.push({ index: i, error: 'Missing start_time or end_time' });
      continue;
    }

    const team = teamStmt.get(club.id, entry.team);
    if (!team) {
      errors.push({ index: i, error: `Team not found: "${entry.team}"` });
      continue;
    }

    const venue = venueStmt.get(club.id, entry.venue, entry.location, bpId);
    if (!venue) {
      errors.push({ index: i, error: `Venue not found: "${entry.venue}" at "${entry.location}"` });
      continue;
    }

    resolved.push({
      team_id: team.id,
      venue_id: venue.id,
      day_of_week: dow,
      start_time: entry.start_time,
      end_time: entry.end_time,
    });
  }

  if (errors.length && !resolved.length) {
    return res.status(400).json({ ok: false, error: 'All entries failed validation', errors });
  }

  const data = JSON.stringify(resolved);
  const result = db.prepare(
    'INSERT INTO training_snapshots (club_id, name, data, is_active, blueprint_id) VALUES (?, ?, ?, 0, ?)'
  ).run(club.id, name.trim(), data, bpId);

  res.status(201).json({
    ok: true,
    snapshot: {
      id: result.lastInsertRowid,
      name: name.trim(),
      entries: resolved.length,
    },
    errors: errors.length ? errors : undefined,
  });
});

module.exports = router;
