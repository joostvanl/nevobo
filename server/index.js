const app = require('./app');
const PORT = process.env.PORT || 3000;

const featureSettings = require('./lib/featureSettings');
const { loadModels } = require('./services/faceBlur');

app.listen(PORT, () => {
  console.log(`🏐 Volleyball App running on http://localhost:${PORT}`);
});

// Load face detection models when feature is enabled
if (featureSettings.isFaceBlurEnabled()) {
  loadModels().catch(err => console.error('[faceBlur] Model load failed:', err.message));
}

// Prevent uncaught TF/WASM errors from killing the server process
process.on('uncaughtException', err => {
  console.error('[server] Uncaught exception (server continues):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection (server continues):', reason?.message ?? reason);
});
