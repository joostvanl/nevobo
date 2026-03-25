'use strict';

/**
 * OWASP Top 10 (2021) security test suite.
 *
 * Maps tests to OWASP categories:
 *   A01 — Broken Access Control
 *   A02 — Cryptographic Failures
 *   A03 — Injection
 *   A05 — Security Misconfiguration
 *   A07 — Identification & Authentication Failures
 *
 * Run:  node --test test/owasp-security.test.cjs
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../server/app');

// ── Helpers ──────────────────────────────────────────────────────────────────

const unique = () => `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function createUser(name) {
  const email = `${unique()}@test.volleyapp.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: name || 'SecTest User', email, password: 'Str0ngP@ss!' })
    .set('Content-Type', 'application/json');
  return { token: res.body.token, user: res.body.user, email };
}

// ─────────────────────────────────────────────────────────────────────────────
// A01 — Broken Access Control
// ─────────────────────────────────────────────────────────────────────────────

describe('A01 — Broken Access Control', () => {

  it('Protected routes reject requests without token', async () => {
    const protectedRoutes = [
      ['GET',  '/api/auth/me'],
      ['PATCH', '/api/auth/profile'],
      ['GET',  '/api/social/feed'],
      ['GET',  '/api/admin/users'],
      ['GET',  '/api/platform/settings'],
      ['GET',  '/api/training/teams'],
      ['GET',  '/api/training/ai-prompts-config'],
      ['GET',  '/api/carpool/coach/teams'],
    ];
    for (const [method, path] of protectedRoutes) {
      const res = await request(app)[method.toLowerCase()](path);
      assert.ok(
        [401, 403].includes(res.status),
        `${method} ${path} should reject unauthenticated — got ${res.status}`
      );
    }
  });

  it('Normal user cannot access super_admin routes', async () => {
    const { token } = await createUser('NormalUser');
    const adminRoutes = [
      ['GET',  '/api/admin/users'],
      ['GET',  '/api/platform/settings'],
      ['GET',  '/api/training/ai-prompts-config'],
    ];
    for (const [method, path] of adminRoutes) {
      const res = await request(app)[method.toLowerCase()](path)
        .set('Authorization', `Bearer ${token}`);
      assert.ok(
        [403].includes(res.status),
        `${method} ${path} should be 403 for normal user — got ${res.status}`
      );
    }
  });

  it('Cannot access another user\'s profile via admin endpoint', async () => {
    const { token } = await createUser('AttackerUser');
    const res = await request(app)
      .get('/api/admin/users/1/profile')
      .set('Authorization', `Bearer ${token}`);
    assert.ok([403, 404].includes(res.status), `Expected 403/404 — got ${res.status}`);
  });

  it('Cannot delete another user via admin endpoint', async () => {
    const victim = await createUser('VictimUser');
    const { token } = await createUser('AttackerUser2');
    const res = await request(app)
      .delete(`/api/admin/users/${victim.user.id}`)
      .set('Authorization', `Bearer ${token}`);
    assert.ok([403, 404].includes(res.status), `Expected 403/404 — got ${res.status}`);
  });

  it('Cannot manage team members without team_admin role', async () => {
    const { token } = await createUser('NoRoleUser');
    const res = await request(app)
      .get('/api/admin/teams/1/members')
      .set('Authorization', `Bearer ${token}`);
    assert.ok([403, 404].includes(res.status));
  });

  it('Cannot delete other user\'s media', async () => {
    const { token } = await createUser('MediaAttacker');
    const res = await request(app)
      .delete('/api/social/media/999999')
      .set('Authorization', `Bearer ${token}`);
    assert.ok([403, 404].includes(res.status));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A02 — Cryptographic Failures
// ─────────────────────────────────────────────────────────────────────────────

describe('A02 — Cryptographic Failures', () => {

  it('Password is not returned in login response', async () => {
    const { email } = await createUser('CryptoTest');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Str0ngP@ss!' })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.user.password_hash, undefined);
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('$2a$'), 'Response must not contain bcrypt hashes');
    assert.ok(!bodyStr.includes('$2b$'), 'Response must not contain bcrypt hashes');
  });

  it('Password is not returned in /me response', async () => {
    const { token } = await createUser('CryptoMe');
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.user.password_hash, undefined);
  });

  it('JWT uses HS256 and is properly structured', async () => {
    const { token } = await createUser('JWTCheck');
    const parts = token.split('.');
    assert.equal(parts.length, 3, 'JWT should have 3 parts');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.equal(header.alg, 'HS256');
    assert.equal(header.typ, 'JWT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A03 — Injection (SQL + XSS via API)
// ─────────────────────────────────────────────────────────────────────────────

describe('A03 — Injection', () => {

  it('SQL injection in login email field is rejected', async () => {
    const payloads = [
      "' OR 1=1 --",
      "admin@test.com' UNION SELECT * FROM users --",
      "'; DROP TABLE users; --",
    ];
    for (const email of payloads) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'anything' })
        .set('Content-Type', 'application/json');
      assert.ok(
        [400, 401, 422].includes(res.status),
        `SQLi payload should not succeed — got ${res.status} for: ${email}`
      );
      assert.ok(res.body.ok !== true, 'SQLi should never succeed');
    }
  });

  it('SQL injection in registration name field does not break', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: "Robert'); DROP TABLE users;--",
        email: `${unique()}@test.volleyapp.local`,
        password: 'Str0ngP@ss!',
      })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 201, 'Registration should succeed (name stored safely)');
    assert.ok(res.body.user.name.includes('DROP TABLE'), 'Name should be stored literally, not executed');
  });

  it('SQL injection in search/query parameters is safe', async () => {
    const { token } = await createUser('InjSearch');
    const sqliPayloads = [
      "' OR '1'='1",
      "1; DROP TABLE teams; --",
      "' UNION SELECT password FROM users --",
    ];
    for (const q of sqliPayloads) {
      const res = await request(app)
        .get(`/api/nevobo/search?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${token}`);
      assert.ok(res.status < 500, `Search should not cause 500 for: ${q} — got ${res.status}`);
    }
  });

  it('XSS payloads in profile name are stored literally (not executed)', async () => {
    const { token } = await createUser('XSSTest');
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(document.cookie)>',
    ];
    for (const name of xssPayloads) {
      const res = await request(app)
        .patch('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
        .set('Content-Type', 'application/json');
      assert.equal(res.status, 200);
      assert.equal(res.body.user.name, name, 'Payload should be stored literally (escaped on render)');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A05 — Security Misconfiguration
// ─────────────────────────────────────────────────────────────────────────────

describe('A05 — Security Misconfiguration', () => {

  it('Security headers are present (Helmet)', async () => {
    const res = await request(app).get('/');
    const h = res.headers;
    assert.ok(h['x-content-type-options'], 'X-Content-Type-Options header missing');
    assert.equal(h['x-content-type-options'], 'nosniff');
    assert.ok(h['x-frame-options'] || h['content-security-policy'], 'Framing protection missing');
  });

  it('Server does not expose X-Powered-By', async () => {
    const res = await request(app).get('/');
    assert.equal(res.headers['x-powered-by'], undefined, 'X-Powered-By should be removed by Helmet');
  });

  it('Error responses do not leak stack traces', async () => {
    const res = await request(app).get('/api/__trigger_error__');
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('at '), 'Response should not contain stack traces');
    assert.ok(!body.includes('node_modules'), 'Response should not reference node_modules');
  });

  it('404 responses are JSON, not HTML error pages', async () => {
    const res = await request(app).get('/api/nonexistent/route/here');
    assert.equal(res.status, 404);
    assert.ok(res.body.ok === false, 'API 404 should return structured JSON');
  });

  it('Malformed JSON body returns 400, not 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"broken json');
    assert.ok(res.status < 500, `Malformed JSON should not cause 500 — got ${res.status}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A07 — Identification & Authentication Failures
// ─────────────────────────────────────────────────────────────────────────────

describe('A07 — Identification & Authentication Failures', () => {

  it('Forged JWT with wrong secret is rejected', async () => {
    const forged = jwt.sign({ id: 1 }, 'wrong_secret_entirely', { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    assert.equal(res.status, 403, 'Forged JWT should be rejected');
  });

  it('Expired JWT is rejected', async () => {
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const expired = jwt.sign({ id: 1 }, secret, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    assert.equal(res.status, 403, 'Expired JWT should be rejected');
  });

  it('JWT with algorithm "none" is rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${noneToken}`);
    assert.ok([401, 403].includes(res.status), '"alg: none" JWT should be rejected');
  });

  it('Malformed Authorization header is handled gracefully', async () => {
    const badHeaders = [
      'Bearer',
      'Bearer ',
      'Basic dXNlcjpwYXNz',
      'garbage.token.here',
      'Bearer eyJ.broken',
    ];
    for (const auth of badHeaders) {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', auth);
      assert.ok(
        [401, 403].includes(res.status),
        `Malformed auth "${auth}" should be rejected — got ${res.status}`
      );
    }
  });

  it('Login does not reveal whether email exists', async () => {
    const realUser = await createUser('EnumTest');
    const wrongPw = await request(app)
      .post('/api/auth/login')
      .send({ email: realUser.email, password: 'wrong' })
      .set('Content-Type', 'application/json');
    const noUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'does_not_exist_ever@fake.com', password: 'wrong' })
      .set('Content-Type', 'application/json');
    assert.equal(wrongPw.status, noUser.status,
      'Same status code for wrong password and non-existent email prevents enumeration');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A04 — Insecure Design (IDOR checks)
// ─────────────────────────────────────────────────────────────────────────────

describe('A04 — Insecure Design (IDOR)', () => {

  it('User A cannot update User B\'s profile', async () => {
    const a = await createUser('IDOR_A');
    const b = await createUser('IDOR_B');
    const res = await request(app)
      .post(`/api/admin/users/${b.user.id}/profile`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Hacked' })
      .set('Content-Type', 'application/json');
    assert.ok([403, 404].includes(res.status));
  });

  it('User cannot modify training session of a team they don\'t belong to', async () => {
    const { token } = await createUser('IDOR_Training');
    const res = await request(app)
      .patch('/api/training/session/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'hacked' })
      .set('Content-Type', 'application/json');
    assert.ok([403, 404].includes(res.status));
  });

  it('User cannot delete another user\'s carpool offer', async () => {
    const { token } = await createUser('IDOR_Carpool');
    const res = await request(app)
      .delete('/api/carpool/offer/999999')
      .set('Authorization', `Bearer ${token}`);
    assert.ok([403, 404].includes(res.status));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A08 — Software and Data Integrity Failures
// ─────────────────────────────────────────────────────────────────────────────

describe('A08 — Data Integrity', () => {

  it('Export API rejects requests without valid API key', async () => {
    const res = await request(app).get('/api/export/teams?club=ckl9x7n');
    assert.ok([401, 403].includes(res.status));
  });

  it('Export API rejects wrong API key', async () => {
    const res = await request(app)
      .get('/api/export/teams?club=ckl9x7n')
      .set('X-API-Key', 'wrong_key_completely');
    assert.ok([401, 403].includes(res.status));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A09 — Security Logging and Monitoring Failures (basic)
// ─────────────────────────────────────────────────────────────────────────────

describe('A09 — Logging & Monitoring (basic)', () => {

  it('Rapid auth failures do not crash the server', async () => {
    const attempts = Array.from({ length: 20 }, () =>
      request(app)
        .post('/api/auth/login')
        .send({ email: 'brute@force.test', password: 'wrong' })
        .set('Content-Type', 'application/json')
    );
    const results = await Promise.all(attempts);
    for (const r of results) {
      assert.ok(r.status < 500, 'Rapid login attempts should not crash server');
    }
  });
});
