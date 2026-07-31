# High Priority Foundations: Consent, NID, Provenance

> **Date:** 2026-04-10
> **Scope:** Three independent workstreams that harden the Ozzyl HMS ecosystem layer.

---

## 1. Consent Completeness — Cross-Hospital Clinical Area Filtering + Auto-Cleanup

### Problem

Consent records store `clinical_areas` (JSON array like `['labs', 'vitals']`) and the purpose-defaults system defines per-purpose area scoping. However, cross-hospital data access routes (NID lookup, portable summary, public token) return **all** clinical data regardless of what the consent permits. The consent SQL checks `consent_type` and `is_active` but never filters by `clinical_areas`.

Additionally, consent expiry cleanup runs only lazily (before listing). There is no scheduled batch to clean stale records.

### Scope

Cross-hospital routes only. Same-hospital routes keep existing RBAC. This avoids breaking internal clinical workflows while closing the compliance gap for external data sharing.

### Design

#### A. `src/lib/consent-helpers.ts` (NEW)

```typescript
type ClinicalArea = 'allergies' | 'prescriptions' | 'diagnoses' | 'vitals' | 'labs' | 'vaccinations' | 'visits' | 'all';

function filterSummaryByClinicalAreas(
  summary: PortableHealthSummary,
  allowedAreas: ClinicalArea[] | null,
): PortableHealthSummary
```

- If `allowedAreas` is null or includes `'all'`, return summary unchanged.
- Otherwise, zero out sections not in the allowed list:
  - `'allergies'` controls `summary.allergies`
  - `'prescriptions'` controls `summary.current_medications`
  - `'diagnoses'` controls `summary.recent_diagnoses` and `summary.active_problems`
  - `'vitals'` controls `summary.last_vitals`
  - `'labs'` controls `summary.recent_lab_results`
  - `'vaccinations'` controls `summary.vaccination_history`
  - `'visits'` controls `summary.recent_visits`
- Safety-exception: allergies flagged `severity='life_threatening'` are ALWAYS included regardless of consent scope (existing safety-exception pattern).

#### B. Route Changes

**`src/routes/tenant/healthRecord.ts`** — NID lookup + portable summary routes:
1. After fetching the consent record, parse `clinical_areas` from JSON.
2. Call `filterSummaryByClinicalAreas(summary, parsedAreas)` before returning.

**`src/routes/public/healthRecord.ts`** — Public token route:
1. When validating the token, also fetch the associated consent's `clinical_areas`.
2. Apply the same filter.

#### C. Consent Expiry Auto-Cleanup

**`src/lib/consent-cleanup.ts`** — Add:

```typescript
export async function runScheduledCleanup(db: D1Database): Promise<CleanupResult & { stats: ConsentExpiryStats }>
```

Calls `cleanupExpiredConsents()` then `getConsentExpiryStats()`. Returns both.

**Cron integration:** A new Cloudflare Worker Cron trigger (or Hono scheduled handler) calls `runScheduledCleanup()` every hour. Pattern: `0 * * * *`.

#### D. No Migration Needed

`clinical_areas` column and `consent_purpose_defaults` table already exist.

---

## 2. NID 17-Digit Smart Checksum Validation

### Problem

Bangladesh's 17-digit smart NID has a structured format (birth registration serial + MMYY + series + check digit). Current validation only checks length (10 or 17 digits), accepting any 17-digit number. This allows typos and fabricated NIDs into the MPI.

### Design

#### A. `src/lib/nid-validation.ts` (NEW)

```typescript
interface NIDValidationResult {
  valid: boolean;
  format: '10-digit' | '17-digit' | 'invalid';
  error?: string;
  birthMonth?: number;  // 1-12, extracted from 17-digit
  birthYear?: number;   // 4-digit, extracted from 17-digit
}

function validateBDNationalId(nid: string): NIDValidationResult
```

**10-digit NID:**
- Length check only (10 digits, all numeric). No known public checksum algorithm.
- Returns `{ valid: true, format: '10-digit' }`.

**17-digit NID:**
1. All characters must be digits.
2. Extract characters at 0-based indices 9-12 (positions 10-13 in 1-based) as MMYY: month (01-12), year (two-digit, mapped to 4-digit using century logic: YY > 30 means 19YY, else 20YY).
3. Validate month range and year reasonableness (not future, not >120 years ago).
4. Compute mod-11 checksum on first 16 digits:
   - Weights cycle: 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9
   - Sum = sum of (digit[i] * weight[i]) for i = 0..15
   - Remainder = Sum % 11
   - Check digit = (11 - Remainder) % 11
   - If check digit == 10, treat as 0
5. Compare computed check digit with position 17 (index 16).
6. Return `{ valid, format: '17-digit', birthMonth, birthYear, error? }`.

#### B. Schema Integration

**`src/schemas/patient.ts`:**
Replace:
```typescript
nationalId: z.string().regex(/^\d{10}$|^\d{17}$/, 'NID must be 10 or 17 digits').optional(),
```
With:
```typescript
nationalId: z.string().optional().superRefine((val, ctx) => {
  if (!val) return;
  const result = validateBDNationalId(val);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error! });
  }
}),
```

**`src/routes/patient-auth.ts`:** Apply same `.superRefine()` to the 3 NID-accepting schemas.

#### C. Global Identity Integration

**`src/lib/global-identity.ts`:** Before storing a new NID in `global_patient_identity`, call `validateBDNationalId()`. Reject invalid NIDs with a 400 error. This is the last line of defense — schema validation catches most, but direct API calls to global resolution should also validate.

#### D. Tests

**`test/nid-validation.test.ts` (NEW):**
- Valid 17-digit NID with correct checksum (compute a known-good example).
- Invalid checksum (flip last digit).
- Invalid month (month 13, month 00).
- Future birth year.
- 10-digit valid (basic pass).
- Non-numeric input.
- Wrong length.

---

## 3. Provenance Broadening — Source Column on 4 Clinical Tables

### Problem

Only `patient_active_medications` has a `source` field. Four other clinical tables lack provenance tracking, so `buildPortableHealthSummary()` hardcodes `'hospital'` as the source for allergies, vitals, diagnoses, and lab results. This makes provenance in the portable summary inaccurate — patient-reported or imported data looks clinician-entered.

### Design

#### A. Migration (NEW) — `migrations/XXXX_provenance_source_columns.sql`

```sql
-- patient_allergies: who entered this allergy?
ALTER TABLE patient_allergies ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
-- Values: 'clinician', 'patient_reported', 'imported'

-- patient_vitals: where did this reading come from?
ALTER TABLE patient_vitals ADD COLUMN source TEXT NOT NULL DEFAULT 'recorded';
-- Values: 'recorded' (nurse/doctor station), 'patient_reported', 'imported', 'device'

-- final_diagnosis: who made this diagnosis?
ALTER TABLE final_diagnosis ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
-- Values: 'clinician', 'imported'

-- tests: where did this lab result originate?
ALTER TABLE tests ADD COLUMN source TEXT NOT NULL DEFAULT 'lab';
-- Values: 'lab' (in-house), 'imported', 'external_lab'
```

Defaults ensure existing rows are retroactively correct (all current data was entered in-hospital).

#### B. Route Updates

| Route File | Change |
|---|---|
| `src/routes/tenant/allergies.ts` POST | Accept optional `source` param in body. Default `'clinician'`. Pass to INSERT. |
| `src/routes/tenant/allergies.ts` PUT | Accept optional `source` param. Pass to UPDATE. |
| `src/routes/tenant/nurseStation.ts` POST vitals | Default `source='recorded'`. |
| `src/routes/tenant/fhir.ts` POST Observation | Set `source='imported'`. |
| `src/routes/tenant/fhir.ts` POST Encounter | Set `source='imported'` on any diagnosis created. |
| `src/routes/patient-phr.ts` | Any patient-submitted allergy/vital → `source='patient_reported'`. |

#### C. Health Summary Fix

**`src/lib/health-summary.ts`:**

Update the SQL queries for allergies, vitals, diagnoses, and lab results to SELECT the new `source` column. In `normalizeProvenance()`, use the real `source` value from the database instead of the hardcoded `'hospital'` fallback.

Before:
```typescript
source: row.source || 'hospital',
```

After:
```typescript
source: row.source || 'clinician',  // fallback only for truly unknown legacy rows
```

---

## Shared Concerns

### Error Handling

All three workstreams follow the existing pattern: try/catch with appropriate HTTP status codes (400 for validation errors, 403 for consent denied, 500 for unexpected).

### Testing Strategy

- NID validation: pure unit tests (no DB needed).
- Consent filtering: unit tests on `filterSummaryByClinicalAreas()` with mock summaries.
- Provenance: integration tests verifying source column is populated correctly on INSERT and appears in portable summary output.

### Migration Numbering

Next available migration number to be determined at implementation time (check highest existing number + 1).

---

## Out of Scope

- Same-hospital consent enforcement (stays RBAC-only)
- Drug-drug interaction engine (already built)
- Cross-tenant duplicate scan (already exists at global MPI level)
- SMART Health Card format (Phase 3)
- Family Health Graph (separate design)
