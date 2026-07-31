# Washout-Aware Medication Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curated washout-period safety checks so new prescriptions can be blocked when a recently discontinued high-risk medication still creates residual interaction risk.

**Architecture:** Keep active medications as the primary prescribing baseline and add a second, narrow layer for recently discontinued medications. The shared safety engine owns the clinical rule set; route handlers only load candidate medication rows and pass them in.

**Tech Stack:** Hono, D1, TypeScript, Vitest

---

### Task 1: Extend the Safety Engine Contract

**Files:**
- Modify: `src/lib/drug-safety.ts`
- Test: `test/drug-interaction-engine.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```ts
it('blocks when a MAOI-family medication was stopped within the washout window', () => {
  const result = evaluateMedicationSafety({
    newItems: [{ medication_name: 'Sertraline', generic_name: 'sertraline' }],
    activeMedications: [],
    recentlyStoppedMedications: [{
      medication_name: 'Phenelzine',
      generic_name: 'phenelzine',
      status: 'discontinued',
      stop_date: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
    }],
    allergies: [],
    interactionPairs: [],
    formularyByDrug: {},
  });

  expect(result.has_blocking).toBe(true);
  expect(result.findings.some((item) => item.type === 'washout_interaction' && item.blocking)).toBe(true);
});

it('does not alert when the washout window has elapsed', () => {
  const result = evaluateMedicationSafety({
    newItems: [{ medication_name: 'Sertraline', generic_name: 'sertraline' }],
    activeMedications: [],
    recentlyStoppedMedications: [{
      medication_name: 'Phenelzine',
      generic_name: 'phenelzine',
      status: 'discontinued',
      stop_date: new Date(Date.now() - (20 * 24 * 60 * 60 * 1000)).toISOString(),
    }],
    allergies: [],
    interactionPairs: [],
    formularyByDrug: {},
  });

  expect(result.findings.some((item) => item.type === 'washout_interaction')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: FAIL because `recentlyStoppedMedications` and `washout_interaction` are not implemented yet

- [ ] **Step 3: Write minimal engine changes**

```ts
export interface RecentlyStoppedMedicationRecord extends ActiveMedicationRecord {
  stop_date?: string | null;
}

export interface MedicationSafetyFinding {
  type: 'drug_interaction' | 'washout_interaction' | 'allergy_contraindication' | 'duplicate_therapy' | 'max_dose';
  // existing fields...
}

export function evaluateMedicationSafety(input: {
  newItems: MedicationSafetyCandidate[];
  activeMedications: ActiveMedicationRecord[];
  recentlyStoppedMedications?: RecentlyStoppedMedicationRecord[];
  allergies: DrugAllergyRecord[];
  interactionPairs: DrugInteractionPairRecord[];
  formularyByDrug: Record<string, FormularyDrugRecord>;
}): MedicationSafetyEvaluation {
  // existing logic...
}
```

- [ ] **Step 4: Run the unit test again**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: still FAIL, but now on missing rule behavior rather than missing types

- [ ] **Step 5: Commit**

```bash
git add test/drug-interaction-engine.test.ts src/lib/drug-safety.ts
git commit -m "test: add washout medication safety expectations"
```

### Task 2: Implement Curated Washout Rules

**Files:**
- Modify: `src/lib/drug-safety.ts`
- Test: `test/drug-interaction-engine.test.ts`

- [ ] **Step 1: Add the failing fluoxetine/MAOI test**

```ts
it('blocks MAOI-family prescribing shortly after fluoxetine discontinuation', () => {
  const result = evaluateMedicationSafety({
    newItems: [{ medication_name: 'Linezolid', generic_name: 'linezolid' }],
    activeMedications: [],
    recentlyStoppedMedications: [{
      medication_name: 'Fluoxetine',
      generic_name: 'fluoxetine',
      status: 'completed',
      stop_date: new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString(),
    }],
    allergies: [],
    interactionPairs: [],
    formularyByDrug: {},
  });

  expect(result.has_blocking).toBe(true);
  expect(result.findings.some((item) => item.type === 'washout_interaction' && item.related_medication === 'Fluoxetine')).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: FAIL on missing fluoxetine-specific washout behavior

- [ ] **Step 3: Implement the curated rule table and evaluation helpers**

```ts
const WASHOUT_RULES = [
  {
    recentlyStoppedMatchers: ['phenelzine', 'tranylcypromine', 'isocarboxazid', 'selegiline', 'rasagiline', 'linezolid', 'methylene blue'],
    newMedicationMatchers: ['sertraline', 'fluoxetine', 'paroxetine', 'citalopram', 'escitalopram', 'venlafaxine', 'duloxetine', 'tramadol', 'linezolid'],
    washoutDays: 14,
    severity: 'contraindicated',
    recommendation: 'Respect the 14-day washout window before starting this medication.',
  },
  {
    recentlyStoppedMatchers: ['fluoxetine'],
    newMedicationMatchers: ['phenelzine', 'tranylcypromine', 'isocarboxazid', 'selegiline', 'rasagiline', 'linezolid', 'methylene blue'],
    washoutDays: 35,
    severity: 'contraindicated',
    recommendation: 'Respect the 35-day washout window after fluoxetine before starting an MAOI-like medication.',
  },
];
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/drug-safety.ts test/drug-interaction-engine.test.ts
git commit -m "feat: add curated washout interaction rules"
```

### Task 3: Load Recently Stopped Medications in the Safety Check Route

**Files:**
- Modify: `src/routes/tenant/ePrescribing.ts`
- Test: `test/e-prescribing-safety-route.test.ts`

- [ ] **Step 1: Add the failing route test**

```ts
expect(body.findings.some((item) => item.type === 'washout_interaction')).toBe(true);
expect(body.has_blocking).toBe(true);
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `pnpm vitest run test/e-prescribing-safety-route.test.ts`
Expected: FAIL because the route only loads active medications

- [ ] **Step 3: Modify the route to query recently stopped medications and pass them into the engine**

```ts
const { results: recentlyStoppedMeds } = await db.$client.prepare(`
  SELECT medication_name, generic_name, status,
         COALESCE(end_date, updated_at, created_at) AS stop_date
  FROM patient_active_medications
  WHERE tenant_id = ? AND patient_id = ? AND status IN ('discontinued', 'completed', 'on_hold', 'suspended') AND is_active = 1
`).bind(tenantId, data.patient_id).all();

const result = evaluateMedicationSafety({
  newItems: medications,
  activeMedications: activeMeds ?? [],
  recentlyStoppedMedications: recentlyStoppedMeds ?? [],
  allergies: drugAllergies ?? [],
  interactionPairs: interactionPairs ?? [],
  formularyByDrug,
});
```

- [ ] **Step 4: Run the route test**

Run: `pnpm vitest run test/e-prescribing-safety-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/ePrescribing.ts test/e-prescribing-safety-route.test.ts
git commit -m "feat: add washout checks to e-prescribing route"
```

### Task 4: Load Recently Stopped Medications in Prescription Create/Update

**Files:**
- Modify: `src/routes/tenant/prescriptions.ts`
- Test: `test/prescription-drug-interaction-safety.test.ts`

- [ ] **Step 1: Add the failing prescription tests**

```ts
expect(body.error).toContain('washout');
expect(body.error).toContain('Phenelzine');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/prescription-drug-interaction-safety.test.ts`
Expected: FAIL because the prescription safety path only checks active medications

- [ ] **Step 3: Update `enforceDrugSafety()` to load recently stopped medications**

```ts
db.$client.prepare(`
  SELECT medication_name, generic_name, status,
         COALESCE(end_date, updated_at, created_at) AS stop_date
  FROM patient_active_medications
  WHERE tenant_id = ? AND patient_id = ? AND status IN ('discontinued', 'completed', 'on_hold', 'suspended') AND is_active = 1
`)
```

- [ ] **Step 4: Run the prescription safety tests**

Run: `pnpm vitest run test/prescription-drug-interaction-safety.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/prescriptions.ts test/prescription-drug-interaction-safety.test.ts
git commit -m "feat: block prescriptions during medication washout windows"
```

### Task 5: Update Documentation and Run Full Verification

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Modify: `ozzyl-health-ecosystem-vision.md`
- Modify: `docs/superpowers/specs/2026-04-09-drug-interaction-engine-design.md`

- [ ] **Step 1: Update docs to reflect the new capability**

```md
- Drug interaction engine | ✅ Done | MEDIUM
- Historical-medication washout rules | ✅ Curated high-risk support done | MEDIUM
```

- [ ] **Step 2: Run focused verification**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts test/e-prescribing-safety-route.test.ts test/prescription-drug-interaction-safety.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add ozzyl_hms_assessment.md ozzyl-health-ecosystem-vision.md docs/superpowers/specs/2026-04-09-drug-interaction-engine-design.md
git commit -m "docs: update medication safety progress"
```
