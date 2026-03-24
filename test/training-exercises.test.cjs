'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../server/app');

describe('Training exercises API', () => {
  it('GET /api/training/exercises zonder token → 401', async () => {
    const res = await request(app).get('/api/training/exercises');
    assert.equal(res.status, 401);
  });

  it('GET /api/training/skill-tags zonder token → 401', async () => {
    const res = await request(app).get('/api/training/skill-tags');
    assert.equal(res.status, 401);
  });

  it('GET /api/training/exercises/pending-share zonder token → 401', async () => {
    const res = await request(app).get('/api/training/exercises/pending-share');
    assert.equal(res.status, 401);
  });

  it('POST /api/training/exercises zonder token → 401', async () => {
    const res = await request(app)
      .post('/api/training/exercises')
      .send({ name: 'Test', default_duration_minutes: 15, scope: 'private' })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 401);
  });
});
