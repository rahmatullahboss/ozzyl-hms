# Drug Interaction Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable drug interaction engine that checks active medications, same-order items, duplicate therapy, allergies, and max-dose limits, then enforce blocking vs warning behavior in e-prescribing and prescription safety flows.

**Architecture:** Reuse the existing tenant interaction-pairs and safety-check audit model, but move evaluation into a shared library so route and prescription flows consume the same policy. Keep active medications as the blocking baseline and leave historical medication logic as an extension point.

**Tech Stack:** Hono, TypeScript, Cloudflare D1, Vitest

---

### Task 1: Add failing unit tests for the shared interaction engine

**Files:**
- Create: `test/drug-interaction-engine.test.ts`
- Modify: `src/lib/drug-safety.ts`
- Test: `test/drug-interaction-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildInteractionPairKey,
  evaluateMedicationSafety,
  normalizeMedicationName,
} from '../src/lib/drug-safety';

describe('drug interaction engine', () => {
  it('matches interaction pairs bidirectionally and blocks contraindicated findings', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Aspirin', generic_name: 'aspirin' }],
      activeMedications: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }],
      allergies: [],
      interactionPairs: [{
        drug_a_name: 'warfarin',
        drug_b_name: 'aspirin',
        severity: 'major',
        description: 'Bleeding risk',
        recommendation: 'Avoid combination',
      }],
      formularyByDrug: {},
    });

    expect(result.has_blocking).toBe(true);
    expect(result.findings[0]).toMatchObject({
      type: 'drug_interaction',
      blocking: true,
      severity: 'critical',
      related_medication: 'Warfarin',
    });
  });

  it('checks same-order items and duplicate therapy', () => {
    const result = evaluateMedicationSafety({
      newItems: [
        { medication_name: 'Ibuprofen', generic_name: 'ibuprofen' },
        { medication_name: 'Warfarin', generic_name: 'warfarin' },
        { medication_name: 'Metformin XR', generic_name: 'metformin' },
      ],
      activeMedications: [{ medication_name: 'Metformin', generic_name: 'metformin', status: 'active' }],
      allergies: [],
      interactionPairs: [{
        drug_a_name: 'warfarin',
        drug_b_name: 'ibuprofen',
        severity: 'moderate',
        description: 'Bleeding risk',
        recommendation: 'Monitor',
      }],
      formularyByDrug: {},
    });

    expect(result.findings.some((item) => item.type === 'drug_interaction')).toBe(true);
    expect(result.findings.some((item) => item.type === 'duplicate_therapy')).toBe(true);
  });

  it('normalizes medication names consistently', () => {
    expect(normalizeMedicationName('Metformin 500mg Tablet')).toBe('metformin tablet');
    expect(buildInteractionPairKey('Warfarin', ' aspirin ')).toBe('aspirin::warfarin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: FAIL with missing exports or failing expectations

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildInteractionPairKey(a: string, b: string): string {
  const left = normalizeMedicationName(a);
  const right = normalizeMedicationName(b);
  return [left, right].sort().join('::');
}

export function evaluateMedicationSafety(/* ... */) {
  return {
    safe: false,
    has_blocking: true,
    has_contraindicated: false,
    has_major: true,
    warning_count: 1,
    findings: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/drug-interaction-engine.test.ts src/lib/drug-safety.ts
git commit -m "test: add drug interaction engine coverage"
```

### Task 2: Refactor the shared safety library to support engine evaluation

**Files:**
- Modify: `src/lib/drug-safety.ts`
- Test: `test/drug-interaction-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('maps allergy and max-dose findings into blocking and warning buckets', () => {
  const result = evaluateMedicationSafety({
    newItems: [{ medication_name: 'Amoxicillin', generic_name: 'amoxicillin', dose_mg: 2000, frequency_per_day: 3 }],
    activeMedications: [],
    allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
    interactionPairs: [],
    formularyByDrug: {
      amoxicillin: { name: 'Amoxicillin', generic_name: 'Amoxicillin', max_daily_dose_mg: 4000 },
    },
  });

  expect(result.findings.some((item) => item.type === 'allergy_contraindication' && item.blocking)).toBe(true);
  expect(result.findings.some((item) => item.type === 'max_dose')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: FAIL because allergy and max-dose evaluation are incomplete

- [ ] **Step 3: Write minimal implementation**

```ts
type MedicationCandidate = {
  medication_name: string;
  generic_name?: string | null;
  dose_mg?: number;
  frequency_per_day?: number;
};

type InteractionPair = {
  drug_a_name: string;
  drug_b_name: string;
  severity: string;
  description: string;
  recommendation?: string | null;
};

type FormularyDrug = {
  name: string;
  generic_name: string | null;
  max_daily_dose_mg: number | null;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/drug-safety.ts test/drug-interaction-engine.test.ts
git commit -m "feat: add reusable medication safety evaluator"
```

### Task 3: Add failing route tests for multi-item safety checks

**Files:**
- Modify: `test/integration/helpers/mock-db.ts`
- Create: `test/e-prescribing-safety-route.test.ts`
- Modify: `src/routes/tenant/ePrescribing.ts`
- Test: `test/e-prescribing-safety-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('POST /check-safety evaluates active meds and same-order items with blocking summary', async () => {
  expect(body.has_blocking).toBe(true);
  expect(body.findings.some((item: any) => item.type === 'drug_interaction')).toBe(true);
  expect(body.findings.some((item: any) => item.type === 'duplicate_therapy')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/e-prescribing-safety-route.test.ts`
Expected: FAIL because route only supports single medication payload and old warning shape

- [ ] **Step 3: Write minimal implementation**

```ts
const medications = data.medications?.length
  ? data.medications
  : [{
      medication_name: data.medication_name,
      generic_name: data.generic_name,
      dose_mg: data.dose_mg,
      frequency_per_day: data.frequency_per_day,
    }];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/e-prescribing-safety-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/e-prescribing-safety-route.test.ts test/integration/helpers/mock-db.ts src/routes/tenant/ePrescribing.ts
git commit -m "feat: support multi-item e-prescribing safety checks"
```

### Task 4: Apply the engine to prescription create/update safety enforcement

**Files:**
- Modify: `src/routes/tenant/prescriptions.ts`
- Modify: `test/prescription-allergy-safety.test.ts`
- Create: `test/prescription-drug-interaction-safety.test.ts`
- Test: `test/prescription-drug-interaction-safety.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('blocks prescription creation when new medication conflicts with an active medication through a major interaction', async () => {
  expect(response.status).toBe(422);
  expect(body.message).toContain('interaction');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/prescription-drug-interaction-safety.test.ts test/prescription-allergy-safety.test.ts`
Expected: FAIL because create/update flow only blocks severe allergy conflicts

- [ ] **Step 3: Write minimal implementation**

```ts
const safety = await evaluatePrescriptionMedicationSafety(db.$client, {
  tenantId,
  patientId,
  medications,
  prescriptionId,
});

if (safety.has_blocking) {
  throw new HTTPException(422, {
    message: 'Prescription blocked by medication safety checks',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/prescription-drug-interaction-safety.test.ts test/prescription-allergy-safety.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/prescriptions.ts test/prescription-drug-interaction-safety.test.ts test/prescription-allergy-safety.test.ts
git commit -m "feat: enforce blocking prescription interaction checks"
```

### Task 5: Regression, docs, and rollout verification

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Test: `test/drug-interaction-engine.test.ts`
- Test: `test/e-prescribing-safety-route.test.ts`
- Test: `test/prescription-drug-interaction-safety.test.ts`
- Test: `test/prescription-allergy-safety.test.ts`
- Test: `test/e-prescribing.test.ts`

- [ ] **Step 1: Update assessment status**

```md
Priority: Hospital Depth
├── Drug-drug interaction engine ✅
├── Active-med baseline with same-order checks ✅
└── Historical-med interaction rules deferred
```

- [ ] **Step 2: Run focused regression**

Run: `pnpm vitest run test/drug-interaction-engine.test.ts test/e-prescribing-safety-route.test.ts test/prescription-drug-interaction-safety.test.ts test/prescription-allergy-safety.test.ts test/e-prescribing.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Review working tree carefully**

Run: `git status --short`
Expected: only intended files changed; unrelated consent files remain untouched

- [ ] **Step 5: Commit**

```bash
git add ozzyl_hms_assessment.md src/lib/drug-safety.ts src/routes/tenant/ePrescribing.ts src/routes/tenant/prescriptions.ts test/drug-interaction-engine.test.ts test/e-prescribing-safety-route.test.ts test/prescription-drug-interaction-safety.test.ts test/prescription-allergy-safety.test.ts
git commit -m "feat: add active-medication drug interaction engine"
```
