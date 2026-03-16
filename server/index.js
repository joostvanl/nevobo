require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled so CDN scripts work
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static files (frontend) ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/clubs',         require('./routes/clubs'));
app.use('/api/nevobo',        require('./routes/nevobo'));
app.use('/api/carpool',       require('./routes/carpool'));
app.use('/api/social',        require('./routes/social'));
app.use('/api/gamification',  require('./routes/gamification'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/scout',         require('./routes/scout'));

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
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

app.listen(PORT, () => {
  console.log(`🏐 Volleyball App running on http://localhost:${PORT}`);
});

// Load face detection models in the background after startup
const { loadModels } = require('./services/faceBlur');
loadModels().catch(err => console.error('[faceBlur] Model load failed:', err.message));

// Prevent uncaught TF/WASM errors from killing the server process
process.on('uncaughtException', err => {
  console.error('[server] Uncaught exception (server continues):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection (server continues):', reason?.message ?? reason);
});
