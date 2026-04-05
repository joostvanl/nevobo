const db = require('../server/db/db');

const clubId = db.prepare("SELECT id FROM clubs WHERE nevobo_code = 'ckl9x7n'").get()?.id;
const dayNames = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];

const defaults = db.prepare(`
  SELECT d.day_of_week, d.start_time, d.end_time,
         t.display_name AS team_name, v.name AS venue_name, l.name AS location_name
  FROM training_defaults_published d
  JOIN teams t ON t.id = d.team_id
  JOIN training_venues v ON v.id = d.venue_id
  JOIN training_locations l ON l.id = v.location_id
  WHERE d.club_id = ?
  ORDER BY d.day_of_week, d.start_time
`).all(clubId);

console.log('Schedule entries:', defaults.length);
console.log('First 3:', JSON.stringify(defaults.slice(0, 3).map(d => ({
  day: dayNames[d.day_of_week],
  start_time: d.start_time,
  end_time: d.end_time,
  team: d.team_name,
  venue: d.venue_name,
  location: d.location_name,
})), null, 2));
