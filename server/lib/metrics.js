'use strict';

/**
 * Prometheus metrics (/metrics). Technical (HTTP, Node runtime) + functional (auth, uploads, DB, face blur).
 *
 * Env:
 *   METRICS_ENABLED   — default true; set to "false" to disable endpoint and middleware
 *   METRICS_TOKEN     — optional; if set, require Authorization: Bearer <token> or X-Metrics-Token
 */

const client = require('prom-client');
const path = require('path');
const db = require('../db/db');

let pkgVersion = 'unknown';
try {
  pkgVersion = require(path.join(__dirname, '../../package.json')).version || 'unknown';
} catch (_) {}

const enabled = String(process.env.METRICS_ENABLED || '').toLowerCase() !== 'false';
const metricsToken = (process.env.METRICS_TOKEN || '').trim();

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

module.exports = {
  enabled,
  register,
  mount,
  recordAuthLogin,
  recordAuthRegister,
  recordSocialPost,
  recordMediaUpload,
  recordFaceBlur,
  recordProcessEvent,
};
