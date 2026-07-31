# High Priority Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining ecosystem hardening gaps by enforcing cross-hospital consent scopes, adding strict smart-NID validation, and broadening provenance coverage for four critical clinical tables.

**Architecture:** Keep the three workstreams isolated. Consent enforcement stays at summary assembly and public/cross-hospital routes only; NID validation becomes a shared pure-library validator reused by schemas and identity services; provenance expansion is a schema-plus-route change whose payoff is in `buildPortableHealthSummary()` using stored source values instead of hardcoded fallbacks.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1, Drizzle ORM, Vitest

---

## File Map

- Create: `src/lib/consent-helpers.ts`
- Create: `src/lib/nid-validation.ts`
- Create: `test/consent-clinical-areas.test.ts`
- Create: `test/nid-validation.test.ts`
- Create: `migrations/0114_foundations_provenance_sources.sql`
- Modify: `src/lib/health-summary.ts`
- Modify: `src/routes/tenant/healthRecord.ts`
- Modify: `src/routes/public/healthRecord.ts`
- Modify: `src/lib/consent-cleanup.ts`
- Modify: `src/schemas/patient.ts`
- Modify: `src/routes/patient-auth.ts`
- Modify: `src/lib/global-identity.ts`
- Modify: `src/routes/tenant/allergies.ts`
- Modify: `src/routes/tenant/nurseStation.ts`
- Modify: `src/routes/tenant/fhir.ts`
- Modify: `src/routes/patient-phr.ts`
- Modify: `src/db/schema/schema.ts`
- Test: `test/health-summary-provenance.test.ts`
- Test: `test/patient-auth-claim-flow.test.ts`
- Test: `test/integration/health-cards.test.ts`

### Task 1: Consent Scope Filtering Helpers

**Files:**
- Create: `src/lib/consent-helpers.ts`
- Create: `test/consent-clinical-areas.test.ts`
- Modify: `src/lib/health-summary.ts`

- [ ] **Step 1: Write the failing consent filter unit tests**

```ts
import { describe, expect, it } from 'vitest';
import { filterSummaryByClinicalAreas } from '../src/lib/consent-helpers';
import type { PortableHealthSummary } from '../src/lib/health-summary';

const baseSummary: PortableHealthSummary = {
  provenance: { generated_at: '2026-04-10T00:00:00Z', model: 'normalized' },
  uhid: 'OZ-000050',
  patient: { name: 'Patient One', age: 34, gender: 'female', blood_group: 'B+', date_of_birth: '1992-01-01' },
  hospital: { name: 'Tenant Hospital', generated_at: '2026-04-10T00:00:00Z', consent_mode: 'view_full' },
  allergies: [{ allergen: 'Penicillin', allergy_type: 'drug', severity: 'moderate', reaction: 'Rash', provenance: { source: 'clinician', verified: true, review_status: 'verified', recorded_at: null, recorded_by_user_id: null, reviewed_at: null, reviewed_by_user_id: null, review_notes: null, verified_at: null, verified_by_user_id: null } }],
  active_problems: [{ description: 'Asthma', icd10_code: 'J45', severity: 'moderate', status: 'active', onset_date: null }],
  current_medications: [{ medication_name: 'Napa', generic_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days', instructions: null, status: 'active', provenance: { source: 'prescribed', verified: true, review_status: 'verified', recorded_at: null, recorded_by_user_id: null, reviewed_at: null, reviewed_by_user_id: null, review_notes: null, verified_at: null, verified_by_user_id: null } }],
  recent_diagnoses: [{ icd10_code: 'I10', icd11_code: null, description: 'Hypertension', diagnosis_type: 'final', created_at: '2026-04-09T10:00:00Z', provenance: { source: 'clinician', verified: true, review_status: 'verified', recorded_at: null, recorded_by_user_id: null, reviewed_at: null, reviewed_by_user_id: null, review_notes: null, verified_at: null, verified_by_user_id: null } }],
  last_vitals: { recorded_at: '2026-04-09T09:00:00Z', temperature: 98.6, pulse: 72, systolic: 120, diastolic: 80, respiratory_rate: 16, spo2: 99, weight: 70, height: 170, bmi: 24.2, blood_sugar: 100, provenance: { source: 'recorded', verified: true, review_status: 'verified', recorded_at: null, recorded_by_user_id: null, reviewed_at: null, reviewed_by_user_id: null, review_notes: null, verified_at: null, verified_by_user_id: null } },
  vaccinations: [{ vaccine_name: 'Td', vaccine_code: null, dose_number: 1, total_doses: null, administered_date: '2024-01-01', status: 'completed', next_dose_date: null }],
  recent_lab_results: [{ test_name: 'CBC', result: 'Normal', abnormal_flag: null, unit: null, normal_range: null, completed_at: '2026-04-08T12:00:00Z' }],
  last_discharge: null,
};

describe('filterSummaryByClinicalAreas', () => {
  it('returns the full summary for null areas', () => {
    expect(filterSummaryByClinicalAreas(baseSummary, null).recent_lab_results).toHaveLength(1);
  });

  it('keeps only labs and vitals when those areas are consented', () => {
    const filtered = filterSummaryByClinicalAreas(baseSummary, ['labs', 'vitals']);
    expect(filtered.recent_lab_results).toHaveLength(1);
    expect(filtered.last_vitals).not.toBeNull();
    expect(filtered.current_medications).toHaveLength(0);
    expect(filtered.recent_diagnoses).toHaveLength(0);
  });

  it('always keeps life-threatening allergies', () => {
    const critical = {
      ...baseSummary,
      allergies: [{ ...baseSummary.allergies[0], severity: 'life_threatening' as const }],
    };
    const filtered = filterSummaryByClinicalAreas(critical, ['labs']);
    expect(filtered.allergies).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `pnpm vitest test/consent-clinical-areas.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/consent-helpers'` or missing export errors.

- [ ] **Step 3: Implement the minimal filtering helper**

```ts
import type { PortableHealthSummary } from './health-summary';

export type ConsentClinicalArea =
  | 'allergies'
  | 'prescriptions'
  | 'diagnoses'
  | 'vitals'
  | 'labs'
  | 'vaccinations'
  | 'visits'
  | 'all';

export function filterSummaryByClinicalAreas(
  summary: PortableHealthSummary,
  allowedAreas: ConsentClinicalArea[] | null,
): PortableHealthSummary {
  if (!allowedAreas || allowedAreas.includes('all')) return summary;

  const allow = new Set(allowedAreas);
  const lifeThreateningAllergies = summary.allergies.filter((item) => item.severity === 'life_threatening');

  return {
    ...summary,
    allergies: allow.has('allergies') ? summary.allergies : lifeThreateningAllergies,
    active_problems: allow.has('diagnoses') ? summary.active_problems : [],
    current_medications: allow.has('prescriptions') ? summary.current_medications : [],
    recent_diagnoses: allow.has('diagnoses') ? summary.recent_diagnoses : [],
    last_vitals: allow.has('vitals') ? summary.last_vitals : null,
    vaccinations: allow.has('vaccinations') ? summary.vaccinations : [],
    recent_lab_results: allow.has('labs') ? summary.recent_lab_results : [],
    last_discharge: summary.last_discharge,
  };
}
```

- [ ] **Step 4: Run the helper tests again**

Run: `pnpm vitest test/consent-clinical-areas.test.ts`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the helper slice**

```bash
git add src/lib/consent-helpers.ts test/consent-clinical-areas.test.ts
git commit -m "test: define consent clinical area filtering"
```

### Task 2: Cross-Hospital Consent Enforcement And Scheduled Cleanup

**Files:**
- Modify: `src/routes/tenant/healthRecord.ts`
- Modify: `src/routes/public/healthRecord.ts`
- Modify: `src/lib/consent-cleanup.ts`
- Modify: `src/lib/health-summary.ts`
- Test: `test/integration/health-cards.test.ts`
- Test: `test/health-summary-provenance.test.ts`

- [ ] **Step 1: Write failing route and cleanup tests**

```ts
it('filters portable summary sections using consent clinical_areas', async () => {
  const mockDB = createMockDB({
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from health_record_consents')) {
        return { first: { id: 1, clinical_areas: JSON.stringify(['labs']) }, success: true, meta: {} };
      }
      return null;
    },
    tables: {
      patients: [{ id: 50, tenant_id: 'tenant-1', name: 'Patient One', uhid: 'OZ-000050' }],
      patient_allergies: [{ id: 1, tenant_id: 'tenant-1', patient_id: 50, allergen: 'Penicillin', severity: 'moderate', is_active: 1 }],
      tests: [{ id: 1, tenant_id: 'tenant-1', patient_id: 50, test_name: 'CBC', result: 'Normal', status: 'completed' }],
    },
  });
  const summary = await buildPortableHealthSummary(mockDB.db, 'tenant-1', 50);
  const filtered = filterSummaryByClinicalAreas(summary!, ['labs']);
  expect(filtered.recent_lab_results).toHaveLength(1);
  expect(filtered.allergies).toHaveLength(0);
});

it('returns combined cleanup result and stats', async () => {
  const result = await runScheduledCleanup(createMockDB().db);
  expect(result).toHaveProperty('cleaned');
  expect(result).toHaveProperty('stats');
});
```

- [ ] **Step 2: Run the focused consent/summary tests to verify failure**

Run: `pnpm vitest test/health-summary-provenance.test.ts test/integration/health-cards.test.ts`

Expected: FAIL on missing `filterSummaryByClinicalAreas` wiring and missing `runScheduledCleanup`.

- [ ] **Step 3: Wire consent filtering into tenant and public routes**

```ts
function parseConsentAreas(value: unknown): ConsentClinicalArea[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const consent = await db.$client.prepare(`
  SELECT id, clinical_areas
  FROM health_record_consents
  WHERE national_id = ? AND granting_tenant_id = ? AND is_active = 1
    AND expires_at > datetime('now')
    AND consent_type IN ('view_summary', 'view_full', 'emergency_access')
  ORDER BY granted_at DESC
  LIMIT 1
`).bind(tokenRow.national_id, tokenRow.tenant_id).first<{ id: number; clinical_areas: string | null }>();

const areas = parseConsentAreas(consent?.clinical_areas ?? null);
const summary = await buildPortableHealthSummary(c.env.DB, tokenRow.tenant_id, tokenRow.patient_id);
const filteredSummary = summary ? filterSummaryByClinicalAreas(summary, areas) : null;
```

- [ ] **Step 4: Add the scheduled cleanup wrapper**

```ts
export async function runScheduledCleanup(db: D1Database): Promise<CleanupResult & { stats: ConsentExpiryStats }> {
  const cleanup = await cleanupExpiredConsents(db);
  const stats = await getConsentExpiryStats(db);
  return {
    ...cleanup,
    stats,
  };
}
```

- [ ] **Step 5: Run the consent-related tests again**

Run: `pnpm vitest test/consent-clinical-areas.test.ts test/health-summary-provenance.test.ts test/integration/health-cards.test.ts`

Expected: PASS on consent area filtering and cleanup wrapper assertions.

- [ ] **Step 6: Commit the consent-route slice**

```bash
git add src/routes/tenant/healthRecord.ts src/routes/public/healthRecord.ts src/lib/consent-cleanup.ts src/lib/consent-helpers.ts test/consent-clinical-areas.test.ts test/integration/health-cards.test.ts test/health-summary-provenance.test.ts
git commit -m "feat: enforce consent clinical areas on shared summaries"
```

### Task 3: Strict NID Validation Everywhere

**Files:**
- Create: `src/lib/nid-validation.ts`
- Create: `test/nid-validation.test.ts`
- Modify: `src/schemas/patient.ts`
- Modify: `src/routes/patient-auth.ts`
- Modify: `src/lib/global-identity.ts`
- Test: `test/patient-auth-claim-flow.test.ts`
- Test: `test/consent-v2.test.ts`

- [ ] **Step 1: Write the failing NID validator tests**

```ts
import { describe, expect, it } from 'vitest';
import { validateBDNationalId } from '../src/lib/nid-validation';

describe('validateBDNationalId', () => {
  it('accepts a 10-digit legacy NID', () => {
    expect(validateBDNationalId('1234567890')).toMatchObject({ valid: true, format: '10-digit' });
  });

  it('rejects invalid smart NID checksum', () => {
    expect(validateBDNationalId('19940512345678901')).toMatchObject({ valid: false, format: '17-digit' });
  });

  it('rejects impossible month values', () => {
    expect(validateBDNationalId('12345678913256789').valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the validator and auth tests to verify failure**

Run: `pnpm vitest test/nid-validation.test.ts test/patient-auth-claim-flow.test.ts test/consent-v2.test.ts`

Expected: FAIL because `src/lib/nid-validation.ts` does not exist and schemas still use regex-only validation.

- [ ] **Step 3: Implement the shared validator**

```ts
export interface NIDValidationResult {
  valid: boolean;
  format: '10-digit' | '17-digit' | 'invalid';
  error?: string;
  birthMonth?: number;
  birthYear?: number;
}

export function validateBDNationalId(nid: string): NIDValidationResult {
  if (!/^\d+$/.test(nid)) return { valid: false, format: 'invalid', error: 'NID must contain only digits' };
  if (nid.length === 10) return { valid: true, format: '10-digit' };
  if (nid.length !== 17) return { valid: false, format: 'invalid', error: 'NID must be 10 or 17 digits' };

  const month = Number(nid.slice(9, 11));
  const shortYear = Number(nid.slice(11, 13));
  const birthYear = shortYear > 30 ? 1900 + shortYear : 2000 + shortYear;
  const currentYear = new Date().getUTCFullYear();

  if (month < 1 || month > 12) return { valid: false, format: '17-digit', error: 'Invalid birth month in NID' };
  if (birthYear > currentYear || birthYear < currentYear - 120) return { valid: false, format: '17-digit', error: 'Invalid birth year in NID' };

  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9];
  const sum = nid
    .slice(0, 16)
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
  let checksum = (11 - (sum % 11)) % 11;
  if (checksum === 10) checksum = 0;

  if (checksum !== Number(nid[16])) {
    return { valid: false, format: '17-digit', error: 'Invalid NID checksum', birthMonth: month, birthYear };
  }

  return { valid: true, format: '17-digit', birthMonth: month, birthYear };
}
```

- [ ] **Step 4: Reuse the validator in schemas and identity creation**

```ts
const nationalIdField = z.string().optional().superRefine((val, ctx) => {
  if (!val) return;
  const result = validateBDNationalId(val);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? 'Invalid National ID' });
  }
});
```

```ts
if (input.nationalId) {
  const validation = validateBDNationalId(input.nationalId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid National ID');
  }
}
```

- [ ] **Step 5: Run the NID-focused tests again**

Run: `pnpm vitest test/nid-validation.test.ts test/patient-auth-claim-flow.test.ts test/consent-v2.test.ts`

Expected: PASS, and invalid 17-digit smart NIDs now fail with explicit error messages.

- [ ] **Step 6: Commit the NID slice**

```bash
git add src/lib/nid-validation.ts src/schemas/patient.ts src/routes/patient-auth.ts src/lib/global-identity.ts test/nid-validation.test.ts test/patient-auth-claim-flow.test.ts test/consent-v2.test.ts
git commit -m "feat: enforce strict smart nid validation"
```

### Task 4: Provenance Columns And Route Writers

**Files:**
- Create: `migrations/0114_foundations_provenance_sources.sql`
- Modify: `src/db/schema/schema.ts`
- Modify: `src/routes/tenant/allergies.ts`
- Modify: `src/routes/tenant/nurseStation.ts`
- Modify: `src/routes/tenant/fhir.ts`
- Modify: `src/routes/patient-phr.ts`
- Test: `test/health-summary-provenance.test.ts`
- Test: `test/health-timeline-provenance.test.ts`

- [ ] **Step 1: Write failing provenance coverage tests**

```ts
it('uses stored source for portable health summary provenance', async () => {
  const mockDB = createMockDB({
    tables: {
      patients: [{ id: 50, tenant_id: 'tenant-1', name: 'Patient One', uhid: 'OZ-000050' }],
      patient_allergies: [{ id: 1, tenant_id: 'tenant-1', patient_id: 50, allergen: 'Peanut', allergy_type: 'food', severity: 'moderate', source: 'patient_reported', is_active: 1 }],
    },
  });
  const summary = await buildPortableHealthSummary(mockDB.db, 'tenant-1', 50);
  expect(summary?.allergies[0].provenance.source).toBe('patient_reported');
});
```

```ts
it('persists source when an allergy is created', async () => {
  const { app, mockDB } = createTestApp({ route: allergiesRoute, routePath: '/allergies', role: 'doctor', tenantId: 'tenant-1', tables: { patients: [{ id: 1, tenant_id: 'tenant-1' }] } });
  await jsonRequest(app, '/allergies', { method: 'POST', body: { patient_id: 1, allergy_type: 'drug', allergen: 'Penicillin', source: 'patient_reported' } });
  expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO patient_allergies') && q.params.includes('patient_reported'))).toBe(true);
});
```

- [ ] **Step 2: Run the provenance tests and verify failure**

Run: `pnpm vitest test/health-summary-provenance.test.ts test/health-timeline-provenance.test.ts`

Expected: FAIL because `source` is not selected for the four target tables and writer routes do not persist it.

- [ ] **Step 3: Add the migration and schema fields**

```sql
ALTER TABLE patient_allergies ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
ALTER TABLE patient_vitals ADD COLUMN source TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE final_diagnosis ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
ALTER TABLE tests ADD COLUMN source TEXT NOT NULL DEFAULT 'lab';
```

```ts
source: text('source').notNull().default('clinician'),
```

- [ ] **Step 4: Update writer routes with explicit defaults**

```ts
const createAllergySchema = z.object({
  patient_id: z.number().int().positive(),
  allergy_type: z.enum(['drug', 'food', 'environmental', 'other']),
  allergen: z.string().min(1),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).default('mild'),
  source: z.enum(['clinician', 'patient_reported', 'imported']).default('clinician'),
});
```

```ts
INSERT INTO patient_vitals (..., source, recorded_by)
VALUES (..., 'recorded', ?)
```

```ts
columns.push('source');
values.push('imported');
```

- [ ] **Step 5: Update portable summary queries to read real source values**

```ts
SELECT allergen, allergy_type, severity, reaction, source, created_at, created_by,
       review_status, reviewed_at, reviewed_by, review_notes, verified_at, verified_by
FROM patient_allergies
```

```ts
provenance: normalizeProvenance({
  source: row.source,
  recordedAt: row.created_at,
  recordedByUserId: row.created_by,
  reviewStatus: row.review_status,
  reviewedAt: row.reviewed_at,
  reviewedByUserId: row.reviewed_by,
  reviewNotes: row.review_notes,
  verifiedAt: row.verified_at,
  verifiedByUserId: row.verified_by,
  defaultSource: 'clinician',
}),
```

- [ ] **Step 6: Run the provenance test pack**

Run: `pnpm vitest test/health-summary-provenance.test.ts test/health-timeline-provenance.test.ts test/integration/health-cards.test.ts`

Expected: PASS with provenance reflecting `patient_reported`, `recorded`, `imported`, and `lab` instead of the old generic fallback.

- [ ] **Step 7: Commit the provenance slice**

```bash
git add migrations/0114_foundations_provenance_sources.sql src/db/schema/schema.ts src/routes/tenant/allergies.ts src/routes/tenant/nurseStation.ts src/routes/tenant/fhir.ts src/routes/patient-phr.ts src/lib/health-summary.ts test/health-summary-provenance.test.ts test/health-timeline-provenance.test.ts
git commit -m "feat: expand clinical provenance sources"
```

### Task 5: Final Regression And Docs Sync

**Files:**
- Modify: `docs/superpowers/specs/2026-04-10-high-priority-foundations-design.md` only if implementation diverges
- Modify: `docs/superpowers/plans/2026-04-10-high-priority-foundations.md`
- Test: existing suites only

- [ ] **Step 1: Run the combined targeted regression suite**

Run: `pnpm vitest test/consent-clinical-areas.test.ts test/nid-validation.test.ts test/consent-v2.test.ts test/health-summary-provenance.test.ts test/health-timeline-provenance.test.ts test/patient-auth-claim-flow.test.ts test/integration/health-cards.test.ts`

Expected: PASS for all focused foundation hardening tests.

- [ ] **Step 2: Run the existing broader safety net**

Run: `pnpm vitest test/clinical-depth.test.ts test/patient-b2c.test.ts test/public-health-record-rate-limit.test.ts`

Expected: PASS with no regressions in consent schema, patient portal auth assumptions, or public health-record routes.

- [ ] **Step 3: Update docs only if the implementation deviates**

```md
- note any implementation-level deviations from the design
- update migration number if it changed
- remove assumptions that became obsolete during implementation
```

- [ ] **Step 4: Commit the finished slice**

```bash
git add docs/superpowers/specs/2026-04-10-high-priority-foundations-design.md docs/superpowers/plans/2026-04-10-high-priority-foundations.md
git commit -m "docs: sync high priority foundations plan"
```

---

## Self-Review

- Spec coverage: consent filtering, cleanup wrapper, strict NID validation, schema reuse, global identity guardrail, provenance migration, writer routes, and summary-query normalization all map to explicit tasks above.
- Placeholder scan: no `TODO`, `TBD`, or "similar to previous task" shortcuts remain.
- Type consistency: consent helper uses `PortableHealthSummary`; NID validator name is `validateBDNationalId` everywhere; provenance source values stay aligned with the spec defaults.
