const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const { verifyToken } = require('../middleware/auth');
const { awardBadgeIfNew } = require('./auth');

// Multer storage: save to public/uploads/<year>/<month>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const dir = path.join(__dirname, '../../public/uploads', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg)/;
  cb(null, allowed.test(file.mimetype));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// GET /api/social/feed — personalized feed (follows + own club)
router.get('/feed', verifyToken, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  const posts = db.prepare(`
    SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
           u.level AS author_level, u.club_id AS author_club_id,
           c.name AS club_name, t.display_name AS team_name
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN clubs c ON c.id = p.club_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.user_id = ?
      OR p.club_id = ?
      OR p.club_id IN (
        SELECT followee_id FROM user_follows
        WHERE follower_id = ? AND followee_type = 'club'
      )
      OR p.team_id IN (
        SELECT followee_id FROM user_follows
        WHERE follower_id = ? AND followee_type = 'team'
      )
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, req.user.club_id || -1, req.user.id, req.user.id, limit, offset);

  const enriched = posts.map(post => {
    const media = db.prepare(
      'SELECT * FROM match_media WHERE post_id = ? ORDER BY created_at ASC'
    ).all(post.id);
    return { ...post, media };
  });

  res.json({ ok: true, posts: enriched, limit, offset });
});

// GET /api/social/club/:clubId/feed
router.get('/club/:clubId/feed', (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar, u.level AS author_level,
           t.display_name AS team_name
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.club_id = ?
    ORDER BY p.created_at DESC
    LIMIT 40
  `).all(req.params.clubId);

  const enriched = posts.map(post => {
    const media = db.prepare('SELECT * FROM match_media WHERE post_id = ?').all(post.id);
    return { ...post, media };
  });

  res.json({ ok: true, posts: enriched });
});

// POST /api/social/post — create a text post
router.post('/post', verifyToken, (req, res) => {
  const { body, team_id, match_id } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ ok: false, error: 'Bericht mag niet leeg zijn' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const result = db.prepare(
    'INSERT INTO posts (user_id, club_id, team_id, match_id, type, body) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, user.club_id || null, team_id || null, match_id || null, 'post', body.trim());

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, post });
});

// POST /api/social/upload — upload photos/videos with optional caption
router.post('/upload', verifyToken, upload.array('files', 10), (req, res) => {
  const { match_id, caption, team_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: 'Geen bestanden ontvangen' });
  }

  // Create a parent post
  const postResult = db.prepare(
    'INSERT INTO posts (user_id, club_id, team_id, match_id, type, body) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, user.club_id || null, team_id || null, match_id || null, 'media', caption || null);

  const postId = postResult.lastInsertRowid;

  const mediaItems = req.files.map(file => {
    const isVideo = file.mimetype.startsWith('video/');
    const relativePath = '/uploads/' + file.path.split(/[/\\]public[/\\]uploads[/\\]/)[1].replace(/\\/g, '/');
    const result = db.prepare(
      'INSERT INTO match_media (post_id, user_id, match_id, file_path, file_type, caption) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(postId, req.user.id, match_id || null, relativePath, isVideo ? 'video' : 'image', caption || null);
    return db.prepare('SELECT * FROM match_media WHERE id = ?').get(result.lastInsertRowid);
  });

  // Badge rewards for photos
  const totalPhotos = db.prepare('SELECT COUNT(*) AS n FROM match_media WHERE user_id = ? AND file_type = ?').get(req.user.id, 'image');
  awardBadgeIfNew(req.user.id, 'photo_uploader');
  if (totalPhotos.n >= 5) awardBadgeIfNew(req.user.id, 'five_photos');

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  res.status(201).json({ ok: true, post, media: mediaItems });
});

// GET /api/social/match/:matchId/media — all media for a match (with counts + like status)
router.get('/match/:matchId/media', (req, res) => {
  const userId = req.query.userId ? parseInt(req.query.userId) : null;
  const media = db.prepare(`
    SELECT mm.*, u.name AS uploader_name, u.avatar_url AS uploader_avatar,
      (SELECT COUNT(*) FROM media_views mv WHERE mv.media_id = mm.id) AS view_count,
      (SELECT COUNT(*) FROM media_likes ml WHERE ml.media_id = mm.id) AS like_count,
      (SELECT COUNT(*) FROM media_comments mc WHERE mc.media_id = mm.id) AS comment_count
    FROM match_media mm
    JOIN users u ON u.id = mm.user_id
    WHERE mm.match_id = ?
    ORDER BY mm.created_at DESC
  `).all(req.params.matchId);

  // Add per-user like status
  const enriched = media.map(m => ({
    ...m,
    liked_by_me: userId
      ? !!db.prepare('SELECT 1 FROM media_likes WHERE media_id = ? AND user_id = ?').get(m.id, userId)
      : false,
  }));
  res.json({ ok: true, media: enriched });
});

// POST /api/social/media/:id/view — record a view
router.post('/media/:id/view', (req, res) => {
  const userId = req.body?.userId || null;
  try {
    db.prepare('INSERT INTO media_views (media_id, user_id) VALUES (?, ?)').run(req.params.id, userId);
  } catch (_) {}
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM media_views WHERE media_id = ?').get(req.params.id);
  res.json({ ok: true, view_count: n });
});

// POST /api/social/media/:id/like — toggle like
router.post('/media/:id/like', verifyToken, (req, res) => {
  const mediaId = req.params.id;
  const userId = req.user.id;
  const existing = db.prepare('SELECT id FROM media_likes WHERE media_id = ? AND user_id = ?').get(mediaId, userId);
  if (existing) {
    db.prepare('DELETE FROM media_likes WHERE media_id = ? AND user_id = ?').run(mediaId, userId);
  } else {
    db.prepare('INSERT INTO media_likes (media_id, user_id) VALUES (?, ?)').run(mediaId, userId);
  }
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM media_likes WHERE media_id = ?').get(mediaId);
  res.json({ ok: true, liked: !existing, like_count: n });
});

// GET /api/social/media/:id/comments
router.get('/media/:id/comments', (req, res) => {
  const comments = db.prepare(`
    SELECT mc.*, u.name AS author_name, u.avatar_url AS author_avatar
    FROM media_comments mc
    JOIN users u ON u.id = mc.user_id
    WHERE mc.media_id = ?
    ORDER BY mc.created_at ASC
  `).all(req.params.id);
  res.json({ ok: true, comments });
});

// POST /api/social/media/:id/comments
router.post('/media/:id/comments', verifyToken, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ ok: false, error: 'Reactie mag niet leeg zijn' });
  const result = db.prepare(
    'INSERT INTO media_comments (media_id, user_id, body) VALUES (?, ?, ?)'
  ).run(req.params.id, req.user.id, body.trim());
  const comment = db.prepare(`
    SELECT mc.*, u.name AS author_name, u.avatar_url AS author_avatar
    FROM media_comments mc JOIN users u ON u.id = mc.user_id
    WHERE mc.id = ?
  `).get(result.lastInsertRowid);
  res.json({ ok: true, comment });
});

// DELETE /api/social/media/:id — delete own media item
router.delete('/media/:id', verifyToken, (req, res) => {
  const item = db.prepare('SELECT * FROM match_media WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  if (item.user_id !== req.user.id) return res.status(403).json({ ok: false, error: 'Geen toegang' });

  // Remove file from disk
  try {
    const fullPath = path.join(__dirname, '../../public', item.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (_) {}

  db.prepare('DELETE FROM match_media WHERE id = ?').run(item.id);

  // If the linked post now has no media and no body, remove it too
  if (item.post_id) {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(item.post_id);
    if (post) {
      const remaining = db.prepare('SELECT COUNT(*) AS n FROM match_media WHERE post_id = ?').get(item.post_id);
      if (remaining.n === 0 && !post.body?.trim()) {
        db.prepare('DELETE FROM posts WHERE id = ?').run(item.post_id);
      }
    }
  }

  res.json({ ok: true });
});

// POST /api/social/follow — follow a user/team/club
// For teams, optionally accepts teamName + nevoboCode to auto-create external teams
router.post('/follow', verifyToken, (req, res) => {
  const { followee_type, followee_id, teamName, nevoboCode, clubName } = req.body;
  if (!['user', 'team', 'club'].includes(followee_type)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig follow verzoek' });
  }

  let resolvedId = followee_id;

  // Auto-create an external team record if teamName is provided without a DB id
  if (followee_type === 'team' && !followee_id && teamName) {
    // Find or create the club
    let club = nevoboCode
      ? db.prepare('SELECT * FROM clubs WHERE nevobo_code = ?').get(nevoboCode.toLowerCase())
      : null;

    if (!club && nevoboCode) {
      const r = db.prepare("INSERT OR IGNORE INTO clubs (name, nevobo_code, region) VALUES (?, ?, '')").run(
        clubName || teamName.split(' ').slice(0, 2).join(' '),
        nevoboCode.toLowerCase()
      );
      club = db.prepare('SELECT * FROM clubs WHERE nevobo_code = ?').get(nevoboCode.toLowerCase());
    }

    if (club) {
      let team = db.prepare('SELECT id FROM teams WHERE club_id = ? AND LOWER(display_name) = ?').get(club.id, teamName.toLowerCase());
      if (!team) {
        const r = db.prepare('INSERT INTO teams (club_id, nevobo_team_type, nevobo_number, display_name) VALUES (?, ?, ?, ?)').run(club.id, '', 0, teamName);
        team = { id: r.lastInsertRowid };
      }
      resolvedId = team.id;
    }
  }

  if (!resolvedId) {
    return res.status(400).json({ ok: false, error: 'Kan team niet vinden of aanmaken' });
  }

  try {
    db.prepare(
      'INSERT INTO user_follows (follower_id, followee_type, followee_id) VALUES (?, ?, ?)'
    ).run(req.user.id, followee_type, resolvedId);

    awardBadgeIfNew(req.user.id, 'social_butterfly');

    if (followee_type === 'club') {
      const user = db.prepare('SELECT club_id FROM users WHERE id = ?').get(req.user.id);
      if (user && user.club_id !== parseInt(resolvedId)) {
        awardBadgeIfNew(req.user.id, 'fan');
      }
    }

    res.status(201).json({ ok: true, followee_id: resolvedId });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Al gevolgd' });
    }
    throw err;
  }
});

// DELETE /api/social/follow — unfollow
router.delete('/follow', verifyToken, (req, res) => {
  const { followee_type, followee_id } = req.body;
  db.prepare(
    'DELETE FROM user_follows WHERE follower_id = ? AND followee_type = ? AND followee_id = ?'
  ).run(req.user.id, followee_type, followee_id);
  res.json({ ok: true });
});

// GET /api/social/following — list what current user follows, enriched with names
router.get('/following', verifyToken, (req, res) => {
  const follows = db.prepare(
    'SELECT * FROM user_follows WHERE follower_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  // Enrich each follow with the name of the followed entity
  const enriched = follows.map(f => {
    let followee_name = null;
    try {
      if (f.followee_type === 'team') {
        const t = db.prepare('SELECT display_name FROM teams WHERE id = ?').get(f.followee_id);
        followee_name = t?.display_name || null;
      } else if (f.followee_type === 'club') {
        const c = db.prepare('SELECT name FROM clubs WHERE id = ?').get(f.followee_id);
        followee_name = c?.name || null;
      } else if (f.followee_type === 'user') {
        const u = db.prepare('SELECT name FROM users WHERE id = ?').get(f.followee_id);
        followee_name = u?.name || null;
      }
    } catch (_) {}
    return { ...f, followee_name };
  });

  res.json({ ok: true, follows: enriched });
});

// GET /api/social/followers/:userId — followers of a user
router.get('/followers/:userId', (req, res) => {
  const followers = db.prepare(`
    SELECT uf.*, u.name, u.avatar_url, u.level FROM user_follows uf
    JOIN users u ON u.id = uf.follower_id
    WHERE uf.followee_type = 'user' AND uf.followee_id = ?
    ORDER BY uf.created_at DESC
  `).all(req.params.userId);
  res.json({ ok: true, followers });
});

module.exports = router;
