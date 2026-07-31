# Prescription Fulfilment Marketplace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hospital medicine dispensing an optional, transactional fulfilment of an immutable final prescription, while preparing a separate future patient-app ordering boundary with no doctor commission.

**Architecture:** Keep `prescriptions` and `prescription_items` as clinical truth. Introduce D1-backed medication fulfilment orders for hospital dispensing, processed through one idempotent Workers endpoint whose sale, stock movement, item summary, and audit write use a D1 `batch()` transaction. Remove new delivery ordering from the doctor prescription surface and batch the appointment/visit/queue completion mutation so the consultation endpoint cannot report a completed lifecycle after a partial lifecycle write.

**Tech Stack:** Cloudflare Workers/Hono, Cloudflare D1 prepared-statement `batch()` transactions, Zod, React/TanStack Query, Vitest/Testing Library.

---

## Scope Boundaries

This implementation has two independently testable milestones:

1. **Medication fulfilment foundation:** optional in-house dispensing and persistence required for later patient-app ordering.
2. **Consultation lifecycle hardening:** completion state updates run atomically after clinical save logic.

It does not implement online payments, provider settlement, delivery orchestration, `medication_platform_fees`, commercial product ranking, or doctor remuneration. Those remain deferred until a separate reviewed commercial phase.

## File Map

- Create `migrations/0275_medication_fulfilment_orders.sql`: order/item tables, pharmacy sale link, lookup indexes, stock guards, and over-dispensing guard.
- Create `test/prescription-fulfilment-migration.test.ts`: migration contract and no-doctor-beneficiary guard assertions.
- Create `src/routes/tenant/prescriptionFulfilment.ts`: hospital dispensing endpoint and replay-safe fulfilment orchestration.
- Create `test/prescription-hospital-dispense.test.ts`: route authorization, final-only, idempotency, transaction and clinical-status tests.
- Modify `src/schemas/clinical.ts`: persist optional mapped formulary medicine IDs and positive prescribed quantities on clinical items.
- Modify `src/routes/tenant/prescriptions.ts`: carry optional mapping/quantity into prescription-item persistence.
- Modify `src/routes/tenant/doctors.ts`: carry optional mapping/quantity from the consultation workflow into prescription-item persistence.
- Modify `src/routes/tenant/ePrescribing.ts`: expose the hospital-linked `medicine_id` only for configured formulary entries.
- Modify `test/prescription-finalization-integrity.test.ts`, `test/doctor-consultation-complete.test.ts`, and `test/e-prescribing-safety-route.test.ts`: prove dispensing metadata is not lost or inferred from free text.
- Modify `src/index.ts`: mount the focused fulfilment route on `/api/prescriptions`.
- Modify `src/routes/tenant/prescriptions.ts`: expose aggregate fulfilment status for final prescriptions and retire new prescription-level delivery mutations while retaining legacy fields for read compatibility only.
- Modify `src/schemas/clinical.ts`: stop accepting dispensing as a clinical prescription update and constrain legacy delivery handling.
- Modify `test/prescription-lock-version.test.ts`: replace the old clinical-status dispensing expectation with the new no-direct-dispensing contract.
- Modify `web/src/pages/MedicineDispensing.tsx`: call the one hospital-dispense endpoint and label it as an optional hospital pharmacy action.
- Modify `web/src/pages/MedicineDispensing.test.ts`: assert one API mutation, idempotency key, and optional-purchase messaging.
- Modify `web/src/pages/DigitalPrescription.tsx`: remove doctor-side medicine delivery ordering UI and API call.
- Modify `web/src/pages/DigitalPrescription.test.ts`: assert no delivery-order control is rendered on the clinical prescription page.
- Modify `src/routes/tenant/doctors.ts`: make consultation completion and adjacent dashboard status, reassign, and report-review lifecycle mutations D1 batches without schema-drift success masking.
- Modify `test/doctor-consultation-complete.test.ts` and create `test/doctor-lifecycle-atomicity.test.ts`: prove lifecycle writes are batched and errors do not return success.

### Task 1: D1 Fulfilment Persistence and Stock Invariants

**Files:**
- Create: `test/prescription-fulfilment-migration.test.ts`
- Create: `migrations/0275_medication_fulfilment_orders.sql`

- [ ] **Step 1: Write the failing migration contract test**

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/0275_medication_fulfilment_orders.sql', 'utf8');

describe('medication fulfilment persistence migration', () => {
  it('creates order truth separately from clinical prescriptions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS medication_orders');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS medication_order_items');
    expect(sql).toContain('UNIQUE(tenant_id, idempotency_key)');
    expect(sql).toContain('ALTER TABLE pharmacy_sales ADD COLUMN medication_order_id');
  });

  it('prevents platform fees or stock deductions from becoming unsafe clinical state', () => {
    expect(sql).not.toContain('doctor_id');
    expect(sql).not.toContain('medication_platform_fees');
    expect(sql).toContain('trg_medication_fulfilment_batch_nonnegative');
    expect(sql).toContain('trg_medication_fulfilment_item_overdispense');
    expect(sql).toContain('RAISE(ABORT');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails because the migration is absent**

Run: `pnpm vitest run test/prescription-fulfilment-migration.test.ts`

Expected: FAIL because `migrations/0275_medication_fulfilment_orders.sql` does not exist.

- [ ] **Step 3: Add the D1 migration**

Create tables with an operational order identifier, a prescription link, `channel`, `provider_type`, `status`, `request_hash`, `idempotency_key`, `sale_id`, and audit timestamps. Create item rows with prescribed snapshots, selected hospital medicine snapshots, quantities and alternative-consent columns. Add `pharmacy_sales.medication_order_id` plus a unique tenant/order index. Add `BEFORE UPDATE` triggers on `medicine_stock_batches.quantity_available` and `medicines.quantity` that use `SELECT RAISE(ABORT, 'medication_fulfilment_stock_negative')` when new quantity is below zero, and a trigger that aborts when `prescription_items.dispensed_qty` exceeds its prescribed `quantity`.

- [ ] **Step 4: Run the migration contract test**

Run: `pnpm vitest run test/prescription-fulfilment-migration.test.ts`

Expected: PASS.

### Task 2: Atomic Hospital Dispensing Endpoint

**Files:**
- Create: `test/prescription-hospital-dispense.test.ts`
- Create: `src/routes/tenant/prescriptionFulfilment.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing endpoint tests**

Write tests using `createTestApp`/`createMockDB` for:

```typescript
const validRequest = {
  idempotencyKey: 'dispense-rx-1-attempt-001',
  items: [{ prescriptionItemId: 11, medicineId: 501, quantity: 2, unitPrice: 500 }],
};

it('rejects a non-final prescription before creating a fulfilment order', async () => {
  const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', { method: 'POST', body: validRequest });
  expect(res.status).toBe(409);
  expect(recordedSql).not.toContain('insert into medication_orders');
});

it('commits hospital dispensing through order records without changing clinical prescription status', async () => {
  const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', { method: 'POST', body: validRequest });
  expect(res.status).toBe(201);
  expect(recordedSql).toContain('insert into medication_orders');
  expect(recordedSql).toContain('insert into medication_order_items');
  expect(recordedSql).toContain('insert into pharmacy_sales');
  expect(recordedSql).toContain('insert or ignore into accounting_posting_events');
  expect(recordedSql).not.toContain('update prescriptions set status');
});

it('returns the completed order for a replayed idempotency key', async () => {
  const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', { method: 'POST', body: validRequest });
  expect(res.status).toBe(200);
  expect((await res.json()).idempotent).toBe(true);
});
```

Also cover pharmacist/admin authorization, requested quantities above remaining prescribed quantity, unmapped medicine mismatch, and insufficient/non-expired stock.

- [ ] **Step 2: Run tests and verify missing route failure**

Run: `pnpm vitest run test/prescription-hospital-dispense.test.ts`

Expected: FAIL with `404` for the absent `/hospital-dispense` route.

- [ ] **Step 3: Implement the focused fulfilment router**

Use a strict request schema:

```typescript
const hospitalDispenseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  paymentMethod: z.enum(['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other']),
  items: z.array(z.object({
    prescriptionItemId: z.number().int().positive(),
    medicineId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
}).strict();
```

For `POST /:id/hospital-dispense`, enforce `pharmacist` or `hospital_admin`, tenant scope, `status = 'final'`, validated recorded counter payment method, order hash replay validation including that method, prescription-item ownership and medicine mapping, server-resolved unit price, remaining quantity, and FEFO non-expired stock. Build one `D1PreparedStatement[]` batch containing:

```typescript
INSERT INTO medication_orders (..., channel, provider_type, status, idempotency_key, request_hash, ...)
VALUES (..., 'hospital_counter', 'hospital_pharmacy', ?, ?, ?, ...);

INSERT INTO pharmacy_sales (..., medication_order_id, ...)
VALUES (..., ?, ...);

INSERT INTO medication_order_items (...);
UPDATE medicine_stock_batches SET quantity_available = quantity_available - ? WHERE id = ? AND tenant_id = ?;
UPDATE medicines SET quantity = quantity - ? WHERE id = ? AND tenant_id = ?;
UPDATE prescription_items SET dispensed_qty = dispensed_qty + ? WHERE id = ? AND prescription_id = ?;
INSERT INTO medicine_stock_movements (..., reference_type, reference_id, ...)
VALUES (..., 'sale', (SELECT id FROM pharmacy_sales WHERE tenant_id = ? AND medication_order_id = ?), ...);
INSERT OR IGNORE INTO accounting_posting_events (..., event_type, payload_json, ...)
VALUES (..., 'pharmacy_sale_cogs', ...);
INSERT INTO audit_logs (... redacted operational summary ...);
```

After a successful transaction, enqueue the existing pending-accounting posting worker path with `waitUntil`; the posting may be asynchronous, but its COGS source event is transactionally recorded with the fulfilment. The route returns the new order identifier, sale reference and `partial`/`fulfilled` status. It never updates `prescriptions.status`.

- [ ] **Step 4: Mount the new route and run endpoint tests**

Register:

```typescript
import prescriptionFulfilmentRoutes from './routes/tenant/prescriptionFulfilment';
app.route('/api/prescriptions', prescriptionRoutes);
app.route('/api/prescriptions', prescriptionFulfilmentRoutes);
```

Run: `pnpm vitest run test/prescription-hospital-dispense.test.ts`

Expected: PASS.

### Task 3: Preserve Verified Prescription-to-Stock Mapping

**Files:**
- Modify: `test/prescription-finalization-integrity.test.ts`
- Modify: `test/doctor-consultation-complete.test.ts`
- Modify: `test/e-prescribing-safety-route.test.ts`
- Modify: `src/schemas/clinical.ts`
- Modify: `src/routes/tenant/prescriptions.ts`
- Modify: `src/routes/tenant/doctors.ts`
- Modify: `src/routes/tenant/ePrescribing.ts`
- Modify: `web/src/pages/DigitalPrescription.tsx`
- Modify: `web/src/components/doctor/DoctorWorkspaceDrawer.tsx`

- [ ] **Step 1: Write failing data-contract tests**

Assert that a clinical item submitted with `medicineId` from the hospital formulary and a positive `quantity` stores both fields in `prescription_items`, through both prescription creation and doctor consultation completion. Assert that `quantity: 0` is rejected. Assert that the formulary search response returns `medicine_id` for linked local formulary products.

- [ ] **Step 2: Run the focused tests and observe metadata loss**

Run: `pnpm vitest run test/prescription-finalization-integrity.test.ts test/doctor-consultation-complete.test.ts test/e-prescribing-safety-route.test.ts`

Expected: FAIL because the existing schemas strip `medicineId` and `quantity` and formulary search does not expose verified stock mapping.

- [ ] **Step 3: Implement optional verified mapping and quantity persistence**

Extend item validation with optional positive `medicineId` and `quantity`; store them on `prescription_items` through both write flows. Return the configured formulary `medicine_id` from search; master-catalog/free-text medicines remain valid clinical text but have no automatic hospital dispensing mapping. Add doctor UI inputs/state so a doctor can record the prescribed quantity for a selected formulary item without choosing fulfilment or provider.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run test/prescription-finalization-integrity.test.ts test/doctor-consultation-complete.test.ts test/e-prescribing-safety-route.test.ts test/prescription-hospital-dispense.test.ts`

Expected: PASS.

### Task 4: Retire Prescription-Level Dispensing and Delivery Mutation

**Files:**
- Modify: `test/prescription-lock-version.test.ts`
- Modify: `src/routes/tenant/prescriptions.ts`
- Modify: `src/schemas/clinical.ts`

- [ ] **Step 1: Replace the failing legacy dispensing test**

```typescript
it('rejects a direct dispense_status mutation on the clinical prescription record', async () => {
  const res = await jsonRequest(app, '/prescriptions/1', {
    method: 'PUT',
    body: { dispense_status: 'dispensed' },
  });
  expect(res.status).toBe(400);
});

it('retires new delivery requests recorded directly on a prescription', async () => {
  const res = await jsonRequest(app, '/prescriptions/1/order-delivery', {
    method: 'POST',
    body: { address: 'Dhaka address', phone: '01700000000' },
  });
  expect(res.status).toBe(410);
});
```

- [ ] **Step 2: Run tests and observe old behavior failure**

Run: `pnpm vitest run test/prescription-lock-version.test.ts`

Expected: FAIL because direct `dispense_status` currently succeeds and delivery ordering currently writes to the prescription.

- [ ] **Step 3: Remove clinical dispensing transitions and retire new delivery orders**

Remove `dispense_status` from `updatePrescriptionSchema`; remove the direct dispensing branch and `final -> dispensed -> completed` transitions from clinical update handling. Return `410 Gone` from both new `/:id/order-delivery` and prescription-level `/:id/delivery-status` mutations with a message directing fulfilment to order-specific workflows. Keep legacy fields readable for migration reconciliation only.

- [ ] **Step 4: Surface operational fulfilment status in list/detail responses**

Extend the final prescription list response with an order-derived status:

```sql
CASE
  WHEN EXISTS (
    SELECT 1 FROM prescription_items pi
    WHERE pi.prescription_id = p.id AND COALESCE(pi.quantity, 0) > COALESCE(pi.dispensed_qty, 0)
  ) AND EXISTS (
    SELECT 1 FROM medication_orders mo
    WHERE mo.prescription_id = p.id AND mo.tenant_id = p.tenant_id
  ) THEN 'partial'
  WHEN EXISTS (
    SELECT 1 FROM medication_orders mo
    WHERE mo.prescription_id = p.id AND mo.tenant_id = p.tenant_id
  ) THEN 'dispensed'
  ELSE COALESCE(p.dispense_status, 'pending')
END AS fulfilment_status
```

Use `fulfilment_status` as UI operational data; do not set clinical status.

- [ ] **Step 5: Run prescription and fulfilment route tests**

Run: `pnpm vitest run test/prescription-lock-version.test.ts test/prescription-hospital-dispense.test.ts test/prescription-finalization-integrity.test.ts`

Expected: PASS.

### Task 5: Pharmacy UI Uses One Optional Fulfilment Command

**Files:**
- Modify: `web/src/pages/MedicineDispensing.test.ts`
- Modify: `web/src/pages/MedicineDispensing.tsx`
- Modify: `web/src/pages/DigitalPrescription.test.ts`
- Modify: `web/src/pages/DigitalPrescription.tsx`

- [ ] **Step 1: Add failing UI tests**

Render `MedicineDispensing` with mocked hooks/API and a final prescription. Open the dispense modal and submit an item:

```typescript
expect(api.post).toHaveBeenCalledTimes(1);
expect(api.post).toHaveBeenCalledWith(
  '/api/prescriptions/1/hospital-dispense',
  expect.objectContaining({
    idempotencyKey: expect.any(String),
    paymentMethod: 'cash',
    items: [{ prescriptionItemId: 11, medicineId: 501, quantity: 2 }],
  }),
);
expect(api.put).not.toHaveBeenCalled();
expect(screen.getByText(/patient may purchase medicines outside/i)).toBeInTheDocument();
```

Render `DigitalPrescription` and assert `Medicine Delivery` / `Order Delivery` is absent from the doctor's clinical prescription page.

- [ ] **Step 2: Run UI tests and observe two-request/doctor-delivery failures**

Run: `pnpm --filter web test -- src/pages/MedicineDispensing.test.ts src/pages/DigitalPrescription.test.ts`

Expected: FAIL because dispensing currently posts `/api/pharmacy/sales`, follows it with a prescription `PUT`, and the clinical screen contains delivery ordering.

- [ ] **Step 3: Implement optional hospital-pharmacy UI**

Change `MedicineDispensing` to:

- display an explicit note: `Hospital dispensing is optional. The patient may purchase medicines outside this hospital.`;
- require the pharmacist to select how counter payment was received before completing fulfilment;
- generate an idempotency key once for the submit attempt;
- post only to `/api/prescriptions/${selectedRx.id}/hospital-dispense`;
- read `fulfilment_status` rather than treating clinical prescription status as sale state.

Remove `showDelivery`, delivery contact state, `handleOrderDelivery`, and the delivery card from `DigitalPrescription`.

- [ ] **Step 4: Run UI tests**

Run: `pnpm --filter web test -- src/pages/MedicineDispensing.test.ts src/pages/DigitalPrescription.test.ts`

Expected: PASS.

### Task 5: Transactional Consultation Lifecycle Completion

**Files:**
- Modify: `test/doctor-consultation-complete.test.ts`
- Modify: `src/routes/tenant/doctors.ts`

- [ ] **Step 1: Add failing lifecycle transaction tests**

```typescript
it('commits appointment, visit and queue completion through one D1 batch', async () => {
  await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
    method: 'POST',
    body: { completeVisit: true },
  });
  expect(capturedBatchSql).toContain('update appointments');
  expect(capturedBatchSql).toContain('update visits');
  expect(capturedBatchSql).toContain('update queue_entries');
});

it('does not return a completed lifecycle when the completion transaction fails', async () => {
  mockDB.db.batch = async () => { throw new Error('transaction failed'); };
  const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
    method: 'POST',
    body: { completeVisit: true },
  });
  expect(res.status).toBe(500);
});
```

- [ ] **Step 2: Run the test and observe independent-update behavior**

Run: `pnpm vitest run test/doctor-consultation-complete.test.ts`

Expected: FAIL because lifecycle mutations currently execute independently and tolerate schema-drift update failure.

- [ ] **Step 3: Make lifecycle state updates atomic**

In `completeDoctorAppointment`, build three prepared statements and invoke:

```typescript
await db.$client.batch([
  updateAppointmentStatement,
  updateVisitStatement,
  updateQueueStatement,
]);
```

Do not use `safeRun()` for lifecycle completion. If an expected lifecycle table or mutation fails, the route fails rather than claiming completion. Keep the audit log after successful lifecycle commit and avoid putting clinical notes in the audit payload.

- [ ] **Step 4: Run doctor workflow tests**

Run: `pnpm vitest run test/doctor-consultation-complete.test.ts test/prescription-finalization-integrity.test.ts`

Expected: PASS.

### Task 6: Verification and Production Gate

**Files:**
- Verify all modified files; no new behavior unless a verified test exposes a required correction.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run test/prescription-fulfilment-migration.test.ts test/prescription-hospital-dispense.test.ts test/prescription-lock-version.test.ts test/prescription-finalization-integrity.test.ts test/doctor-consultation-complete.test.ts
pnpm --filter web test -- src/pages/MedicineDispensing.test.ts src/pages/DigitalPrescription.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static/build gates**

Run:

```bash
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 3: Run applicable broader suites**

Run:

```bash
pnpm test
pnpm --filter web test
```

Expected: all pass, or failures are individually reported as release blockers with no production deployment.

- [ ] **Step 4: Deploy only if every release gate is clear**

Run only after all required checks and workflow validation pass:

```bash
pnpm build && wrangler deploy --env production
```

Expected: production deployment reports a new Worker version for `https://hms-saas-production.rahmatullahzisan.workers.dev`.
