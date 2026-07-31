# Test-Level Performer Reserve and Doctor Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure flat or percentage performer reserve rules per diagnostic test, create immutable unit reserves during billing, calculate referral commission after the reserve, and let Reception Cash Operations assign selected reserve units to a doctor and pay them safely.

**Architecture:** Add a versioned test-rule table and a unit-level unassigned reserve ledger rather than weakening the existing doctor-specific accrual model. Bill finalization resolves canonical invoice items and rule snapshots, creates idempotent reserve units, and passes a reduced commission base into the existing commission engine. A new Cash Operations mutation converts selected reserve units into named doctor accruals, settlement items, one cash movement, and one accounting event in a guarded D1 batch.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, Drizzle schema declarations, TypeScript, Zod, React, TanStack Query wrappers, Vitest, Testing Library.

## Global Constraints

- Work only in `.worktrees/test-performer-reserve-payout` on branch `feature/test-performer-reserve-payout`.
- Do not copy or modify dirty files from the original `review/all-branches-20260711` checkout.
- D1 is the source of truth for rules, reserves, accruals, settlements, cash movements, and audit references.
- Use migration `0422_diagnostic_performer_reserve_payout.sql`; main already contains `0421_*` migrations.
- Update migration SQL, `tenant-schema.sql`, Drizzle declarations, and generated migration manifest together.
- Use basis points for persisted percentage rules: 1% = 100 bps, maximum 10,000 bps.
- Persist money rounded to two decimals; exclude tax from reserve and doctor commission base.
- Flat reserve is capped at the unit net service amount; percent reserve is capped at the same amount.
- Create one reserve row per integer invoice-item unit.
- Never trust a client-supplied reserve amount, bill-paid flag, doctor name, or drawer balance.
- Reserve-enabled items must not create a normal automatic performer accrual at billing or lab verification.
- Named doctor accruals are created only when selected reserves are paid.
- Only fully paid bills with active, uncancelled invoice items are eligible for payout.
- One payout settlement may contain multiple test types but exactly one doctor.
- All financial POST mutations require UUID-style idempotency keys and request-hash mismatch protection.
- Use a guarded D1 `batch()` for reserve payout so stale rows, count mismatches, or total mismatches roll back the entire transition.
- Standard cancellation/refund may cancel unpaid reserves but must block paid reserves until an authorized payout reversal occurs.
- Keep existing assigned-doctor payout behavior backward compatible.
- No automatic historical reserve backfill.

---

## File Map

### Create

- `migrations/0422_diagnostic_performer_reserve_payout.sql` — rule table, reserve table, accrual linkage/audit columns, indexes, and constraints.
- `src/lib/diagnostic-performer-payout.ts` — pure money allocation, rule normalization, unit reserve, and commission-base calculations.
- `src/lib/diagnostic-performer-reserve.ts` — canonical bill-item loading, effective rule resolution, reserve persistence, eligibility, cancellation, and paid-reserve guards.
- `test/diagnostic-performer-reserve-migration.test.ts` — migration, baseline schema, Drizzle parity, and unique-index checks.
- `test/unit/diagnostic-performer-payout.test.ts` — pure flat/percent/discount/tax/rounding tests.
- `test/integration/routes/diagnostic-performer-rules.test.ts` — rule read/write, LAB/RAD scope, versioning, overlap, and tenant isolation.
- `test/integration/routes/diagnostic-performer-reserves.test.ts` — bill finalization reserve creation and commission-base split.
- `test/integration/routes/reception-performer-reserve-payouts.test.ts` — reserve listing and atomic payout behavior.
- `web/src/components/reception/UnassignedPerformerReservePanel.tsx` — grouped reserve quantity selection and doctor assignment UI.
- `web/src/components/reception/UnassignedPerformerReservePanel.test.tsx` — reserve selection, doctor selection, amount, and mutation tests.
- `web/src/pages/billing-master-performer-rule.test.ts` — source/contract regression tests for test-level rule controls.

### Modify

- `tenant-schema.sql` — fresh-install parity for rules, reserves, accrual columns, and indexes.
- `src/db/schema/finance.ts` — Drizzle declarations for rules/reserves and new accrual fields/index.
- `src/data/schema-migrations.generated.ts` — regenerated migration manifest.
- `src/schemas/billingMaster.ts` — performer rule request schemas.
- `src/routes/tenant/billingMaster.ts` — rule endpoints and diagnostic service-item validation.
- `web/src/pages/BillingMasterPage.tsx` — LAB/RAD performer rule controls and price preview.
- `web/public/locales/en/billing.json` — English labels/messages.
- `web/public/locales/bn/billing.json` — Bengali labels/messages.
- `src/lib/billing-finalization.ts` — canonical reserve creation before commission accrual and item reserve summaries.
- `src/lib/lab-finance.ts` — use explicit commission base and suppress duplicate performer accrual for reserved items.
- Diagnostic-capable bill finalization call sites as required by canonical-item tests:
  - `src/routes/tenant/billing.ts`
  - `src/routes/tenant/billingCounter.ts`
  - `src/routes/tenant/billingProvisional.ts`
  - `src/routes/tenant/lab.ts`
  - `src/routes/tenant/radiology/orders.ts`
  - `src/routes/tenant/reception.ts`
  - `src/routes/tenant/ipBilling.ts`
- `src/schemas/commission.ts` — reserve payout payload schema.
- `src/routes/tenant/receptionDoctorPayouts.ts` — unassigned reserve read endpoint and guarded payout endpoint.
- `web/src/components/reception/ReceptionDoctorPayoutPanel.tsx` — assigned/unassigned payout sections.
- `web/src/pages/reception/CashOperationsPage.test.tsx` — combined payout workspace contract.
- `src/routes/tenant/billingCancellation.ts` — cancel unpaid reserves and block paid reserves.
- `src/routes/tenant/approvals.ts` — apply the same guard to approval-driven cancellation/refund.
- `src/routes/tenant/creditNotes.ts` — prevent refunding paid performer reserve units without reversal.
- `src/routes/tenant/dailyCollection.ts` — keep reserves out of cash-basis expense until paid and expose reserve reporting only where requested.
- Existing commission/payout/cancellation tests that assert source fields or response totals.

---

### Task 1: Add the performer rule and reserve schema

**Files:**
- Create: `migrations/0422_diagnostic_performer_reserve_payout.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `src/data/schema-migrations.generated.ts`
- Test: `test/diagnostic-performer-reserve-migration.test.ts`

**Interfaces:**
- Produces tables `diagnostic_performer_payout_rules` and `diagnostic_performer_reserves`.
- Produces accrual fields `commission_base_amount`, `performer_reserve_amount`, and `performer_reserve_id`.
- Later tasks depend on reserve statuses `reserved | paid | cancelled | reversed` and unique `(tenant_id, invoice_item_id, unit_sequence)`.

- [ ] **Step 1: Write the failing migration parity test**

Create `test/diagnostic-performer-reserve-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0422_diagnostic_performer_reserve_payout.sql', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
const drizzle = readFileSync('src/db/schema/finance.ts', 'utf8');

describe('diagnostic performer reserve schema', () => {
  it('creates versioned rules and immutable unit reserves', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS diagnostic_performer_payout_rules');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS diagnostic_performer_reserves');
    expect(migration).toContain("CHECK (rate_type IN ('flat', 'percent'))");
    expect(migration).toContain("CHECK (diagnostic_kind IN ('lab', 'radiology'))");
    expect(migration).toContain("CHECK (status IN ('reserved', 'paid', 'cancelled', 'reversed'))");
    expect(migration).toContain('UNIQUE (tenant_id, invoice_item_id, unit_sequence)');
  });

  it('adds deterministic reserve linkage to doctor accruals', () => {
    expect(migration).toContain('ADD COLUMN commission_base_amount REAL NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN performer_reserve_amount REAL NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN performer_reserve_id INTEGER');
    expect(migration).toContain('uq_doctor_commission_accrual_performer_reserve');
  });

  it('keeps fresh-install and Drizzle declarations in parity', () => {
    for (const text of [tenantSchema, drizzle]) {
      expect(text).toContain('diagnostic_performer_payout_rules');
      expect(text).toContain('diagnostic_performer_reserves');
      expect(text).toContain('performer_reserve_id');
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm vitest run test/diagnostic-performer-reserve-migration.test.ts
```

Expected: FAIL because migration 0422 and schema declarations do not exist.

- [ ] **Step 3: Create migration 0422**

Create `migrations/0422_diagnostic_performer_reserve_payout.sql` with this shape:

```sql
CREATE TABLE IF NOT EXISTS diagnostic_performer_payout_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  billing_service_item_id INTEGER NOT NULL,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'percent')),
  rate_value REAL NOT NULL CHECK (rate_value >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from)),
  CHECK (rate_type != 'percent' OR rate_value <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_rules_lookup
  ON diagnostic_performer_payout_rules(
    tenant_id, billing_service_item_id, is_active, effective_from, effective_to
  );

CREATE TABLE IF NOT EXISTS diagnostic_performer_reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  invoice_item_id INTEGER NOT NULL,
  patient_id INTEGER,
  visit_id INTEGER,
  billing_service_item_id INTEGER NOT NULL,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  lab_test_id INTEGER,
  radiology_imaging_item_id INTEGER,
  test_code TEXT,
  test_name TEXT NOT NULL,
  unit_sequence INTEGER NOT NULL CHECK (unit_sequence > 0),
  unit_service_amount REAL NOT NULL CHECK (unit_service_amount >= 0),
  unit_discount_amount REAL NOT NULL DEFAULT 0 CHECK (unit_discount_amount >= 0),
  net_unit_service_amount REAL NOT NULL CHECK (net_unit_service_amount >= 0),
  rule_rate_type TEXT NOT NULL CHECK (rule_rate_type IN ('flat', 'percent')),
  rule_rate_value REAL NOT NULL CHECK (rule_rate_value >= 0),
  reserved_amount REAL NOT NULL CHECK (reserved_amount >= 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'paid', 'cancelled', 'reversed')),
  assigned_doctor_id INTEGER,
  commission_accrual_id INTEGER,
  settlement_id INTEGER,
  reserved_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  paid_at TEXT,
  cancelled_at TEXT,
  reversed_at TEXT,
  cancel_reason TEXT,
  created_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, invoice_item_id, unit_sequence)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_status
  ON diagnostic_performer_reserves(tenant_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_service
  ON diagnostic_performer_reserves(tenant_id, billing_service_item_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_bill
  ON diagnostic_performer_reserves(tenant_id, bill_id, invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_settlement
  ON diagnostic_performer_reserves(tenant_id, settlement_id);

ALTER TABLE doctor_commission_accruals
  ADD COLUMN commission_base_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals
  ADD COLUMN performer_reserve_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals
  ADD COLUMN performer_reserve_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_commission_accrual_performer_reserve
  ON doctor_commission_accruals(tenant_id, performer_reserve_id)
  WHERE performer_reserve_id IS NOT NULL;
```

Mirror the tables/columns/indexes in `tenant-schema.sql`. Add `diagnosticPerformerPayoutRules`, `diagnosticPerformerReserves`, and the accrual fields/index in `src/db/schema/finance.ts` using existing naming conventions.

- [ ] **Step 4: Regenerate the migration manifest**

Run:

```bash
pnpm build:migrations
```

Expected: PASS and `src/data/schema-migrations.generated.ts` includes migration 0422.

- [ ] **Step 5: Run schema guards**

Run:

```bash
pnpm vitest run test/diagnostic-performer-reserve-migration.test.ts test/build-migration-manifest.test.ts test/production-migration-guard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/0422_diagnostic_performer_reserve_payout.sql tenant-schema.sql src/db/schema/finance.ts src/data/schema-migrations.generated.ts test/diagnostic-performer-reserve-migration.test.ts
git commit -m "feat: add diagnostic performer reserve schema"
```

---

### Task 2: Build pure payout split and rounding calculations

**Files:**
- Create: `src/lib/diagnostic-performer-payout.ts`
- Create: `test/unit/diagnostic-performer-payout.test.ts`

**Interfaces:**
- Produces `normalizePerformerRule`, `splitMoneyAcrossUnits`, `allocateProportionalMoney`, `calculateUnitPerformerReserve`, and `calculateDiagnosticLinePayoutSplit`.
- Later billing and payout tasks use these exact signatures.

```ts
export type PerformerPayoutRateType = 'flat' | 'percent';

export type NormalizedPerformerRule = {
  rateType: PerformerPayoutRateType;
  rateValue: number; // flat BDT or percentage basis points
};

export function normalizePerformerRule(input: {
  rateType: PerformerPayoutRateType;
  flatAmount?: number | null;
  percent?: number | null;
}): NormalizedPerformerRule;

export function splitMoneyAcrossUnits(total: number, quantity: number): number[];

export function allocateProportionalMoney(
  total: number,
  weights: number[],
): number[];

export function calculateUnitPerformerReserve(input: {
  netUnitServiceAmount: number;
  rule: NormalizedPerformerRule;
}): number;

export function calculateDiagnosticLinePayoutSplit(input: {
  serviceAmountExcludingTax: number;
  discountAmount: number;
  quantity: number;
  rule: NormalizedPerformerRule;
}): {
  units: Array<{
    unitSequence: number;
    unitServiceAmount: number;
    unitDiscountAmount: number;
    netUnitServiceAmount: number;
    reservedAmount: number;
  }>;
  netServiceAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
};
```

- [ ] **Step 1: Write failing calculation tests**

Cover at least:

```ts
it('splits a flat BDT 200 performer reserve before 20 percent referral commission', () => {
  const result = calculateDiagnosticLinePayoutSplit({
    serviceAmountExcludingTax: 1000,
    discountAmount: 0,
    quantity: 1,
    rule: { rateType: 'flat', rateValue: 200 },
  });
  expect(result.performerReserveAmount).toBe(200);
  expect(result.commissionBaseAmount).toBe(800);
});

it('normalizes 15 percent to 1500 basis points', () => {
  expect(normalizePerformerRule({ rateType: 'percent', percent: 15 }))
    .toEqual({ rateType: 'percent', rateValue: 1500 });
});

it('calculates percentage reserve from net service amount after discount', () => {
  const result = calculateDiagnosticLinePayoutSplit({
    serviceAmountExcludingTax: 1000,
    discountAmount: 100,
    quantity: 1,
    rule: { rateType: 'percent', rateValue: 1500 },
  });
  expect(result.performerReserveAmount).toBe(135);
  expect(result.commissionBaseAmount).toBe(765);
});

it('caps flat reserve at the unit net amount', () => {
  const result = calculateUnitPerformerReserve({
    netUnitServiceAmount: 120,
    rule: { rateType: 'flat', rateValue: 200 },
  });
  expect(result).toBe(120);
});

it('preserves cents exactly across three units', () => {
  const units = splitMoneyAcrossUnits(1000, 3);
  expect(units).toEqual([333.34, 333.33, 333.33]);
  expect(units.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 2);
});

it('excludes tax supplied outside service amount', () => {
  const result = calculateDiagnosticLinePayoutSplit({
    serviceAmountExcludingTax: 1000,
    discountAmount: 0,
    quantity: 1,
    rule: { rateType: 'percent', rateValue: 1000 },
  });
  expect(result.performerReserveAmount).toBe(100);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/unit/diagnostic-performer-payout.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure module**

Use integer cents internally for distribution and convert back to two-decimal BDT values. Reject non-integer or non-positive quantities. Normalize percent only from human percentage at the API boundary; internal calculations always receive basis points.

Core implementation:

```ts
import { roundMoney } from './discount_allocation';

const toCents = (value: number) => Math.max(0, Math.round(roundMoney(value) * 100));
const fromCents = (value: number) => roundMoney(value / 100);

export function splitMoneyAcrossUnits(total: number, quantity: number): number[] {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer');
  const cents = toCents(total);
  const base = Math.floor(cents / quantity);
  const remainder = cents % quantity;
  return Array.from({ length: quantity }, (_, index) => fromCents(base + (index < remainder ? 1 : 0)));
}

export function allocateProportionalMoney(total: number, weights: number[]): number[] {
  const totalCents = toCents(total);
  const normalized = weights.map((value) => Math.max(0, Number(value) || 0));
  const weightTotal = normalized.reduce((sum, value) => sum + value, 0);
  if (totalCents === 0 || weightTotal === 0) return normalized.map(() => 0);

  const exact = normalized.map((weight) => (totalCents * weight) / weightTotal);
  const floors = exact.map(Math.floor);
  let remainder = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i += 1) floors[order[i].index] += 1;
  return floors.map(fromCents);
}
```

Implement the remaining functions exactly to the interfaces above.

- [ ] **Step 4: Run and verify GREEN**

```bash
pnpm vitest run test/unit/diagnostic-performer-payout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diagnostic-performer-payout.ts test/unit/diagnostic-performer-payout.test.ts
git commit -m "feat: calculate diagnostic performer payout split"
```

---

### Task 3: Add test-level performer rule APIs

**Files:**
- Modify: `src/schemas/billingMaster.ts`
- Modify: `src/routes/tenant/billingMaster.ts`
- Test: `test/integration/routes/diagnostic-performer-rules.test.ts`

**Interfaces:**
- Produces `GET /api/billing-master/service-items/:id/performer-payout-rule`.
- Produces `PUT /api/billing-master/service-items/:id/performer-payout-rule`.
- Consumes `normalizePerformerRule` from Task 2.

Request schema:

```ts
export const performerPayoutRuleSchema = z.union([
  z.object({
    enabled: z.literal(true),
    rate_type: z.literal('flat'),
    flat_amount: z.number().min(0),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    enabled: z.literal(true),
    rate_type: z.literal('percent'),
    percent: z.number().min(0).max(100),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    enabled: z.literal(false),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().max(500).optional(),
  }),
]);
```

- [ ] **Step 1: Write failing route tests**

Tests must prove:

- LAB and RAD tenant-local service items accept flat and percentage rules.
- 15% persists as `1500` basis points.
- A non-diagnostic department returns `400`.
- A tenant cannot configure another tenant's service item.
- Editing closes the previous version on the day before the new `effective_from` date and inserts a new version.
- Disabling closes the current version without deleting historical rules.
- Overlapping or backward effective dates return `409`.
- GET returns the current effective rule and a bounded version history.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/integration/routes/diagnostic-performer-rules.test.ts
```

Expected: FAIL because endpoints and schema do not exist.

- [ ] **Step 3: Implement diagnostic service-item resolution**

Add a focused helper inside `billingMaster.ts` or a small local function:

```ts
async function loadTenantDiagnosticServiceItem(
  db: D1Database,
  tenantId: string,
  serviceItemId: number,
) {
  return db.prepare(`
    SELECT si.id, si.item_name, si.item_code, si.price, si.tenant_id,
           sd.department_code,
           CASE sd.department_code WHEN 'LAB' THEN 'lab' WHEN 'RAD' THEN 'radiology' END AS diagnostic_kind
    FROM billing_service_items si
    JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
    WHERE si.id = ?
      AND si.tenant_id = ?
      AND COALESCE(si.is_active, 1) = 1
      AND sd.department_code IN ('LAB', 'RAD')
    LIMIT 1
  `).bind(serviceItemId, tenantId).first<{
    id: number;
    item_name: string;
    item_code: string | null;
    price: number;
    tenant_id: string;
    department_code: 'LAB' | 'RAD';
    diagnostic_kind: 'lab' | 'radiology';
  }>();
}
```

Global items must be copied to the tenant before rule configuration, matching the existing Billing Master customization behavior.

- [ ] **Step 4: Implement versioned PUT and audited GET**

The PUT route must:

1. validate the tenant-local diagnostic item;
2. normalize flat/percent values;
3. load the latest active version;
4. reject a new effective date earlier than the existing version's start;
5. expire the previous version at `date(newEffectiveFrom, '-1 day')`;
6. insert the new enabled version, or only close the old version when disabling;
7. write an audit log with old/new values.

Use D1 `batch()` for close-plus-insert so a failed insert cannot leave the test unintentionally disabled.

- [ ] **Step 5: Run and verify GREEN**

```bash
pnpm vitest run test/integration/routes/diagnostic-performer-rules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/billingMaster.ts src/routes/tenant/billingMaster.ts test/integration/routes/diagnostic-performer-rules.test.ts
git commit -m "feat: configure performer reserve per diagnostic test"
```

---

### Task 4: Add Billing Master performer-rule controls

**Files:**
- Modify: `web/src/pages/BillingMasterPage.tsx`
- Modify: `web/public/locales/en/billing.json`
- Modify: `web/public/locales/bn/billing.json`
- Create: `web/src/pages/billing-master-performer-rule.test.ts`

**Interfaces:**
- Consumes rule GET/PUT endpoints from Task 3.
- Produces rule fields in the Service Item modal only for LAB/RAD departments.

- [ ] **Step 1: Write the failing UI contract test**

Assert the source contains stable labels/controls and API paths:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/BillingMasterPage.tsx', 'utf8');

describe('Billing Master performer payout rule', () => {
  it('shows fixed and percentage performer reserve controls for diagnostic tests', () => {
    expect(source).toContain('performerPayoutEnabled');
    expect(source).toContain("rate_type: 'flat'");
    expect(source).toContain("rate_type: 'percent'");
    expect(source).toContain('performer-payout-rule');
    expect(source).toContain('Performer Payout Rule');
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/billing-master-performer-rule.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Extend the Service Item form state**

Add these fields with flat as the default:

```ts
performer_payout_enabled: false,
performer_rate_type: 'flat' as 'flat' | 'percent',
performer_flat_amount: '0',
performer_percent: '0',
performer_effective_from: new Date().toISOString().slice(0, 10),
performer_notes: '',
```

Resolve the selected department's `department_code`; show the section only for `LAB` or `RAD`.

- [ ] **Step 4: Load and save the rule**

On edit, GET the current rule after the item loads. On item save success, PUT the rule when the selected item is diagnostic. Keep the modal open and show a specific error if the item saves but rule save fails.

Show preview text:

```text
Test price BDT 1,000 · Performer reserve BDT 200 · Remaining base BDT 800
```

For percent mode, preview with the human percentage.

- [ ] **Step 5: Run UI tests**

```bash
pnpm --filter web exec vitest run src/pages/BillingMasterPage.test.ts src/pages/billing-master-performer-rule.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/BillingMasterPage.tsx web/public/locales/en/billing.json web/public/locales/bn/billing.json web/src/pages/billing-master-performer-rule.test.ts
git commit -m "feat: add diagnostic performer rule controls"
```

---

### Task 5: Create canonical reserve rows during bill finalization

**Files:**
- Create: `src/lib/diagnostic-performer-reserve.ts`
- Modify: `src/lib/billing-finalization.ts`
- Test: `test/integration/routes/diagnostic-performer-reserves.test.ts`

**Interfaces:**
- Consumes Task 2 calculations and Task 1 tables.
- Produces:

```ts
export type BillItemPerformerReserveSummary = {
  billItemId: number;
  netServiceAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  reserveIds: number[];
};

export async function createBillDiagnosticPerformerReserves(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string | number;
    billId: number;
    billDate: string;
  },
): Promise<Map<number, BillItemPerformerReserveSummary>>;
```

- [ ] **Step 1: Write failing integration tests**

Tests must prove:

- one quantity creates one reserve row;
- quantity two creates unit sequences 1 and 2;
- retrying finalization creates no duplicates;
- flat and percent snapshots persist correctly;
- tax is excluded;
- bill discount is allocated before reserve;
- rule changes after billing do not modify old reserves;
- non-LAB/RAD and rule-disabled items create no reserves;
- tenant isolation applies to rule lookup.

Use the concrete assertion:

```ts
expect(reserves).toEqual([
  expect.objectContaining({
    unit_sequence: 1,
    net_unit_service_amount: 900,
    rule_rate_type: 'flat',
    rule_rate_value: 200,
    reserved_amount: 200,
    status: 'reserved',
  }),
]);
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/integration/routes/diagnostic-performer-reserves.test.ts
```

Expected: FAIL because reserve persistence does not exist.

- [ ] **Step 3: Implement canonical bill loading and discount allocation**

Load:

- `bills.patient_id`, `visit_id`, `discount`, and date;
- all active `invoice_items` for the bill;
- service-item/department and lab/radiology mapping;
- item-level discount allocations;
- effective rule for the bill date.

Calculate service amount as `max(0, line_total - COALESCE(tax_amount, 0))`. Apply item-level allocations first, then allocate the remaining bill discount proportionally with `allocateProportionalMoney`.

- [ ] **Step 4: Insert immutable unit rows idempotently**

For each diagnostic line, call `calculateDiagnosticLinePayoutSplit`, then insert each unit with:

```sql
INSERT INTO diagnostic_performer_reserves (
  tenant_id, rule_id, bill_id, invoice_item_id, patient_id, visit_id,
  billing_service_item_id, diagnostic_kind, lab_test_id, radiology_imaging_item_id,
  test_code, test_name, unit_sequence, unit_service_amount, unit_discount_amount,
  net_unit_service_amount, rule_rate_type, rule_rate_value, reserved_amount,
  status, created_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
ON CONFLICT(tenant_id, invoice_item_id, unit_sequence) DO NOTHING
```

Reload the persisted rows and return summaries keyed by invoice item ID. Do not trust `last_row_id` for conflict-safe inserts.

- [ ] **Step 5: Call reserve creation before commission accrual**

In `recordBillFinalizationSideEffects`:

```ts
const performerReserves = await createBillDiagnosticPerformerReserves(db, {
  tenantId: input.tenantId,
  userId: input.userId,
  billId: input.billId,
  billDate: input.billDate,
});
```

Hydrate canonical invoice item IDs for commission inputs. Add `commissionBaseAmount`, `performerReserveAmount`, and `hasPerformerReserve` to the item shape passed to `accrueBillCommissions`.

- [ ] **Step 6: Run and verify GREEN**

```bash
pnpm vitest run test/integration/routes/diagnostic-performer-reserves.test.ts test/unit/billing-finalization.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/diagnostic-performer-reserve.ts src/lib/billing-finalization.ts test/integration/routes/diagnostic-performer-reserves.test.ts test/unit/billing-finalization.test.ts
git commit -m "feat: reserve diagnostic performer payout at billing"
```

---

### Task 6: Apply the payout split to doctor commission accruals

**Files:**
- Modify: `src/lib/lab-finance.ts`
- Modify: diagnostic-capable finalization call sites only where tests show missing canonical item metadata.
- Test: `test/lab-finance.test.ts`
- Test: `test/integration/routes/diagnostic-performer-reserves.test.ts`

**Interfaces:**
- Extends bill commission item input with:

```ts
billItemId?: number | null;
commissionBaseAmount?: number | null;
performerReserveAmount?: number | null;
hasPerformerReserve?: boolean;
```

- [ ] **Step 1: Add failing commission tests**

Prove:

- BDT 1,000 line, BDT 200 reserve, 20% referral rule produces BDT 160.
- BDT 900 net line after discount, BDT 200 reserve, 20% produces BDT 140.
- performer doctor input is ignored for reserve-enabled items.
- non-reserve items retain current performer and referral behavior.
- created referral accrual stores original net amount, explicit commission base, and performer reserve amount.
- lab verification does not create a duplicate performer accrual when a reserve row exists.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/lab-finance.test.ts test/integration/routes/diagnostic-performer-reserves.test.ts
```

Expected: FAIL on the current full-line commission behavior.

- [ ] **Step 3: Use the explicit commission base**

Inside `accrueBillCommissions`, calculate:

```ts
const commissionBaseAmount = Math.max(
  0,
  roundMoney(item.commissionBaseAmount ?? item.lineTotal),
);
```

Use this value for prescriber/referrer rule calculation. Persist:

```ts
commission_base_amount = commissionBaseAmount
performer_reserve_amount = roundMoney(item.performerReserveAmount ?? 0)
```

For a reserve-enabled item:

```ts
if (item.hasPerformerReserve) {
  // No bill-time named performer accrual; Cash Operations will create it.
} else if (item.performerDoctorId) {
  // Existing performer accrual path.
}
```

- [ ] **Step 4: Suppress lab-verification duplicate performer accrual**

Before verification accrual insertion, query for a reserve matching the tenant, bill/lab test or invoice item linkage. If a reserve exists in `reserved`, `paid`, or `reversed`, return without creating a standard performer accrual.

- [ ] **Step 5: Run focused regressions**

```bash
pnpm vitest run test/lab-finance.test.ts test/integration/routes/diagnostic-performer-reserves.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lab-finance.ts src/lib/billing-finalization.ts src/routes/tenant/billing.ts src/routes/tenant/billingCounter.ts src/routes/tenant/billingProvisional.ts src/routes/tenant/lab.ts src/routes/tenant/radiology/orders.ts src/routes/tenant/reception.ts src/routes/tenant/ipBilling.ts test/lab-finance.test.ts test/integration/routes/diagnostic-performer-reserves.test.ts
git commit -m "feat: deduct performer reserve from referral commission"
```

Only add call-site files actually changed.

---

### Task 7: Show reserve state in Billing Counter

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Test: relevant Billing Counter route/unit tests.

**Interfaces:**
- Service item lookup returns current rule summary:

```ts
performerPayoutRule: null | {
  rateType: 'flat' | 'percent';
  rateValue: number;
  displayAmount: number;
  effectiveFrom: string;
};
```

- [ ] **Step 1: Write failing route/UI tests**

Prove that a reserve-enabled USG line displays `Performer BDT 200 auto-reserved per unit` and does not submit a performer doctor ID. Prescriber/referrer remains selectable.

- [ ] **Step 2: Run and verify RED**

Run the focused Billing Counter route and web tests identified by the existing suite.

- [ ] **Step 3: Join the effective rule into the service-item response**

Resolve by tenant, service item, bill date/today, `is_active = 1`, and effective window. Return no rule for non-diagnostic or disabled items.

- [ ] **Step 4: Render the read-only badge and disable performer input**

Clear stale `performerDoctorId` when a line changes to a reserve-enabled test. Do not change prescriber behavior.

- [ ] **Step 5: Run regressions and commit**

```bash
git add src/routes/tenant/billingCounter.ts web/src/pages/BillingCounterPage.tsx test web/src/pages/BillingCounterPage.test.ts
git commit -m "feat: show automatic performer reserve in billing"
```

Add only the exact focused test files changed.

---

### Task 8: Add unassigned reserve payables read API

**Files:**
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Test: `test/integration/routes/reception-performer-reserve-payouts.test.ts`

**Interfaces:**
- Produces `GET /api/payment-methods/doctor-payouts/unassigned-performer-reserves`.

Response shape:

```ts
type UnassignedPerformerReserveResponse = {
  groups: Array<{
    billingServiceItemId: number;
    testCode: string | null;
    testName: string;
    diagnosticKind: 'lab' | 'radiology';
    eligibleQuantity: number;
    waitingPaymentQuantity: number;
    eligibleAmount: number;
    waitingPaymentAmount: number;
    rateSummary: string;
    reserves: Array<{
      reserveId: number;
      serviceDate: string;
      patientId: number | null;
      patientName: string | null;
      patientCode: string | null;
      billId: number;
      invoiceNo: string;
      netUnitServiceAmount: number;
      reservedAmount: number;
      billIsPaid: boolean;
    }>;
  }>;
  summary: {
    testCount: number;
    eligibleQuantity: number;
    waitingPaymentQuantity: number;
    eligibleAmount: number;
    waitingPaymentAmount: number;
  };
};
```

- [ ] **Step 1: Write failing listing tests**

Prove grouping, fully-paid eligibility, waiting-payment separation, date filtering, service-item filtering, status filtering, and tenant isolation.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/integration/routes/reception-performer-reserve-payouts.test.ts
```

Expected: FAIL because endpoint does not exist.

- [ ] **Step 3: Implement the tenant-scoped query**

Join reserves to bills, invoice items, patients, and service items. Reuse the existing paid-bill predicate. Return only `status = 'reserved'`. Order reserve rows by service date then reserve ID so the UI's quantity selection is FIFO and deterministic.

- [ ] **Step 4: Run and verify GREEN**

```bash
pnpm vitest run test/integration/routes/reception-performer-reserve-payouts.test.ts
```

Expected: listing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/receptionDoctorPayouts.ts test/integration/routes/reception-performer-reserve-payouts.test.ts
git commit -m "feat: list unassigned diagnostic performer reserves"
```

---

### Task 9: Pay selected reserve units to one doctor atomically

**Files:**
- Modify: `src/schemas/commission.ts`
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Test: `test/integration/routes/reception-performer-reserve-payouts.test.ts`

**Interfaces:**
- Produces `POST /api/payment-methods/doctor-payouts/sessions/:id/pay-reserves`.
- Uses existing settlement, drawer, idempotency, accounting, shadow-ledger, and audit patterns.

Schema:

```ts
export const receptionPerformerReservePayoutSchema = z.object({
  doctorId: z.number().int().positive(),
  reserveIds: z.array(z.number().int().positive()).min(1).max(500)
    .transform((ids) => Array.from(new Set(ids)).sort((a, b) => a - b)),
  receiverType: z.enum(['doctor', 'assistant', 'representative']).default('doctor'),
  receiverName: z.string().min(1).max(200),
  receiverReference: z.string().max(200).optional(),
  paymentMethod: z.literal('cash'),
  adjustments: z.object({
    advanceDeduction: z.number().min(0).default(0),
    otherAdjustment: z.number().default(0),
    roundingAdjustment: z.number().min(-1).max(1).default(0),
  }),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});
```

- [ ] **Step 1: Add failing mutation tests**

Prove:

- two reserve units create one settlement, two named accruals, two settlement items, and one cash-out;
- selected reserves may come from multiple test types but one chosen doctor;
- unpaid bill, cancelled item, stale reserve, inactive/cross-tenant doctor, wrong workstation, insufficient cash, and closed period are blocked;
- duplicate request retry replays the first success;
- same idempotency key with different reserve IDs returns conflict;
- two payout attempts cannot claim the same reserve;
- reserve/accrual/settlement totals match exactly;
- reserve rows store assigned doctor, accrual, settlement, and paid timestamp.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm vitest run test/integration/routes/reception-performer-reserve-payouts.test.ts
```

Expected: mutation tests FAIL.

- [ ] **Step 3: Reuse existing preflight controls**

Before constructing the batch:

1. reserve/replay idempotency request hash;
2. load current-workstation active session and match path session ID;
3. load active same-tenant doctor;
4. load all selected reserve rows with linked bills/items;
5. require exact row count, `reserved` status, active invoice item, and fully paid bill;
6. calculate gross reserve total and adjustments;
7. verify positive net payout and drawer cash;
8. assert accounting period open.

- [ ] **Step 4: Build the guarded D1 batch**

Use a new mutation type such as `reception_performer_reserve_payout`. Insert:

- settlement header keyed by idempotency key;
- one accrual per reserve with `source_type = 'lab_test'`, `incentive_type = 'performer'`, `commission_amount = reserved_amount`, `performer_reserve_id = reserve.id`, and settlement ID from the deterministic settlement subquery;
- settlement items from the new accruals;
- guarded reserve updates requiring `status = 'reserved'`;
- one `cash_drawer_movements` payout row;
- accounting posting and audit records using the same patterns as existing doctor payout.

Add a final transition guard that deliberately violates a NOT NULL/unique constraint when any of these are false:

```text
settlement item count = selected reserve count
paid reserve count = selected reserve count
sum settlement commission = gross reserve total
sum paid reserve amount = gross reserve total
one cash movement exists for settlement
```

- [ ] **Step 5: Complete idempotency and shadow ledger**

After successful batch, resolve settlement/accrual/cash movement IDs, complete the mutation idempotency record, and call the existing shadow cash-ledger writer with source `doctor_commission_settlement`. A retry must not write a second shadow row because its idempotency key is settlement-based.

- [ ] **Step 6: Run and verify GREEN**

```bash
pnpm vitest run test/integration/routes/reception-performer-reserve-payouts.test.ts test/integration/routes/reception-doctor-payouts.test.ts
```

Expected: PASS and existing assigned-doctor payout tests remain green.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/commission.ts src/routes/tenant/receptionDoctorPayouts.ts test/integration/routes/reception-performer-reserve-payouts.test.ts test/integration/routes/reception-doctor-payouts.test.ts
git commit -m "feat: pay performer reserves from reception cash"
```

---

### Task 10: Add the unassigned reserve panel to Cash Operations

**Files:**
- Create: `web/src/components/reception/UnassignedPerformerReservePanel.tsx`
- Create: `web/src/components/reception/UnassignedPerformerReservePanel.test.tsx`
- Modify: `web/src/components/reception/ReceptionDoctorPayoutPanel.tsx`
- Modify: `web/src/pages/reception/CashOperationsPage.test.tsx`
- Modify: locale files as needed.

**Interfaces:**
- Consumes Tasks 8 and 9 endpoints.
- Emits query invalidation for doctor payouts, commissions, billing counter, cash activity, and daily collection.

- [ ] **Step 1: Write failing component tests**

Tests must prove:

- groups show eligible and waiting quantities separately;
- entering quantity 2 selects the oldest two eligible reserve IDs;
- exact row selection overrides quantity helper correctly;
- doctor selection is required;
- selected amount cannot exceed drawer cash;
- submit payload contains exact reserve IDs, one doctor, zero default adjustments, and UUID idempotency key;
- success clears selection and invalidates all financial queries;
- existing assigned-payable panel remains usable.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/components/reception/UnassignedPerformerReservePanel.test.tsx src/pages/reception/CashOperationsPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Build the grouped reserve component**

Render:

- summary cards;
- test groups;
- eligible quantity input bounded by the number of eligible rows;
- expandable reserve rows;
- doctor selector from the existing tenant doctor endpoint;
- receiver/note controls;
- selected quantity and amount summary;
- disabled submit with explicit reason.

Selection helper:

```ts
function selectOldestReserveIds(
  reserves: Array<{ reserveId: number; billIsPaid: boolean }>,
  quantity: number,
): number[] {
  return reserves
    .filter((row) => row.billIsPaid)
    .slice(0, Math.max(0, quantity))
    .map((row) => row.reserveId);
}
```

- [ ] **Step 4: Integrate under Doctor Payout**

Use two clearly labeled subsections:

- `Assigned Doctor Payables`
- `Unassigned Test Performer Reserves`

Do not mix reserve IDs with existing accrual IDs in one mutation.

- [ ] **Step 5: Run and verify GREEN**

```bash
pnpm --filter web exec vitest run src/components/reception/UnassignedPerformerReservePanel.test.tsx src/pages/reception/CashOperationsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/reception/UnassignedPerformerReservePanel.tsx web/src/components/reception/UnassignedPerformerReservePanel.test.tsx web/src/components/reception/ReceptionDoctorPayoutPanel.tsx web/src/pages/reception/CashOperationsPage.test.tsx web/public/locales/en/billing.json web/public/locales/bn/billing.json
git commit -m "feat: assign and pay performer reserves in cash operations"
```

---

### Task 11: Enforce cancellation, refund, and reversal safety

**Files:**
- Modify: `src/lib/diagnostic-performer-reserve.ts`
- Modify: `src/routes/tenant/billingCancellation.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/routes/tenant/creditNotes.ts`
- Test: focused cancellation/refund/approval tests.

**Interfaces:**
- Produces:

```ts
export async function assertNoPaidPerformerReserves(
  db: D1Database,
  tenantId: string,
  input: { billId: number; invoiceItemIds?: number[] },
): Promise<void>;

export async function cancelUnpaidPerformerReserves(
  db: D1Database,
  tenantId: string,
  input: {
    billId: number;
    invoiceItemIds?: number[];
    reason: string;
    userId: string | number;
  },
): Promise<number>;
```

- [ ] **Step 1: Write failing lifecycle tests**

Prove:

- full bill cancellation changes all `reserved` rows to `cancelled`;
- item cancellation changes only selected invoice-item reserves;
- cancelled reserves disappear from payout lists;
- paid reserve causes standard cancel/refund/credit-note approval to return `409`;
- no route partially cancels a bill before discovering a paid reserve;
- tenant isolation applies to guards.

- [ ] **Step 2: Run and verify RED**

Run the focused existing cancellation, approvals, and credit-note tests plus new cases.

- [ ] **Step 3: Add preflight guard before any clinical/accounting mutation**

Call `assertNoPaidPerformerReserves` before changing bill/item status or creating a credit note. Use the message:

```text
This bill includes a paid performer payout. Reverse the doctor payout before cancelling or refunding the linked test.
```

- [ ] **Step 4: Cancel unpaid reserves in the same lifecycle boundary**

After all preflight checks and within the route's existing atomic boundary, update only `status = 'reserved'` rows to `cancelled`, set reason/timestamp, and write audit linkage.

- [ ] **Step 5: Add an authorized reserve-settlement reversal endpoint**

Add `POST /api/payment-methods/doctor-payouts/settlements/:id/reverse` to `src/routes/tenant/receptionDoctorPayouts.ts` with a schema containing `reason` (minimum 3 characters) and UUID `idempotencyKey`. Restrict it to the existing administrator/accountant reversal roles; reception users may not reverse completed payouts.

The route must load one same-tenant settlement, require linked `diagnostic_performer_reserves` in `paid` status, require an open accounting period, and use a guarded D1 batch to:

1. insert one opposite-direction cash drawer movement linked to the original settlement and original counter session;
2. record the existing accounting reversal event with the original voucher/event reference;
3. update linked accruals from `paid` to `cancelled` and clear no immutable amount fields;
4. update linked reserves from `paid` to `reversed` with `reversed_at` and the reason;
5. write an immutable audit event;
6. fail the batch unless reversed reserve count and reversed amount equal the original reserve-linked settlement count and amount.

Required postconditions:

```text
original settlement retained
cash/accounting reversal linked
accrual status = cancelled
reserve status = reversed
bill cancellation/refund may be retried after successful reversal
```

- [ ] **Step 6: Run and verify GREEN**

Run all focused lifecycle tests and confirm no existing cancellation/refund behavior regresses for bills without reserves.

- [ ] **Step 7: Commit**

```bash
git add src/lib/diagnostic-performer-reserve.ts src/routes/tenant/billingCancellation.ts src/routes/tenant/approvals.ts src/routes/tenant/creditNotes.ts test
git commit -m "feat: guard performer reserves during refund and cancellation"
```

Stage only the focused test files changed.

---

### Task 12: Add reconciliation reporting and complete verification

**Files:**
- Modify: `src/routes/tenant/dailyCollection.ts` only if response contract needs reserve metrics.
- Modify: settlement receipt/detail source as identified by existing tests.
- Add/modify focused reporting tests.
- Modify: `docs/database-guide.md` migration metadata after implementation if repository practice requires it.

**Interfaces:**
- Preserves cash-basis expense behavior: only paid settlements count as doctor payout expense.
- Adds reserve reporting fields without treating unpaid reserves as cash-out.

- [ ] **Step 1: Write failing reconciliation tests**

Prove:

- an unpaid reserve does not increase daily cash expense;
- a completed reserve payout increases doctor payout expense once;
- settlement detail includes test quantity and reserve-linked items;
- unassigned reserve report totals equal the reserve ledger;
- cancelled/reversed rows are separated from currently reserved rows.

- [ ] **Step 2: Implement server-derived reserve summaries**

Use direct aggregate queries over `diagnostic_performer_reserves`; never sum client values. Keep patient details out of broad summaries.

- [ ] **Step 3: Run the focused feature suite**

```bash
pnpm vitest run \
  test/diagnostic-performer-reserve-migration.test.ts \
  test/unit/diagnostic-performer-payout.test.ts \
  test/integration/routes/diagnostic-performer-rules.test.ts \
  test/integration/routes/diagnostic-performer-reserves.test.ts \
  test/integration/routes/reception-performer-reserve-payouts.test.ts \
  test/integration/routes/reception-doctor-payouts.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the focused web suite**

```bash
pnpm --filter web exec vitest run \
  src/pages/BillingMasterPage.test.ts \
  src/pages/billing-master-performer-rule.test.ts \
  src/components/reception/UnassignedPerformerReservePanel.test.tsx \
  src/pages/reception/CashOperationsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run schema, type, and build verification**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm --filter web build
```

Expected: all PASS.

- [ ] **Step 6: Run broader billing/cash regressions**

Run existing billing finalization, commission, billing cancellation, credit note, approval, daily collection, cash movement, and Cash Operations tests selected by filename. Do not run Playwright against production.

- [ ] **Step 7: Review the final diff**

Verify:

- original dirty workspace remains untouched;
- no E2E reports, auth state, traces, generated local DBs, or `.ai-bridge` files are staged;
- migration is additive and numbered 0422;
- all financial queries are tenant-scoped;
- no client-supplied amount is trusted;
- no duplicate performer path remains for reserve-enabled items;
- flat and percentage modes both have tests;
- existing assigned-doctor payouts still pass.

- [ ] **Step 8: Commit final reporting/docs changes**

```bash
git add src/routes/tenant/dailyCollection.ts docs/database-guide.md test web
git commit -m "test: verify performer reserve payout reconciliation"
```

Stage only files actually changed in this task.

---

## Execution Order and Review Gates

1. Tasks 1–2 establish schema and pure calculations.
2. Tasks 3–4 deliver independently testable rule configuration.
3. Tasks 5–7 deliver billing-time reserve and commission split.
4. Tasks 8–10 deliver reserve assignment and cash payout.
5. Tasks 11–12 close lifecycle and reconciliation risks.

After each task:

- run the exact focused tests;
- review tenant scope, money rounding, and idempotency;
- commit only that task's files;
- do not continue with a red baseline introduced by the task.

## Plan Self-Review

- Spec coverage: rule configuration, flat/percent support, unit reserves, discount/tax rules, commission split, Billing Counter state, Cash Operations listing/payout, idempotency, cancellation/refund/reversal, audit, and reporting each map to an explicit task.
- Placeholder scan: every implementation step names its concrete interface, validation, command, and expected result.
- Type consistency: `rateValue` is flat BDT or percent basis points throughout; reserve payout always submits exact `reserveIds`; `performerReserveId` is the unique accrual linkage; money uses two-decimal BDT values.
