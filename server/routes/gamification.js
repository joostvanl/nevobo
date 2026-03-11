const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken } = require('../middleware/auth');
const { awardBadgeIfNew, updateUserLevel } = require('./auth');

// GET /api/gamification/badges — all available badges
router.get('/badges', (req, res) => {
  const badges = db.prepare('SELECT * FROM badges ORDER BY sort_order ASC').all();
  res.json({ ok: true, badges });
});

// GET /api/gamification/goals — all goals
router.get('/goals', (req, res) => {
  const goals = db.prepare('SELECT * FROM goals ORDER BY id ASC').all();
  res.json({ ok: true, goals });
});

// GET /api/gamification/my — personal progress for logged-in user
router.get('/my', verifyToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  const badges = db.prepare(`
    SELECT b.*, ub.earned_at FROM badges b
    LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ?
    ORDER BY b.sort_order ASC
  `).all(user.id);

  const goals = db.prepare(`
    SELECT g.*, COALESCE(ug.progress, 0) AS progress, ug.completed_at FROM goals g
    LEFT JOIN user_goals ug ON ug.goal_id = g.id AND ug.user_id = ?
    ORDER BY g.id ASC
  `).all(user.id);

  const currentLevel = db.prepare('SELECT * FROM xp_levels WHERE level = ?').get(user.level);
  const nextLevel = db.prepare('SELECT * FROM xp_levels WHERE xp_required > ? ORDER BY xp_required ASC LIMIT 1').get(user.xp);
  const allLevels = db.prepare('SELECT * FROM xp_levels ORDER BY level ASC').all();

  res.json({
    ok: true,
    xp: user.xp,
    level: user.level,
    currentLevel,
    nextLevel,
    allLevels,
    badges,
    goals,
  });
});

// GET /api/gamification/leaderboard/:clubId
router.get('/leaderboard/:clubId', (req, res) => {
  const users = db.prepare(`
    SELECT id, name, avatar_url, xp, level,
           (SELECT COUNT(*) FROM user_badges WHERE user_id = users.id) AS badge_count
    FROM users WHERE club_id = ?
    ORDER BY xp DESC LIMIT 20
  `).all(req.params.clubId);
  res.json({ ok: true, users });
});

// POST /api/gamification/award-xp — internal: award XP and update goals
router.post('/award-xp', verifyToken, (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ ok: false, error: 'Ongeldig XP bedrag' });

  db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, req.user.id);
  updateUserLevel(req.user.id);

  const user = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, xp: user.xp, level: user.level });
});

// POST /api/gamification/check-badges — check and award automatic badges
router.post('/check-badges', verifyToken, (req, res) => {
  const userId = req.user.id;
  const awarded = [];

  // Count matches attended (via carpool bookings or offers)
  const matchCount = db.prepare(`
    SELECT COUNT(DISTINCT match_id) AS n FROM (
      SELECT co.match_id FROM carpool_offers co WHERE co.user_id = ?
      UNION
      SELECT co.match_id FROM carpool_bookings cb JOIN carpool_offers co ON co.id = cb.offer_id WHERE cb.user_id = ?
    )
  `).get(userId, userId);

  if (matchCount.n >= 1 && awardBadgeIfNew(userId, 'first_match')) awarded.push('first_match');
  if (matchCount.n >= 5 && awardBadgeIfNew(userId, 'five_matches')) awarded.push('five_matches');
  if (matchCount.n >= 10 && awardBadgeIfNew(userId, 'ten_matches')) awarded.push('ten_matches');

  // Photo count
  const photoCount = db.prepare('SELECT COUNT(*) AS n FROM match_media WHERE user_id = ? AND file_type = ?').get(userId, 'image');
  if (photoCount.n >= 1 && awardBadgeIfNew(userId, 'photo_uploader')) awarded.push('photo_uploader');
  if (photoCount.n >= 5 && awardBadgeIfNew(userId, 'five_photos')) awarded.push('five_photos');

  // Follow count
  const followCount = db.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ?').get(userId);
  if (followCount.n >= 5 && awardBadgeIfNew(userId, 'social_butterfly')) awarded.push('social_butterfly');

  const user = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
  res.json({ ok: true, awarded, xp: user.xp, level: user.level });
});

// POST /api/gamification/goal-progress — update a goal's progress
function updateGoalProgress(userId, slug, increment) {
  const goal = db.prepare('SELECT * FROM goals WHERE slug = ?').get(slug);
  if (!goal) return null;

  const existing = db.prepare('SELECT * FROM user_goals WHERE user_id = ? AND goal_id = ?').get(userId, goal.id);

  if (existing && existing.completed_at) return existing; // already done

  if (!existing) {
    db.prepare('INSERT OR IGNORE INTO user_goals (user_id, goal_id, progress) VALUES (?, ?, ?)').run(userId, goal.id, 0);
  }

  const newProgress = Math.min((existing ? existing.progress : 0) + increment, goal.target_value);
  const completed = newProgress >= goal.target_value;

  db.prepare('UPDATE user_goals SET progress = ?, completed_at = ? WHERE user_id = ? AND goal_id = ?')
    .run(newProgress, completed ? new Date().toISOString() : null, userId, goal.id);

  if (completed) {
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(goal.xp_reward, userId);
    updateUserLevel(userId);
    if (goal.badge_id) awardBadgeIfNew(userId, db.prepare('SELECT slug FROM badges WHERE id = ?').get(goal.badge_id)?.slug);
  }

  return db.prepare('SELECT * FROM user_goals WHERE user_id = ? AND goal_id = ?').get(userId, goal.id);
}

router.post('/goal-progress', verifyToken, (req, res) => {
  const { slug, increment } = req.body;
  const result = updateGoalProgress(req.user.id, slug, increment || 1);
  if (!result) return res.status(404).json({ ok: false, error: 'Doel niet gevonden' });
  res.json({ ok: true, goal: result });
});

module.exports = router;
module.exports.updateGoalProgress = updateGoalProgress;
