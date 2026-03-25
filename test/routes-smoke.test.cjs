'use strict';

/**
 * Smoke tests: elke geregistreerde API-route wordt minstens één keer aangeroepen
 * zonder een serverfout (500). Routes die JWT vereisen moeten zonder token 401
 * of 403 geven (of 403 als feature uit staat).
 *
 * Bij nieuwe routes: deze lijst uitbreiden (zie ook docs/technical/14-api-endpoint-inventory.md).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../server/app');

/** @typedef {'auth'|'apiKey'|'public'|'public_loose'|'optional'} SmokeKind */

/**
 * @param {string} method
 * @param {string} path
 * @param {SmokeKind} kind
 */
async function smokeRequest(method, path, kind) {
  const m = method.toLowerCase();
  let req;
  if (m === 'get' || m === 'delete') {
    req = request(app)[m](path);
  } else {
    req = request(app)[m](path).set('Content-Type', 'application/json').send({});
  }
  const res = await req;
  const label = `${method} ${path}`;
  if (kind === 'auth') {
    assert.ok(
      [401, 403].includes(res.status),
      `${label}: zonder token verwacht 401/403, got ${res.status}`
    );
  } else if (kind === 'apiKey') {
    assert.ok(
      [401, 403, 503].includes(res.status),
      `${label}: zonder geldige API-key verwacht 401/403/503, got ${res.status}`
    );
  } else if (kind === 'public') {
    assert.notEqual(res.status, 500, `${label}: interne serverfout`);
    assert.notEqual(res.status, 401, `${label}: publieke route gaf 401`);
  } else if (kind === 'public_loose') {
    assert.notEqual(res.status, 500, `${label}: interne serverfout`);
  } else if (kind === 'optional') {
    assert.notEqual(res.status, 500, `${label}: interne serverfout`);
  }
}

/** @type {string[][]} */
const ROUTES = [
  // ── Metrics (Prometheus) ─────────────────────────────────────────────────
  ['GET', '/metrics', 'public'],

  // ── /api/auth ────────────────────────────────────────────────────────────
  ['GET', '/api/auth/me', 'auth'],
  ['GET', '/api/auth/memberships', 'auth'],
  ['GET', '/api/auth/face-references', 'auth'],
  ['DELETE', '/api/auth/memberships/1', 'auth'],
  ['DELETE', '/api/auth/face-reference/1', 'auth'],
  ['PATCH', '/api/auth/profile', 'auth'],
  ['POST', '/api/auth/memberships', 'auth'],
  ['POST', '/api/auth/avatar', 'auth'],
  ['POST', '/api/auth/face-reference', 'auth'],
  ['POST', '/api/auth/register', 'public_loose'],
  ['POST', '/api/auth/login', 'public_loose'],

  // ── /api/clubs ─────────────────────────────────────────────────────────────
  ['GET', '/api/clubs', 'public'],
  ['GET', '/api/clubs/1', 'public'],
  ['GET', '/api/clubs/1/teams', 'public'],
  ['GET', '/api/clubs/1/members', 'public'],
  ['GET', '/api/clubs/1/teams/1', 'public_loose'],
  ['POST', '/api/clubs', 'auth'],
  ['POST', '/api/clubs/1/teams', 'auth'],
  ['POST', '/api/clubs/1/sync-teams', 'auth'],

  // ── /api/nevobo (publiek; geen query kan 400 zijn) ─────────────────────────
  // Geen name/code → snelle 400; route wordt wel gemount
  ['GET', '/api/nevobo/team-by-name', 'public_loose'],
  ['GET', '/api/nevobo/poule-stand', 'public_loose'],
  ['GET', '/api/nevobo/team-recent-results', 'public_loose'],
  ['GET', '/api/nevobo/club/xxx/schedule', 'public_loose'],
  ['GET', '/api/nevobo/club/xxx/results', 'public_loose'],
  ['GET', '/api/nevobo/team/xxx/hs/1/schedule', 'public_loose'],
  ['GET', '/api/nevobo/team/xxx/hs/1/results', 'public_loose'],
  ['GET', '/api/nevobo/team/xxx/hs/1/calendar', 'public_loose'],
  ['GET', '/api/nevobo/poule/1/regio/standings', 'public_loose'],
  ['GET', '/api/nevobo/geocode', 'public_loose'],
  ['GET', '/api/nevobo/travel-time', 'public_loose'],
  ['GET', '/api/nevobo/search', 'public_loose'],
  ['GET', '/api/nevobo/opponent-clubs', 'public'],
  ['GET', '/api/nevobo/cache-stats', 'public'],
  ['DELETE', '/api/nevobo/cache', 'public_loose'],
  ['DELETE', '/api/nevobo/cache/xxx', 'public_loose'],
  ['POST', '/api/nevobo/validate', 'public_loose'],

  // ── /api/carpool/coach ─────────────────────────────────────────────────────
  ['GET', '/api/carpool/coach/teams', 'auth'],
  ['GET', '/api/carpool/coach/team/1/stats', 'auth'],
  ['POST', '/api/carpool/coach/plan-season', 'auth'],
  ['PATCH', '/api/carpool/coach/offer/1', 'auth'],

  // ── /api/carpool ───────────────────────────────────────────────────────────
  ['GET', '/api/carpool/1/summary', 'optional'],
  ['GET', '/api/carpool/1', 'auth'],
  ['POST', '/api/carpool/1/offer', 'auth'],
  ['PATCH', '/api/carpool/offer/1', 'auth'],
  ['DELETE', '/api/carpool/offer/1', 'auth'],

  // ── /api/social ────────────────────────────────────────────────────────────
  ['GET', '/api/social/feed', 'auth'],
  ['GET', '/api/social/my-media', 'auth'],
  ['GET', '/api/social/following', 'auth'],
  ['GET', '/api/social/home-summary', 'auth'],
  ['GET', '/api/social/media-feed', 'auth'],
  ['POST', '/api/social/post', 'auth'],
  ['POST', '/api/social/upload', 'auth'],
  ['POST', '/api/social/media/1/like', 'auth'],
  ['POST', '/api/social/media/1/comments', 'auth'],
  ['DELETE', '/api/social/media/1', 'auth'],
  ['POST', '/api/social/follow', 'auth'],
  ['DELETE', '/api/social/follow', 'auth'],
  ['GET', '/api/social/media/1/has-original', 'auth'],
  ['GET', '/api/social/media/1/detect-faces', 'auth'],
  ['POST', '/api/social/media/1/revert-blur', 'auth'],
  ['POST', '/api/social/media/1/reblur', 'auth'],
  ['POST', '/api/social/media/1/toggle-face-blur', 'auth'],
  ['POST', '/api/social/media/1/blur-at-point', 'auth'],
  ['POST', '/api/social/teams/1/social-links', 'auth'],
  ['DELETE', '/api/social/teams/1/social-links/1', 'auth'],
  ['GET', '/api/social/club/1/feed', 'public'],
  ['GET', '/api/social/match/1/media', 'public_loose'],
  ['POST', '/api/social/media/1/view', 'public_loose'],
  ['GET', '/api/social/media/1/comments', 'public'],
  ['GET', '/api/social/followers/1', 'public_loose'],
  ['POST', '/api/social/social-links/1/view', 'public_loose'],
  ['GET', '/api/social/team-media/1', 'optional'],

  // ── /api/gamification ─────────────────────────────────────────────────────────
  ['GET', '/api/gamification/badges', 'public'],
  ['GET', '/api/gamification/goals', 'public'],
  ['GET', '/api/gamification/leaderboard/1', 'public'],
  ['GET', '/api/gamification/my', 'auth'],
  ['POST', '/api/gamification/award-xp', 'auth'],
  ['POST', '/api/gamification/check-badges', 'auth'],
  ['POST', '/api/gamification/goal-progress', 'auth'],

  // ── /api/admin ─────────────────────────────────────────────────────────────
  ['GET', '/api/admin/users', 'auth'],
  ['GET', '/api/admin/my-roles', 'auth'],
  ['POST', '/api/admin/roles', 'auth'],
  ['DELETE', '/api/admin/roles/1', 'auth'],
  ['GET', '/api/admin/clubs/1/admins', 'auth'],
  ['GET', '/api/admin/clubs/1/users', 'auth'],
  ['GET', '/api/admin/teams/1/members', 'auth'],
  ['POST', '/api/admin/teams/1/members', 'auth'],
  ['PATCH', '/api/admin/teams/1/members/1', 'auth'],
  ['DELETE', '/api/admin/teams/1/members/1', 'auth'],
  ['GET', '/api/admin/users/1/profile', 'auth'],
  ['POST', '/api/admin/users/1/profile', 'auth'],
  ['DELETE', '/api/admin/users/1', 'auth'],
  ['GET', '/api/admin/teams/1/social-links', 'auth'],
  ['POST', '/api/admin/teams/1/social-links', 'auth'],
  ['DELETE', '/api/admin/teams/1/social-links/1', 'auth'],

  // ── /api/platform ──────────────────────────────────────────────────────────
  ['GET', '/api/platform/settings', 'auth'],
  ['PATCH', '/api/platform/settings', 'auth'],

  // ── /api/scout ─────────────────────────────────────────────────────────────
  ['GET', '/api/scout/', 'public'],
  ['GET', '/api/scout/sessions', 'auth'],
  ['GET', '/api/scout/status/1', 'optional'],
  ['POST', '/api/scout/match/1/lock', 'auth'],
  ['POST', '/api/scout/match/1/unlock', 'optional'],
  ['POST', '/api/scout/match/1/heartbeat', 'auth'],
  ['GET', '/api/scout/match/1', 'auth'],
  ['POST', '/api/scout/match/1', 'auth'],
  ['POST', '/api/scout/match/1/complete', 'auth'],

  // ── /api/training ──────────────────────────────────────────────────────────
  ['GET', '/api/training/ai-webhook-status', 'auth'],
  ['GET', '/api/training/ai-prompts-config/bundled', 'auth'],
  ['GET', '/api/training/ai-prompts-config', 'auth'],
  ['PUT', '/api/training/ai-prompts-config', 'auth'],
  ['POST', '/api/training/ai-prompts-config/activate', 'auth'],
  ['POST', '/api/training/ai-prompts-config/import-bundled', 'auth'],
  ['GET', '/api/training/locations', 'auth'],
  ['POST', '/api/training/locations', 'auth'],
  ['PATCH', '/api/training/locations/1', 'auth'],
  ['DELETE', '/api/training/locations/1', 'auth'],
  ['GET', '/api/training/venues', 'auth'],
  ['POST', '/api/training/venues', 'auth'],
  ['PATCH', '/api/training/venues/1', 'auth'],
  ['DELETE', '/api/training/venues/1', 'auth'],
  ['GET', '/api/training/defaults', 'auth'],
  ['POST', '/api/training/defaults', 'auth'],
  ['PATCH', '/api/training/defaults/1', 'auth'],
  ['DELETE', '/api/training/defaults/all', 'auth'],
  ['POST', '/api/training/defaults/restore', 'auth'],
  ['GET', '/api/training/week/2025-01', 'auth'],
  ['POST', '/api/training/week/2025-01/override', 'auth'],
  ['DELETE', '/api/training/week/2025-01/override', 'auth'],
  ['POST', '/api/training/exceptions', 'auth'],
  ['PATCH', '/api/training/exceptions/1', 'auth'],
  ['DELETE', '/api/training/exceptions/1', 'auth'],
  ['GET', '/api/training/team/1/schedule', 'auth'],
  ['GET', '/api/training/skill-tags', 'auth'],
  ['POST', '/api/training/skill-tags', 'auth'],
  ['DELETE', '/api/training/skill-tags/1', 'auth'],
  ['GET', '/api/training/exercises/pending-share', 'auth'],
  ['GET', '/api/training/exercises', 'auth'],
  ['POST', '/api/training/exercises', 'auth'],
  ['PATCH', '/api/training/exercises/1', 'auth'],
  ['DELETE', '/api/training/exercises/1', 'auth'],
  ['POST', '/api/training/exercises/1/request-share', 'auth'],
  ['POST', '/api/training/exercises/1/approve-share', 'auth'],
  ['POST', '/api/training/exercises/1/reject-share', 'auth'],
  ['GET', '/api/training/session/999999/attendance-list', 'auth'],
  ['GET', '/api/training/session/999999/search-club-members', 'auth'],
  ['POST', '/api/training/session/999999/add-guest', 'auth'],
  ['DELETE', '/api/training/session/999999/guest/1', 'auth'],
  ['POST', '/api/training/session/999999/exercises', 'auth'],
  ['PATCH', '/api/training/session/999999/exercises/1', 'auth'],
  ['DELETE', '/api/training/session/999999/exercises/1', 'auth'],
  ['GET', '/api/training/session/1/2025-01-01/1000', 'auth'],
  ['PATCH', '/api/training/session/999999', 'auth'],
  ['PATCH', '/api/training/session/999999/attendance', 'auth'],
  ['GET', '/api/training/teams', 'auth'],
  ['PATCH', '/api/training/teams/1', 'auth'],
  ['GET', '/api/training/snapshots', 'auth'],
  ['GET', '/api/training/snapshots/active', 'auth'],
  ['POST', '/api/training/snapshots', 'auth'],
  ['POST', '/api/training/snapshots/1/activate', 'auth'],
  ['PATCH', '/api/training/snapshots/1', 'auth'],
  ['DELETE', '/api/training/snapshots/1', 'auth'],
  ['POST', '/api/training/import', 'auth'],
  ['POST', '/api/training/ai-optimize', 'auth'],
  ['GET', '/api/training/nevobo-venues', 'auth'],
  ['GET', '/api/training/nevobo-match-fields/2025-01', 'auth'],

  // ── /api/export ────────────────────────────────────────────────────────────
  ['GET', '/api/export/teams', 'apiKey'],
  ['GET', '/api/export/training', 'apiKey'],
  ['POST', '/api/export/training', 'apiKey'],
];

describe('API routes smoke (alle routes, geen 500)', () => {
  for (const row of ROUTES) {
    const [method, path, kind] = row;
    it(`${method} ${path}`, async () => {
      await smokeRequest(method, path, kind);
    });
  }

  it('GET onbekende /api-route → 404 JSON', async () => {
    const res = await request(app).get('/api/__smoke_route_missing__');
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });

  it('GET / → SPA shell', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('html'));
  });
});
