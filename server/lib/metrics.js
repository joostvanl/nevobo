'use strict';

/**
 * Prometheus metrics (/metrics). Technical (HTTP, Node runtime) + functional (auth, uploads, DB, face blur).
 *
 * Env:
 *   METRICS_ENABLED   — default true; set to "false" to disable endpoint and middleware
 *   METRICS_TOKEN     — optional; if set, require Authorization: Bearer <token> or X-Metrics-Token
 *   METRICS_DISK_PATH — directory whose filesystem is reported (statfs); default public/uploads
 *   METRICS_MEDIA_DIR_SCAN_INTERVAL_MS — scan uploads tree for total file bytes; 0=off; default 300000 (5m)
 */

const client = require('prom-client');
const fs = require('fs');
const path = require('path');
const db = require('../db/db');

/** Filesystem containing uploads (statfs); default public/uploads */
const diskPathForStats = path.resolve(
  process.env.METRICS_DISK_PATH || path.join(__dirname, '../../public/uploads')
);
if (!process.env.METRICS_DISK_PATH) {
  try {
    fs.mkdirSync(diskPathForStats, { recursive: true });
  } catch (_) {}
}
/** Background scan of uploads dir size (bytes); 0 = disabled */
const mediaDirScanMs = Math.max(0, parseInt(process.env.METRICS_MEDIA_DIR_SCAN_INTERVAL_MS || '300000', 10) || 0);
let cachedMediaDirBytes = 0;
let mediaDirScanRunning = false;

function refreshMediaDirSize() {
  if (mediaDirScanMs <= 0 || mediaDirScanRunning) return;
  const root = diskPathForStats;
  mediaDirScanRunning = true;
  (async () => {
    let total = 0;
    async function walk(dir) {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          try {
            const st = await fs.promises.stat(p);
            total += st.size;
          } catch (_) {}
        }
      }
    }
    try {
      await walk(root);
      cachedMediaDirBytes = total;
    } finally {
      mediaDirScanRunning = false;
    }
  })().catch(() => {
    mediaDirScanRunning = false;
  });
}

function readFsStatfsBytes() {
  if (typeof fs.statfsSync !== 'function') return { total: 0, free: 0 };
  const n = (v) => {
    if (v == null) return 0;
    return typeof v === 'bigint' ? Number(v) : Number(v);
  };
  try {
    const s = fs.statfsSync(diskPathForStats);
    const bsize = n(s.bsize || s.frsize) || 4096;
    const blocks = n(s.blocks);
    const bavail = n(s.bavail);
    return {
      total: (Number.isFinite(blocks) ? blocks : 0) * bsize,
      free: (Number.isFinite(bavail) ? bavail : 0) * bsize,
    };
  } catch (_) {
    return { total: 0, free: 0 };
  }
}

let pkgVersion = 'unknown';
try {
  pkgVersion = require(path.join(__dirname, '../../package.json')).version || 'unknown';
} catch (_) {}

const enabled = String(process.env.METRICS_ENABLED || '').toLowerCase() !== 'false';
const metricsToken = (process.env.METRICS_TOKEN || '').trim();

if (enabled && mediaDirScanMs > 0) {
  setTimeout(refreshMediaDirSize, 3000);
  setInterval(refreshMediaDirSize, mediaDirScanMs);
}

const register = new client.Registry();

if (enabled) {
  client.collectDefaultMetrics({
    register,
    prefix: '',
    labels: { app: 'volleyapp' },
  });

  new client.Gauge({
    name: 'volleyapp_info',
    help: 'Application version label',
    labelNames: ['version'],
    registers: [register],
  }).set({ version: pkgVersion }, 1);

  new client.Gauge({
    name: 'volleyapp_db_users_total',
    help: 'Number of registered users',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_db_teams_total',
    help: 'Number of teams',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM teams').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_db_clubs_total',
    help: 'Number of clubs',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM clubs').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_db_match_media_total',
    help: 'Number of match_media rows',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM match_media').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_db_posts_total',
    help: 'Number of social posts',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM posts').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_db_carpool_offers_total',
    help: 'Number of carpool offers',
    registers: [register],
    collect() {
      try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM carpool_offers').get();
        this.set(row.c);
      } catch (_) {
        this.set(0);
      }
    },
  });

  new client.Gauge({
    name: 'volleyapp_disk_bytes_total',
    help: 'Total bytes on filesystem containing METRICS_DISK_PATH (statfs)',
    registers: [register],
    collect() {
      this.set(readFsStatfsBytes().total);
    },
  });

  new client.Gauge({
    name: 'volleyapp_disk_bytes_free',
    help: 'Free bytes on filesystem containing METRICS_DISK_PATH (statfs)',
    registers: [register],
    collect() {
      this.set(readFsStatfsBytes().free);
    },
  });

  new client.Gauge({
    name: 'volleyapp_media_dir_bytes',
    help: 'Total bytes under uploads directory (periodic scan; see METRICS_MEDIA_DIR_SCAN_INTERVAL_MS)',
    registers: [register],
    collect() {
      this.set(cachedMediaDirBytes);
    },
  });

  new client.Counter({
    name: 'volleyapp_http_requests_total',
    help: 'HTTP requests',
    labelNames: ['method', 'route_group', 'status_code'],
    registers: [register],
  });

  new client.Histogram({
    name: 'volleyapp_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route_group'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_auth_logins_total',
    help: 'Login attempts',
    labelNames: ['outcome'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_auth_registrations_total',
    help: 'Registrations',
    labelNames: ['outcome'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_social_posts_created_total',
    help: 'Posts created',
    labelNames: ['kind'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_media_uploads_total',
    help: 'Media files stored (social upload)',
    labelNames: ['kind'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_media_bytes_uploaded_total',
    help: 'Bytes received for media uploads (multipart)',
    labelNames: ['kind'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_media_bytes_served_total',
    help: 'Bytes sent for GET /uploads/* when Content-Length is set',
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_face_blur_runs_total',
    help: 'Face blur pipeline outcomes',
    labelNames: ['outcome'],
    registers: [register],
  });

  new client.Counter({
    name: 'volleyapp_process_events_total',
    help: 'Process-level events (errors)',
    labelNames: ['type'],
    registers: [register],
  });

  /** Outbound HTTP (Nevobo, OSM, N8N, …): outcome = success | client_error | server_error | network_error | timeout */
  new client.Counter({
    name: 'volleyapp_dependency_requests_total',
    help: 'Outbound dependency HTTP calls',
    labelNames: ['dependency', 'outcome'],
    registers: [register],
  });

  new client.Histogram({
    name: 'volleyapp_dependency_request_duration_seconds',
    help: 'Outbound dependency request duration',
    labelNames: ['dependency'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [register],
  });
}

function getMetric(name) {
  return register.getSingleMetric(name);
}

function routeGroupFromPath(urlPath) {
  const p = String(urlPath || '').split('?')[0] || '/';
  if (p === '/' || p === '') return '/';
  if (p.startsWith('/api/')) {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
    return '/api';
  }
  if (p.startsWith('/uploads')) return '/uploads';
  if (p.includes('.')) return '/static-asset';
  return 'other';
}

function httpMiddleware(req, res, next) {
  if (!enabled) return next();
  const start = process.hrtime.bigint();
  const rawPath = req.originalUrl || req.url || '';
  if (rawPath.split('?')[0] === '/metrics') return next();

  res.on('finish', () => {
    try {
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      const routeGroup = routeGroupFromPath(rawPath);
      const method = req.method || 'GET';
      const code = String(res.statusCode || 0);
      const c = getMetric('volleyapp_http_requests_total');
      const h = getMetric('volleyapp_http_request_duration_seconds');
      if (c) c.inc({ method, route_group: routeGroup, status_code: code });
      if (h) h.observe({ method, route_group: routeGroup }, duration);

      const pathOnly = String(rawPath || '').split('?')[0] || '';
      if (method === 'GET' && pathOnly.startsWith('/uploads')) {
        const cl = res.getHeader('content-length');
        const len = cl != null && cl !== '' ? parseInt(String(cl), 10) : 0;
        if (Number.isFinite(len) && len > 0 && len < 1e13) {
          const served = getMetric('volleyapp_media_bytes_served_total');
          if (served) served.inc(len);
        }
      }
    } catch (_) {}
  });
  next();
}

function checkMetricsAuth(req) {
  if (!metricsToken) return true;
  const auth = req.headers.authorization;
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const header = req.headers['x-metrics-token'];
  return bearer === metricsToken || header === metricsToken;
}

function mount(app) {
  if (!enabled) return;

  app.use(httpMiddleware);

  app.get('/metrics', async (req, res) => {
    if (!checkMetricsAuth(req)) {
      res.set('WWW-Authenticate', 'Bearer realm="metrics"');
      return res.status(401).end('Unauthorized');
    }
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(String(err.message || err));
    }
  });
}

function recordAuthLogin(outcome) {
  if (!enabled) return;
  const m = getMetric('volleyapp_auth_logins_total');
  if (m) m.inc({ outcome });
}

function recordAuthRegister(outcome) {
  if (!enabled) return;
  const m = getMetric('volleyapp_auth_registrations_total');
  if (m) m.inc({ outcome });
}

function recordSocialPost(kind) {
  if (!enabled) return;
  const m = getMetric('volleyapp_social_posts_created_total');
  if (m) m.inc({ kind });
}

function recordMediaUpload(kind) {
  if (!enabled) return;
  const m = getMetric('volleyapp_media_uploads_total');
  if (m) m.inc({ kind });
}

function recordMediaBytesUploaded(kind, bytes) {
  if (!enabled) return;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return;
  const m = getMetric('volleyapp_media_bytes_uploaded_total');
  if (m) m.inc({ kind }, n);
}

function recordFaceBlur(outcome) {
  if (!enabled) return;
  const m = getMetric('volleyapp_face_blur_runs_total');
  if (m) m.inc({ outcome });
}

function recordProcessEvent(type) {
  if (!enabled) return;
  const m = getMetric('volleyapp_process_events_total');
  if (m) m.inc({ type });
}

function recordDependencyRequest(dependency, outcome, durationSec) {
  if (!enabled) return;
  const c = getMetric('volleyapp_dependency_requests_total');
  const h = getMetric('volleyapp_dependency_request_duration_seconds');
  if (c) c.inc({ dependency, outcome });
  if (h) h.observe({ dependency }, durationSec);
}

module.exports = {
  enabled,
  register,
  mount,
  recordAuthLogin,
  recordAuthRegister,
  recordSocialPost,
  recordMediaUpload,
  recordMediaBytesUploaded,
  recordFaceBlur,
  recordProcessEvent,
  recordDependencyRequest,
};
