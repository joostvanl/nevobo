/**
 * Zelfde week-resolutie voor GET /api/training/week en GET /api/public/training/week.
 * - Normaliseert ISO-week (YYYY-Www) zodat 2026-w16 en 2026-W16 hetzelfde zijn.
 * - Zoekt training_exception_weeks case-insensitive (SQLite TEXT is case-sensitive bij =).
 * - Gebruikt de exacte iso_week-kolom uit de DB voor training_exceptions (mengvormen in data).
 * - LEFT JOIN naar team/veld/locatie zodat rijen niet verdwijnen bij verouderde FK’s.
 */

function normalizeIsoWeek(input) {
  const s = String(input ?? '').trim();
  if (!s) return s;
  const m = s.match(/^(\d{4})[\-_][Ww]?(\d{1,2})$/);
  if (!m) return s;
  const y = m[1];
  const w = parseInt(m[2], 10);
  if (w < 1 || w > 53) return s;
  return `${y}-W${String(w).padStart(2, '0')}`;
}

const SELECT_EXCEPTION_TRAININGS = `
  SELECT e.*, t.display_name AS team_name, v.name AS venue_name,
         l.name AS location_name, l.nevobo_venue_name
  FROM training_exceptions e
  LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN training_venues v ON v.id = e.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE e.club_id = ? AND lower(trim(e.iso_week)) = lower(trim(?))
  ORDER BY e.day_of_week, e.start_time
`;

const SELECT_DEFAULT_TRAININGS = `
  SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
         l.name AS location_name, l.nevobo_venue_name
  FROM training_defaults d
  LEFT JOIN teams t ON t.id = d.team_id
  LEFT JOIN training_venues v ON v.id = d.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ?
  ORDER BY d.day_of_week, d.start_time
`;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} clubId
 * @param {string} isoWeekParam — uit route / query
 * @returns {{ iso_week: string, is_exception: boolean, exception_label: string|null, trainings: object[], source: 'exception'|'default' }}
 */
function resolveTrainingWeekForClub(db, clubId, isoWeekParam) {
  const canonical = normalizeIsoWeek(isoWeekParam);

  const exWeek = db.prepare(`
    SELECT * FROM training_exception_weeks
    WHERE club_id = ? AND lower(trim(iso_week)) = lower(trim(?))
  `).get(clubId, canonical || isoWeekParam);

  let trainings;
  let source;
  if (exWeek) {
    trainings = db.prepare(SELECT_EXCEPTION_TRAININGS).all(clubId, exWeek.iso_week);
    source = 'exception';
  } else {
    trainings = db.prepare(SELECT_DEFAULT_TRAININGS).all(clubId);
    source = 'default';
  }

  return {
    iso_week: canonical || String(isoWeekParam).trim(),
    is_exception: !!exWeek,
    exception_label: exWeek?.label || null,
    trainings,
    source,
  };
}

module.exports = {
  normalizeIsoWeek,
  resolveTrainingWeekForClub,
};
