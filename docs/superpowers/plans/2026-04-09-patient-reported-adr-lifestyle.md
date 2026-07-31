# Patient-Reported ADR and Lifestyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add patient-reported adverse reactions and lifestyle logs with clinician-facing review and summary endpoints.

**Architecture:** Introduce dedicated global tables for ADRs and lifestyle logs, keep patient entry in the global patient portal, and expose tenant staff review routes keyed from local patient id to global UHID. Reuse the existing clinical review metadata model instead of inventing another trust system.

**Tech Stack:** Hono, TypeScript, Cloudflare D1, Vitest

---

### Task 1: Add failing tests for patient portal ADR and lifestyle routes

**Files:**
- Create: `test/patient-phr-reported-experience.test.ts`
- Modify: `src/routes/patient-phr.ts`
- Test: `test/patient-phr-reported-experience.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('allows an authenticated patient to create and list ADRs and lifestyle logs', async () => {
  expect(createAdr.status).toBe(201);
  expect(createLifestyle.status).toBe(201);
  expect(listBody.adverse_reactions[0].medication_name).toBe('Ibuprofen');
  expect(listBody.lifestyle_logs[0].sleep_hours).toBe(4.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-phr-reported-experience.test.ts`
Expected: FAIL because these routes do not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
patientPhrRoutes.get('/adverse-reactions', async (c) => c.json({ adverse_reactions: [] }));
patientPhrRoutes.post('/adverse-reactions', async (c) => c.json({ success: true }, 201));
patientPhrRoutes.get('/lifestyle-logs', async (c) => c.json({ lifestyle_logs: [] }));
patientPhrRoutes.post('/lifestyle-logs', async (c) => c.json({ success: true }, 201));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/patient-phr-reported-experience.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/patient-phr-reported-experience.test.ts src/routes/patient-phr.ts
git commit -m "test: add patient-reported experience route coverage"
```

### Task 2: Add failing tests for clinician summary and review routes

**Files:**
- Create: `src/routes/tenant/patientReported.ts`
- Create: `test/patient-reported-review.test.ts`
- Modify: `src/index.ts`
- Test: `test/patient-reported-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns ADR and lifestyle summary for a globally linked patient and allows review', async () => {
  expect(summary.status).toBe(200);
  expect(body.highlights.pending_review_count).toBeGreaterThanOrEqual(1);
  expect(review.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-reported-review.test.ts`
Expected: FAIL because the route is not mounted yet

- [ ] **Step 3: Write minimal implementation**

```ts
const app = new Hono();
app.get('/patient/:id/summary', async (c) => c.json({ adverse_reactions: [], lifestyle_logs: [], highlights: {} }));
app.put('/adverse-reactions/:id/review', async (c) => c.json({ success: true }));
app.put('/lifestyle-logs/:id/review', async (c) => c.json({ success: true }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/patient-reported-review.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/patientReported.ts src/index.ts test/patient-reported-review.test.ts
git commit -m "test: add clinician review coverage for patient-reported data"
```

### Task 3: Add schema and migration support

**Files:**
- Create: `migrations/0109_patient_reported_experience.sql`
- Create: `src/schemas/patientReported.ts`
- Modify: `src/routes/patient-phr.ts`
- Modify: `src/routes/tenant/patientReported.ts`
- Test: `test/patient-phr-reported-experience.test.ts`
- Test: `test/patient-reported-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('validates ADR severity and requires meaningful lifestyle content', () => {
  expect(adrSchema.safeParse({ medication_name: '', reaction: 'rash' }).success).toBe(false);
  expect(lifestyleLogSchema.safeParse({ logged_on: '2026-04-09' }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-phr-reported-experience.test.ts test/patient-reported-review.test.ts`
Expected: FAIL because schemas and tables do not exist

- [ ] **Step 3: Write minimal implementation**

```sql
CREATE TABLE IF NOT EXISTS global_patient_adverse_reactions (...);
CREATE TABLE IF NOT EXISTS global_patient_lifestyle_logs (...);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/patient-phr-reported-experience.test.ts test/patient-reported-review.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/0109_patient_reported_experience.sql src/schemas/patientReported.ts src/routes/patient-phr.ts src/routes/tenant/patientReported.ts
git commit -m "feat: add patient-reported ADR and lifestyle schema"
```

### Task 4: Implement summary generation and review metadata behavior

**Files:**
- Modify: `src/routes/tenant/patientReported.ts`
- Modify: `src/routes/patient-phr.ts`
- Modify: `test/patient-reported-review.test.ts`
- Modify: `test/patient-phr-reported-experience.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('computes summary highlights from recent lifestyle and ADR data', async () => {
  expect(body.highlights.average_sleep_hours).toBe(5.25);
  expect(body.highlights.severe_adr_count).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-reported-review.test.ts`
Expected: FAIL because summary highlights are not computed yet

- [ ] **Step 3: Write minimal implementation**

```ts
const average_sleep_hours = lifestyleLogs.length
  ? Number((lifestyleLogs.reduce((sum, item) => sum + Number(item.sleep_hours ?? 0), 0) / lifestyleLogs.length).toFixed(2))
  : null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/patient-reported-review.test.ts test/patient-phr-reported-experience.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/patientReported.ts src/routes/patient-phr.ts test/patient-reported-review.test.ts test/patient-phr-reported-experience.test.ts
git commit -m "feat: add patient-reported summary highlights"
```

### Task 5: Regression, docs, and final verification

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Test: `test/patient-phr-reported-experience.test.ts`
- Test: `test/patient-reported-review.test.ts`

- [ ] **Step 1: Update assessment**

```md
Priority: Next-Gen Patient Ecosystem
├── Patient-reported lifestyle & ADR module ✅
├── Verified-by-doctor review path ✅
└── AI physician summary still pending
```

- [ ] **Step 2: Run focused regression**

Run: `pnpm vitest run test/patient-phr-reported-experience.test.ts test/patient-reported-review.test.ts test/patient-b2c.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Check working tree**

Run: `git status --short`
Expected: only intended new files and unrelated pre-existing user changes remain

- [ ] **Step 5: Commit**

```bash
git add ozzyl_hms_assessment.md migrations/0109_patient_reported_experience.sql src/schemas/patientReported.ts src/routes/patient-phr.ts src/routes/tenant/patientReported.ts src/index.ts test/patient-phr-reported-experience.test.ts test/patient-reported-review.test.ts
git commit -m "feat: add patient-reported ADR and lifestyle review flows"
```
