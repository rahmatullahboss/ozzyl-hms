# Patient AI Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a patient-triggered AI planner that creates a saved structured health guidance plan from the patient’s global records and shows the latest plan plus plan history in a card-based portal UI.

**Architecture:** Add a global patient planner route layer on top of the existing global portal auth flow, store generated plans in a new D1 table, use the existing AI JSON client for structured output, and render the saved plans in a new dedicated patient portal tab. The backend owns aggregation, validation, safety framing, and daily limit checks. The frontend only renders saved structured content.

**Tech Stack:** Hono, D1, Cloudflare Workers AI/OpenRouter wrapper, React, Vitest, existing patient portal UI and i18n files

---

### Task 1: Add failing tests for planner persistence and route behavior

**Files:**
- Create: `test/integration/routes/patient-ai-planner.test.ts`
- Test: `test/integration/routes/patient-ai-planner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('generates and lists a saved patient AI plan', async () => {
  expect(generateRes.status).toBe(201);
  expect(listRes.status).toBe(200);
  expect(body.plans[0].headline).toBe('Focus on blood sugar stability');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/routes/patient-ai-planner.test.ts`
Expected: FAIL because the planner routes do not exist yet

- [ ] **Step 3: Add a second failing limit test**

```ts
it('rejects a second patient AI plan generation on the same day', async () => {
  expect(secondRes.status).toBe(429);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run test/integration/routes/patient-ai-planner.test.ts`
Expected: FAIL because the daily limit check does not exist yet

- [ ] **Step 5: Commit**

```bash
git add test/integration/routes/patient-ai-planner.test.ts
git commit -m "test: add patient ai planner route coverage"
```

### Task 2: Add failing tests for planner normalization helpers

**Files:**
- Modify: `test/patient-portal-ux.test.ts`
- Test: `test/patient-portal-ux.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
it('normalizes patient ai planner payload for card rendering', () => {
  expect(normalized.latestPlan?.headline).toBe('Focus on blood sugar stability');
  expect(normalized.remainingGenerationsToday).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: FAIL because planner UX helpers do not exist yet

- [ ] **Step 3: Commit**

```bash
git add test/patient-portal-ux.test.ts
git commit -m "test: add patient ai planner ux helper coverage"
```

### Task 3: Add planner persistence schema

**Files:**
- Create: `migrations/0118_patient_ai_plans.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS patient_ai_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER NOT NULL,
  uhid TEXT NOT NULL,
  patient_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_ai_plans_user_created
  ON patient_ai_plans(global_user_id, created_at DESC);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0118_patient_ai_plans.sql
git commit -m "feat: add patient ai plan persistence"
```

### Task 4: Add planner schema and aggregation library

**Files:**
- Create: `src/schemas/patientAiPlanner.ts`
- Create: `src/lib/patient-ai-planner.ts`
- Modify: `src/lib/ai-memory.ts`

- [ ] **Step 1: Add the planner schema**

```ts
export const patientAiPlanSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  focus_areas: z.array(z.string()).default([]),
  eat_more: z.array(z.string()).default([]),
  avoid_or_reduce: z.array(z.string()).default([]),
  daily_routine: z.array(z.string()).default([]),
  exercise_plan: z.array(z.string()).default([]),
  follow_up_actions: z.array(z.string()).default([]),
  warning_signs: z.array(z.string()).default([]),
  doctor_consultation_advice: z.array(z.string()).default([]),
  disclaimer: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  data_gaps: z.array(z.string()).default([]),
});
```

- [ ] **Step 2: Add aggregation and prompt helpers**

```ts
export async function buildPatientAiPlannerSnapshot(env: Env, db: D1Database, globalUserId: number) {
  return {
    identity: { ... },
    dashboard: { ... },
    summaries: [],
    vaultDocuments: [],
    reportedData: [],
    adverseReactions: [],
    lifestyleLogs: [],
    vitals: [],
  };
}
```

- [ ] **Step 3: Extend AI memory feature union**

```ts
| 'patient_health_planner';
```

- [ ] **Step 4: Commit**

```bash
git add src/schemas/patientAiPlanner.ts src/lib/patient-ai-planner.ts src/lib/ai-memory.ts
git commit -m "feat: add patient ai planner aggregation"
```

### Task 5: Add global portal planner routes

**Files:**
- Modify: `src/routes/global-portal.ts`

- [ ] **Step 1: Write the route implementation**

```ts
globalPortal.get('/ai-plans', async (c) => c.json({ latest_plan: null, plans: [], remaining_generations_today: 1 }));
globalPortal.get('/ai-plans/:id', async (c) => c.json({ plan: null }));
globalPortal.post('/ai-plans/generate', async (c) => c.json({ plan: {} }, 201));
```

- [ ] **Step 2: Replace stubs with real generation flow**

```ts
const snapshot = await buildPatientAiPlannerSnapshot(c.env, db, globalUserId);
const aiResult = await callAIJson<PatientAiPlan>(...);
await saveInteraction(c.env, 'global', String(globalUserId), 'patient_health_planner', inputSummary, JSON.stringify(aiResult.data));
```

- [ ] **Step 3: Enforce daily limit**

```ts
SELECT COUNT(*) as total
FROM patient_ai_plans
WHERE global_user_id = ? AND date(created_at) = date('now')
```

- [ ] **Step 4: Run route tests**

Run: `pnpm vitest run test/integration/routes/patient-ai-planner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/global-portal.ts
git commit -m "feat: add patient ai planner routes"
```

### Task 6: Add patient planner UI helpers and section wiring

**Files:**
- Modify: `web/src/lib/patientPortalUx.ts`
- Modify: `web/src/pages/PatientDashboardPage.tsx`

- [ ] **Step 1: Add planner payload and normalization helpers**

```ts
export interface PatientAiPlanPayload { ... }
export function normalizePatientAiPlannerPayload(input: PatientAiPlanPayload | null | undefined) { ... }
```

- [ ] **Step 2: Add planner section id**

```ts
| 'ai-planner'
```

- [ ] **Step 3: Add section metadata**

```ts
{ id: 'ai-planner', label: 'AI Planner', description: 'Saved health guidance and daily care plans' }
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/patientPortalUx.ts web/src/pages/PatientDashboardPage.tsx
git commit -m "feat: wire patient ai planner tab"
```

### Task 7: Build the patient planner tab UI

**Files:**
- Create: `web/src/components/patient/PatientAIPlannerTab.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx`
- Modify: `web/public/locales/en/patients.json`
- Modify: `web/public/locales/bn/patients.json`

- [ ] **Step 1: Create the tab component**

```tsx
export default function PatientAIPlannerTab() {
  return <div>...</div>;
}
```

- [ ] **Step 2: Render the latest plan hero card**

```tsx
<section>
  <h2>{latestPlan.headline}</h2>
  <p>{latestPlan.summary}</p>
</section>
```

- [ ] **Step 3: Render structured section cards**

```tsx
{[
  ['eat_more', latestPlan.eat_more],
  ['avoid_or_reduce', latestPlan.avoid_or_reduce],
  ['daily_routine', latestPlan.daily_routine],
].map(...)}
```

- [ ] **Step 4: Render history cards and generation CTA**

```tsx
<button disabled={remainingGenerationsToday <= 0}>Generate AI Plan</button>
```

- [ ] **Step 5: Add the tab to the dashboard switch**

```tsx
{activeTab === 'ai-planner' && <PatientAIPlannerTab />}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/patient/PatientAIPlannerTab.tsx web/src/pages/PatientDashboardPage.tsx web/public/locales/en/patients.json web/public/locales/bn/patients.json
git commit -m "feat: add patient ai planner cards"
```

### Task 8: Final verification

**Files:**
- Modify: any touched file if needed

- [ ] **Step 1: Run route and helper tests**

Run: `pnpm vitest run test/integration/routes/patient-ai-planner.test.ts test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 2: Run full focused planner verification**

Run: `pnpm vitest run test/integration/routes/patient-ai-planner.test.ts test/integration/routes/patient-live-visit-status.test.ts test/patient-live-visit.test.ts test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 3: Run web build**

Run: `pnpm --filter web build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: ship patient ai planner v1"
```
