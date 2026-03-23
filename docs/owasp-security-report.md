# OWASP Top 10 Security Test Report

**Application:** Volleyball Team App  
**Date:** 2026-03-22  
**Test file:** `test/owasp-security.test.cjs`  
**Run command:** `npm run test:security`  
**Result:** 29/29 passed

---

## Summary

| OWASP Category | Tests | Status | Findings |
|---|---|---|---|
| A01 — Broken Access Control | 6 | PASS | None |
| A02 — Cryptographic Failures | 3 | PASS | None |
| A03 — Injection | 4 | PASS | None |
| A04 — Insecure Design (IDOR) | 3 | PASS | None |
| A05 — Security Misconfiguration | 5 | PASS | 1 fixed during testing |
| A07 — Authentication Failures | 5 | PASS | None |
| A08 — Data Integrity | 2 | PASS | None |
| A09 — Logging & Monitoring | 1 | PASS | None |

Categories A06 (Vulnerable Components) and A10 (SSRF) are not covered by automated tests. A06 should be addressed through regular `npm audit` runs. A10 is low risk given the app does not proxy arbitrary user-supplied URLs.

---

## Detailed Results

### A01 — Broken Access Control

All protected API routes enforce authentication. Role-based authorization (super_admin, club_admin, team_admin) prevents privilege escalation.

| Test | Result |
|---|---|
| Protected routes reject requests without token | PASS |
| Normal user cannot access super_admin routes | PASS |
| Cannot access another user's profile via admin endpoint | PASS |
| Cannot delete another user via admin endpoint | PASS |
| Cannot manage team members without team_admin role | PASS |
| Cannot delete other user's media | PASS |

**How it works:** `verifyToken` middleware on all sensitive routes rejects missing/invalid JWTs with 401. Role checks (`requireSuperAdmin`, `requireClubAdmin`, `requireTeamAdmin`) return 403 when the authenticated user lacks the required role. Resource ownership is verified per-request (e.g. media deletion checks `user_id` match).

### A02 — Cryptographic Failures

No sensitive data leaks through API responses. Passwords are hashed with bcrypt and never returned to clients.

| Test | Result |
|---|---|
| Password hash not in login response | PASS |
| Password hash not in /me response | PASS |
| JWT uses HS256 with proper structure | PASS |

**How it works:** User queries explicitly select columns or strip `password_hash` before responding. JWTs are signed with HS256 using `JWT_SECRET` from environment variables.

### A03 — Injection

The application uses parameterized queries (prepared statements via `better-sqlite3`) throughout. No SQL injection vectors were found. XSS payloads are stored literally and escaped on render via `escHtml()`.

| Test | Result |
|---|---|
| SQL injection in login email field | PASS |
| SQL injection in registration name (Bobby Tables) | PASS |
| SQL injection in search/query parameters | PASS |
| XSS payloads stored literally, not executed | PASS |

**How it works:** All database access uses `db.prepare(...).run/get/all(params)` — the SQLite driver handles escaping. Frontend rendering uses `escHtml()` for all user-supplied strings in HTML templates.

### A04 — Insecure Design (IDOR)

Users cannot access or modify resources belonging to other users or teams they don't belong to.

| Test | Result |
|---|---|
| User A cannot update User B's profile | PASS |
| Cannot modify training session of unrelated team | PASS |
| Cannot delete another user's carpool offer | PASS |

**How it works:** Each mutation endpoint verifies ownership or membership. Training session endpoints check `team_memberships` before allowing access. Admin profile endpoints verify the caller has admin rights over the target user's club/team.

### A05 — Security Misconfiguration

Security headers are properly configured via Helmet. Error responses don't leak implementation details.

| Test | Result |
|---|---|
| Helmet security headers present (X-Content-Type-Options, etc.) | PASS |
| X-Powered-By header removed | PASS |
| Error responses don't contain stack traces | PASS |
| API 404 returns structured JSON | PASS |
| Malformed JSON body returns 400 | PASS (fixed) |

**Finding fixed during testing:** Malformed JSON request bodies (`{"broken json`) caused a 500 response with a full stack trace visible to the client. This was fixed by adding `entity.parse.failed` handling to the global error handler in `server/app.js`. The response is now a clean 400 with `"Ongeldige JSON in request body"`.

**Known trade-offs:**
- `contentSecurityPolicy` is disabled in Helmet because the app loads scripts from CDNs (Leaflet, Chart.js) and uses inline handlers in legacy HTML. This is documented in the codebase.
- CORS is fully open (`cors()`). The API relies on JWT authentication rather than origin restrictions, which is acceptable for a mobile-first PWA.

### A07 — Identification & Authentication Failures

JWT verification is strict. Forged, expired, and algorithm-downgrade tokens are all rejected. Login responses don't reveal whether an email address is registered.

| Test | Result |
|---|---|
| Forged JWT (wrong secret) rejected | PASS |
| Expired JWT rejected | PASS |
| JWT with `alg: none` rejected | PASS |
| Malformed Authorization headers handled | PASS |
| Login doesn't reveal email existence (enumeration) | PASS |

**How it works:** `jsonwebtoken.verify()` with an explicit secret rejects tokens signed with other secrets or the `none` algorithm. Login returns the same HTTP status for wrong-password and non-existent-email, preventing user enumeration.

### A08 — Data Integrity

The export API (used by N8N integrations) requires a valid API key and rejects unauthorized requests.

| Test | Result |
|---|---|
| Export API rejects missing API key | PASS |
| Export API rejects wrong API key | PASS |

### A09 — Logging & Monitoring

The server remains stable under rapid authentication attempts.

| Test | Result |
|---|---|
| 20 concurrent failed logins don't crash server | PASS |

**Note:** The application does not currently implement rate limiting on authentication endpoints. While the bcrypt cost factor provides natural throttling (~250ms per attempt), adding explicit rate limiting (e.g. `express-rate-limit`) would further mitigate brute-force attacks. This is recommended as a future improvement.

---

## Not Covered / Recommendations

| Area | Status | Recommendation |
|---|---|---|
| A06 — Vulnerable Components | Not tested | Run `npm audit` regularly; consider adding it to CI |
| A10 — SSRF | Low risk | App doesn't proxy arbitrary URLs; Nevobo scraper fetches from known domains only |
| Rate limiting | Not implemented | Add `express-rate-limit` on `/api/auth/login` and `/api/auth/register` |
| CSP headers | Disabled | Evaluate whether a permissive CSP policy (allowing specific CDN origins) is feasible |
| HTTPS enforcement | N/A in tests | Handled by Cloudflare tunnel in production |
| Cookie security | N/A | App uses Bearer tokens, not cookies |

---

## Running the Tests

```bash
# Security tests only
npm run test:security

# Full test suite (includes security)
npm test
```

Tests use Node's built-in test runner and `supertest` against the Express app directly (no running server needed). Test users are created with unique emails per run and do not interfere with production data.
