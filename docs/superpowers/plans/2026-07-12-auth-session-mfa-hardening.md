# Authentication, Session and MFA Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the automated W0-01 authentication/session/MFA P0 sub-gate with fail-closed permission resolution, typed token separation, session rotation, password-bound one-time MFA challenges, disabled-user protection and complete regression evidence.

**Architecture:** Centralize staff token issuance in one edge-compatible service. Keep bearer access JWTs and HttpOnly session JWTs purpose-bound with `tokenUse`; persist MFA login challenges in D1 for one-time, tenant-scoped consumption. Login, direct login, refresh and MFA completion all call the same fail-closed issuance path.

**Tech Stack:** TypeScript, Hono, Hono JWT, Cloudflare Workers/D1/KV, Vitest, SQLite migrations.

## Global Constraints

- Preserve tenant → authentication → authorization → route middleware order.
- Use Web Crypto APIs only; no Node-only crypto in runtime code.
- Permission resolution failures deny authentication; no static-role fallback.
- Session and challenge identifiers use `crypto.randomUUID()`.
- Cookie remains HttpOnly, Secure outside development, SameSite=Lax and scoped to `/api/auth`.
- Existing untyped bearer JWTs remain valid during transition; newly issued tokens are purpose-bound.
- Every completed task must be reviewed, verified and committed before the next independent readiness task begins.

---

### Task 1: Shared typed staff token issuance

**Files:**
- Create: `src/lib/staff-auth-tokens.ts`
- Modify: `src/middleware/auth.ts`
- Test: `test/unit/staff-auth-tokens.test.ts`
- Test: `test/integration/middleware/auth.test.ts`

**Interfaces:**
- Produces: `issueStaffTokenPair(env, user): Promise<{ accessToken: string; sessionToken: string }>`
- Produces: `issueMfaChallengeToken(secret, challenge): Promise<string>`
- Produces: `assertTokenUse(payload, expected, options?): void`

- [x] **Step 1: Write failing tests for distinct access/session claims and fail-closed permission resolution**
- [x] **Step 2: Run focused tests and verify RED**
- [x] **Step 3: Implement the shared issuance service using `resolveUserPermissions` without `.catch()` fallback**
- [x] **Step 4: Reject typed `session` and `mfa_challenge` JWTs in bearer authentication while accepting transitional untyped access JWTs**
- [x] **Step 5: Run focused tests and verify GREEN**

### Task 2: Rotate refresh sessions and revoke logout tokens

**Files:**
- Modify: `src/routes/tenant/auth.ts`
- Modify: `src/routes/login-direct.ts`
- Modify: `src/lib/staff-session-cookie.ts`
- Test: `test/integration/routes/staff-auth-session-hardening.test.ts`
- Test: `test/unit/staff-auth-session-regression.test.ts`

**Interfaces:**
- Consumes: `issueStaffTokenPair`
- Refresh accepts a typed `session` cookie or one transitional untyped cookie, revokes it, then returns a fresh access token and sets a fresh session cookie.

- [x] **Step 1: Write failing tests proving login issues distinct access/session tokens**
- [x] **Step 2: Write failing tests proving refresh rejects access/challenge cookies, rotates the session token and blacklists the old cookie**
- [x] **Step 3: Write failing tests proving logout blacklists both bearer and cookie tokens**
- [x] **Step 4: Implement minimal rotation and dual-token revocation**
- [x] **Step 5: Verify disabled users and inactive tenants cannot refresh**
- [x] **Step 6: Run focused tests and verify GREEN**

### Task 3: Persist password-bound MFA login challenges

**Files:**
- Create: `migrations/0417_mfa_login_challenges.sql`
- Modify: `tenant-schema.sql`
- Create: `src/lib/mfa-login-challenge.ts`
- Test: `test/mfa-login-challenge-migration.test.ts`
- Test: `test/unit/mfa-login-challenge.test.ts`

**Interfaces:**
- Produces: `createMfaLoginChallenge(db, secret, identity): Promise<string>`
- Produces: `loadMfaLoginChallenge(db, payload): Promise<MfaLoginChallenge>`
- Produces: `recordMfaChallengeFailure(db, challenge): Promise<'retry' | 'locked'>`
- Produces: `consumeMfaLoginChallenge(db, challenge): Promise<boolean>`

- [x] **Step 1: Write migration contract test for unique challenge IDs, tenant/user scope, expiry, failed-attempt count and consumed state**
- [x] **Step 2: Write failing unit tests for signed challenge purpose, expiry and tenant mismatch**
- [x] **Step 3: Add migration and fresh-install schema**
- [x] **Step 4: Implement D1 challenge creation, load, failure increment and atomic consume**
- [x] **Step 5: Run focused tests and verify GREEN**

### Task 4: Repair tenant and direct-login MFA flow

**Files:**
- Modify: `src/routes/tenant/auth.ts`
- Modify: `src/routes/login-direct.ts`
- Modify: `src/routes/tenant/mfa.ts`
- Modify: `src/middleware/auth.ts`
- Modify: `src/index.ts`
- Test: `test/integration/routes/mfa-login-flow.test.ts`
- Modify: `test/integration/routes/mfa.test.ts`

**Interfaces:**
- Login response when MFA is enabled: `{ mfa_required: true, challenge_token: string }`
- MFA verify body: `{ challenge_token: string; code: string }`

- [x] **Step 1: Write failing end-to-end route tests showing password login returns a challenge and no access/session token**
- [x] **Step 2: Write failing tests showing `/api/mfa/verify` is public only for challenge completion and no longer accepts `user_id`**
- [x] **Step 3: Write failing tests for invalid tenant, inactive user, inactive tenant, expired/reused challenge and five failed codes**
- [x] **Step 4: Make only `/api/mfa/verify` publicly reachable and rate-limit it**
- [x] **Step 5: Resolve active user state and effective permissions fail closed before issuing the final token pair**
- [x] **Step 6: Consume recovery codes and the challenge atomically enough that a second challenge use is rejected**
- [x] **Step 7: Run focused tests and verify GREEN**

### Task 5: Direct-login account-state parity

**Files:**
- Modify: `src/routes/login-direct.ts`
- Test: `test/integration/routes/login-direct-security.test.ts`

**Interfaces:**
- Direct-login success is revalidated against `u.is_active`, `u.mfa_enabled` and active tenant status before any credential leaves the response boundary.
- Hospital selection includes only active user records on active tenants.

- [x] **Step 1: Write failing tests for deactivated single-tenant and multi-tenant accounts**
- [x] **Step 2: Add user-state fields and active-account filtering**
- [x] **Step 3: Route direct-login MFA users through the same challenge service**
- [x] **Step 4: Run focused tests and verify GREEN**

### Task 6: Review evidence, verification and readiness update

**Files:**
- Create: `docs/production-readiness/AUTH_SESSION_MFA_REVIEW.md`
- Modify: `docs/production-readiness/CURRENT_NEXT_TASK.md`
- Modify: `docs/HMS_PRODUCTION_READINESS_TRACKER.md`
- Modify: `docs/production-readiness/index.md`

**Interfaces:**
- Produces a conservative automated sub-gate verdict without marking W0-01 or any module fully `READY`.

- [ ] **Step 1: Run focused auth/session/MFA tests and record exact file/test counts**
- [ ] **Step 2: Run `pnpm exec tsc --noEmit`**
- [ ] **Step 3: Run `pnpm test`**
- [ ] **Step 4: Run `pnpm build`**
- [ ] **Step 5: Perform adversarial review for token confusion, challenge replay, disabled-user bypass, tenant mismatch and fail-open permission resolution**
- [ ] **Step 6: Update readiness docs with exact commands, results, changed files, remaining manual work and commit SHA placeholder**
- [ ] **Step 7: Commit the reviewed W0-01 automated sub-gate changes**
