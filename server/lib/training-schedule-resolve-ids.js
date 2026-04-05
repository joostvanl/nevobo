'use strict';

const dayMap = {
  maandag: 0,
  dinsdag: 1,
  woensdag: 2,
  donderdag: 3,
  vrijdag: 4,
  zaterdag: 5,
  zondag: 6,
};

/**
 * Zet rooster-items (team/veld/locatie-namen) om naar team_id + venue_id voor snapshots.
 * @param {import('better-sqlite3').Database} db
 * @param {number} clubId
 * @param {number} bpId
 * @param {Array<{team:string, venue:string, location:string, day_of_week?:number, day?:string, start_time:string, end_time:string}>} schedule
 * @returns {{ resolved: Array<{team_id:number, venue_id:number, day_of_week:number, start_time:string, end_time:string}>, errors: Array<{index:number, error:string}> }}
 */
function resolveScheduleEntriesToIds(db, clubId, bpId, schedule) {
  const teamStmt = db.prepare('SELECT id FROM teams WHERE club_id = ? AND display_name = ?');
  const venueStmt = db.prepare(`
    SELECT v.id FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? AND v.name = ? AND l.name = ? AND l.blueprint_id = ?
  `);

  const errors = [];
  const resolved = [];

  if (!Array.isArray(schedule)) {
    return { resolved: [], errors: [{ index: -1, error: 'schedule is geen array' }] };
  }

  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const dow =
      typeof entry.day_of_week === 'number'
        ? entry.day_of_week
        : typeof entry.day === 'string'
          ? dayMap[entry.day.toLowerCase()]
          : undefined;

    if (dow === undefined || dow < 0 || dow > 6) {
      errors.push({ index: i, error: `Ongeldige dag: ${entry.day || entry.day_of_week}` });
      continue;
    }
    if (!entry.start_time || !entry.end_time) {
      errors.push({ index: i, error: 'start_time of end_time ontbreekt' });
      continue;
    }

    const team = teamStmt.get(clubId, entry.team);
    if (!team) {
      errors.push({ index: i, error: `Team niet gevonden: "${entry.team}"` });
      continue;
    }

    const venue = venueStmt.get(clubId, entry.venue, entry.location, bpId);
    if (!venue) {
      errors.push({ index: i, error: `Veld niet gevonden: "${entry.venue}" op "${entry.location}"` });
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

  return { resolved, errors };
}

module.exports = { resolveScheduleEntriesToIds, dayMap };
