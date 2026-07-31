# Staff Self-Service Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let hospital staff securely request and complete a one-time password reset so the administrator never needs to choose or know the staff member's password.

**Architecture:** Store one-time SHA-256 token hashes in D1, expose public Hono routes for request/validation/reset, send the existing password-reset email template, clear both D1 and KV lockout state after reset, and add dedicated React pages wired from the login screen. Invitation result copy will explicitly direct the administrator to send—not open—the link.

**Tech Stack:** Cloudflare Workers, Hono, D1, KV, Web Crypto, Zod, React Router, Vitest, Testing Library.

## Global Constraints

- D1 is the authoritative store for reset-token state.
- KV remains limited to the existing direct-login lock counter.
- Raw reset tokens and passwords must never be logged or stored.
- Unknown emails must receive the same response as known emails.
- Reset links expire after one hour and are one-time use.
- A successful reset clears `users.login_attempts`, `users.locked_until`, and the matching KV lock key.
- Existing unrelated code and behavior must remain unchanged.

---

### Task 1: Password-reset persistence contract

**Files:**
- Create: `migrations/0433_staff_password_resets.sql`
- Create: `test/staff-password-reset-schema.test.ts`

**Interfaces:**
- Produces table `staff_password_resets(id, user_id, tenant_id, token_hash, expires_at, used_at, created_at)` with token and user indexes.

- [ ] **Step 1: Write the failing schema test**

Assert the migration creates the table, foreign keys to `users` and `tenants`, a unique token hash, and indexes for token lookup and user invalidation.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/staff-password-reset-schema.test.ts`
Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add the migration**

Use `CREATE TABLE IF NOT EXISTS`, `ON DELETE CASCADE` for the user, tenant-scoped foreign keys, and partial/ordinary indexes compatible with D1 SQLite.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/staff-password-reset-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0433_staff_password_resets.sql test/staff-password-reset-schema.test.ts
git commit -m "feat(auth): add staff password reset persistence"
```

### Task 2: Public reset API and lock clearing

**Files:**
- Create: `src/routes/staff-password-reset.ts`
- Modify: `src/index.ts`
- Modify: `src/lib/email.ts`
- Test: `test/staff-password-reset-routes.test.ts`
- Test: `test/email-templates.test.ts` or a focused new template test if the existing file is unsuitable.

**Interfaces:**
- Produces `POST /api/auth/forgot-password`.
- Produces `GET /api/auth/reset-password/:token`.
- Produces `POST /api/auth/reset-password/:token` with body `{ password: string }`.

- [ ] **Step 1: Write failing route tests**

Cover neutral unknown-email responses, hashed-token insertion, valid token metadata, expired/used token rejection, password update, D1 lock clearing, token consumption, and KV lock deletion.

- [ ] **Step 2: Run the route tests and confirm they fail**

Run: `pnpm exec vitest run test/staff-password-reset-routes.test.ts`
Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement token helpers and schemas**

Use 32 random bytes, SHA-256 hex hashing, a one-hour ISO expiry, the existing `isStrongPassword`, `hashPassword`, `clearAccountLockout`, `sendEmail`, and `EmailTemplates.passwordReset` helpers.

- [ ] **Step 4: Implement neutral request behavior**

Normalize the submitted email, query active users joined to active tenants, invalidate their prior unused tokens, insert a new token hash per account, and send a reset URL based on `HMS_APP_URL`. Return the same `200` message regardless of matches or delivery results.

- [ ] **Step 5: Implement token validation and reset**

Validate unused/non-expired tokens, update the password and D1 lock fields, mark the token used, expire sibling tokens, clear the KV lock for the normalized email, and write a minimal audit event.

- [ ] **Step 6: Mount the routes**

Mount the router in `src/index.ts` under `/api/auth` without tenant middleware.

- [ ] **Step 7: Run backend tests**

Run: `pnpm exec vitest run test/staff-password-reset-routes.test.ts test/staff-password-reset-schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/staff-password-reset.ts src/index.ts src/lib/email.ts test/staff-password-reset-routes.test.ts test/email-templates.test.ts
git commit -m "feat(auth): add staff self-service password reset API"
```

### Task 3: Forgot/reset password web flow

**Files:**
- Create: `web/src/pages/ForgotPassword.tsx`
- Create: `web/src/pages/ResetPassword.tsx`
- Create: `web/src/pages/ForgotPassword.test.tsx`
- Create: `web/src/pages/ResetPassword.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/Login.tsx`

**Interfaces:**
- Produces public routes `/forgot-password` and `/reset-password?token=...`.

- [ ] **Step 1: Write failing component tests**

Verify request submission, neutral confirmation, token validation, strong-password fields, mismatch handling, successful reset, and login navigation.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter web exec vitest run src/pages/ForgotPassword.test.tsx src/pages/ResetPassword.test.tsx`
Expected: FAIL because the pages do not exist.

- [ ] **Step 3: Implement the request page**

Use the existing API client and auth visual patterns. Always render a neutral confirmation after a successful API response.

- [ ] **Step 4: Implement the reset page**

Read `token` from the query string, validate it on load, collect password/confirmation, enforce the existing strong-password rule client-side, submit the reset, and redirect to `/login` after success.

- [ ] **Step 5: Wire routes and login link**

Replace the dead `href="#"` Forgot Password link with a React Router link to `/forgot-password` and add both public routes to `App.tsx`.

- [ ] **Step 6: Run web tests**

Run: `pnpm --filter web exec vitest run src/pages/ForgotPassword.test.tsx src/pages/ResetPassword.test.tsx src/pages/Login.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ForgotPassword.tsx web/src/pages/ResetPassword.tsx web/src/pages/ForgotPassword.test.tsx web/src/pages/ResetPassword.test.tsx web/src/App.tsx web/src/pages/Login.tsx
git commit -m "feat(auth): add staff password recovery pages"
```

### Task 4: Invitation misuse prevention and final verification

**Files:**
- Modify: `web/src/pages/InviteStaff.tsx`
- Modify: `web/src/pages/InviteStaff.test.ts`
- Modify: `web/src/pages/StaffPage.tsx`
- Modify: `web/src/pages/StaffPage.test.ts`

**Interfaces:**
- Produces explicit administrator-facing warning copy in both invitation surfaces.

- [ ] **Step 1: Write failing copy tests**

Assert both invitation result surfaces state that the recipient must open the link and create the password, and that the administrator must not open or complete the link.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter web exec vitest run src/pages/InviteStaff.test.ts src/pages/StaffPage.test.ts`
Expected: FAIL because the warning is absent.

- [ ] **Step 3: Add the warning copy**

Keep the fallback copy button, but visually distinguish the instruction and avoid language implying the administrator should accept the invitation.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter web exec vitest run src/pages/InviteStaff.test.ts src/pages/StaffPage.test.ts src/pages/ForgotPassword.test.tsx src/pages/ResetPassword.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run type and build verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm build:web`
Expected: PASS.

Run: `pnpm build:migrations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/InviteStaff.tsx web/src/pages/InviteStaff.test.ts web/src/pages/StaffPage.tsx web/src/pages/StaffPage.test.ts
git commit -m "fix(auth): make invitee-owned passwords explicit"
```
