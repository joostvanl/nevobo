const { ensureActiveBlueprint } = require('./training-blueprint');

/**
 * Bepaalt welke blauwdruk voor een gegeven ISO-week geldt.
 * - scope 'standard': geldt voor elke week (fallback-basis).
 * - scope 'exceptional': alleen weken die in training_blueprint_weeks staan.
 * Bij meerdere kandidaten wint de hoogste priority.
 * Geen match op afwijkend + geen standaard: fallback naar actieve club-blauwdruk.
 */
function resolveBlueprintIdForWeek(db, clubId, canonicalIsoWeek) {
  const weekKey = String(canonicalIsoWeek ?? '').trim();
  const all = db
    .prepare('SELECT id, name, priority, scope FROM training_blueprints WHERE club_id = ?')
    .all(clubId);
  if (!all.length) return ensureActiveBlueprint(db, clubId);

  const candidates = [];
  const weekStmt = db.prepare(`
    SELECT 1 FROM training_blueprint_weeks
    WHERE blueprint_id = ? AND lower(trim(iso_week)) = lower(trim(?))
  `);

  for (const bp of all) {
    const scope = bp.scope === 'exceptional' ? 'exceptional' : 'standard';
    if (scope === 'standard') {
      candidates.push(bp);
    } else if (weekKey) {
      const hit = weekStmt.get(bp.id, weekKey);
      if (hit) candidates.push(bp);
    }
  }

  if (candidates.length === 0) {
    const standards = all.filter((b) => b.scope !== 'exceptional');
    if (standards.length) {
      standards.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      return standards[0].id;
    }
    return ensureActiveBlueprint(db, clubId);
  }

  candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return candidates[0].id;
}

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
  FROM training_defaults_published d
  LEFT JOIN teams t ON t.id = d.team_id
  LEFT JOIN training_venues v ON v.id = d.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ? AND d.blueprint_id = ?
  ORDER BY d.day_of_week, d.start_time
`;

const SELECT_DEFAULT_TRAININGS_DRAFT = `
  SELECT d.*, t.display_name AS team_name, v.name AS venue_name,
         l.name AS location_name, l.nevobo_venue_name
  FROM training_defaults d
  LEFT JOIN teams t ON t.id = d.team_id
  LEFT JOIN training_venues v ON v.id = d.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ? AND d.blueprint_id = ?
  ORDER BY d.day_of_week, d.start_time
`;

/** Gepubliceerd heeft voorrang; als die set leeg is (nog niet gepubliceerd), val terug op concept. */
function getDefaultTrainingsPublishedOrDraft(db, clubId, blueprintId) {
  const pub = db.prepare(SELECT_DEFAULT_TRAININGS).all(clubId, blueprintId);
  if (pub.length > 0) return pub;
  return db.prepare(SELECT_DEFAULT_TRAININGS_DRAFT).all(clubId, blueprintId);
}

const SELECT_DEFAULT_TRAINING_TUPLES_PUBLISHED = `
  SELECT team_id, venue_id, day_of_week, start_time, end_time
  FROM training_defaults_published WHERE club_id = ? AND blueprint_id = ?
`;

const SELECT_DEFAULT_TRAINING_TUPLES_DRAFT = `
  SELECT team_id, venue_id, day_of_week, start_time, end_time
  FROM training_defaults WHERE club_id = ? AND blueprint_id = ?
`;

function getDefaultTrainingTuplesPublishedOrDraft(db, clubId, blueprintId) {
  const pub = db.prepare(SELECT_DEFAULT_TRAINING_TUPLES_PUBLISHED).all(clubId, blueprintId);
  if (pub.length > 0) return pub;
  return db.prepare(SELECT_DEFAULT_TRAINING_TUPLES_DRAFT).all(clubId, blueprintId);
}

const SELECT_TEAM_SCHEDULE_DEFAULTS_PUBLISHED = `
  SELECT d.*, v.name AS venue_name, l.name AS location_name
  FROM training_defaults_published d
  LEFT JOIN training_venues v ON v.id = d.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ? AND d.blueprint_id = ? AND d.team_id = ?
  ORDER BY d.day_of_week, d.start_time
`;

const SELECT_TEAM_SCHEDULE_DEFAULTS_DRAFT = `
  SELECT d.*, v.name AS venue_name, l.name AS location_name
  FROM training_defaults d
  LEFT JOIN training_venues v ON v.id = d.venue_id
  LEFT JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ? AND d.blueprint_id = ? AND d.team_id = ?
  ORDER BY d.day_of_week, d.start_time
`;

function getTeamScheduleDefaultsPublishedOrDraft(db, clubId, blueprintId, teamId) {
  const pub = db.prepare(SELECT_TEAM_SCHEDULE_DEFAULTS_PUBLISHED).all(clubId, blueprintId, teamId);
  if (pub.length > 0) return pub;
  return db.prepare(SELECT_TEAM_SCHEDULE_DEFAULTS_DRAFT).all(clubId, blueprintId, teamId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} clubId
 * @param {string} isoWeekParam — uit route / query
 * @returns {{ iso_week: string, is_exception: boolean, exception_label: string|null, trainings: object[], source: 'exception'|'default' }}
 */
function resolveTrainingWeekForClub(db, clubId, isoWeekParam) {
  const canonical = normalizeIsoWeek(isoWeekParam);

  const blueprintId = resolveBlueprintIdForWeek(db, clubId, canonical || String(isoWeekParam ?? '').trim());

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
    trainings = getDefaultTrainingsPublishedOrDraft(db, clubId, blueprintId);
    source = 'default';
  }

  const bpRow = db
    .prepare('SELECT id, name, scope, priority FROM training_blueprints WHERE id = ?')
    .get(blueprintId);

  return {
    iso_week: canonical || String(isoWeekParam).trim(),
    is_exception: !!exWeek,
    exception_label: exWeek?.label || null,
    trainings,
    source,
    effective_blueprint: bpRow || null,
  };
}

module.exports = {
  normalizeIsoWeek,
  resolveBlueprintIdForWeek,
  resolveTrainingWeekForClub,
  getDefaultTrainingsPublishedOrDraft,
  getDefaultTrainingTuplesPublishedOrDraft,
  getTeamScheduleDefaultsPublishedOrDraft,
};
