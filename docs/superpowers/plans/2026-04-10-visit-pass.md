# Minimal Patient Visit Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bangladesh-friendly “Visit Pass” flow so patients can share summary-level records with a hospital using one QR/code instead of managing complex consent settings.

**Architecture:** Add a dedicated visit-pass table and two small route surfaces: one patient-controlled creation/revocation flow in the global portal, and one tenant staff redemption flow that automatically grants short-lived summary consent to the redeeming hospital.

**Tech Stack:** Hono, D1, TypeScript, Vitest

---

### Task 1: Add the visit-pass persistence model

**Files:**
- Create: `migrations/0110_patient_visit_passes.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS patient_visit_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  code_last4 TEXT NOT NULL,
  global_user_id INTEGER NOT NULL,
  uhid TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by_tenant_id TEXT,
  redeemed_by_user_id INTEGER,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0110_patient_visit_passes.sql
git commit -m "feat: add patient visit pass table"
```

### Task 2: Add patient visit-pass creation and revocation

**Files:**
- Modify: `src/routes/global-portal.ts`
- Create: `src/schemas/visitPass.ts`
- Test: `test/global-visit-pass.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(body.pass_code).toMatch(/^VP-[A-Z2-9]{6}$/);
expect(body.scope).toBe('summary');
expect(body.qr_payload).toContain('/api/visit-pass/redeem');
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm vitest run test/global-visit-pass.test.ts`
Expected: FAIL because no visit-pass route exists

- [ ] **Step 3: Implement routes**

```ts
globalPortal.post('/visit-pass', ...);
globalPortal.delete('/visit-pass/:id', ...);
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/global-visit-pass.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/global-portal.ts src/schemas/visitPass.ts test/global-visit-pass.test.ts
git commit -m "feat: add patient visit pass issuance"
```

### Task 3: Add staff redemption flow

**Files:**
- Create: `src/routes/tenant/visitPass.ts`
- Modify: `src/index.ts`
- Test: `test/visit-pass-redeem.test.ts`

- [ ] **Step 1: Write the failing redeem tests**

```ts
expect(body.redeemed).toBe(true);
expect(body.scope).toBe('summary');
expect(body.hospitals).toHaveLength(2);
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm vitest run test/visit-pass-redeem.test.ts`
Expected: FAIL because redeem route is missing

- [ ] **Step 3: Implement redemption**

```ts
app.post('/redeem', zValidator('json', redeemVisitPassSchema), async (c) => {
  // validate pass
  // bind to tenant
  // create summary consents
  // return portable summaries
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/visit-pass-redeem.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/visitPass.ts src/index.ts test/visit-pass-redeem.test.ts
git commit -m "feat: add staff visit pass redemption"
```

### Task 4: Docs and verification

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Modify: `ozzyl-health-ecosystem-vision.md`
- Modify: `docs/superpowers/specs/2026-04-10-visit-pass-design.md`

- [ ] **Step 1: Update docs**

```md
- Patient Data Ownership & Temporary Consent Tokens | 🟡 Minimal visit-pass backend done | PHASE 2
```

- [ ] **Step 2: Run focused verification**

Run: `pnpm vitest run test/global-visit-pass.test.ts test/visit-pass-redeem.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add ozzyl_hms_assessment.md ozzyl-health-ecosystem-vision.md docs/superpowers/specs/2026-04-10-visit-pass-design.md docs/superpowers/plans/2026-04-10-visit-pass.md
git commit -m "docs: update visit pass progress"
```
