'use strict';

/**
 * Actieve trainingsblauwdruk per club (`clubs.active_training_blueprint_id`): bepaalt welke set
 * je in de planner bewerkt (defaults, snapshots, locaties/velden bij ontbrekende ?blueprint_id).
 * Weekweergave en teampagina gebruiken resolveBlueprintIdForWeek + published/draft — zie training-week-resolve.js.
 */

function getActiveBlueprintIdRaw(db, clubId) {
  const row = db.prepare('SELECT active_training_blueprint_id AS id FROM clubs WHERE id = ?').get(clubId);
  return row?.id ?? null;
}

/**
 * Zorgt dat de club een actieve blueprint heeft (nieuwe clubs na migratie).
 */
function ensureActiveBlueprint(db, clubId) {
  let id = getActiveBlueprintIdRaw(db, clubId);
  if (id) return id;
  const r = db.prepare('INSERT INTO training_blueprints (club_id, name) VALUES (?, ?)').run(clubId, 'Standaard');
  id = r.lastInsertRowid;
  db.prepare('UPDATE clubs SET active_training_blueprint_id = ? WHERE id = ?').run(id, clubId);
  return id;
}

function blueprintBelongsToClub(db, blueprintId, clubId) {
  const row = db.prepare('SELECT 1 FROM training_blueprints WHERE id = ? AND club_id = ?').get(blueprintId, clubId);
  return !!row;
}

function venueBelongsToBlueprint(db, venueId, blueprintId, clubId) {
  const row = db.prepare(`
    SELECT 1 FROM training_venues v
    JOIN training_locations l ON l.id = v.location_id
    WHERE v.id = ? AND v.club_id = ? AND l.blueprint_id = ?
  `).get(venueId, clubId, blueprintId);
  return !!row;
}

function locationBelongsToBlueprint(db, locationId, blueprintId, clubId) {
  const row = db.prepare(`
    SELECT 1 FROM training_locations
    WHERE id = ? AND club_id = ? AND blueprint_id = ?
  `).get(locationId, clubId, blueprintId);
  return !!row;
}

module.exports = {
  getActiveBlueprintIdRaw,
  ensureActiveBlueprint,
  blueprintBelongsToClub,
  venueBelongsToBlueprint,
  locationBelongsToBlueprint,
};
