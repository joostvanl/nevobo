'use strict';

/**
 * Integratietests tegen de Express-app zonder te luisteren op een poort.
 * Eerste load van `server/app` trekt `server/db/db.js` mee — die maakt `data/`
 * en `volleyball.db` aan en draait schema + migraties indien nodig.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../server/app');

describe('HTTP API (integratie)', () => {
  it('GET onbekende /api-route → 404 JSON', async () => {
    const res = await request(app).get('/api/__does_not_exist__');
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
    assert.ok(typeof res.body.error === 'string');
  });

  it('GET /api/gamification/badges → 200 met badges-array', async () => {
    const res = await request(app).get('/api/gamification/badges');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.badges));
  });

  it('GET /api/gamification/goals → 200 met goals-array', async () => {
    const res = await request(app).get('/api/gamification/goals');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.goals));
  });

  it('GET /api/clubs → 200 met clubs-array', async () => {
    const res = await request(app).get('/api/clubs');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.clubs));
  });

  it('GET / → SPA shell (index.html)', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('html'));
  });

  it('GET /api/platform/settings zonder Authorization → 401', async () => {
    const res = await request(app).get('/api/platform/settings');
    assert.equal(res.status, 401);
  });
});
