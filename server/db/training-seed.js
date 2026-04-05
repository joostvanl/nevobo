/**
 * Seed the training planner tables with the current VTC Woerden schedule.
 * Runs once: skips entirely if training_locations already has rows.
 * Team references use display_name lookups so IDs don't need to match between environments.
 */
module.exports = function seedTraining(db) {
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM training_locations').get();
  if (existing.cnt > 0) return;

  const club = db.prepare("SELECT id FROM clubs WHERE nevobo_code = 'ckl9x7n'").get();
  if (!club) return;
  const C = club.id;

  console.log('[seed] Seeding training schedule...');

  let bpId = db.prepare('SELECT active_training_blueprint_id FROM clubs WHERE id = ?').get(C)?.active_training_blueprint_id;
  if (!bpId) {
    const r = db.prepare('INSERT INTO training_blueprints (club_id, name) VALUES (?, ?)').run(C, 'Standaard');
    bpId = r.lastInsertRowid;
    db.prepare('UPDATE clubs SET active_training_blueprint_id = ? WHERE id = ?').run(bpId, C);
  }

  const insertLoc = db.prepare(
    'INSERT INTO training_locations (club_id, name, nevobo_venue_name, blueprint_id) VALUES (?, ?, ?, ?)'
  );
  const insertVenue = db.prepare('INSERT INTO training_venues (club_id, location_id, name, type, nevobo_field_slug) VALUES (?, ?, ?, ?, ?)');
  const insertDefault = db.prepare(
    'INSERT INTO training_defaults (club_id, blueprint_id, team_id, venue_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertExWeek = db.prepare('INSERT OR IGNORE INTO training_exception_weeks (club_id, iso_week, label) VALUES (?, ?, ?)');
  const insertException = db.prepare('INSERT INTO training_exceptions (club_id, team_id, venue_id, iso_week, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const seed = db.transaction(() => {
    // ── Locations ──────────────────────────────────────────────────────────
    const locThijs = insertLoc.run(C, 'Thijs van der Polshal', 'Thijs van der Polshal', bpId).lastInsertRowid;
    const locEssen = insertLoc.run(C, 'Essenlaan', null, bpId).lastInsertRowid;

    // ── Venues ─────────────────────────────────────────────────────────────
    const v = {};
    v.T1 = insertVenue.run(C, locThijs, 'Veld 1', 'hall', 'veld-1').lastInsertRowid;
    v.T2 = insertVenue.run(C, locThijs, 'Veld 2', 'hall', 'veld-2').lastInsertRowid;
    v.T3 = insertVenue.run(C, locThijs, 'Veld 3', 'hall', 'veld-3').lastInsertRowid;
    v.T4 = insertVenue.run(C, locThijs, 'Veld 4', 'hall', 'veld-4').lastInsertRowid;
    v.E1 = insertVenue.run(C, locEssen, 'Veld 1', 'field', null).lastInsertRowid;
    v.E2 = insertVenue.run(C, locEssen, 'Veld 2', 'field', null).lastInsertRowid;

    const teamStmt = db.prepare('SELECT id FROM teams WHERE club_id = ? AND display_name = ?');
    const t = (name) => {
      const row = teamStmt.get(C, name);
      if (!row) { console.warn(`[seed] Team not found: ${name}`); return null; }
      return row.id;
    };

    // ── Blueprint defaults ─────────────────────────────────────────────────
    const defaults = [
      // Monday — Thijs Veld 1
      [t('VTC Woerden N5 1'),  v.T1, 0, '17:00', '18:00'],
      [t('VTC Woerden JB 1'),  v.T1, 0, '18:00', '19:15'],
      [t('VTC Woerden DS 2'),  v.T1, 0, '19:15', '20:45'],
      [t('VTC Woerden HS 1'),  v.T1, 0, '20:45', '22:30'],
      // Monday — Thijs Veld 2
      [t('VTC Woerden N5 1'),  v.T2, 0, '17:00', '18:00'],
      [t('VTC Woerden MA 1'),  v.T2, 0, '18:00', '19:30'],
      [t('VTC Woerden DS 5'),  v.T2, 0, '19:30', '21:00'],
      [t('VTC Woerden HS 2'),  v.T2, 0, '21:00', '22:30'],
      // Monday — Thijs Veld 3
      [t('VTC Woerden N5 2'),  v.T3, 0, '17:00', '18:15'],
      [t('VTC Woerden MB 3'),  v.T3, 0, '18:15', '19:30'],
      [t('VTC Woerden DS 3'),  v.T3, 0, '19:30', '21:00'],
      [t('VTC Woerden HS 6'),  v.T3, 0, '21:00', '22:30'],
      // Monday — Thijs Veld 4
      [t('VTC Woerden N5 2'),  v.T4, 0, '17:00', '18:15'],
      [t('VTC Woerden MA 2'),  v.T4, 0, '18:15', '19:30'],
      [t('VTC Woerden DS 4'),  v.T4, 0, '19:30', '21:00'],
      [t('VTC Woerden HS 3'),  v.T4, 0, '21:00', '22:30'],
      // Monday — Essenlaan
      [t('VTC Woerden MB 2'),  v.E1, 0, '19:30', '21:00'],

      // Tuesday — Thijs Veld 1
      [t('VTC Woerden MC 3'),  v.T1, 1, '17:45', '19:00'],
      [t('VTC Woerden MB 1'),  v.T1, 1, '19:00', '20:30'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, 1, '20:30', '22:15'],
      // Tuesday — Thijs Veld 2
      [t('VTC Woerden MC 1'),  v.T2, 1, '17:45', '19:15'],
      [t('VTC Woerden DM 1'),  v.T2, 1, '19:15', '20:45'],
      [t('VTC Woerden DR 5'),  v.T2, 1, '20:45', '22:15'],
      // Tuesday — Thijs Veld 3
      [t('VTC Woerden JA 1'),  v.T3, 1, '17:45', '19:15'],
      [t('VTC Woerden DR 3'),  v.T3, 1, '19:15', '20:45'],
      [t('VTC Woerden DR 6'),  v.T3, 1, '20:45', '22:15'],
      // Tuesday — Thijs Veld 4
      [t('VTC Woerden MC 2'),  v.T4, 1, '17:45', '19:15'],
      [t('VTC Woerden DR 4'),  v.T4, 1, '19:15', '20:45'],
      [t('VTC Woerden DR 1'),  v.T4, 1, '20:45', '22:15'],
      // Tuesday — Essenlaan
      [t('VTC Woerden N5 3'),  v.E1, 1, '17:45', '19:00'],
      [t('VTC Woerden MA 3'),  v.E1, 1, '19:00', '20:30'],
      [t('VTC Woerden N5 3'),  v.E2, 1, '17:45', '19:00'],

      // Wednesday — Thijs Veld 1
      [t('VTC Woerden N5 3'),  v.T1, 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T1, 2, '18:15', '19:30'],
      [t('VTC Woerden DS 6'),  v.T1, 2, '19:30', '21:00'],
      [t('VTC Woerden DS 3'),  v.T1, 2, '21:00', '22:30'],
      // Wednesday — Thijs Veld 2
      [t('VTC Woerden N5 3'),  v.T2, 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T2, 2, '18:15', '19:30'],
      [t('VTC Woerden JB 1'),  v.T2, 2, '19:30', '21:00'],
      [t('VTC Woerden HS 5'),  v.T2, 2, '21:00', '22:30'],
      // Wednesday — Thijs Veld 3
      [t('VTC Woerden N5 2'),  v.T3, 2, '17:00', '18:15'],
      [t('VTC Woerden MB 2'),  v.T3, 2, '18:15', '19:30'],
      [t('VTC Woerden MA 2'),  v.T3, 2, '19:30', '21:00'],
      [t('VTC Woerden HS 4'),  v.T3, 2, '21:00', '22:30'],
      // Wednesday — Thijs Veld 4
      [t('VTC Woerden N5 2'),  v.T4, 2, '17:00', '18:15'],
      [t('VTC Woerden MC 4'),  v.T4, 2, '18:15', '19:30'],
      [t('VTC Woerden HS 2'),  v.T4, 2, '19:30', '21:00'],
      [t('VTC Woerden HS 7'),  v.T4, 2, '21:00', '22:30'],

      // Thursday — Thijs Veld 1
      [t('VTC Woerden MC 1'),  v.T1, 3, '17:15', '18:45'],
      [t('VTC Woerden MB 1'),  v.T1, 3, '18:45', '20:15'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, 3, '20:15', '22:15'],
      // Thursday — Thijs Veld 2
      [t('VTC Woerden MC 3'),  v.T2, 3, '17:15', '18:45'],
      [t('VTC Woerden DS 5'),  v.T2, 3, '18:45', '20:15'],
      [t('VTC Woerden DS 2'),  v.T2, 3, '20:15', '22:15'],
      // Thursday — Thijs Veld 3
      [t('VTC Woerden MC 2'),  v.T3, 3, '17:15', '18:45'],
      [t('VTC Woerden MA 1'),  v.T3, 3, '18:45', '20:15'],
      [t('VTC Woerden HS 1'),  v.T3, 3, '20:15', '22:15'],
      // Thursday — Thijs Veld 4
      [t('VTC Woerden MA 3'),  v.T4, 3, '17:15', '18:45'],
      [t('VTC Woerden JA 1'),  v.T4, 3, '18:45', '20:15'],
      // Thursday — Essenlaan
      [t('VTC Woerden MB 3'),  v.E1, 3, '19:00', '20:30'],

      // Friday
      [t('VTC Woerden HR 1'),  v.T3, 4, '20:15', '22:15'],
    ];

    for (const [teamId, venueId, dow, start, end] of defaults) {
      if (teamId) insertDefault.run(C, bpId, teamId, venueId, dow, start, end);
    }

    db.prepare(`
      INSERT INTO training_defaults_published (club_id, blueprint_id, team_id, venue_id, day_of_week, start_time, end_time)
      SELECT club_id, blueprint_id, team_id, venue_id, day_of_week, start_time, end_time
      FROM training_defaults WHERE club_id = ? AND blueprint_id = ?
    `).run(C, bpId);

    // ── Exception weeks ────────────────────────────────────────────────────
    insertExWeek.run(C, '2026-W12', '');
    insertExWeek.run(C, '2026-W15', '');

    const exceptions = [
      // W12 — Monday
      [t('VTC Woerden N5 1'),  v.T1, '2026-W12', 0, '17:00', '18:00'],
      [t('VTC Woerden JB 1'),  v.T1, '2026-W12', 0, '18:00', '19:15'],
      [t('VTC Woerden DS 2'),  v.T1, '2026-W12', 0, '19:15', '20:45'],
      [t('VTC Woerden HS 1'),  v.T1, '2026-W12', 0, '20:45', '22:30'],
      [t('VTC Woerden N5 1'),  v.T2, '2026-W12', 0, '17:00', '18:00'],
      [t('VTC Woerden MA 1'),  v.T2, '2026-W12', 0, '18:00', '19:30'],
      [t('VTC Woerden DS 5'),  v.T2, '2026-W12', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 2'),  v.T2, '2026-W12', 0, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T3, '2026-W12', 0, '17:00', '18:15'],
      [t('VTC Woerden MB 3'),  v.T3, '2026-W12', 0, '18:15', '19:30'],
      [t('VTC Woerden DS 3'),  v.T3, '2026-W12', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 6'),  v.T3, '2026-W12', 0, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T4, '2026-W12', 0, '17:00', '18:15'],
      [t('VTC Woerden MA 2'),  v.T4, '2026-W12', 0, '18:15', '19:30'],
      [t('VTC Woerden DS 4'),  v.T4, '2026-W12', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 3'),  v.T4, '2026-W12', 0, '21:00', '22:30'],
      [t('VTC Woerden MB 2'),  v.E1, '2026-W12', 0, '19:30', '21:00'],
      // W12 — Tuesday
      [t('VTC Woerden MC 3'),  v.T1, '2026-W12', 1, '17:45', '19:00'],
      [t('VTC Woerden MB 1'),  v.T1, '2026-W12', 1, '19:00', '20:30'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, '2026-W12', 1, '20:30', '22:15'],
      [t('VTC Woerden MC 1'),  v.T2, '2026-W12', 1, '17:45', '19:15'],
      [t('VTC Woerden DM 1'),  v.T2, '2026-W12', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 5'),  v.T2, '2026-W12', 1, '20:45', '22:15'],
      [t('VTC Woerden JA 1'),  v.T3, '2026-W12', 1, '17:45', '19:15'],
      [t('VTC Woerden DR 3'),  v.T3, '2026-W12', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 6'),  v.T3, '2026-W12', 1, '20:45', '22:15'],
      [t('VTC Woerden MC 2'),  v.T4, '2026-W12', 1, '17:45', '19:15'],
      [t('VTC Woerden DR 4'),  v.T4, '2026-W12', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 1'),  v.T4, '2026-W12', 1, '20:45', '22:15'],
      [t('VTC Woerden N5 3'),  v.E1, '2026-W12', 1, '17:45', '19:00'],
      [t('VTC Woerden MA 3'),  v.E1, '2026-W12', 1, '19:00', '20:30'],
      [t('VTC Woerden N5 3'),  v.E2, '2026-W12', 1, '17:45', '19:00'],
      // W12 — Wednesday
      [t('VTC Woerden N5 3'),  v.T1, '2026-W12', 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T1, '2026-W12', 2, '18:15', '19:30'],
      [t('VTC Woerden DS 6'),  v.T1, '2026-W12', 2, '19:30', '21:00'],
      [t('VTC Woerden DS 3'),  v.T1, '2026-W12', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 3'),  v.T2, '2026-W12', 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T2, '2026-W12', 2, '18:15', '19:30'],
      [t('VTC Woerden JB 1'),  v.T2, '2026-W12', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 5'),  v.T2, '2026-W12', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T3, '2026-W12', 2, '17:00', '18:15'],
      [t('VTC Woerden MB 2'),  v.T3, '2026-W12', 2, '18:15', '19:30'],
      [t('VTC Woerden MA 2'),  v.T3, '2026-W12', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 4'),  v.T3, '2026-W12', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T4, '2026-W12', 2, '17:00', '18:15'],
      [t('VTC Woerden MC 4'),  v.T4, '2026-W12', 2, '18:15', '19:30'],
      [t('VTC Woerden HS 2'),  v.T4, '2026-W12', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 7'),  v.T4, '2026-W12', 2, '21:00', '22:30'],
      // W12 — Thursday
      [t('VTC Woerden MC 1'),  v.T1, '2026-W12', 3, '17:15', '18:45'],
      [t('VTC Woerden MB 1'),  v.T1, '2026-W12', 3, '18:45', '20:15'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, '2026-W12', 3, '20:15', '22:15'],
      [t('VTC Woerden MC 3'),  v.T2, '2026-W12', 3, '17:15', '18:45'],
      [t('VTC Woerden DS 5'),  v.T2, '2026-W12', 3, '18:45', '20:15'],
      [t('VTC Woerden DS 2'),  v.T2, '2026-W12', 3, '20:15', '22:15'],
      [t('VTC Woerden MC 2'),  v.T3, '2026-W12', 3, '17:15', '18:45'],
      [t('VTC Woerden MA 1'),  v.T3, '2026-W12', 3, '18:45', '20:15'],
      [t('VTC Woerden HS 1'),  v.T3, '2026-W12', 3, '20:15', '22:15'],
      [t('VTC Woerden MA 3'),  v.T4, '2026-W12', 3, '17:15', '18:45'],
      [t('VTC Woerden JA 1'),  v.T4, '2026-W12', 3, '18:45', '20:15'],
      [t('VTC Woerden MB 3'),  v.E1, '2026-W12', 3, '19:00', '20:30'],
      // W12 — Friday
      [t('VTC Woerden HR 1'),  v.T3, '2026-W12', 4, '21:00', '23:00'],

      // W15 — Monday
      [t('VTC Woerden N5 1'),  v.T1, '2026-W15', 0, '17:00', '18:00'],
      [t('VTC Woerden JB 1'),  v.T1, '2026-W15', 0, '18:00', '19:15'],
      [t('VTC Woerden DS 2'),  v.T1, '2026-W15', 0, '19:15', '20:45'],
      [t('VTC Woerden HS 1'),  v.T1, '2026-W15', 0, '20:45', '22:30'],
      [t('VTC Woerden N5 1'),  v.T2, '2026-W15', 0, '17:00', '18:00'],
      [t('VTC Woerden MA 1'),  v.T2, '2026-W15', 0, '18:00', '19:30'],
      [t('VTC Woerden DS 5'),  v.T2, '2026-W15', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 2'),  v.T2, '2026-W15', 0, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T3, '2026-W15', 0, '17:00', '18:15'],
      [t('VTC Woerden MB 3'),  v.T3, '2026-W15', 0, '18:15', '19:30'],
      [t('VTC Woerden DS 3'),  v.T3, '2026-W15', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 6'),  v.T3, '2026-W15', 0, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T4, '2026-W15', 0, '17:00', '18:15'],
      [t('VTC Woerden MA 2'),  v.T4, '2026-W15', 0, '18:15', '19:30'],
      [t('VTC Woerden DS 4'),  v.T4, '2026-W15', 0, '19:30', '21:00'],
      [t('VTC Woerden HS 3'),  v.T4, '2026-W15', 0, '21:00', '22:30'],
      [t('VTC Woerden MB 2'),  v.E1, '2026-W15', 0, '19:30', '21:00'],
      // W15 — Tuesday
      [t('VTC Woerden MC 3'),  v.T1, '2026-W15', 1, '17:45', '19:00'],
      [t('VTC Woerden MB 1'),  v.T1, '2026-W15', 1, '19:00', '20:30'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, '2026-W15', 1, '20:30', '22:15'],
      [t('VTC Woerden MC 1'),  v.T2, '2026-W15', 1, '17:45', '19:15'],
      [t('VTC Woerden DM 1'),  v.T2, '2026-W15', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 5'),  v.T2, '2026-W15', 1, '20:45', '22:15'],
      [t('VTC Woerden JA 1'),  v.T3, '2026-W15', 1, '17:45', '19:15'],
      [t('VTC Woerden DR 3'),  v.T3, '2026-W15', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 6'),  v.T3, '2026-W15', 1, '20:45', '22:15'],
      [t('VTC Woerden MC 2'),  v.T4, '2026-W15', 1, '17:45', '19:15'],
      [t('VTC Woerden DR 4'),  v.T4, '2026-W15', 1, '19:15', '20:45'],
      [t('VTC Woerden DR 1'),  v.T4, '2026-W15', 1, '20:45', '22:15'],
      [t('VTC Woerden N5 3'),  v.E1, '2026-W15', 1, '17:45', '19:00'],
      [t('VTC Woerden MA 3'),  v.E1, '2026-W15', 1, '19:00', '20:30'],
      [t('VTC Woerden N5 3'),  v.E2, '2026-W15', 1, '17:45', '19:00'],
      // W15 — Wednesday
      [t('VTC Woerden N5 3'),  v.T1, '2026-W15', 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T1, '2026-W15', 2, '18:15', '19:30'],
      [t('VTC Woerden DS 6'),  v.T1, '2026-W15', 2, '19:30', '21:00'],
      [t('VTC Woerden DS 3'),  v.T1, '2026-W15', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 3'),  v.T2, '2026-W15', 2, '17:00', '18:15'],
      [t('VTC Woerden N5 1'),  v.T2, '2026-W15', 2, '18:15', '19:30'],
      [t('VTC Woerden JB 1'),  v.T2, '2026-W15', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 5'),  v.T2, '2026-W15', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T3, '2026-W15', 2, '17:00', '18:15'],
      [t('VTC Woerden MB 2'),  v.T3, '2026-W15', 2, '18:15', '19:30'],
      [t('VTC Woerden MA 2'),  v.T3, '2026-W15', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 4'),  v.T3, '2026-W15', 2, '21:00', '22:30'],
      [t('VTC Woerden N5 2'),  v.T4, '2026-W15', 2, '17:00', '18:15'],
      [t('VTC Woerden MC 4'),  v.T4, '2026-W15', 2, '18:15', '19:30'],
      [t('VTC Woerden HS 2'),  v.T4, '2026-W15', 2, '19:30', '21:00'],
      [t('VTC Woerden HS 7'),  v.T4, '2026-W15', 2, '21:00', '22:30'],
      // W15 — Thursday
      [t('VTC Woerden MC 1'),  v.T1, '2026-W15', 3, '17:15', '18:45'],
      [t('VTC Woerden MB 1'),  v.T1, '2026-W15', 3, '18:45', '20:15'],
      [t('Quadrant Bouw VTC Woerden DS 1'), v.T1, '2026-W15', 3, '20:15', '22:15'],
      [t('VTC Woerden MC 3'),  v.T2, '2026-W15', 3, '17:15', '18:45'],
      [t('VTC Woerden DS 5'),  v.T2, '2026-W15', 3, '18:45', '20:15'],
      [t('VTC Woerden DS 2'),  v.T2, '2026-W15', 3, '20:15', '22:15'],
      [t('VTC Woerden MC 2'),  v.T3, '2026-W15', 3, '17:15', '18:45'],
      [t('VTC Woerden MA 1'),  v.T3, '2026-W15', 3, '18:45', '20:15'],
      [t('VTC Woerden HS 1'),  v.T3, '2026-W15', 3, '20:15', '22:15'],
      [t('VTC Woerden MA 3'),  v.T4, '2026-W15', 3, '17:15', '18:45'],
      [t('VTC Woerden JA 1'),  v.T4, '2026-W15', 3, '18:45', '20:15'],
      [t('VTC Woerden MB 3'),  v.E1, '2026-W15', 3, '19:00', '20:30'],
      // W15 — Friday
      [t('VTC Woerden HR 1'),  v.T3, '2026-W15', 4, '20:30', '22:15'],
    ];

    for (const [teamId, venueId, isoWeek, dow, start, end] of exceptions) {
      if (teamId) insertException.run(C, teamId, venueId, isoWeek, dow, start, end);
    }

    const defCount = defaults.filter(d => d[0]).length;
    const exCount = exceptions.filter(e => e[0]).length;
    console.log(`[seed] Training schedule seeded: ${defCount} defaults, ${exCount} exceptions (W12 + W15)`);
  });

  seed();
};
