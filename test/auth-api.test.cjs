'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../server/app');

describe('Auth & club API', () => {
  let token;
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.volleyapp.local`;
  const password = 'testpass123';
  const name = 'Test User';

  it('POST /api/auth/register — nieuw account', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 201, res.body?.error || '');
    assert.equal(res.body.ok, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, email);
    token = res.body.token;
  });

  it('POST /api/auth/register — dubbel e-mail → 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 409);
  });

  it('POST /api/auth/login — fout wachtwoord → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'fout' })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 401);
  });

  it('POST /api/auth/login — ok', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    token = res.body.token;
  });

  it('GET /api/auth/me — met Bearer', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user.email, email);
    assert.ok(Array.isArray(res.body.user.memberships));
  });

  it('GET /api/auth/me — zonder token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  it('PATCH /api/auth/profile — naam bijwerken', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test User Updated' })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Test User Updated');
  });

  it('GET /api/clubs/999999 — onbekende club → 404', async () => {
    const res = await request(app).get('/api/clubs/999999');
    assert.equal(res.status, 404);
  });
});
