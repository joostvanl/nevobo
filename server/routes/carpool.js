const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken, optionalToken, canManageTeamCarpool } = require('../middleware/auth');
const { awardBadgeIfNew } = require('./auth');

const memberOfTeamStmt = db.prepare('SELECT 1 FROM team_memberships WHERE user_id = ? AND team_id = ?');
const sharedTeamWithDriverStmt = db.prepare(`
  SELECT 1 FROM team_memberships tm1
  INNER JOIN team_memberships tm2 ON tm1.team_id = tm2.team_id
  WHERE tm1.user_id = ? AND tm2.user_id = ?
`);

/**
 * Carpool-aanbod zichtbaar: eigen lift, lid van het team (teamcarpool), beheerder van dat team,
 * of privé-lift van iemand met wie je een team deelt.
 */
function viewerMaySeeCarpoolOffer(viewerId, offer) {
  if (!viewerId) return false;
  const driverId = offer.user_id;
  const tid = offer.team_id;
  if (driverId === viewerId) return true;
  if (tid != null) {
    if (memberOfTeamStmt.get(viewerId, tid)) return true;
    if (canManageTeamCarpool(viewerId, tid)) return true;
    return false;
  }
  return !!sharedTeamWithDriverStmt.get(driverId, viewerId);
}

// GET /api/carpool/:matchId/summary — gefilterd op teamlidmaatschap (Bearer aanbevolen)
router.get('/:matchId/summary', optionalToken, (req, res) => {
  const matchId = req.params.matchId;
  const viewerId = req.user?.id ?? null;

  const rows = db.prepare(`
    SELECT co.id AS offer_id, co.user_id, co.team_id, co.seats_available, co.departure_time, co.departure_point, co.note,
      u.name AS driver_name, u.avatar_url AS driver_avatar,
      (co.seats_available - (SELECT COUNT(*) FROM carpool_bookings cb WHERE cb.offer_id = co.id)) AS free_seats
    FROM carpool_offers co
    JOIN users u ON u.id = co.user_id
    WHERE co.match_id = ?
    ORDER BY co.created_at ASC
  `).all(matchId);

  const visible = viewerId ? rows.filter((r) => viewerMaySeeCarpoolOffer(viewerId, r)) : [];
  const free_seats = visible.reduce((sum, r) => sum + Math.max(Number(r.free_seats) || 0, 0), 0);

  res.json({
    ok: true,
    offer_count: visible.length,
    free_seats,
    drivers: visible.map((r) => ({
      offer_id: r.offer_id,
      user_id: r.user_id,
      seats_available: r.seats_available,
      departure_time: r.departure_time,
      departure_point: r.departure_point,
      note: r.note,
      driver_name: r.driver_name,
      driver_avatar: r.driver_avatar,
      free_seats: r.free_seats,
    })),
  });
});

// GET /api/carpool/:matchId — get all offers for a match
router.get('/:matchId', verifyToken, (req, res) => {
  const matchId = req.params.matchId;
  let offers = db.prepare(`
    SELECT co.*, u.name AS driver_name, u.avatar_url AS driver_avatar,
      (SELECT COUNT(*) FROM carpool_bookings cb WHERE cb.offer_id = co.id) AS booked_seats
    FROM carpool_offers co
    JOIN users u ON u.id = co.user_id
    WHERE co.match_id = ?
    ORDER BY co.created_at ASC
  `).all(matchId);

  offers = offers.filter((o) => viewerMaySeeCarpoolOffer(req.user.id, o));

  // Attach bookings per offer
  const enriched = offers.map(offer => {
    const bookings = db.prepare(`
      SELECT cb.*, u.name AS passenger_name, u.avatar_url AS passenger_avatar
      FROM carpool_bookings cb
      JOIN users u ON u.id = cb.user_id
      WHERE cb.offer_id = ?
    `).all(offer.id);
    return { ...offer, bookings };
  });

  res.json({ ok: true, offers: enriched });
});

// POST /api/carpool/:matchId/offer — offer a ride
router.post('/:matchId/offer', verifyToken, (req, res) => {
  const { seats_available, departure_point, departure_time, note } = req.body;
  if (!seats_available || seats_available < 1) {
    return res.status(400).json({ ok: false, error: 'Voer het aantal beschikbare plaatsen in' });
  }

  // Enforce 1 offer per user per match
  const existing = db.prepare('SELECT id FROM carpool_offers WHERE match_id = ? AND user_id = ?').get(req.params.matchId, req.user.id);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Je hebt al een lift aangeboden voor deze wedstrijd' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO carpool_offers (match_id, user_id, seats_available, departure_point, departure_time, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.matchId, req.user.id, seats_available, departure_point || null, departure_time || null, note || null);

    awardBadgeIfNew(req.user.id, 'carpool_hero');

    const offer = db.prepare('SELECT * FROM carpool_offers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ok: true, offer });
  } catch (err) {
    throw err;
  }
});

// DELETE /api/carpool/offer/:offerId — eigen aanbod, of coach/teambeheer voor team-carpool
router.delete('/offer/:offerId', verifyToken, (req, res) => {
  const offer = db.prepare('SELECT * FROM carpool_offers WHERE id = ?').get(req.params.offerId);
  if (!offer) return res.status(404).json({ ok: false, error: 'Aanbod niet gevonden' });
  const coachOk =
    offer.team_id && canManageTeamCarpool(req.user.id, offer.team_id);
  if (offer.user_id !== req.user.id && !coachOk) {
    return res.status(403).json({ ok: false, error: 'Geen toestemming' });
  }

  db.prepare('DELETE FROM carpool_offers WHERE id = ?').run(req.params.offerId);
  res.json({ ok: true });
});

// POST /api/carpool/offer/:offerId/book — book a seat
router.post('/offer/:offerId/book', verifyToken, (req, res) => {
  const offer = db.prepare(`
    SELECT co.*,
      (SELECT COUNT(*) FROM carpool_bookings cb WHERE cb.offer_id = co.id) AS booked_seats
    FROM carpool_offers co WHERE co.id = ?
  `).get(req.params.offerId);

  if (!offer) return res.status(404).json({ ok: false, error: 'Aanbod niet gevonden' });
  if (!viewerMaySeeCarpoolOffer(req.user.id, offer)) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot dit aanbod' });
  }
  if (offer.user_id === req.user.id) return res.status(400).json({ ok: false, error: 'Je kunt niet in je eigen auto zitten' });
  if (offer.booked_seats >= offer.seats_available) {
    return res.status(409).json({ ok: false, error: 'Geen plaatsen meer beschikbaar' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO carpool_bookings (offer_id, user_id) VALUES (?, ?)'
    ).run(req.params.offerId, req.user.id);
    const booking = db.prepare('SELECT * FROM carpool_bookings WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ok: true, booking });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Je hebt al een plek geboekt bij dit aanbod' });
    }
    throw err;
  }
});

// DELETE /api/carpool/booking/:bookingId — eigen boeking of coach van team-carpool
router.delete('/booking/:bookingId', verifyToken, (req, res) => {
  const booking = db.prepare('SELECT * FROM carpool_bookings WHERE id = ?').get(req.params.bookingId);
  if (!booking) return res.status(404).json({ ok: false, error: 'Boeking niet gevonden' });
  const offer = db.prepare('SELECT * FROM carpool_offers WHERE id = ?').get(booking.offer_id);
  const coachOk =
    offer?.team_id && canManageTeamCarpool(req.user.id, offer.team_id);
  if (booking.user_id !== req.user.id && !coachOk) {
    return res.status(403).json({ ok: false, error: 'Geen toestemming' });
  }

  db.prepare('DELETE FROM carpool_bookings WHERE id = ?').run(req.params.bookingId);
  res.json({ ok: true });
});

module.exports = router;
