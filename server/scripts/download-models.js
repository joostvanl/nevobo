/**
 * Downloads face-api.js model files (~12 MB total) into server/models/.
 * Run once: node server/scripts/download-models.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BASE_URL  = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
const DEST      = path.join(__dirname, '../models');

const FILES = [
  // SSD MobileNetV1 — face detection
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  // Face landmark 68 points — required by recognition pipeline
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  // Face recognition net — 128-d descriptor
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

function download(filename) {
  return new Promise((resolve, reject) => {
    const dest = path.join(DEST, filename);
    if (fs.existsSync(dest)) {
      console.log(`  skip  ${filename} (already exists)`);
      return resolve();
    }
    const file = fs.createWriteStream(dest);
    const url  = BASE_URL + filename;
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  console.log(`Downloading face-api models to ${DEST}\n`);
  for (const f of FILES) {
    process.stdout.write(`  fetch ${f} … `);
    try {
      await download(f);
      console.log('ok');
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nAll models downloaded successfully.');
})();
