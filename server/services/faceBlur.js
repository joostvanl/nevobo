'use strict';
/**
 * faceBlur service
 *
 * Detects faces in uploaded photos, compares them against the stored
 * face-reference photos of users who opted for anonymous mode, and blurs any
 * matching face regions before the file is used anywhere.
 *
 * Uses face-api.js WASM backend by default (no native compilation needed).
 * Automatically upgrades to tfjs-node when available (faster on Linux/Pi).
 */

const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');
const db    = require('../db/db');
const { isFaceBlurEnabled } = require('../lib/featureSettings');
const metrics = require('../lib/metrics');

const MODELS_PATH       = path.join(__dirname, '../models');
// Euclidean distance threshold for face matching.
// Lower = stricter (frontal only). Higher = more lenient (side angles, different lighting).
// Range: 0.4 (strict) → 0.5 (balanced) → 0.6 (lenient) → 0.7 (very lenient, false positive risk)
const MATCH_THRESHOLD   = parseFloat((process.env.FACE_BLUR_THRESHOLD || '').trim()) || 0.6;
const PIXELATE_BLOCKS   = 8;     // face divided into N×N blocks — lower = bigger/more visible blocks
const BLUR_SIGMA        = 40;    // additional Gaussian blur on top of pixelation
const EXPAND_RATIO      = 0.25;  // expand bounding box 25% each side for better coverage
const MIN_CONFIDENCE    = 0.4;   // raised back to 0.4 for reliable descriptors (was 0.25)

// Reference photo quality thresholds
const REF_MIN_BRIGHTNESS    = 35;   // grayscale mean 0-255; below = too dark
const REF_MAX_BRIGHTNESS    = 220;  // above = overexposed
const REF_MIN_SHARPNESS     = 6;    // Laplacian stdev for reference photos (measured at 640px); below = too blurry
const UPLOAD_MIN_SHARPNESS  = 2;    // Laplacian stdev for match photo uploads (measured at 640px)
const UPLOAD_MAX_GRAIN_RATIO = 3.2; // sharpness(640px)/sharpness(80px); above = too grainy/noisy
                                    // Real edges survive extreme downscale; grain/noise mostly disappears.
                                    // Brick walls & clothing textures disappear at 80px, so they won't inflate this score.
const UPLOAD_MIN_PIXELS     = 200;  // minimum short-side resolution in pixels
const QUALITY_NORM_SIZE     = 640;  // normalise to this max dimension before Laplacian
const QUALITY_GRAIN_SIZE    = 80;   // extreme downscale for grain ratio reference
const REF_MIN_FACE_RATIO    = 0.05; // face width must be ≥ 5 % of image width
const REF_MIN_FACE_CONF     = 0.65; // face detection confidence for reference photos

let modelsLoaded = false;
let faceapi      = null;

/** In-memory descriptor cache: relativePath → Float32Array */
const descriptorCache = new Map();

/* ─── Public: load models (call once at server startup) ──────────────────── */

async function loadModels() {
  if (!isFaceBlurEnabled()) {
    console.log('[faceBlur] Feature disabled — skipping model load');
    return;
  }
  if (modelsLoaded) return;

  // Try tfjs-node first (best performance, available after manual install on Pi)
  let usingNodeBackend = false;
  try {
    require('@tensorflow/tfjs-node');
    faceapi = require('@vladmandic/face-api');
    usingNodeBackend = true;
    console.log('[faceBlur] Backend: tfjs-node (native)');
  } catch (_) {
    // Fall back to bundled WASM build — works on all platforms without compilation
    faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
  }

  if (!usingNodeBackend) {
    // Configure WASM path so Node.js can locate the .wasm binary
    try {
      const wasmPkg  = require('@tensorflow/tfjs-backend-wasm');
      const wasmFile = require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm');
      wasmPkg.setWasmPaths(path.dirname(wasmFile) + path.sep);
    } catch (_) { /* wasm paths already set by bundled build */ }

    await faceapi.tf.setBackend('wasm');
    await faceapi.tf.ready();
    console.log(`[faceBlur] Backend: ${faceapi.tf.getBackend()}`);
  }

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);

  modelsLoaded = true;
  console.log('[faceBlur] Models loaded — ready');
}

/* ─── Public: invalidate descriptor cache entry ─────────────────────────── */

function invalidateCache(faceRefRelativePath) {
  if (faceRefRelativePath) descriptorCache.delete(faceRefRelativePath);
}

/* ─── Internal: image file → TF tensor via sharp (no canvas needed) ─────── */

async function imageToTensor(filePath) {
  const { data, info } = await sharp(filePath)
    .rotate()           // honour EXIF orientation
    .removeAlpha()      // face-api expects RGB (3 channels), not RGBA
    .raw()
    .toBuffer({ resolveWithObject: true });

  return faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
}

/* ─── Public: fast check — does a team have any anonymous members? ──────── */

function teamHasAnonymousMembers(teamId) {
  if (!teamId) return false;
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM face_references fr
    JOIN users u  ON u.id  = fr.user_id
    JOIN team_memberships tm ON tm.user_id = u.id
    WHERE u.anonymous_mode = 1 AND tm.team_id = ?
  `).get(teamId);
  return (row?.n ?? 0) > 0;
}

/* ─── Internal: get descriptors for anonymous users (optionally scoped to team) */
//
// Returns a Map<userId, Float32Array[]>.
// When teamId is provided, only members of that team are considered —
// so a photo for Team A won't blur members of Team B.

async function getAnonymousDescriptors(teamId) {
  const refs = teamId
    ? db.prepare(`
        SELECT fr.id, fr.user_id, fr.file_path
        FROM face_references fr
        JOIN users u ON u.id = fr.user_id
        JOIN team_memberships tm ON tm.user_id = u.id
        WHERE u.anonymous_mode = 1 AND tm.team_id = ?
      `).all(teamId)
    : db.prepare(`
        SELECT fr.id, fr.user_id, fr.file_path
        FROM face_references fr
        JOIN users u ON u.id = fr.user_id
        WHERE u.anonymous_mode = 1
      `).all();

  const userMap = new Map(); // userId → Float32Array[]
  for (const ref of refs) {
    let descriptor = descriptorCache.get(ref.file_path);
    if (!descriptor) {
      const absPath = path.join(__dirname, '../../public', ref.file_path);
      if (!fs.existsSync(absPath)) continue;
      try {
        const tensor    = await imageToTensor(absPath);
        const detection = await faceapi
          .detectSingleFace(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        faceapi.tf.dispose(tensor);
        if (!detection) {
          console.warn(`[faceBlur] No face in reference ${ref.file_path} (user ${ref.user_id})`);
          continue;
        }
        descriptor = detection.descriptor;
        descriptorCache.set(ref.file_path, descriptor);
      } catch (err) {
        console.error(`[faceBlur] Error loading reference ${ref.file_path}:`, err.message);
        continue;
      }
    }
    const list = userMap.get(ref.user_id) || [];
    list.push(descriptor);
    userMap.set(ref.user_id, list);
  }
  return userMap; // Map<userId, Float32Array[]>
}

/* ─── Public: blur anonymous faces in a photo ───────────────────────────── */
//
// teamId (optional) — when provided, only team members who opted for anonymity
// are checked. Photos for teams without any anonymous members are skipped
// entirely without loading models or running detection.

async function blurFacesIfNeeded(absoluteFilePath, teamId) {
  if (!isFaceBlurEnabled() || !modelsLoaded) {
    metrics.recordFaceBlur('skipped_feature_disabled');
    return false;
  }

  // Fast-path: skip when no relevant anonymous users exist
  if (teamId) {
    if (!teamHasAnonymousMembers(teamId)) {
      metrics.recordFaceBlur('skipped_no_anonymous_members');
      return false;
    }
  } else {
    const anonCount = db.prepare(
      'SELECT COUNT(*) AS n FROM face_references fr JOIN users u ON u.id = fr.user_id WHERE u.anonymous_mode = 1'
    ).get();
    if (!anonCount?.n) {
      metrics.recordFaceBlur('skipped_no_anonymous_members');
      return false;
    }
  }

  const userDescriptorMap = await getAnonymousDescriptors(teamId);
  if (!userDescriptorMap.size) {
    metrics.recordFaceBlur('skipped_no_descriptors');
    return false;
  }

  // Detect all faces in the uploaded photo
  const tensor = await imageToTensor(absoluteFilePath);
  let detections;
  try {
    detections = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } finally {
    faceapi.tf.dispose(tensor);
  }

  const fname = path.basename(absoluteFilePath);
  if (!detections || !detections.length) {
    console.log(`[faceBlur] ${fname}: 0 faces detected (team=${teamId ?? 'global'}, threshold: ${MIN_CONFIDENCE})`);
    metrics.recordFaceBlur('no_faces_detected');
    return false;
  }
  console.log(`[faceBlur] ${fname}: ${detections.length} face(s) detected`);

  // Determine which detected faces match an anonymous user.
  // A face is blurred when its distance to ANY reference of ANY anon user is < threshold.
  // Per-user minimum distance is used, so having multiple references only HELPS (better recall,
  // same or better precision — a face must closely resemble at least one reference).
  const toBlur = [];
  for (const det of detections) {
    let bestDist   = Infinity;
    let bestUserId = null;
    for (const [userId, descriptors] of userDescriptorMap) {
      for (const refDesc of descriptors) {
        const d = faceapi.euclideanDistance(Array.from(det.descriptor), Array.from(refDesc));
        if (d < bestDist) { bestDist = d; bestUserId = userId; }
      }
    }
    const matched = bestDist < MATCH_THRESHOLD;
    console.log(`[faceBlur]   face score=${det.detection.score.toFixed(2)} bestDist=${bestDist.toFixed(3)} user=${bestUserId} matched=${matched}`);
    if (matched) toBlur.push(det.detection.box);
  }

  if (!toBlur.length) {
    console.log(`[faceBlur] ${fname}: no faces matched anonymous users (threshold: ${MATCH_THRESHOLD})`);
    metrics.recordFaceBlur('no_anonymous_match');
    return false;
  }

  // Apply blur to the matched regions and return the stored bounding boxes for re-use
  const regions = toBlur.map(b => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  const applied = await applyBlurRegions(absoluteFilePath, regions);
  if (!applied) {
    metrics.recordFaceBlur('blur_apply_failed');
    return false;
  }
  console.log(`[faceBlur] Blurred ${regions.length} face(s) in ${fname} (original saved as .orig)`);
  metrics.recordFaceBlur('blurred');
  return { blurred: true, regions };
}
/* ─── Internal: generate SVG sticker buffer for a given style ────────────── */

function makeStickerSvg(style, w, h) {
  if (style === 'heart') {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${h}">` +
      `<path d="M50 85 C50 85 5 58 5 32 C5 18 16 8 30 8 C39 8 47 14 50 22 ` +
      `C53 14 61 8 70 8 C84 8 95 18 95 32 C95 58 50 85 50 85Z" fill="#e74c3c" opacity="0.92"/>` +
      `</svg>`
    );
  }
  if (style === 'love') {
    // Smiley face with heart-shaped eyes
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${h}">` +
      `<circle cx="50" cy="50" r="48" fill="#f1c40f" stroke="#d4ac0d" stroke-width="2"/>` +
      // Left heart eye
      `<path d="M35 44 C35 44 24 37 24 30 C24 25 28 22 32 22 C33.5 22 35 23.5 35 23.5 C35 23.5 36.5 22 38 22 C42 22 46 25 46 30 C46 37 35 44 35 44Z" fill="#e74c3c"/>` +
      // Right heart eye
      `<path d="M65 44 C65 44 54 37 54 30 C54 25 58 22 62 22 C63.5 22 65 23.5 65 23.5 C65 23.5 66.5 22 68 22 C72 22 76 25 76 30 C76 37 65 44 65 44Z" fill="#e74c3c"/>` +
      // Smile
      `<path d="M28 62 Q50 82 72 62" stroke="#2c3e50" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `</svg>`
    );
  }
  if (style === 'smile') {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${h}">` +
      `<circle cx="50" cy="50" r="48" fill="#f1c40f" stroke="#d4ac0d" stroke-width="2"/>` +
      `<circle cx="35" cy="40" r="7" fill="#2c3e50"/>` +
      `<circle cx="65" cy="40" r="7" fill="#2c3e50"/>` +
      `<path d="M28 60 Q50 80 72 60" stroke="#2c3e50" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `</svg>`
    );
  }
  if (style === 'star') {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${h}">` +
      `<path d="M50 5 L61 38 L96 38 L68 59 L79 91 L50 70 L21 91 L32 59 L4 38 L39 38Z" ` +
      `fill="#f39c12" stroke="#e67e22" stroke-width="2"/>` +
      `</svg>`
    );
  }
  return null;
}

/**
 * Applies per-region effects to the given bounding-box regions.
 * Supports styles: 'blur' (default), 'pixel', 'heart', 'love', 'smile', 'star'.
 * Saves a .orig backup before overwriting. Returns true on success.
 * @param {string} absoluteFilePath
 * @param {Array<{x,y,width,height,style?}>} regions — in EXIF-rotated pixel space
 */
async function applyBlurRegions(absoluteFilePath, regions) {
  const normPath = absoluteFilePath + '.norm.tmp';
  await sharp(absoluteFilePath).rotate().toFile(normPath);

  const meta = await sharp(normPath).metadata();
  const imgW  = meta.width;
  const imgH  = meta.height;

  const composites = await Promise.all(
    regions.map(async (box) => {
      const padX = Math.round(box.width  * EXPAND_RATIO);
      const padY = Math.round(box.height * EXPAND_RATIO);
      const left = Math.max(0, Math.floor(box.x)      - padX);
      const top  = Math.max(0, Math.floor(box.y)      - padY);
      const w    = Math.min(Math.ceil(box.width)  + padX * 2, imgW - left);
      const h    = Math.min(Math.ceil(box.height) + padY * 2, imgH - top);

      if (w <= 0 || h <= 0) return null;

      const style = box.style || 'blur';

      // Sticker styles: composite an SVG directly over the face region
      if (style === 'heart' || style === 'love' || style === 'smile' || style === 'star') {
        const svgBuf = makeStickerSvg(style, w, h);
        if (!svgBuf) return null;
        return { input: svgBuf, left, top };
      }

      // Pixel-only style: coarser pixelation, no Gaussian blur
      if (style === 'pixel') {
        const PIXEL_ONLY_BLOCKS = 4; // fewer, larger blocks for a more visible effect
        const origRegion = await sharp(normPath)
          .extract({ left, top, width: w, height: h }).png().toBuffer();
        const bW = Math.max(2, Math.round(w / PIXEL_ONLY_BLOCKS));
        const bH = Math.max(2, Math.round(h / PIXEL_ONLY_BLOCKS));
        const pixBuf = await sharp(origRegion)
          .resize(bW, bH, { kernel: 'nearest', fit: 'fill' })
          .resize(w, h, { kernel: 'nearest', fit: 'fill' })
          .png().toBuffer();
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" fill="white"/></svg>`
        );
        const masked = await sharp(pixBuf)
          .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        const base = await sharp(normPath)
          .extract({ left, top, width: w, height: h }).png().toBuffer();
        const result = await sharp(base)
          .composite([{ input: masked, blend: 'over' }]).png().toBuffer();
        return { input: result, left, top };
      }

      // Default 'blur': Gaussian + pixelation with elliptical mask
      const gaussBuffer = await sharp(normPath)
        .extract({ left, top, width: w, height: h })
        .blur(BLUR_SIGMA).png().toBuffer();

      const blockW = Math.max(2, Math.round(w / PIXELATE_BLOCKS));
      const blockH = Math.max(2, Math.round(h / PIXELATE_BLOCKS));
      const pixBuffer = await sharp(gaussBuffer)
        .resize(blockW, blockH, { kernel: 'nearest', fit: 'fill' })
        .resize(w, h, { kernel: 'nearest', fit: 'fill' })
        .png().toBuffer();

      const ellipseMask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" fill="white"/></svg>`
      );
      const maskedBlur = await sharp(pixBuffer)
        .composite([{ input: ellipseMask, blend: 'dest-in' }])
        .png().toBuffer();

      const origRegion = await sharp(normPath)
        .extract({ left, top, width: w, height: h })
        .png().toBuffer();

      const blurredRegion = await sharp(origRegion)
        .composite([{ input: maskedBlur, blend: 'over' }])
        .png().toBuffer();

      return { input: blurredRegion, left, top };
    })
  );

  const valid    = composites.filter(Boolean);
  const tmpPath  = absoluteFilePath + '.blur.tmp';
  const origPath = absoluteFilePath + '.orig';
  try {
    if (valid.length) {
      await sharp(normPath).composite(valid).toFile(tmpPath);
    } else {
      // No composites to apply — just normalise EXIF rotation and save
      if (!fs.existsSync(origPath)) fs.copyFileSync(absoluteFilePath, origPath);
      if (fs.existsSync(absoluteFilePath)) fs.unlinkSync(absoluteFilePath);
      fs.copyFileSync(normPath, absoluteFilePath);
      fs.unlinkSync(normPath);
      return false;
    }
    // Only save .orig on the very first blur (don't overwrite with an already-blurred version)
    if (!fs.existsSync(origPath)) fs.copyFileSync(absoluteFilePath, origPath);
    if (fs.existsSync(absoluteFilePath)) fs.unlinkSync(absoluteFilePath);
    fs.copyFileSync(tmpPath, absoluteFilePath);
    fs.unlinkSync(tmpPath);
    return true;
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw err;
  } finally {
    if (fs.existsSync(normPath)) fs.unlinkSync(normPath);
  }
}

/**
 * Detects all faces in an image and returns their bounding boxes.
 * Does NOT perform matching — returns every detected face regardless of identity.
 * Boxes are sorted top-to-bottom, left-to-right for consistent indexing.
 * @param {string} absoluteFilePath
 * @returns {Promise<Array<{x,y,width,height}>>}
 */
async function detectAllFaces(absoluteFilePath) {
  if (!modelsLoaded || !faceapi) return [];
  try {
    const tensor = await imageToTensor(absoluteFilePath);
    let detections;
    try {
      detections = await faceapi
        .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }))
        .withFaceLandmarks();
    } finally {
      faceapi.tf.dispose(tensor);
    }
    if (!detections || !detections.length) return [];
    const faces = detections.map(d => ({
      x:      Math.round(d.detection.box.x),
      y:      Math.round(d.detection.box.y),
      width:  Math.round(d.detection.box.width),
      height: Math.round(d.detection.box.height),
    }));
    // Stable sort: top-to-bottom, left-to-right — ensures consistent faceIndex across calls
    faces.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
    return faces;
  } catch (err) {
    console.error('[faceBlur] detectAllFaces error:', err.message);
    return [];
  }
}

/**
 * Tolerant face detection around a specific tap point.
 *
 * Crops a region around (tapX, tapY) — about 3× expected face size — and
 * runs face detection with a much lower confidence threshold (0.15) to catch
 * faces at distance or in difficult angles. Returns the best matching face
 * bounding box in ORIGINAL image coordinates, or null if nothing found.
 *
 * @param {string} absoluteFilePath  path to the original (unblurred) image
 * @param {number} tapX              tap X in original-image pixel coordinates
 * @param {number} tapY              tap Y in original-image pixel coordinates
 * @param {number} imgWidth          full image width in pixels
 * @param {number} imgHeight         full image height in pixels
 * @returns {{ x, y, width, height } | null}
 */
async function detectFaceAtPoint(absoluteFilePath, tapX, tapY, imgWidth, imgHeight) {
  if (!modelsLoaded || !faceapi) return null;
  try {
    // Crop size: ~30% of the shortest image dimension, min 100px
    const cropSize = Math.max(100, Math.round(Math.min(imgWidth, imgHeight) * 0.30));
    const halfCrop = Math.floor(cropSize / 2);

    const cropX = Math.max(0, Math.round(tapX) - halfCrop);
    const cropY = Math.max(0, Math.round(tapY) - halfCrop);
    const cropW = Math.min(cropSize, imgWidth  - cropX);
    const cropH = Math.min(cropSize, imgHeight - cropY);

    if (cropW < 20 || cropH < 20) return null;

    // Extract crop as raw tensor
    const { data, info } = await sharp(absoluteFilePath)
      .rotate()
      .removeAlpha()
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensor = faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');

    let detections;
    try {
      // Very tolerant threshold — catches distant/angled faces
      detections = await faceapi
        .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 }))
        .withFaceLandmarks();
    } finally {
      faceapi.tf.dispose(tensor);
    }

    if (!detections || !detections.length) return null;

    // Pick the detection whose centre is closest to the tap point (within the crop)
    const tapInCropX = tapX - cropX;
    const tapInCropY = tapY - cropY;
    let best = null;
    let bestDist = Infinity;
    for (const d of detections) {
      const cx = d.detection.box.x + d.detection.box.width  / 2;
      const cy = d.detection.box.y + d.detection.box.height / 2;
      const dist = Math.hypot(cx - tapInCropX, cy - tapInCropY);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    if (!best) return null;

    // Translate back to original image coordinates
    return {
      x:      Math.round(best.detection.box.x + cropX),
      y:      Math.round(best.detection.box.y + cropY),
      width:  Math.round(best.detection.box.width),
      height: Math.round(best.detection.box.height),
    };
  } catch (err) {
    console.error('[faceBlur] detectFaceAtPoint error:', err.message);
    return null;
  }
}


function getOriginalBackupPath(absoluteFilePath) {
  const p = absoluteFilePath + '.orig';
  return fs.existsSync(p) ? p : null;
}

/**
 * Reverts a blurred file to its .orig backup.
 * Returns true on success, false if no backup exists.
 */
function revertBlur(absoluteFilePath) {
  const origPath = absoluteFilePath + '.orig';
  if (!fs.existsSync(origPath)) return false;
  if (fs.existsSync(absoluteFilePath)) fs.unlinkSync(absoluteFilePath);
  fs.copyFileSync(origPath, absoluteFilePath);
  // Keep the .orig backup intact so we can always revert again
  console.log(`[faceBlur] Reverted blur for ${path.basename(absoluteFilePath)}`);
  return true;
}

/* ─── Internal: brightness + sharpness measurement ──────────────────────── */

async function measurePhotoQuality(absoluteFilePath) {
  // Get original resolution
  const meta = await sharp(absoluteFilePath).metadata();
  const origWidth  = meta.width  || 0;
  const origHeight = meta.height || 0;

  // Brightness: grayscale mean 0-255 (use original, not downscaled)
  const brightnessStats = await sharp(absoluteFilePath).grayscale().stats();
  const brightness = brightnessStats.channels[0].mean;

  // Sharpness at QUALITY_NORM_SIZE (640px): standard deviation of Laplacian.
  // Downscaling before measuring eliminates noise bias: grain averages out, real edges survive.
  const lapKernel = { width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0], scale: 4, offset: 128 };

  function laplacianStdev(buffer) {
    const n = buffer.length;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) { sum += buffer[i]; sumSq += buffer[i] * buffer[i]; }
    const mean = sum / n;
    return Math.sqrt((sumSq / n) - (mean * mean));
  }

  const { data: lap640 } = await sharp(absoluteFilePath)
    .grayscale()
    .resize(QUALITY_NORM_SIZE, QUALITY_NORM_SIZE, { fit: 'inside', withoutEnlargement: true })
    .convolve(lapKernel)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sharpness = laplacianStdev(lap640);

  // Grain ratio: compare Laplacian stdev at 640px vs. extreme downscale (80px).
  // At 80px, grain and fine textures (brick wall, clothing) largely disappear.
  // Only major structural edges (head/shoulder outlines) survive.
  // High ratio  → high-frequency content that disappears when small = GRAIN/NOISE.
  // Low ratio   → content survives downscale = real edges = genuinely sharp photo.
  const { data: lap80 } = await sharp(absoluteFilePath)
    .grayscale()
    .resize(QUALITY_GRAIN_SIZE, QUALITY_GRAIN_SIZE, { fit: 'inside', withoutEnlargement: true })
    .convolve(lapKernel)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sharpness80  = laplacianStdev(lap80);
  const grainRatio   = sharpness80 > 0.1 ? +(sharpness / sharpness80).toFixed(2) : 99; // guard div-by-zero

  return { brightness, sharpness, sharpness80, grainRatio, width: origWidth, height: origHeight };
}

/* ─── Public: quality check for uploaded match/social photos (WARNING) ───── */
/**
 * Checks brightness and sharpness of an uploaded photo.
 * Non-blocking — returns { ok, warnings, measurements }.
 * Always includes raw measured values so callers can surface them for calibration.
 */
async function checkUploadedPhotoQuality(absoluteFilePath) {
  try {
    const { brightness, sharpness, sharpness80, grainRatio, width, height } = await measurePhotoQuality(absoluteFilePath);
    const shortSide = Math.min(width, height);
    const warnings = [];

    if (brightness < REF_MIN_BRIGHTNESS) {
      warnings.push('De foto is te donker — gezichten worden mogelijk niet automatisch herkend voor blur');
    } else if (brightness > REF_MAX_BRIGHTNESS) {
      warnings.push('De foto is overbelicht — gezichtsherkenning werkt mogelijk minder goed');
    }
    if (sharpness < UPLOAD_MIN_SHARPNESS) {
      warnings.push('De foto is wazig of onscherp — automatische blur werkt mogelijk niet voor alle gezichten');
    }
    if (grainRatio > UPLOAD_MAX_GRAIN_RATIO) {
      warnings.push(`De foto is te korrelig/graining (ratio ${grainRatio}) — gezichtsherkenning kan onbetrouwbaar zijn`);
    }
    if (shortSide < UPLOAD_MIN_PIXELS) {
      warnings.push(`De foto is te klein (${width}×${height}px) — gebruik een hogere resolutie voor betrouwbare gezichtsherkenning`);
    }

    const measurements = {
      brightness:  +brightness.toFixed(2),
      sharpness:   +sharpness.toFixed(2),
      sharpness80: +sharpness80.toFixed(2),
      grainRatio,
      width,
      height,
    };
    const thresholds = {
      minBrightness:  REF_MIN_BRIGHTNESS,
      maxBrightness:  REF_MAX_BRIGHTNESS,
      minSharpness:   UPLOAD_MIN_SHARPNESS,
      maxGrainRatio:  UPLOAD_MAX_GRAIN_RATIO,
      minPixels:      UPLOAD_MIN_PIXELS,
    };

    console.log(
      `[faceBlur] Upload quality → ${width}×${height}px` +
      ` | brightness=${measurements.brightness}` +
      ` | sharpness640=${measurements.sharpness} sharpness80=${measurements.sharpness80}` +
      ` | grainRatio=${grainRatio} (max=${UPLOAD_MAX_GRAIN_RATIO})` +
      ` | warnings=${warnings.length}`
    );

    return { ok: true, warnings, measurements, thresholds };
  } catch (err) {
    console.error('[faceBlur] Upload quality check error (non-blocking):', err.message);
    return { ok: true, warnings: [], measurements: null, thresholds: null };
  }
}

/* ─── Public: quality check for reference photos (BLOCKING) ─────────────── */
/**
 * Checks brightness, sharpness AND face detection quality.
 * Blocking — returns { ok: false, issues, hints } when quality is insufficient.
 */
async function checkReferencePhotoQuality(absoluteFilePath) {
  const issues = [];
  const hints  = [];

  try {
    const { brightness, sharpness } = await measurePhotoQuality(absoluteFilePath);

    if (brightness < REF_MIN_BRIGHTNESS) {
      issues.push('De foto is te donker');
      hints.push('Maak de foto op een goed verlichte plek of zet de flits aan');
    } else if (brightness > REF_MAX_BRIGHTNESS) {
      issues.push('De foto is overbelicht');
      hints.push('Vermijd direct (tegen)licht achter je hoofd');
    }
    if (sharpness < REF_MIN_SHARPNESS) {
      issues.push('De foto is te wazig of onscherp');
      hints.push('Houd de camera stil, gebruik autofocus en zorg dat je gezicht scherp in beeld staat');
    }

    // Face detection (requires loaded models)
    if (modelsLoaded && faceapi) {
      const imgMeta = await sharp(absoluteFilePath).metadata();
      const tensor  = await imageToTensor(absoluteFilePath);
      let detection;
      try {
        detection = await faceapi
          .detectSingleFace(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
          .withFaceLandmarks();
      } finally {
        faceapi.tf.dispose(tensor);
      }

      if (!detection) {
        issues.push('Geen gezicht herkend in de foto');
        hints.push('Zorg dat je gezicht volledig zichtbaar en goed verlicht is, en kijk recht in de camera');
      } else {
        if (detection.detection.box.width / imgMeta.width < REF_MIN_FACE_RATIO) {
          issues.push('Gezicht te klein in beeld');
          hints.push('Kom dichter bij de camera — je gezicht moet het grootste deel van de foto vullen');
        }
        if (detection.detection.score < REF_MIN_FACE_CONF) {
          issues.push('Gezicht niet duidelijk genoeg herkenbaar');
          hints.push('Kijk recht vooruit, zorg voor goede belichting en vermijd zonnebril of pet');
        }
      }
    }

    console.log(`[faceBlur] Ref quality: brightness=${brightness.toFixed(1)} sharpness=${sharpness.toFixed(2)} issues=${JSON.stringify(issues)}`);
  } catch (err) {
    console.error('[faceBlur] Ref quality check error (non-blocking):', err.message);
    return { ok: true, skipped: true };
  }

  return { ok: issues.length === 0, issues, hints };
}

module.exports = { loadModels, blurFacesIfNeeded, applyBlurRegions, detectAllFaces, detectFaceAtPoint, invalidateCache, checkReferencePhotoQuality, checkUploadedPhotoQuality, teamHasAnonymousMembers, getOriginalBackupPath, revertBlur };
