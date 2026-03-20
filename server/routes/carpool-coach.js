/**
 * Carpool coach / seizoensplanning — aparte router, gemount op /api/carpool/coach
 * (vóór de hoofd-carpool-router), zodat dit pad nooit per ongeluk als :matchId wordt gematcht.
 */
const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken, canManageTeamCarpool, canPlanTeamCarpoolSeason, hasSuperAdmin } = require('../middleware/auth');

const SEATS_PER_CAR_MIN = 2;
const SEATS_PER_CAR_MAX = 8;

function pickDriversFair(poolUserIds, k, teamId) {
  const scored = poolUserIds.map((id) => {
    const row = db.prepare(
      'SELECT drive_count FROM carpool_coach_drive_stats WHERE team_id = ? AND user_id = ?'
    ).get(teamId, id);
    return { id, c: row?.drive_count ?? 0 };
  });
  scored.sort((a, b) => a.c - b.c || Math.random() - 0.5);
  return scored.slice(0, k).map((x) => x.id);
}

function bumpDriveCounts(teamId, userIds) {
  const stmt = db.prepare(`
    INSERT INTO carpool_coach_drive_stats (team_id, user_id, drive_count)
    VALUES (?, ?, 1)
    ON CONFLICT(team_id, user_id) DO UPDATE SET drive_count = drive_count + 1
  `);
  for (const uid of userIds) stmt.run(teamId, uid);
}

// GET /api/carpool/coach/teams
// — teams: alleen waar je coach bent (seizoensplanner)
// — moderation_team_ids: teams waar je liften/boekingen mag beheren (coach + admins)
router.get('/teams', verifyToken, (req, res) => {
  const uid = req.user.id;
  const user = db.prepare('SELECT club_id FROM users WHERE id = ?').get(uid);
  let scopeRows;
  if (hasSuperAdmin(uid)) {
    scopeRows = db.prepare('SELECT id, display_name, club_id FROM teams ORDER BY display_name').all();
  } else if (user?.club_id) {
    scopeRows = db
      .prepare('SELECT id, display_name, club_id FROM teams WHERE club_id = ? ORDER BY display_name')
      .all(user.club_id);
  } else {
    scopeRows = [];
  }
  const moderation_team_ids = scopeRows.filter((t) => canManageTeamCarpool(uid, t.id)).map((t) => t.id);

  const planningRows = db
    .prepare(
      `SELECT DISTINCT t.id, t.display_name, t.club_id
       FROM teams t
       INNER JOIN team_memberships tm ON tm.team_id = t.id
         AND tm.user_id = ?
         AND tm.membership_type = 'coach'
       ORDER BY t.display_name`
    )
    .all(uid);

  const memStmt = db.prepare(`
    SELECT tm.user_id, tm.membership_type, u.name, u.email
    FROM team_memberships tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY u.name
  `);
  res.json({
    ok: true,
    teams: planningRows.map((t) => ({
      id: t.id,
      display_name: t.display_name,
      club_id: t.club_id,
      members: memStmt.all(t.id),
    })),
    moderation_team_ids,
  });
});

// GET /api/carpool/coach/team/:teamId/stats
router.get('/team/:teamId/stats', verifyToken, (req, res) => {
  const teamId = parseInt(req.params.teamId, 10);
  if (!teamId || !canPlanTeamCarpoolSeason(req.user.id, teamId)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }
  const rows = db
    .prepare(
      `SELECT s.user_id, s.drive_count, u.name
       FROM carpool_coach_drive_stats s
       JOIN users u ON u.id = s.user_id
       WHERE s.team_id = ?
       ORDER BY s.drive_count DESC, u.name`
    )
    .all(teamId);
  res.json({ ok: true, stats: rows });
});

// POST /api/carpool/coach/plan-season
router.post('/plan-season', verifyToken, (req, res) => {
  const teamId = parseInt(req.body?.team_id, 10);
  const matchIds = req.body?.match_ids;
  const totalTravelers = parseInt(req.body?.total_travelers, 10);
  const poolUserIds = req.body?.pool_user_ids;
  let seatsPerCar = parseInt(req.body?.seats_per_car, 10) || 4;

  if (!teamId || !canPlanTeamCarpoolSeason(req.user.id, teamId)) {
    return res.status(403).json({ ok: false, error: 'Alleen de teamcoach kan carpool voor dit team plannen' });
  }
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Kies minimaal één wedstrijd' });
  }
  if (!Number.isFinite(totalTravelers) || totalTravelers < 1 || totalTravelers > 200) {
    return res.status(400).json({ ok: false, error: 'Ongeldig aantal meereizenden (1–200)' });
  }
  if (!Array.isArray(poolUserIds) || poolUserIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Kies minimaal één persoon in de chauffeurspool' });
  }
  seatsPerCar = Math.min(SEATS_PER_CAR_MAX, Math.max(SEATS_PER_CAR_MIN, seatsPerCar));

  const uniquePool = [...new Set(poolUserIds.map((x) => parseInt(x, 10)).filter(Boolean))];
  const placeholders = uniquePool.map(() => '?').join(',');
  const validMembers = db
    .prepare(
      `SELECT user_id FROM team_memberships WHERE team_id = ? AND user_id IN (${placeholders})`
    )
    .all(teamId, ...uniquePool);
  if (validMembers.length !== uniquePool.length) {
    return res.status(400).json({ ok: false, error: 'Pool mag alleen teamleden bevatten' });
  }

  const maxPassengerSeats = seatsPerCar - 1;

  const existingOffersStmt = db.prepare(`
    SELECT user_id, seats_available
    FROM carpool_offers
    WHERE match_id = ? AND team_id = ? AND coach_planned = 0
  `);
  const insertOffer = db.prepare(`
    INSERT INTO carpool_offers (match_id, user_id, seats_available, departure_point, departure_time, note, team_id, coach_planned)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, 1)
  `);
  const delPlanned = db.prepare(
    'DELETE FROM carpool_offers WHERE match_id = ? AND team_id = ? AND coach_planned = 1'
  );

  const results = [];
  const seenMid = new Set();

  const runMatch = db.transaction((matchId) => {
    const existingOffers = existingOffersStmt.all(matchId, teamId);
    const existingDriverIds = new Set(existingOffers.map(r => r.user_id));
    const capExisting = existingOffers.reduce((sum, r) => sum + 1 + r.seats_available, 0);

    delPlanned.run(matchId, teamId);

    if (capExisting >= totalTravelers) {
      results.push({ match_id: matchId, drivers: [], cars_added: 0, capacity_existing: capExisting });
      return;
    }

    const shortfall = totalTravelers - capExisting;
    const newK = Math.ceil(shortfall / seatsPerCar);
    const availablePool = uniquePool.filter(id => !existingDriverIds.has(id));

    if (newK > availablePool.length) {
      const err = new Error('NEED_DRIVERS');
      err.needed = newK;
      err.available = availablePool.length;
      err.matchId = matchId;
      throw err;
    }

    const drivers = pickDriversFair(availablePool, newK, teamId);
    bumpDriveCounts(teamId, drivers);
    const note = `Teamcarpool (${totalTravelers} pers., ${seatsPerCar}/auto)`;
    for (const driverId of drivers) {
      insertOffer.run(matchId, driverId, maxPassengerSeats, note, teamId);
    }

    results.push({ match_id: matchId, drivers, cars_added: newK, capacity_existing: capExisting });
  });

  try {
    for (const mid of matchIds) {
      if (typeof mid !== 'string' || !mid.trim()) continue;
      const m = mid.trim();
      if (seenMid.has(m)) continue;
      seenMid.add(m);
      runMatch(m);
    }
  } catch (err) {
    if (err.message === 'NEED_DRIVERS') {
      return res.status(400).json({
        ok: false,
        error: `Te weinig chauffeurs: ${err.needed} auto('s) nodig maar nog ${err.available} beschikbaar in de pool. Vergroot de pool of verlaag het aantal reizigers.`,
      });
    }
    console.error('[carpool coach plan]', err);
    return res.status(500).json({ ok: false, error: 'Plannen mislukt — probeer opnieuw' });
  }

  const totalCarsAdded = results.reduce((s, r) => s + r.cars_added, 0);

  res.json({
    ok: true,
    planned_matches: results.length,
    total_cars_added: totalCarsAdded,
    total_travelers: totalTravelers,
    seats_per_car: seatsPerCar,
    results,
  });
});

// PATCH /api/carpool/coach/offer/:offerId
router.patch('/offer/:offerId', verifyToken, (req, res) => {
  const offer = db.prepare('SELECT * FROM carpool_offers WHERE id = ?').get(req.params.offerId);
  if (!offer) return res.status(404).json({ ok: false, error: 'Aanbod niet gevonden' });
  if (!offer.team_id || !canPlanTeamCarpoolSeason(req.user.id, offer.team_id)) {
    return res.status(403).json({ ok: false, error: 'Alleen de teamcoach kan dit aanbod wijzigen' });
  }

  const { seats_available, departure_point, departure_time, note } = req.body || {};
  const booked = db
    .prepare('SELECT COUNT(*) AS n FROM carpool_bookings WHERE offer_id = ?')
    .get(offer.id).n;
  const nextSeats =
    seats_available !== undefined ? parseInt(seats_available, 10) : offer.seats_available;
  if (Number.isNaN(nextSeats) || nextSeats < booked) {
    return res.status(400).json({
      ok: false,
      error: `Minimaal ${booked} plaatsen (al geboekt)`,
    });
  }

  db.prepare(
    `UPDATE carpool_offers SET
      seats_available = COALESCE(?, seats_available),
      departure_point = COALESCE(?, departure_point),
      departure_time = COALESCE(?, departure_time),
      note = COALESCE(?, note)
    WHERE id = ?`
  ).run(
    seats_available !== undefined ? nextSeats : null,
    departure_point !== undefined ? departure_point : null,
    departure_time !== undefined ? departure_time : null,
    note !== undefined ? note : null,
    offer.id
  );
  const updated = db.prepare('SELECT * FROM carpool_offers WHERE id = ?').get(offer.id);
  res.json({ ok: true, offer: updated });
});

module.exports = router;
