'use strict';

const { applyBlueprintTrainingsPerWeek } = require('./training-blueprint-team-settings');

/**
 * Coach-constraints voor H-08: users met minstens één coach- én één player-lidmaatschap.
 * @returns {Map<number, { coachedTeamIds: Set<number>, playerTeamIds: Set<number> }>}
 */
function buildCoachConstraintsMap(db, clubId) {
  const rows = db
    .prepare(
      `
    SELECT tm.user_id AS user_id, tm.team_id AS team_id, tm.membership_type AS membership_type
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE t.club_id = ? AND tm.membership_type IN ('player', 'coach')
  `,
    )
    .all(clubId);

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, { coached: new Set(), playerTeamIds: new Set() });
    }
    const u = byUser.get(r.user_id);
    if (r.membership_type === 'coach') u.coached.add(r.team_id);
    if (r.membership_type === 'player') u.playerTeamIds.add(r.team_id);
  }

  const coachMap = new Map();
  for (const [uid, u] of byUser) {
    if (u.coached.size && u.playerTeamIds.size) {
      coachMap.set(uid, {
        coachedTeamIds: u.coached,
        playerTeamIds: u.playerTeamIds,
      });
    }
  }
  return coachMap;
}

/**
 * Zelfde shape als AI auto-optimize payload + solver/validator context.
 * @param {{ plannerMode?: 'blueprint'|'week', isoWeek?: string }} opts
 */
function buildAutoSchedulePlannerInputs(db, clubId, bpId, opts = {}) {
  const plannerMode = opts.plannerMode === 'week' ? 'week' : 'blueprint';
  const isoWeek = opts.isoWeek && String(opts.isoWeek).trim() ? String(opts.isoWeek).trim() : undefined;

  const teamRowsRaw = db
    .prepare(
      `SELECT id, display_name, nevobo_team_type, nevobo_number, trainings_per_week, min_training_minutes, max_training_minutes
       FROM teams WHERE club_id = ? AND is_active = 1 ORDER BY display_name`,
    )
    .all(clubId);
  const teamRowsMerged = applyBlueprintTrainingsPerWeek(db, bpId, teamRowsRaw);
  const teamRows = teamRowsMerged.map((t) => ({
    id: t.id,
    display_name: t.display_name,
    nevobo_team_type: t.nevobo_team_type,
    nevobo_number: t.nevobo_number,
    trainings_per_week: t.trainings_per_week,
    min_training_minutes: t.min_training_minutes,
    max_training_minutes: t.max_training_minutes,
  }));

  const locations = db
    .prepare(
      'SELECT id, name, nevobo_venue_name FROM training_locations WHERE club_id = ? AND blueprint_id = ? ORDER BY name',
    )
    .all(clubId, bpId);

  const venues = db
    .prepare(
      `
    SELECT v.id, v.name, v.type, l.name AS location_name
    FROM training_venues v JOIN training_locations l ON l.id = v.location_id
    WHERE v.club_id = ? AND l.blueprint_id = ? ORDER BY l.name, v.name
  `,
    )
    .all(clubId, bpId);

  const defaults = db
    .prepare(
      `
    SELECT d.day_of_week, d.start_time, d.end_time, t.display_name AS team_name, v.name AS venue_name, l.name AS location_name
    FROM training_defaults d
    JOIN teams t ON t.id = d.team_id JOIN training_venues v ON v.id = d.venue_id JOIN training_locations l ON l.id = v.location_id
    WHERE d.club_id = ? AND d.blueprint_id = ? ORDER BY d.day_of_week, d.start_time
  `,
    )
    .all(clubId, bpId);

  const unavailRows = db
    .prepare(
      `
    SELECT u.day_of_week, u.start_time, u.end_time, u.iso_week, u.note,
           v.name AS venue_name, l.name AS location_name
    FROM training_venue_unavailability u
    JOIN training_venues v ON v.id = u.venue_id
    JOIN training_locations l ON l.id = v.location_id
    WHERE u.club_id = ? AND u.blueprint_id = ?
    ORDER BY u.day_of_week, u.start_time, u.id
  `,
    )
    .all(clubId, bpId);

  const venue_unavailability = unavailRows.map((u) => ({
    venue: u.venue_name,
    location: u.location_name,
    day_of_week: u.day_of_week,
    start_time: u.start_time,
    end_time: u.end_time,
    iso_week: u.iso_week && String(u.iso_week).trim() ? String(u.iso_week).trim() : null,
    note: u.note && String(u.note).trim() ? String(u.note).trim() : null,
  }));

  const frozenSchedule = defaults.map((d) => ({
    team: d.team_name,
    venue: d.venue_name,
    location: d.location_name,
    day_of_week: d.day_of_week,
    start_time: d.start_time,
    end_time: d.end_time,
  }));

  const coachConstraints = buildCoachConstraintsMap(db, clubId);

  return {
    teams: teamRows,
    locations,
    venues: venues.map((v) => ({ name: v.name, location: v.location_name, type: v.type })),
    venue_unavailability,
    frozenSchedule,
    coachConstraints,
    plannerMode,
    isoWeek,
  };
}

module.exports = {
  buildCoachConstraintsMap,
  buildAutoSchedulePlannerInputs,
};
