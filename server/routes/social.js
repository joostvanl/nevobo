const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const { verifyToken, optionalToken } = require('../middleware/auth');
const { awardBadgeIfNew } = require('./auth');
const sharp = require('sharp');
const { blurFacesIfNeeded, applyBlurRegions, detectAllFaces, detectFaceAtPoint, checkUploadedPhotoQuality, teamHasAnonymousMembers, getOriginalBackupPath, revertBlur } = require('../services/faceBlur');

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
router.post('/upload', verifyToken, upload.array('files', 10), async (req, res) => {
  const { match_id, caption, team_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: 'Geen bestanden ontvangen' });
  }

  // Normalise team_id — frontend may send the string "undefined" when not set
  const rawTeamId = (team_id && team_id !== 'undefined') ? parseInt(team_id) : null;

  // Resolve effective team scope for anonymisation:
  // 1. Use team_id from request if provided
  // 2. Fall back to the uploading user's own team memberships
  //    (photos are almost always uploaded for one's own team)
  let effectiveTeamId = rawTeamId;
  if (!effectiveTeamId) {
    const userTeams = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(req.user.id);
    const anonTeam  = userTeams.find(t => teamHasAnonymousMembers(t.team_id));
    if (anonTeam) {
      effectiveTeamId = anonTeam.team_id;
    }
  }

  const needsAnonymisation = effectiveTeamId ? teamHasAnonymousMembers(effectiveTeamId) : false;

  if (!needsAnonymisation) {
  }

  // Phase 1: EXIF normalize + (if needed) quality check + face blur per image.
  // qualityFlagsByIndex[i] = warnings array (empty = OK, non-empty = skip blur)
  const qualityFlagsByIndex = req.files.map(() => []);
  const blurRegionsByIndex  = req.files.map(() => null); // stored face regions for re-blur
  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    if (!file.mimetype.startsWith('image/')) continue;
    try {
      const tmpPath = file.path + '.rot.tmp';
      await sharp(file.path).rotate().toFile(tmpPath);
      fs.renameSync(tmpPath, file.path);
    } catch (err) {
      console.error('[upload] EXIF rotation failed, keeping original:', err.message);
    }
    if (!needsAnonymisation) continue; // no anon members → nothing more to do

    try {
      const quality = await checkUploadedPhotoQuality(file.path);
      qualityFlagsByIndex[i] = quality.warnings || [];
      // Store measurements for debug response (keyed by original filename)
      if (quality.measurements) {
        req._qualityDebug = req._qualityDebug || [];
        req._qualityDebug.push({
          file: file.originalname,
          ...quality.measurements,
          thresholds: quality.thresholds,
          passed: quality.warnings.length === 0,
        });
      }
    } catch (err) {
      console.error('[upload] Quality check failed (non-blocking):', err.message);
    }
    if (qualityFlagsByIndex[i].length === 0) {
      try {
        const result = await blurFacesIfNeeded(file.path, effectiveTeamId);
        if (result && result.regions) blurRegionsByIndex[i] = result.regions;
      } catch (err) {
        console.error('[upload] Face blur failed, continuing without blur:', err.message);
      }
    } else {
      // quality too low — skip blur silently
    }
  }

  // Create a parent post — use effectiveTeamId so team_id is never null when blur was applied
  const postResult = db.prepare(
    'INSERT INTO posts (user_id, club_id, team_id, match_id, type, body) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, user.club_id || null, effectiveTeamId || null, match_id || null, 'media', caption || null);

  const postId = postResult.lastInsertRowid;

  const mediaItems = req.files.map((file, i) => {
    const isVideo = file.mimetype.startsWith('video/');
    const relativePath = '/uploads/' + file.path.split(/[/\\]public[/\\]uploads[/\\]/)[1].replace(/\\/g, '/');
    const result = db.prepare(
      'INSERT INTO match_media (post_id, user_id, match_id, file_path, file_type, caption) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(postId, req.user.id, match_id || null, relativePath, isVideo ? 'video' : 'image', caption || null);
    const item = db.prepare('SELECT * FROM match_media WHERE id = ?').get(result.lastInsertRowid);
    // Persist blur regions so re-blur can skip face detection entirely
    if (blurRegionsByIndex[i]) {
      db.prepare('UPDATE match_media SET blur_regions = ? WHERE id = ?')
        .run(JSON.stringify(blurRegionsByIndex[i]), item.id);
      item.blur_regions = JSON.stringify(blurRegionsByIndex[i]);
    }
    item._qualityWarnings = qualityFlagsByIndex[i] || [];
    return item;
  });

  // Badge rewards for photos
  const totalPhotos = db.prepare('SELECT COUNT(*) AS n FROM match_media WHERE user_id = ? AND file_type = ?').get(req.user.id, 'image');
  awardBadgeIfNew(req.user.id, 'photo_uploader');
  if (totalPhotos.n >= 5) awardBadgeIfNew(req.user.id, 'five_photos');

  // Build per-media quality issue list for the frontend
  const qualityIssues = mediaItems
    .filter(m => m._qualityWarnings?.length)
    .map(m => ({ mediaId: m.id, file_path: m.file_path, warnings: m._qualityWarnings }));

  // Strip internal field before sending
  mediaItems.forEach(m => delete m._qualityWarnings);

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  const debugEnabled = (process.env.FACE_BLUR_DEBUG || '').trim() === 'true';
  res.status(201).json({ ok: true, post, media: mediaItems, qualityIssues, qualityDebug: debugEnabled ? (req._qualityDebug || []) : [] });
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

// GET /api/social/my-media — all media uploaded by the current user
router.get('/my-media', verifyToken, (req, res) => {
  const items = db.prepare(`
    SELECT mm.*,
      (SELECT COUNT(*) FROM media_likes ml WHERE ml.media_id = mm.id) AS like_count,
      (SELECT COUNT(*) FROM media_views mv WHERE mv.media_id = mm.id) AS view_count,
      t.display_name AS team_name
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE mm.user_id = ?
    ORDER BY mm.created_at DESC
  `).all(req.user.id);
  res.json({ ok: true, media: items });
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

// GET /api/social/media/:id/has-original — check if a .orig backup exists and if team has anon members
router.get('/media/:id/has-original', verifyToken, (req, res) => {
  const item = db.prepare(`
    SELECT mm.*, p.team_id as post_team_id
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE mm.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });
  const fullPath   = path.join(__dirname, '../../public', item.file_path);
  const hasOriginal = !!getOriginalBackupPath(fullPath);

  // Check if team has anonymous members.
  // If post_team_id is null (frontend sent "undefined"), fall back to uploader's own teams.
  let teamHasAnon = false;
  if (item.post_team_id) {
    teamHasAnon = teamHasAnonymousMembers(item.post_team_id);
  } else {
    const uploaderTeams = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(item.user_id);
    teamHasAnon = uploaderTeams.some(t => teamHasAnonymousMembers(t.team_id));
  }

  // The uploader (or super admin) can always manually blur, regardless of anon settings
  const isSuperAdmin = !!db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'"
  ).get(req.user.id);
  const isUploader = item.user_id === req.user.id || isSuperAdmin;

  res.json({ ok: true, hasOriginal, teamHasAnon, isUploader });
});

// POST /api/social/media/:id/revert-blur — restore original (pre-blur) file
router.post('/media/:id/revert-blur', verifyToken, (req, res) => {
  const item = db.prepare('SELECT * FROM match_media WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  // Only uploader or super-admin may revert
  const isSuperAdmin = db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'"
  ).get(req.user.id);
  if (item.user_id !== req.user.id && !isSuperAdmin) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const fullPath = path.join(__dirname, '../../public', item.file_path);
  const reverted = revertBlur(fullPath);
  if (!reverted) {
    return res.status(404).json({ ok: false, error: 'Geen originele versie beschikbaar (foto is niet geblurd of backup ontbreekt)' });
  }

  res.json({ ok: true });
});

// POST /api/social/media/:id/reblur — re-run face blur on the current file
router.post('/media/:id/reblur', verifyToken, async (req, res) => {
  const item = db.prepare(`
    SELECT mm.*, p.team_id as post_team_id
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE mm.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  const isSuperAdmin = db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'"
  ).get(req.user.id);
  if (item.user_id !== req.user.id && !isSuperAdmin) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const fullPath = path.join(__dirname, '../../public', item.file_path);
  if (!require('fs').existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: 'Bestand niet gevonden' });
  }

  try {
    let blurred = false;
    if (item.blur_regions) {
      // Fast path: we already know which regions to blur — skip all face detection and matching
      const regions = JSON.parse(item.blur_regions);
      const ok = await applyBlurRegions(fullPath, regions);
      blurred = !!ok;
    } else {
      // Fall-back: full face detection + matching (older uploads without stored regions)
      const result = await blurFacesIfNeeded(fullPath, item.post_team_id || null);
      blurred = !!(result && result.blurred);
      if (result && result.regions) {
        db.prepare('UPDATE match_media SET blur_regions = ? WHERE id = ?')
          .run(JSON.stringify(result.regions), item.id);
      }
    }
    res.json({ ok: true, blurred });
  } catch (err) {
    console.error('[reblur] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Blur mislukt: ' + err.message });
  }
});

// GET /api/social/media/:id/detect-faces — detect all face positions for the blur editor
router.get('/media/:id/detect-faces', verifyToken, async (req, res) => {
  const item = db.prepare(`
    SELECT mm.*, p.team_id as post_team_id
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE mm.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  const fs = require('fs');
  const fullPath = path.join(__dirname, '../../public', item.file_path);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: 'Bestand niet gevonden' });
  }

  // Always detect on the original (unblurred) image when available
  const origPath = fullPath + '.orig';
  const basePath = fs.existsSync(origPath) ? origPath : fullPath;

  try {
    const faces      = await detectAllFaces(basePath);
    const blurRegions = item.blur_regions ? JSON.parse(item.blur_regions) : [];
    const debugOverlay = (process.env.FACE_BLUR_DEBUG || '').trim() === 'true';
    res.json({ ok: true, faces, blurRegions, debugOverlay });
  } catch (err) {
    console.error('[detect-faces] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Gezichtsdetectie mislukt: ' + err.message });
  }
});

// POST /api/social/media/:id/toggle-face-blur — blur or unblur a single detected face
router.post('/media/:id/toggle-face-blur', verifyToken, async (req, res) => {
  const item = db.prepare(`
    SELECT mm.*, p.team_id as post_team_id
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE mm.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  const isSuperAdmin = db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'"
  ).get(req.user.id);
  if (item.user_id !== req.user.id && !isSuperAdmin) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  const { faceIndex, style = 'blur' } = req.body;
  if (faceIndex === undefined || faceIndex === null) {
    return res.status(400).json({ ok: false, error: 'faceIndex vereist' });
  }

  const fs = require('fs');
  const fullPath = path.join(__dirname, '../../public', item.file_path);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: 'Bestand niet gevonden' });
  }

  try {
    // Always work from the original to avoid quality degradation across multiple edits
    const origPath = fullPath + '.orig';
    const basePath = fs.existsSync(origPath) ? origPath : fullPath;

    // Detect all faces from the original (same sort order as /detect-faces)
    const faces = await detectAllFaces(basePath);
    if (faceIndex < 0 || faceIndex >= faces.length) {
      return res.status(400).json({ ok: false, error: `Ongeldig gezichtsindex ${faceIndex} (${faces.length} gevonden)` });
    }
    const targetFace = faces[faceIndex];

    // Current blur regions from DB
    let currentRegions = item.blur_regions ? JSON.parse(item.blur_regions) : [];

    // Check if this face is already blurred (centre-proximity match)
    const faceCx   = targetFace.x + targetFace.width  / 2;
    const faceCy   = targetFace.y + targetFace.height / 2;
    const maxDim   = Math.max(targetFace.width, targetFace.height);
    const existIdx = currentRegions.findIndex(r => {
      const rCx = r.x + r.width  / 2;
      const rCy = r.y + r.height / 2;
      return Math.hypot(faceCx - rCx, faceCy - rCy) < maxDim * 0.45;
    });

    let newRegions;
    let action;
    if (existIdx !== -1) {
      // Face is blurred → remove it
      newRegions = currentRegions.filter((_, i) => i !== existIdx);
      action = 'unblurred';
    } else {
      // Face is not blurred → add it with the selected style
      newRegions = [...currentRegions, { ...targetFace, style }];
      action = 'blurred';
    }

    // Restore the original before re-applying (always start clean to avoid stacking)
    revertBlur(fullPath);

    if (newRegions.length > 0) {
      await applyBlurRegions(fullPath, newRegions);
    }
    // If newRegions is empty, revertBlur already restored the clean original — nothing more needed

    // Persist updated regions to DB
    const regionsJson = newRegions.length > 0 ? JSON.stringify(newRegions) : null;
    db.prepare('UPDATE match_media SET blur_regions = ? WHERE id = ?').run(regionsJson, item.id);

    res.json({ ok: true, action, regions: newRegions });
  } catch (err) {
    console.error('[toggle-face-blur] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Bewerking mislukt: ' + err.message });
  }
});

// POST /api/social/media/:id/blur-at-point
// Tolerant face detection at a user-tapped point. Crops around the tap,
// runs detection with low confidence threshold. If a face is found, blur it.
// If not, place a fallback blur region centered on the tap point.
router.post('/media/:id/blur-at-point', verifyToken, async (req, res) => {
  const item = db.prepare(`
    SELECT mm.*, p.team_id as post_team_id
    FROM match_media mm
    LEFT JOIN posts p ON p.id = mm.post_id
    WHERE mm.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Niet gevonden' });

  const isSuperAdmin = db.prepare(
    "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin'"
  ).get(req.user.id);
  if (item.user_id !== req.user.id && !isSuperAdmin) {
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  }

  // tapX, tapY: coordinates in original image pixels
  // imgWidth, imgHeight: full image dimensions (sent by client from naturalWidth/Height)
  // style: blur style to apply
  const { tapX, tapY, imgWidth, imgHeight, style = 'blur' } = req.body;
  if (tapX == null || tapY == null || !imgWidth || !imgHeight) {
    return res.status(400).json({ ok: false, error: 'tapX, tapY, imgWidth en imgHeight zijn verplicht' });
  }

  const fs = require('fs');
  const fullPath = path.join(__dirname, '../../public', item.file_path);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: 'Bestand niet gevonden' });
  }

  try {
    const origPath = fullPath + '.orig';
    const basePath = fs.existsSync(origPath) ? origPath : fullPath;

    // Try tolerant face detection around the tap point
    let region = await detectFaceAtPoint(basePath, tapX, tapY, imgWidth, imgHeight);

    if (!region) {
      // No face found — use a fallback region centered on the tap point.
      // Size: ~8% of the shortest image dimension (typical face size at moderate distance)
      const fallbackSize = Math.round(Math.min(imgWidth, imgHeight) * 0.08);
      region = {
        x:      Math.round(tapX - fallbackSize / 2),
        y:      Math.round(tapY - fallbackSize / 2),
        width:  fallbackSize,
        height: fallbackSize,
        _fallback: true,
      };
    }

    // Check if a very similar region already exists → toggle off instead
    const currentRegions = item.blur_regions ? JSON.parse(item.blur_regions) : [];
    const regionCx = region.x + region.width  / 2;
    const regionCy = region.y + region.height / 2;
    const maxDim   = Math.max(region.width, region.height);
    const existIdx = currentRegions.findIndex(r => {
      const rCx = r.x + r.width  / 2;
      const rCy = r.y + r.height / 2;
      return Math.hypot(regionCx - rCx, regionCy - rCy) < maxDim * 0.5;
    });

    let newRegions;
    let action;
    if (existIdx !== -1) {
      newRegions = currentRegions.filter((_, i) => i !== existIdx);
      action = 'unblurred';
    } else {
      newRegions = [...currentRegions, { ...region, style }];
      action = 'blurred';
    }

    // Restore original then re-apply all regions
    revertBlur(fullPath);
    if (newRegions.length > 0) {
      await applyBlurRegions(fullPath, newRegions);
    }

    const regionsJson = newRegions.length > 0 ? JSON.stringify(newRegions) : null;
    db.prepare('UPDATE match_media SET blur_regions = ? WHERE id = ?').run(regionsJson, item.id);

    res.json({ ok: true, action, region, regions: newRegions, wasFallback: !!(region._fallback) });
  } catch (err) {
    console.error('[blur-at-point] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Bewerking mislukt: ' + err.message });
  }
});

// POST /api/social/follow — follow a user/team/club
// For teams, optionally accepts teamName + nevoboCode to auto-create external teams
router.post('/follow', verifyToken, (req, res) => {
  const { followee_type, followee_id, teamName, nevoboCode, clubName } = req.body;
  if (!['user', 'team', 'club'].includes(followee_type)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig follow verzoek' });
  }

  let resolvedId = followee_id;
  let externalNevoboCode = null; // track if we need to warm the cache

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
      externalNevoboCode = club.nevobo_code;
    }
  } else if (followee_type === 'team' && followee_id) {
    // Following an existing DB team — check if it's an external club
    const teamRow = db.prepare('SELECT c.nevobo_code FROM teams t JOIN clubs c ON c.id = t.club_id WHERE t.id = ?').get(followee_id);
    if (teamRow?.nevobo_code) externalNevoboCode = teamRow.nevobo_code;
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

    // Fire-and-forget: warm the RSS cache for the followed club so the
    // homepage has fresh data on the next load without delay
    if (externalNevoboCode) {
      const { warmClubCache } = require('./nevobo');
      warmClubCache(externalNevoboCode).catch(() => {});
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

// GET /api/social/home-summary — aggregated data for the homepage
router.get('/home-summary', verifyToken, (req, res) => {
  const userId = req.user.id;
  const user   = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });

  // All team IDs the user is a member of
  const memberTeams = db.prepare(`
    SELECT tm.team_id, t.display_name, t.club_id, c.name AS club_name, c.nevobo_code
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    JOIN clubs c ON c.id = t.club_id
    WHERE tm.user_id = ?
  `).all(userId);

  // Team IDs the user follows
  const followedTeamRows = db.prepare(`
    SELECT uf.followee_id AS team_id, t.display_name, t.club_id,
           c.name AS club_name, c.nevobo_code
    FROM user_follows uf
    JOIN teams t ON t.id = uf.followee_id
    JOIN clubs c ON c.id = t.club_id
    WHERE uf.follower_id = ? AND uf.followee_type = 'team'
  `).all(userId);

  // Fire-and-forget: ensure RSS feeds for all followed external clubs are cached.
  // This repairs the case where a club was followed but its feeds were never fetched.
  const ownCodes = new Set(memberTeams.map(t => t.nevobo_code).filter(Boolean));
  const externalCodes = [...new Set(
    followedTeamRows.map(t => t.nevobo_code).filter(c => c && !ownCodes.has(c))
  )];
  if (externalCodes.length > 0) {
    const { warmClubCache } = require('./nevobo');
    for (const code of externalCodes) warmClubCache(code).catch(() => {});
  }

  // Recent media: photos/videos from the user's club or followed teams
  // Posts often have club_id set but team_id=null, so we query by both
  const relevantTeamIds = [
    ...new Set([...memberTeams.map(t => t.team_id), ...followedTeamRows.map(t => t.team_id)])
  ];
  const relevantClubIds = [
    ...new Set([
      user.club_id,
      ...memberTeams.map(t => t.club_id),
      ...followedTeamRows.map(t => t.club_id),
    ].filter(Boolean))
  ];

  let recentMedia = [];
  if (relevantClubIds.length > 0 || relevantTeamIds.length > 0) {
    const teamPlaceholders  = relevantTeamIds.length  > 0 ? relevantTeamIds.map(() => '?').join(',')  : null;
    const clubPlaceholders  = relevantClubIds.length  > 0 ? relevantClubIds.map(() => '?').join(',')  : null;
    const whereClause = [
      teamPlaceholders ? `p.team_id IN (${teamPlaceholders})` : null,
      clubPlaceholders ? `p.club_id IN (${clubPlaceholders})` : null,
    ].filter(Boolean).join(' OR ');
    const args = [...(relevantTeamIds.length > 0 ? relevantTeamIds : []), ...(relevantClubIds.length > 0 ? relevantClubIds : [])];
    recentMedia = db.prepare(`
      SELECT mm.*, u.name AS uploader_name, u.avatar_url AS uploader_avatar,
        (SELECT COUNT(*) FROM media_likes ml WHERE ml.media_id = mm.id) AS like_count,
        (SELECT COUNT(*) FROM media_views mv WHERE mv.media_id = mm.id) AS view_count,
        (SELECT COUNT(*) FROM media_comments mc WHERE mc.media_id = mm.id) AS comment_count,
        (SELECT COUNT(*) FROM media_likes ml2 WHERE ml2.media_id = mm.id AND ml2.user_id = ?) AS liked_by_me,
        COALESCE(
          t.display_name,
          (SELECT t3.display_name FROM posts p3
           JOIN teams t3 ON t3.id = p3.team_id
           WHERE p3.match_id = mm.match_id AND p3.team_id IS NOT NULL
           LIMIT 1)
        ) AS team_name,
        COALESCE(
          c.name,
          (SELECT c3.name FROM posts p3
           JOIN teams t3 ON t3.id = p3.team_id
           JOIN clubs c3 ON c3.id = t3.club_id
           WHERE p3.match_id = mm.match_id AND p3.team_id IS NOT NULL
           LIMIT 1)
        ) AS club_name_media
      FROM match_media mm
      JOIN users u ON u.id = mm.user_id
      LEFT JOIN posts p ON p.id = mm.post_id
      LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN clubs c ON c.id = p.club_id
      WHERE ${whereClause}
      ORDER BY mm.created_at DESC
      LIMIT 10
    `).all(userId, ...args);
  }

  // New followers who started following the current user in the last 30 days
  const newFollowers = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, uf.created_at AS followed_at, c.name AS club_name
    FROM user_follows uf
    JOIN users u ON u.id = uf.follower_id
    LEFT JOIN clubs c ON c.id = u.club_id
    WHERE uf.followee_type = 'user' AND uf.followee_id = ?
      AND uf.created_at >= datetime('now', '-30 days')
    ORDER BY uf.created_at DESC
    LIMIT 5
  `).all(userId);

  res.json({
    ok: true,
    memberTeams,
    followedTeams: followedTeamRows,
    recentMedia,
    newFollowers,
  });
});

// GET /api/social/media-feed — paginated media for reel viewer
router.get('/media-feed', verifyToken, (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ ok: false });

  const memberTeams   = db.prepare(`
    SELECT tm.team_id, t.club_id FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ?
  `).all(userId);
  const followedTeams = db.prepare(`
    SELECT uf.followee_id AS team_id, t.club_id FROM user_follows uf
    JOIN teams t ON t.id = uf.followee_id
    WHERE uf.follower_id = ? AND uf.followee_type = 'team'
  `).all(userId);

  const relevantTeamIds = [...new Set([...memberTeams.map(t => t.team_id), ...followedTeams.map(t => t.team_id)])];
  const relevantClubIds = [...new Set([user.club_id, ...memberTeams.map(t => t.club_id), ...followedTeams.map(t => t.club_id)].filter(Boolean))];

  if (!relevantTeamIds.length && !relevantClubIds.length) return res.json({ ok: true, media: [] });

  const teamPH = relevantTeamIds.length > 0 ? relevantTeamIds.map(() => '?').join(',') : null;
  const clubPH = relevantClubIds.length > 0 ? relevantClubIds.map(() => '?').join(',') : null;
  const whereClause = [
    teamPH ? `p.team_id IN (${teamPH})` : null,
    clubPH ? `p.club_id IN (${clubPH})` : null,
  ].filter(Boolean).join(' OR ');
  const args = [
    ...(relevantTeamIds.length > 0 ? relevantTeamIds : []),
    ...(relevantClubIds.length > 0 ? relevantClubIds : []),
  ];

  const media = db.prepare(`
    SELECT mm.*, u.name AS uploader_name, u.avatar_url AS uploader_avatar,
      (SELECT COUNT(*) FROM media_likes ml  WHERE ml.media_id  = mm.id) AS like_count,
      (SELECT COUNT(*) FROM media_views mv  WHERE mv.media_id  = mm.id) AS view_count,
      (SELECT COUNT(*) FROM media_comments mc WHERE mc.media_id = mm.id) AS comment_count,
      (SELECT COUNT(*) FROM media_likes ml2 WHERE ml2.media_id = mm.id AND ml2.user_id = ?) AS liked_by_me,
      COALESCE(
        t.display_name,
        (SELECT t3.display_name FROM posts p3
         JOIN teams t3 ON t3.id = p3.team_id
         WHERE p3.match_id = mm.match_id AND p3.team_id IS NOT NULL
         LIMIT 1)
      ) AS team_name,
      COALESCE(
        c.name,
        (SELECT c3.name FROM posts p3
         JOIN teams t3 ON t3.id = p3.team_id
         JOIN clubs c3 ON c3.id = t3.club_id
         WHERE p3.match_id = mm.match_id AND p3.team_id IS NOT NULL
         LIMIT 1)
      ) AS club_name_media
    FROM match_media mm
    JOIN users u ON u.id = mm.user_id
    LEFT JOIN posts p ON p.id = mm.post_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN clubs c ON c.id = p.club_id
    WHERE ${whereClause}
    ORDER BY mm.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, ...args, limit, offset);

  res.json({ ok: true, media });
});

// GET /api/social/team-media/:teamId — media for a specific team (public, no auth required)
router.get('/team-media/:teamId', optionalToken, (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);
  const userId = req.user?.id || null;

  // Resolve team display name and club nevobo_code to search feed_cache
  const teamRow = db.prepare(`
    SELECT t.display_name, c.nevobo_code, c.id AS club_id
    FROM teams t JOIN clubs c ON c.id = t.club_id
    WHERE t.id = ?
  `).get(teamId);

  // Collect match_ids from feed_cache where this team played
  const cacheMatchIds = new Set();
  if (teamRow) {
    const teamNameLower = teamRow.display_name.toLowerCase();
    const cacheKeys = db.prepare(
      "SELECT cache_key, data_json FROM feed_cache WHERE cache_key LIKE ? OR cache_key LIKE ?"
    ).all(`schedule:club:${teamRow.nevobo_code}`, `results:club:${teamRow.nevobo_code}`);

    for (const row of cacheKeys) {
      try {
        const data = JSON.parse(row.data_json);
        for (const m of (data.matches || [])) {
          if (!m.match_id) continue;
          const home = (m.home_team || '').toLowerCase();
          const away = (m.away_team || '').toLowerCase();
          if (home.includes(teamNameLower) || away.includes(teamNameLower)) {
            cacheMatchIds.add(m.match_id);
          }
        }
      } catch (_) {}
    }
  }

  const cacheIds = [...cacheMatchIds];
  const cachePH  = cacheIds.length > 0 ? cacheIds.map(() => '?').join(',') : null;

  const whereClause = [
    // Direct link: post explicitly belongs to this team
    'p.team_id = ?',
    // Same match as another post that explicitly belongs to this team
    '(p.team_id = ? AND mm.match_id IS NOT NULL AND mm.match_id IN (SELECT DISTINCT p2.match_id FROM posts p2 WHERE p2.team_id = ? AND p2.match_id IS NOT NULL))',
    // match_ids from feed_cache — only when the post explicitly belongs to this team
    cachePH ? `(p.team_id = ? AND mm.match_id IN (${cachePH}))` : null,
  ].filter(Boolean).join(' OR ');

  const args = [userId, teamId, teamId, teamId, teamId, ...cacheIds, limit, offset];

  const media = db.prepare(`
    SELECT mm.*, u.name AS uploader_name, u.avatar_url AS uploader_avatar,
      (SELECT COUNT(*) FROM media_likes ml  WHERE ml.media_id  = mm.id) AS like_count,
      (SELECT COUNT(*) FROM media_views mv  WHERE mv.media_id  = mm.id) AS view_count,
      (SELECT COUNT(*) FROM media_comments mc WHERE mc.media_id = mm.id) AS comment_count,
      (SELECT COUNT(*) FROM media_likes ml2 WHERE ml2.media_id = mm.id AND ml2.user_id = ?) AS liked_by_me,
      COALESCE(t.display_name, cl.name) AS team_name,
      cl.name AS club_name_media
    FROM match_media mm
    LEFT JOIN users u ON u.id = mm.user_id
    LEFT JOIN posts p ON p.id = mm.post_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN clubs cl ON cl.id = p.club_id
    WHERE ${whereClause}
    ORDER BY mm.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...args);

  res.json({ ok: true, media });
});


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
