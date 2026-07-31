# IPD Doctor Round Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add doctor-specific IPD round fees and create one traceable provisional billing item for every nurse- or reception-entered doctor round.

**Architecture:** A dedicated tenant-scoped `ipd_doctor_rounds` table owns the clinical/billing event and links to `billing_provisional_items`. One shared backend service validates the admission and doctor, snapshots the configured fee/name, and uses one D1 atomic batch for the round, provisional item, linkage, audit, and local outbox records. A reusable web form submits the same API contract from Nurse Station and IP Billing.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, Zod, TypeScript, React 19, TanStack Query, Vitest, Testing Library, i18next.

---

## File Map

- `migrations/0357_ipd_doctor_round_fees.sql`: cloud/local versioned schema change.
- `tenant-schema.sql`: fresh local-install schema parity.
- `src/db/schema/schema.ts`: Drizzle declarations for the new doctor field and round table.
- `src/schemas/doctor.ts`: validate `ipdRoundFee` on doctor create/update.
- `src/routes/tenant/doctors.ts`: read and persist the doctor round fee.
- `src/lib/ipd-doctor-rounds.ts`: validation, Dhaka timestamp normalization, atomic creation/cancellation, and idempotent result loading.
- `src/routes/tenant/ipdDoctorRounds.ts`: thin list/create/cancel HTTP handlers and role guards.
- `src/index.ts`: mount `/api/ipd-doctor-rounds`.
- `src/routes/sync.ts`: cloud-pull table and audited local-to-cloud round/provisional mappers.
- `scripts/local-server/export-tenant-snapshot.ts`: snapshot ordering/support for the new table.
- `src/lib/billing-category-totals.ts`: aggregate `doctor_round` into `doctorVisitBill`.
- `src/routes/tenant/ipBilling.ts`: retain `doctor_round` when finalizing invoice items.
- `web/src/components/doctor/types.ts`: expose snake/camel doctor round-fee fields.
- `web/src/components/doctor/DoctorDrawer.tsx`: hospital-admin doctor round-fee editor.
- `web/src/pages/doctor/DoctorProfile.tsx`: doctor self-profile round-fee display/edit contract.
- `web/src/components/ipd/DoctorRoundForm.tsx`: shared doctor, date, time, fee, and submit UI.
- `web/src/pages/NurseStation.tsx`: nurse-originated Doctor Round action, separate from Vitals Round.
- `web/src/pages/IPBillingPage.tsx`: reception-originated Doctor Round action and round history.
- `web/public/locales/{en,bn}/{doctor,nursing,billing}.json`: user-facing labels and errors.
- Focused tests listed in each task below.

### Task 1: Persist Doctor Round Configuration And Events

**Files:**
- Create: `migrations/0357_ipd_doctor_round_fees.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/schema.ts`
- Test: `test/ipd-doctor-round-schema.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Assert that migration and fresh schema both contain `doctors.ipd_round_fee`, `ipd_doctor_rounds`, `idempotency_key TEXT NOT NULL`, `UNIQUE(tenant_id, idempotency_key)`, the partial unique provisional-link index, and admission/doctor timestamp indexes.

```ts
expect(migration).toContain('ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0');
expect(migration).toContain('UNIQUE (tenant_id, idempotency_key)');
expect(migration).toContain('WHERE provisional_item_id IS NOT NULL');
expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS ipd_doctor_rounds');
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run test/ipd-doctor-round-schema.test.ts`

Expected: FAIL because migration `0357` and the new schema declarations do not exist.

- [ ] **Step 3: Add the SQLite/D1 schema**

Create columns equivalent to:

```sql
ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0;

CREATE TABLE ipd_doctor_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  rounded_at TEXT NOT NULL,
  doctor_name_snapshot TEXT NOT NULL,
  round_fee_snapshot INTEGER NOT NULL CHECK (round_fee_snapshot > 0),
  entry_source TEXT NOT NULL CHECK (entry_source IN ('nurse_station', 'ipd_billing')),
  entered_by INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  provisional_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, idempotency_key)
);
```

Mirror it in `tenant-schema.sql`, add the three indexes from the design, and add matching Drizzle fields/indexes.

- [ ] **Step 4: Run schema verification and confirm GREEN**

Run: `pnpm vitest run test/ipd-doctor-round-schema.test.ts && pnpm build:migrations`

Expected: PASS and migration manifest regenerates successfully.

- [ ] **Step 5: Commit**

```bash
git add migrations/0357_ipd_doctor_round_fees.sql tenant-schema.sql src/db/schema/schema.ts src/data/schema-migrations.generated.ts test/ipd-doctor-round-schema.test.ts
git commit -m "feat(ipd): add doctor round schema"
```

### Task 2: Add Doctor IPD Round Fee To Doctor Management

**Files:**
- Modify: `src/schemas/doctor.ts`
- Modify: `src/routes/tenant/doctors.ts`
- Modify: `web/src/components/doctor/types.ts`
- Modify: `web/src/components/doctor/DoctorDrawer.tsx`
- Modify: `web/src/pages/doctor/DoctorProfile.tsx`
- Modify: `web/public/locales/en/doctor.json`
- Modify: `web/public/locales/bn/doctor.json`
- Test: `test/doctor-fee-validation.test.ts`
- Test: `web/src/components/doctor/DoctorDrawer.test.tsx`

- [ ] **Step 1: Write failing API and UI tests**

Test that `ipdRoundFee: 700` is accepted and negative/fractional values are rejected; doctor list/detail SQL and create/update SQL contain `ipd_round_fee`; Doctor Drawer sends `ipdRoundFee` and renders a non-negative number input labelled `IPD Round Fee`.

```ts
expect(createDoctorSchema.parse({ ...validDoctor, ipdRoundFee: 700 }).ipdRoundFee).toBe(700);
expect(() => createDoctorSchema.parse({ ...validDoctor, ipdRoundFee: -1 })).toThrow();
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run test/doctor-fee-validation.test.ts web/src/components/doctor/DoctorDrawer.test.tsx`

Expected: FAIL because the field is absent.

- [ ] **Step 3: Implement minimal doctor fee plumbing**

Add this schema field and its partial update behavior:

```ts
ipdRoundFee: z.number().int().min(0, 'IPD round fee cannot be negative').default(0),
```

Select/persist `ipd_round_fee`, expose both `ipdRoundFee` and `ipd_round_fee` frontend types, and add the number input beside consultation fee. Do not reuse `consultation_fee` as a fallback.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `pnpm vitest run test/doctor-fee-validation.test.ts test/doctors.test.ts web/src/components/doctor/DoctorDrawer.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/doctor.ts src/routes/tenant/doctors.ts web/src/components/doctor/types.ts web/src/components/doctor/DoctorDrawer.tsx web/src/pages/doctor/DoctorProfile.tsx web/public/locales/en/doctor.json web/public/locales/bn/doctor.json test/doctor-fee-validation.test.ts web/src/components/doctor/DoctorDrawer.test.tsx
git commit -m "feat(doctors): configure IPD round fees"
```

### Task 3: Implement Atomic And Idempotent Round Creation

**Files:**
- Create: `src/lib/ipd-doctor-rounds.ts`
- Create: `src/routes/tenant/ipdDoctorRounds.ts`
- Modify: `src/index.ts`
- Test: `test/ipd-doctor-rounds.test.ts`

- [ ] **Step 1: Write failing service/route tests**

Cover role guards, active admission/patient matching, active doctor with positive fee, Asia/Dhaka normalization, same-key retry, distinct-key repeated round, fee/name snapshots, and rollback when an audit statement fails.

```ts
const payload = {
  admissionId: 21,
  patientId: 9,
  doctorId: 4,
  roundDate: '2026-06-18',
  roundTime: '14:35',
  entrySource: 'nurse_station',
  idempotencyKey: '018f6f64-8b4b-7d11-8f9d-aaaaaaaaaaaa',
};
expect(result.roundedAt).toBe('2026-06-18 14:35:00');
expect(result.fee).toBe(700);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run test/ipd-doctor-rounds.test.ts`

Expected: FAIL because the service and route are missing.

- [ ] **Step 3: Implement shared validation and atomic batch**

Export a Zod request schema and service with this contract:

```ts
export type CreateDoctorRoundInput = {
  admissionId: number;
  patientId: number;
  doctorId: number;
  roundDate: string;
  roundTime: string;
  entrySource: 'nurse_station' | 'ipd_billing';
  idempotencyKey: string;
};

export async function createIpdDoctorRound(
  env: Env,
  tenantId: string,
  userId: string,
  input: CreateDoctorRoundInput,
): Promise<{ roundId: number; provisionalItemId: number; roundedAt: string; fee: number }>;
```

Pre-read the idempotency key for the fast retry path. For new writes, use conditional `INSERT ... SELECT` statements in one `env.DB.batch()` so concurrent same-key requests create one round and one `doctor_round` provisional item. Link with subqueries on `(tenant_id, idempotency_key)` and `(tenant_id, item_category, reference_id)`. Put the audit insert in the batch rather than calling the fire-and-forget audit helper.

- [ ] **Step 4: Implement atomic cancellation**

Add `cancelIpdDoctorRound()` to load the linked provisional item, reject a
finalized/paid item with HTTP 409, and execute one D1 batch that marks the round
and provisional item cancelled and inserts cancellation audit/local outbox rows.
Every update is conditional on the current active/provisional status so repeated
cancellation cannot mutate the record twice.

- [ ] **Step 5: Add thin routes**

Mount:

```text
POST   /api/ipd-doctor-rounds
GET    /api/ipd-doctor-rounds?admission_id=21
POST   /api/ipd-doctor-rounds/:id/cancel
```

Create allows nurse/reception/hospital_admin/md/director/accountant but enforces `nurse_station` source for nurses and `ipd_billing` source for billing roles. List follows the same clinical/billing visibility. Cancel is limited to hospital_admin/md/director and requires a reason.

- [ ] **Step 6: Run tests and confirm GREEN**

Run: `pnpm vitest run test/ipd-doctor-rounds.test.ts test/doctor-role-guards.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ipd-doctor-rounds.ts src/routes/tenant/ipdDoctorRounds.ts src/index.ts test/ipd-doctor-rounds.test.ts
git commit -m "feat(ipd): create billable doctor rounds"
```

### Task 4: Preserve Doctor Round Billing Categories

**Files:**
- Modify: `src/lib/billing-category-totals.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Test: `test/unit/billing-category-totals.test.ts`
- Test: `test/ipd-doctor-rounds.test.ts`

- [ ] **Step 1: Write failing category tests**

```ts
expect(normalizeBillCategory('doctor_round')).toBe('doctorVisitBill');
expect(calculateBillCategoryTotals([{ category: 'doctor_round', amount: 700 }]).doctorVisitBill).toBe(700);
expect(getDischargeInvoiceItemCategory('doctor_round')).toBe('doctor_round');
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run test/unit/billing-category-totals.test.ts test/ipd-doctor-rounds.test.ts`

Expected: FAIL because `doctor_round` is ignored/falls back to `other`.

- [ ] **Step 3: Add explicit mappings**

Add `doctor_round` to the doctor total aliases and the discharge mapper's retained categories. Keep the line category as `doctor_round`; only the bill aggregate uses `doctorVisitBill`.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `pnpm vitest run test/unit/billing-category-totals.test.ts test/ipd-doctor-rounds.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing-category-totals.ts src/routes/tenant/ipBilling.ts test/unit/billing-category-totals.test.ts test/ipd-doctor-rounds.test.ts
git commit -m "fix(billing): classify IPD doctor rounds"
```

### Task 5: Sync Local Doctor Rounds Without Clinical Payloads

**Files:**
- Modify: `src/lib/ipd-doctor-rounds.ts`
- Modify: `src/routes/sync.ts`
- Modify: `scripts/local-server/export-tenant-snapshot.ts`
- Test: `test/local-sync-routes.test.ts`
- Test: `test/local-schema-sync-routes.test.ts`

- [ ] **Step 1: Write failing sync tests**

Assert cloud pull includes `ipd_doctor_rounds`; local creation queues deterministic round and provisional outbox keys in the same batch; cloud ingest upserts by tenant/idempotency and resolves the cloud provisional link; payloads contain no `note`, `clinical_note`, or patient clinical content.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run test/local-sync-routes.test.ts test/local-schema-sync-routes.test.ts`

Expected: FAIL because the entity mappers/table list are absent.

- [ ] **Step 3: Implement explicit metadata mappers**

Add `ipd_doctor_rounds` to pull/snapshot tables. Extend `applyKnownSyncEvent()` for `ipd_doctor_round` and `billing_provisional_doctor_round`, validating tenant/admission/patient/doctor identifiers and upserting by the round idempotency key. Never accept arbitrary table SQL or note fields from payloads.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `pnpm vitest run test/local-sync-routes.test.ts test/local-schema-sync-routes.test.ts test/local-schema-sync-engine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipd-doctor-rounds.ts src/routes/sync.ts scripts/local-server/export-tenant-snapshot.ts test/local-sync-routes.test.ts test/local-schema-sync-routes.test.ts
git commit -m "feat(sync): replicate IPD doctor rounds"
```

### Task 6: Build The Shared Doctor Round Form

**Files:**
- Create: `web/src/components/ipd/DoctorRoundForm.tsx`
- Create: `web/src/components/ipd/DoctorRoundForm.test.tsx`
- Modify: `web/public/locales/en/nursing.json`
- Modify: `web/public/locales/bn/nursing.json`
- Modify: `web/public/locales/en/billing.json`
- Modify: `web/public/locales/bn/billing.json`

- [ ] **Step 1: Write failing component tests**

Test patient/admission display, searchable doctor selection, configured fee display, Bangladesh-local date/time defaults, read-only fee, UUID idempotency key reuse during a retry, and a new key after success.

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm --filter web test -- src/components/ipd/DoctorRoundForm.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the reusable form**

Use `DoctorCombobox`, `/api/doctors`, and `useApiMutation` to submit:

```ts
{
  admissionId,
  patientId,
  doctorId,
  roundDate,
  roundTime,
  entrySource,
  idempotencyKey,
}
```

Do not send fee/name/note. Disable submit when the selected doctor's `ipd_round_fee <= 0` and show the translated configuration error.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `pnpm --filter web test -- src/components/ipd/DoctorRoundForm.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ipd/DoctorRoundForm.tsx web/src/components/ipd/DoctorRoundForm.test.tsx web/public/locales/en/nursing.json web/public/locales/bn/nursing.json web/public/locales/en/billing.json web/public/locales/bn/billing.json
git commit -m "feat(ipd): add doctor round entry form"
```

### Task 7: Integrate Nurse Station And IP Billing

**Files:**
- Modify: `web/src/pages/NurseStation.tsx`
- Modify: `web/src/pages/NurseStation.test.tsx`
- Modify: `web/src/pages/IPBillingPage.tsx`
- Create: `web/src/pages/IPBillingPage.doctor-rounds.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Nurse Station must expose a separate `Doctor Round` action and keep `Vitals Round Entry` unchanged. IP Billing must open the shared form for the selected admission and show each returned round with doctor, Bangladesh time, fee, source, entered-by, and billing status.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm --filter web test -- src/pages/NurseStation.test.tsx src/pages/IPBillingPage.doctor-rounds.test.tsx`

Expected: FAIL because neither integration exists.

- [ ] **Step 3: Integrate the shared form**

Pass `entrySource="nurse_station"` in Nurse Station and `entrySource="ipd_billing"` in IP Billing. Invalidate `queryKeys.ipdCharges`, IP billing pending/history keys, and the round-list key after success. Do not modify `handleBulkVitals()` or the vitals payload.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `pnpm --filter web test -- src/pages/NurseStation.test.tsx src/pages/IPBillingPage.doctor-rounds.test.tsx web/src/pages/IPDCharges.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/NurseStation.tsx web/src/pages/NurseStation.test.tsx web/src/pages/IPBillingPage.tsx web/src/pages/IPBillingPage.doctor-rounds.test.tsx
git commit -m "feat(ipd): enter doctor rounds from nursing and billing"
```

### Task 8: Verify The Complete Feature

**Files:**
- Modify only files required by failures caused by this feature.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
pnpm vitest run \
  test/ipd-doctor-round-schema.test.ts \
  test/ipd-doctor-rounds.test.ts \
  test/unit/billing-category-totals.test.ts \
  test/doctor-fee-validation.test.ts \
  test/doctors.test.ts \
  test/local-sync-routes.test.ts \
  test/local-schema-sync-routes.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
pnpm --filter web test -- \
  src/components/doctor/DoctorDrawer.test.tsx \
  src/components/ipd/DoctorRoundForm.test.tsx \
  src/pages/NurseStation.test.tsx \
  src/pages/IPBillingPage.doctor-rounds.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Run type/build verification**

Run: `pnpm build`

Expected: migration manifest, web, lifestyle, and admin builds all succeed.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff HEAD~7 --check && git status --short`

Expected: no whitespace errors; only pre-existing unrelated artifacts remain uncommitted.

- [ ] **Step 5: Commit verification-only fixes when present**

```bash
git add migrations/0357_ipd_doctor_round_fees.sql tenant-schema.sql \
  src/db/schema/schema.ts src/schemas/doctor.ts src/routes/tenant/doctors.ts \
  src/lib/ipd-doctor-rounds.ts src/routes/tenant/ipdDoctorRounds.ts src/index.ts \
  src/routes/sync.ts scripts/local-server/export-tenant-snapshot.ts \
  src/lib/billing-category-totals.ts src/routes/tenant/ipBilling.ts \
  web/src/components/doctor/types.ts web/src/components/doctor/DoctorDrawer.tsx \
  web/src/pages/doctor/DoctorProfile.tsx web/src/components/ipd/DoctorRoundForm.tsx \
  web/src/pages/NurseStation.tsx web/src/pages/IPBillingPage.tsx
git commit -m "test(ipd): verify doctor round billing flow"
```

Skip this step when verification produced no additional feature changes.

Do not push, deploy, apply the production migration, or update the physical local server unless the user explicitly requests those actions.
