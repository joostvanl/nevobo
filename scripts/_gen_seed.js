// Generate the seed data arrays from the current database
const db = require('../server/db/db');

const teamMap = new Map();
const teams = db.prepare('SELECT id, display_name FROM teams').all();
for (const t of teams) teamMap.set(t.id, t.display_name);

const venueMap = new Map();
// Map old venue_id to our aliases
const venues = db.prepare('SELECT v.id, v.name, v.location_id, l.name AS loc_name FROM training_venues v JOIN training_locations l ON l.id = v.location_id').all();
for (const v of venues) {
  const prefix = v.loc_name === 'Thijs van der Polshal' ? 'T' : 'E';
  const num = v.name.replace('Veld ', '');
  venueMap.set(v.id, `v.${prefix}${num}`);
}

console.log('// venue alias map:', Object.fromEntries(venueMap));

// Defaults
const defaults = db.prepare('SELECT * FROM training_defaults ORDER BY day_of_week, venue_id, start_time').all();
console.log('\n// ── Defaults ──');
for (const d of defaults) {
  const tn = teamMap.get(d.team_id);
  const vn = venueMap.get(d.venue_id);
  console.log(`      [t('${tn}'), ${vn}, ${d.day_of_week}, '${d.start_time}', '${d.end_time}'],`);
}

// Exceptions
const exceptions = db.prepare('SELECT * FROM training_exceptions ORDER BY iso_week, day_of_week, venue_id, start_time').all();
console.log('\n// ── Exceptions ──');
for (const e of exceptions) {
  const tn = teamMap.get(e.team_id);
  const vn = venueMap.get(e.venue_id);
  console.log(`      [t('${tn}'), ${vn}, '${e.iso_week}', ${e.day_of_week}, '${e.start_time}', '${e.end_time}'],`);
}

// Exception weeks
const weeks = db.prepare('SELECT * FROM training_exception_weeks').all();
console.log('\n// ── Exception weeks ──');
for (const w of weeks) {
  console.log(`    insertExWeek.run(C, '${w.iso_week}', '${w.label || ''}');`);
}
