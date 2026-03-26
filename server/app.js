require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

const metrics = require('./lib/metrics');
metrics.mount(app);

const featureSettings = require('./lib/featureSettings');
const { loadModels } = require('./services/faceBlur');
const { verifyToken, requireSuperAdmin } = require('./middleware/auth');

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled so CDN scripts work
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API routes vóór static: voorkomt dat een toekomstig bestand onder public/
//     ooit /api/* overschaduwt; relative fetch('/api/...') blijft dezelfde host.
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/clubs',         require('./routes/clubs'));
app.use('/api/nevobo',        require('./routes/nevobo'));
// Coach-routes eerst op eigen mount — voorkomt dat /coach/* als :matchId wordt geïnterpreteerd
app.use('/api/carpool/coach', require('./routes/carpool-coach'));
app.use('/api/carpool',       require('./routes/carpool'));
app.use('/api/social',        require('./routes/social'));
app.use('/api/gamification',  require('./routes/gamification'));
app.use('/api/admin',         require('./routes/admin'));
// Platform toggles — expliciet op app (niet sub-router) voor betrouwbare matching op Express 5
app.get('/api/platform/settings', verifyToken, requireSuperAdmin, (req, res) => {
  res.json({ ok: true, settings: featureSettings.getAdminSettingsList() });
});
app.patch('/api/platform/settings', verifyToken, requireSuperAdmin, (req, res) => {
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const patch = raw.settings && typeof raw.settings === 'object' ? raw.settings : raw;
  for (const key of Object.keys(featureSettings.DEFINITIONS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const v = patch[key];
    if (typeof v !== 'boolean' && typeof v !== 'string' && typeof v !== 'number') continue;
    const bool = v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
    featureSettings.setBoolean(key, bool);
  }
  if (featureSettings.isFaceBlurEnabled()) {
    loadModels().catch(err => console.error('[platform/settings] loadModels:', err.message));
  }
  res.json({
    ok: true,
    settings: featureSettings.getAdminSettingsList(),
    features: featureSettings.getClientFeatures(),
  });
});
app.use('/api/scout',         require('./routes/scout'));
app.use('/api/public/training', require('./routes/public-training'));
app.use('/api/training',      require('./routes/training'));
app.use('/api/export',        require('./routes/export'));

// ─── Static files (frontend) ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Ongeldige JSON in request body' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Interne serverfout' });
});

// ─── SPA fallback — all non-API routes serve index.html ──────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Route niet gevonden' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;
