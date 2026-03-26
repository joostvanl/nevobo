/**
 * Openbare read-only trainingsdata per club (Nevobo-code) en ISO-week.
 * Zelfde resolutie als GET /api/training/week/:isoWeek: afwijkende week indien aanwezig, anders blauwdruk.
 *
 * Optioneel: zet PUBLIC_TRAINING_API_KEY in .env — dan is header X-API-Key, query ?key= of Authorization: Bearer verplicht.
 */
const express = require('express');
const router = express.Router();
const db = require('../db/db');

function resolveWeekForClub(clubId, isoWeek) {
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

  return {
    iso_week: isoWeek,
    is_exception: !!exWeek,
    exception_label: exWeek?.label || null,
    trainings,
    source: exWeek ? 'exception' : 'default',
  };
}

function publicTrainingKeyOk(req) {
  const expected = process.env.PUBLIC_TRAINING_API_KEY;
  if (!expected || !String(expected).trim()) return true;
  const ex = String(expected).trim();
  const q = req.query && (req.query.key || req.query.api_key);
  if (q && String(q).trim() === ex) return true;
  const xk = req.headers['x-api-key'] || req.headers['x-training-api-key'];
  if (xk && String(xk).trim() === ex) return true;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t === ex) return true;
  }
  return false;
}

/**
 * GET /week/:isoWeek?nevobo=<club Nevobo-code>
 * Alias query: club (zelfde betekenis als nevobo)
 */
router.get('/week/:isoWeek', (req, res) => {
  if (!publicTrainingKeyOk(req)) {
    return res.status(401).json({ ok: false, error: 'Ongeldige of ontbrekende API-sleutel' });
  }

  const isoWeek = req.params.isoWeek;
  const nevobo = String(req.query.nevobo || req.query.club || '').trim().toLowerCase();
  if (!nevobo) {
    return res.status(400).json({
      ok: false,
      error: 'Parameter nevobo (Nevobo-code van de club) is verplicht, bijv. ?nevobo=ckl9x7n',
    });
  }

  const club = db.prepare('SELECT id, name, nevobo_code FROM clubs WHERE lower(nevobo_code) = ?').get(nevobo);
  if (!club) {
    return res.status(404).json({ ok: false, error: 'Club niet gevonden' });
  }

  const data = resolveWeekForClub(club.id, isoWeek);
  res.json({
    ok: true,
    club: { id: club.id, name: club.name, nevobo_code: club.nevobo_code },
    ...data,
  });
});

module.exports = router;
