'use strict';

/**
 * Per-blauwdruk override van trainings_per_week (fallback: teams.trainings_per_week = clubstandaard).
 */

function getTrainingsPerWeekOverridesMap(db, blueprintId) {
  const rows = db
    .prepare(
      'SELECT team_id, trainings_per_week FROM training_blueprint_team_settings WHERE blueprint_id = ?',
    )
    .all(blueprintId);
  return new Map(rows.map((r) => [r.team_id, r.trainings_per_week]));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} blueprintId
 * @param {Array<object>} teamRows — rijen uit `teams` met o.a. id, trainings_per_week
 * @returns {Array<object>} Zelfde velden + effective trainings_per_week; extra: trainings_per_week_club_default, has_blueprint_trainings_per_week_override
 */
function applyBlueprintTrainingsPerWeek(db, blueprintId, teamRows) {
  const m = getTrainingsPerWeekOverridesMap(db, blueprintId);
  return teamRows.map((row) => {
    const has = m.has(row.id);
    const eff = has ? m.get(row.id) : row.trainings_per_week;
    return {
      ...row,
      trainings_per_week: eff,
      trainings_per_week_club_default: row.trainings_per_week,
      has_blueprint_trainings_per_week_override: has,
    };
  });
}

module.exports = {
  getTrainingsPerWeekOverridesMap,
  applyBlueprintTrainingsPerWeek,
};
