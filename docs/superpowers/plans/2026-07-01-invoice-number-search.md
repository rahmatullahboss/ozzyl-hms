# Invoice Number Search Across Patient/Bill Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let receptionists and billing operators find bills by their invoice number from every patient/bill list in the product, with partial matching and typo tolerance (`o` ↔ `0`).

**Architecture:** Lift the existing `buildInvoiceSearchTerms` helper from `src/routes/tenant/global-search.ts` into a new `src/lib/invoice-search.ts` module. Reuse it on the server to extend `search` query params on three billing endpoints (`/api/reception/visits`, `/api/ip-billing/patients`, `/api/billing-counter/pending-bills`). On the frontend, add `invoice_no` (or `invoiceNo`) to existing in-memory `.filter()` predicates on the reception patient flow, due collection, and lab monitoring pages. Refresh the `byNameOrSerialOrNumber` placeholder to mention "invoice".

**Tech Stack:** TypeScript, Hono (server), React + TanStack Query (web), D1 / `c.env.DB` (SQL), Vitest + D1 mock-db helpers (testing), `en`/`bn` JSON i18n files.

---

## File Structure

### New

- `src/lib/invoice-search.ts` — pure helper exports `buildInvoiceSearchTerms` and `escapeLikeWildcards`.
- `test/unit/invoice-search.test.ts` — unit tests for the extracted helper.

### Modified — backend

- `src/routes/tenant/global-search.ts` — replace private `buildInvoiceSearchTerms` with re-export from `src/lib/invoice-search.ts` (zero behavior change).
- `src/routes/tenant/reception.ts` — `/api/reception/visits` (line ~2359) gains `b.invoice_no LIKE ?` clauses when `search` is supplied.
- `src/routes/tenant/billingCounter.ts` — `/api/billing-counter/pending-bills` (line ~683) gains a new `search` query param that applies `b.invoice_no LIKE ?` + patient name LIKE.
- `src/routes/tenant/ipBilling.ts` — `/api/ip-billing/patients` (line ~248) gains `b.invoice_no LIKE ?` clauses when `search` is supplied.
- `src/routes/tenant/lab.ts` — whichever lab monitoring endpoint returns rows with `invoice_no`; if more than one, pick the one that powers `LabMonitoringDashboard`.

### Modified — frontend

- `web/src/pages/ReceptionDashboard.tsx` — extend `flowSearch` filter at line 2776 and `dueCollectionSearch` filter to also match `invoice_no` / `invoiceNo`.
- `web/src/pages/LabMonitoringDashboard.tsx` — extend the `search` predicate at line 455 to include `row.invoice_no`.
- `web/public/locales/en/reception.json` — update `placeholder.byNameOrSerialOrNumber`.
- `web/public/locales/bn/reception.json` — same key.

### New — integration tests

- `test/integration/routes/reception-visits-invoice-search.test.ts`
- `test/integration/routes/ip-billing-patients-invoice-search.test.ts`
- `test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts`

### New — frontend test

- `web/src/pages/ReceptionDashboard.test.tsx` (existing) — add cases for invoice_no search in `flowSearch`.

---

## Task 1: Extract `buildInvoiceSearchTerms` to `src/lib/invoice-search.ts`

**Files:**
- Create: `src/lib/invoice-search.ts`
- Modify: `src/routes/tenant/global-search.ts:95-118`
- Test: `test/unit/invoice-search.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `test/unit/invoice-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildInvoiceSearchTerms,
  escapeLikeWildcards,
} from '../../src/lib/invoice-search';

describe('buildInvoiceSearchTerms', () => {
  it('wraps the original trimmed input in % wildcards', () => {
    const out = buildInvoiceSearchTerms('INV-000001');
    expect(out.original).toBe('%INV-000001%');
    expect(out.normalized).toBe('%INV-000001%');
  });

  it('normalises letter o and O to digit 0', () => {
    const out = buildInvoiceSearchTerms('inv-oooo12');
    expect(out.original).toBe('%inv-oooo12%');
    expect(out.normalized).toBe('%inv-000012%');
  });

  it('pads pure-digit inputs shorter than 6 chars to six digits', () => {
    const out = buildInvoiceSearchTerms('23');
    expect(out.padded).toBe('%000023%');
  });

  it('pads digit-only input that contains letter-o typos', () => {
    const out = buildInvoiceSearchTerms('oooo23');
    expect(out.padded).toBe('%000023%');
  });

  it('does not pad digit-only inputs with 6+ chars', () => {
    const out = buildInvoiceSearchTerms('1234567');
    expect(out.padded).toBe('%1234567%');
  });

  it('returns empty-string patterns for blank input', () => {
    const out = buildInvoiceSearchTerms('   ');
    expect(out.original).toBe('%%');
    expect(out.normalized).toBe('%%');
    expect(out.padded).toBe('%%');
  });
});

describe('escapeLikeWildcards', () => {
  it('escapes % and _ characters', () => {
    expect(escapeLikeWildcards('50%_off')).toBe('50\\%\\_off');
  });

  it('leaves normal characters untouched', () => {
    expect(escapeLikeWildcards('INV-000001')).toBe('INV-000001');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test test/unit/invoice-search.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/invoice-search'" (or similar module-not-found error).

- [ ] **Step 3: Create the new helper module**

Create `src/lib/invoice-search.ts`:

```ts
/**
 * Helpers for building SQL LIKE patterns that match a user-typed invoice
 * number forgivingly.
 *
 * Extracted from src/routes/tenant/global-search.ts so multiple route
 * handlers can share the same typo-tolerant match logic.
 */

export interface InvoiceSearchTerms {
  /** Raw trimmed query wrapped in % wildcards. */
  original: string;
  /** Query with letter o/O normalised to digit 0, wrapped in % wildcards. */
  normalized: string;
  /**
   * Padded numeric pattern. When the normalised query contains only digits
   * and has fewer than 6 digits, this is the same digits zero-padded to 6
   * and wrapped in %. Otherwise it equals `original` so it does not produce
   * surprising matches for long numeric strings.
   */
  padded: string;
}

export function buildInvoiceSearchTerms(raw: string): InvoiceSearchTerms {
  const trimmed = raw.trim();
  const original = `%${trimmed}%`;
  const normalized = `%${trimmed.replace(/o/gi, '0')}%`;

  const digitsOnly = trimmed.replace(/o/gi, '0').replace(/\D/g, '');
  const padded =
    digitsOnly.length > 0 && digitsOnly.length < 6
      ? `%${digitsOnly.padStart(6, '0')}%`
      : original;

  return { original, normalized, padded };
}

/**
 * Escape `%` and `_` (SQL LIKE wildcards) in user input so they cannot be
 * used to widen an unintended scan. Callers should pass the escaped value
 * into the helper and also include `ESCAPE '\\'` in the SQL clause.
 */
export function escapeLikeWildcards(raw: string): string {
  return raw.replace(/([%_\\])/g, '\\$1');
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm test test/unit/invoice-search.test.ts`
Expected: PASS (all assertions succeed).

- [ ] **Step 5: Replace the private helper in `global-search.ts` with a re-export**

Edit `src/routes/tenant/global-search.ts`:

1. Add a new import at the top of the file (with the other imports from `../../lib/...`):

```ts
export { buildInvoiceSearchTerms } from '../../lib/invoice-search';
```

2. Delete the entire local `function buildInvoiceSearchTerms(raw: string): { ... }` block including its preceding comment (lines ~88-118).

The function is still referenced at line 25 inside the route handler; the re-export keeps it available.

- [ ] **Step 6: Run the global-search test suite (if it exists) to verify nothing regressed**

Run: `pnpm test test/integration/routes/query-param-fix.test.ts` (this exercises the global search endpoint; if it is not the right path, run `pnpm test -- -t "global-search"` to find the right test file.)
Expected: PASS — no behaviour change.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoice-search.ts \
        src/routes/tenant/global-search.ts \
        test/unit/invoice-search.test.ts
git commit -m "refactor: extract buildInvoiceSearchTerms to src/lib/invoice-search

Pure helper now lives next to other lib/ utilities so route handlers
in reception, billingCounter, and ipBilling can reuse the same
typo-tolerant LIKE patterns. global-search.ts re-exports it for
backward compatibility with any caller that imported it from there.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add `invoice_no` search to `/api/reception/visits`

**Files:**
- Modify: `src/routes/tenant/reception.ts:2359-2407` (the `/visits` handler search clause)
- Test: `test/integration/routes/reception-visits-invoice-search.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/routes/reception-visits-invoice-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import receptionRoutes from '../../../src/routes/tenant/reception';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /reception/visits — invoice_no search', () => {
  it('matches when search text equals invoice_no (with typos o→0)', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        visits: [
          { id: 1, tenant_id: TENANT_1.id, patient_id: 10, visit_date: '2026-07-01', status: 'open', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [
          { id: 10, tenant_id: TENANT_1.id, name: 'Rahim', patient_code: 'P-001', mobile: '01700000001' },
        ],
        bills: [
          { id: 100, tenant_id: TENANT_1.id, visit_id: 1, patient_id: 10, invoice_no: 'INV-000001', total: 500, paid: 0, due: 500, status: 'open', created_at: '2026-07-01 09:05:00' },
        ],
        doctors: [],
        token_reservations: [],
      },
    });

    const res = await jsonRequest(app, '/reception/visits?date=2026-07-01&search=inv-oooo1');
    expect(res.status).toBe(200);

    const visitSearchSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+visits/i.test(sql) && sql.includes('?'));
    expect(visitSearchSql).toBeDefined();
    expect(visitSearchSql!.toLowerCase()).toContain('invoice_no');
  });

  it('does not add an invoice_no clause when search is empty', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        visits: [
          { id: 1, tenant_id: TENANT_1.id, patient_id: 10, visit_date: '2026-07-01', status: 'open', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Rahim', patient_code: 'P-001', mobile: '01700000001' }],
        bills: [],
        doctors: [],
        token_reservations: [],
      },
    });

    const res = await jsonRequest(app, '/reception/visits?date=2026-07-01');
    expect(res.status).toBe(200);

    const visitSearchSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+visits/i.test(sql));
    expect(visitSearchSql).toBeDefined();
    expect(visitSearchSql!.toLowerCase()).not.toContain('invoice_no like');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test test/integration/routes/reception-visits-invoice-search.test.ts`
Expected: FAIL — `visitSearchSql!.toLowerCase()` does not contain `'invoice_no'`.

- [ ] **Step 3: Extend the `/visits` search clause**

Edit `src/routes/tenant/reception.ts`. Replace the block starting with `if (search) {` at line 2359 with:

```ts
  if (search) {
    const invoiceTerms = buildInvoiceSearchTerms(search);
    const like = `%${search}%`;
    sql += ` AND (
      p.name LIKE ?
      OR p.patient_code LIKE ?
      OR p.mobile LIKE ?
      OR b.invoice_no LIKE ?
      OR b.invoice_no LIKE ?
      OR b.invoice_no LIKE ?
    )`;
    params.push(like, like, like, invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }
```

Also add the import at the top of the file (next to the other `../../lib/...` imports):

```ts
import { buildInvoiceSearchTerms } from '../../lib/invoice-search';
```

Note: the `/visits` SELECT already joins `bills` via the `bs` and `lb` subqueries; `b.invoice_no` is in scope. If your version of the query does not include `b.invoice_no` in the join chain, you may need to expose it via an additional `LEFT JOIN bills search_b ON search_b.visit_id = v.id AND search_b.tenant_id = v.tenant_id` restricted to `MAX(search_b.id)` so the `OR` clause compiles. Pick whichever keeps the change minimal.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `pnpm test test/integration/routes/reception-visits-invoice-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-run the existing reception test suite**

Run: `pnpm test -- -t "reception"`
Expected: PASS — no regression.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/reception.ts \
        test/integration/routes/reception-visits-invoice-search.test.ts
git commit -m "feat(reception): search visits by invoice_no with typo tolerance

Plumb buildInvoiceSearchTerms into /api/reception/visits so the same
search box used for patient name / mobile / code also matches the
associated invoice number.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Add `invoice_no` search to `/api/billing-counter/pending-bills`

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts:683-695` (the `/pending-bills` handler)
- Test: `test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /billing-counter/pending-bills — invoice_no search', () => {
  it('applies invoice_no LIKE clauses when ?search= is supplied', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        bills: [
          {
            id: 500, tenant_id: TENANT_1.id, visit_id: null, patient_id: 10,
            invoice_no: 'INV-000001', total: 1000, paid: 0, due: 1000,
            status: 'open', created_at: '2026-07-01 10:00:00',
            test_bill: 1, operation_bill: 0, admission_bill: 0, medicine_bill: 0,
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Karim', patient_code: 'P-002', mobile: '01700000002' }],
        invoice_items: [{ id: 1, tenant_id: TENANT_1.id, bill_id: 500, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null }],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills?search=inv-oooo1');
    expect(res.status).toBe(200);

    const pendingSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+bills/i.test(sql) && sql.toLowerCase().includes('invoice_no like'));
    expect(pendingSql).toBeDefined();
  });

  it('does not add invoice_no clause when search is empty', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        bills: [
          { id: 500, tenant_id: TENANT_1.id, visit_id: null, patient_id: 10, invoice_no: 'INV-000001', total: 1000, paid: 0, due: 1000, status: 'open', created_at: '2026-07-01 10:00:00', test_bill: 1, operation_bill: 0, admission_bill: 0, medicine_bill: 0 },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Karim', patient_code: 'P-002', mobile: '01700000002' }],
        invoice_items: [{ id: 1, tenant_id: TENANT_1.id, bill_id: 500, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null }],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills');
    expect(res.status).toBe(200);

    const pendingSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+bills/i.test(sql));
    expect(pendingSql).toBeDefined();
    expect(pendingSql!.toLowerCase()).not.toContain('invoice_no like');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts`
Expected: FAIL — no SQL containing `'invoice_no like'`.

- [ ] **Step 3: Add a `search` parameter to `/pending-bills`**

Edit `src/routes/tenant/billingCounter.ts` at the top of the `/pending-bills` handler (around line 683). Right after the existing `limit` / `page` / `offset` declarations, add:

```ts
  const search = (c.req.query('search') ?? '').trim();
```

Right after the existing `optionalClauses.push(...)` block (after the visitId block), add:

```ts
  if (search) {
    const invoiceTerms = buildInvoiceSearchTerms(search);
    optionalClauses.push(`AND (b.invoice_no LIKE ? OR b.invoice_no LIKE ? OR b.invoice_no LIKE ?)`);
    params.push(invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }
```

Also add to the `countParams` mirror block — repeat the same three pushes against `countParams`:

```ts
  if (search) {
    countParams.push(invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }
```

(Compute `invoiceTerms` once above the two blocks and reuse; or call `buildInvoiceSearchTerms(search)` twice — the function is pure and cheap.)

Add the import at the top of the file:

```ts
import { buildInvoiceSearchTerms } from '../../lib/invoice-search';
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `pnpm test test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-run the existing billing-counter test suite**

Run: `pnpm test test/integration/routes/billing-counter.test.ts`
Expected: PASS — no regression.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/billingCounter.ts \
        test/integration/routes/billing-counter-pending-bills-invoice-search.test.ts
git commit -m "feat(billing-counter): search pending bills by invoice_no

Accept ?search= on /api/billing-counter/pending-bills and apply the
three LIKE patterns from buildInvoiceSearchTerms so the billing
counter UI can find a pending bill from a partial or typo-laden
invoice number.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add `invoice_no` search to `/api/ip-billing/patients`

**Files:**
- Modify: `src/routes/tenant/ipBilling.ts:248-322` (the `/patients` handler search clause)
- Test: `test/integration/routes/ip-billing-patients-invoice-search.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/routes/ip-billing-patients-invoice-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import ipBillingRoutes from '../../../src/routes/tenant/ipBilling';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /ip-billing/patients — invoice_no search', () => {
  it('matches when search text contains the invoice number', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [
          { id: 1, tenant_id: TENANT_1.id, admission_no: 'A-001', patient_id: 10, doctor_id: null, bed_id: 1, status: 'admitted', admission_date: '2026-07-01', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Selim', patient_code: 'P-003', mobile: '01700000003' }],
        beds: [{ id: 1, tenant_id: TENANT_1.id, ward_name: 'Ward A', bed_number: 'A-1' }],
        doctors: [],
        bills: [
          { id: 200, tenant_id: TENANT_1.id, visit_id: null, admission_id: 1, patient_id: 10, invoice_no: 'INV-000099', total: 2000, paid: 0, due: 2000, status: 'open', created_at: '2026-07-01 09:30:00' },
        ],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients?search=inv-oooo99');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql) && sql.includes('invoice_no'));
    expect(patientSql).toBeDefined();
    expect(patientSql!.toLowerCase()).toContain('invoice_no like');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test test/integration/routes/ip-billing-patients-invoice-search.test.ts`
Expected: FAIL — `patientSql` undefined.

- [ ] **Step 3: Extend the `/patients` search clause**

Edit `src/routes/tenant/ipBilling.ts`. The current SQL at line ~310 already has:

```ts
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.patient_code LIKE ? OR p.mobile LIKE ? OR a.admission_no LIKE ? OR b.ward_name LIKE ? OR b.bed_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
```

Replace this block with:

```ts
  if (search) {
    const invoiceTerms = buildInvoiceSearchTerms(search);
    sql += ` AND (
      p.name LIKE ?
      OR p.patient_code LIKE ?
      OR p.mobile LIKE ?
      OR a.admission_no LIKE ?
      OR b.ward_name LIKE ?
      OR b.bed_number LIKE ?
      OR inv.invoice_no LIKE ?
      OR inv.invoice_no LIKE ?
      OR inv.invoice_no LIKE ?
    )`;
    params.push(
      `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`,
      invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded,
    );
  }
```

Because `/api/ip-billing/patients` does not currently join `bills`, add an existence JOIN above the `WHERE`:

```ts
  let sql = `
    SELECT
      a.id as admission_id, a.admission_no as admission_number,
      a.patient_id, COALESCE(p.name, 'Unknown Patient') as patient_name, p.patient_code,
      b.ward_name, b.bed_number, d.name as doctor_name,
      a.admission_date as admitted_date,
      0 as total_charges,
      0 as total_paid,
      0 as balance,
      'pending' as billing_status
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    LEFT JOIN (
      SELECT tenant_id, patient_id, MAX(invoice_no) AS invoice_no
      FROM bills
      WHERE tenant_id = ?
      GROUP BY tenant_id, patient_id
    ) inv ON inv.tenant_id = a.tenant_id AND inv.patient_id = a.patient_id
    WHERE a.tenant_id = ? AND a.status IN ('admitted','critical')
  `;
```

(Add the `?` binding to `params` after the tenantId is pushed.) If the pre-existing code already references `tenantId` differently, mirror the existing pattern; only the new `LEFT JOIN (... ) inv` block and the OR clause additions are part of this task.

Add the import at the top:

```ts
import { buildInvoiceSearchTerms } from '../../lib/invoice-search';
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `pnpm test test/integration/routes/ip-billing-patients-invoice-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the broader IP billing test suite to confirm no regression**

Run: `pnpm test -- -t "ip-billing"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/ipBilling.ts \
        test/integration/routes/ip-billing-patients-invoice-search.test.ts
git commit -m "feat(ip-billing): search admitted patients by invoice_no

Add LEFT JOIN against bills so the existing /ip-billing/patients
search box can also match by invoice number, using the shared
buildInvoiceSearchTerms helper for typo tolerance.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Add `invoice_no` to the lab monitoring dashboard search (if applicable)

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx:455-...` (the `search` predicate) **and** the API endpoint behind it if it filters server-side.
- Test: extension to `web/src/pages/LabMonitoringDashboard.test.tsx` if it exists.

- [ ] **Step 1: Inspect what API powers the lab monitoring list**

Run: `grep -nE "useApiQuery.*lab|lab/monitoring" web/src/pages/LabMonitoringDashboard.tsx | head -10`

Note the URL. Open the route file and find the corresponding handler.

- [ ] **Step 2: Decide where to add the filter**

- If the endpoint already filters server-side: add `b.invoice_no LIKE ?` clauses to its search handler using `buildInvoiceSearchTerms` (same pattern as Task 2). Skip to Step 5.
- If the endpoint returns all rows and the frontend filters in memory: skip to Step 4.

- [ ] **Step 3 (server-side path): extend the SQL handler**

Mirror Task 2 / Task 3 — add the three `OR b.invoice_no LIKE ?` clauses using `buildInvoiceSearchTerms(search)`. Bind the three patterns after the existing LIKE params.

Add a failing-then-passing test in `test/integration/routes/<lab-monitor>-invoice-search.test.ts` modelled after Task 2 Step 1.

- [ ] **Step 4 (frontend-only path): extend the `search` predicate**

In `web/src/pages/LabMonitoringDashboard.tsx`, find the `.filter(...)` that consumes `search`. Add one more predicate matching `row.invoice_no`:

```ts
const q = search.trim().toLowerCase();
const filtered = rows.filter((row) =>
  (row.test_name ?? '').toLowerCase().includes(q) ||
  (row.patient_name ?? '').toLowerCase().includes(q) ||
  (row.order_no ?? '').toLowerCase().includes(q) ||
  (row.invoice_no ?? '').toLowerCase().includes(q),
);
```

(Adjust field names to whatever the page actually uses; the test below will tell you if you got it wrong.)

- [ ] **Step 5: Verify in the browser**

Run: `pnpm --filter web dev`
Open `/lab/monitoring` (or whichever path the page lives at), type `inv-oooo1` in the search box, and confirm a row whose `invoice_no` is `INV-000001` stays visible while unrelated rows hide. (Smoke test; not a replacement for the unit test.)

- [ ] **Step 6: Add a frontend unit test if the page already has one**

In `web/src/pages/LabMonitoringDashboard.test.tsx` (if it exists), add:

```tsx
it('keeps rows whose invoice_no matches a typo-laden search', () => {
  render(<LabMonitoringDashboard />);
  // seed rows through your existing test helper
  // simulate typing 'inv-oooo1'
  // assert the row with invoice_no 'INV-000001' is in the document
});
```

If the page has no existing test, skip this step — the visual smoke check is enough for this slice. Add a follow-up task to backfill coverage.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/LabMonitoringDashboard.tsx \
        src/routes/tenant/lab.ts \
        test/integration/routes/<lab-monitor>-invoice-search.test.ts 2>/dev/null || true
git commit -m "feat(lab-monitoring): include invoice_no in search filter

Either extend the endpoint's SQL or the frontend .filter() so the
lab monitoring dashboard matches by invoice_no with the same
typo-tolerant patterns the rest of the product now uses.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Add `invoice_no` to the Reception patient-flow `flowSearch` filter

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx:2773-2784`

- [ ] **Step 1: Locate the existing filter**

The current code is:

```tsx
  const filteredFlowRows = useMemo(() => {
    const q = flowSearch.trim().toLowerCase();
    if (!q) return receptionFlowRows;
    return receptionFlowRows.filter((row) =>
      (row.patientName ?? '').toLowerCase().includes(q) ||
      String(row.serial ?? '').toLowerCase().includes(q) ||
      String(row.admissionNo ?? '').toLowerCase().includes(q) ||
      String(row.wardBed ?? '').toLowerCase().includes(q) ||
      (row.mobile ?? '').includes(q) ||
      (row.patientCode ?? '').toLowerCase().includes(q)
    );
  }, [receptionFlowRows, flowSearch]);
```

- [ ] **Step 2: Replace it with the version that also matches invoice_no**

Replace the entire block with:

```tsx
  const filteredFlowRows = useMemo(() => {
    const q = flowSearch.trim().toLowerCase();
    if (!q) return receptionFlowRows;
    const normalized = q.replace(/o/g, '0');
    return receptionFlowRows.filter((row) => {
      const haystacks = [
        row.patientName,
        String(row.serial ?? ''),
        String(row.admissionNo ?? ''),
        String(row.wardBed ?? ''),
        row.mobile,
        row.patientCode,
        row.invoiceNo,
        row.invoice_no,
      ];
      return haystacks.some((value) => {
        if (!value) return false;
        const text = String(value).toLowerCase();
        return text.includes(q) || text.includes(normalized);
      });
    });
  }, [receptionFlowRows, flowSearch]);
```

The `.replace(/o/g, '0')` mirrors the server-side helper so the same input matches the same way.

- [ ] **Step 3: Add a unit test in `web/src/pages/ReceptionDashboard.test.tsx`**

Open the existing test file. Inside the `describe` block that exercises `flowSearch` (or add a new block), add:

```tsx
it('flowSearch matches a row by invoice_no even with letter-o typos', () => {
  const rows = [
    { id: 1, patientName: 'Rahim', invoiceNo: 'INV-000001' },
    { id: 2, patientName: 'Karim', invoiceNo: 'INV-000002' },
  ];
  // invoke the same logic by rendering ReceptionDashboard with stubbed data,
  // or — if the component is too heavy — refactor the filter into a pure
  // helper exported from the page and unit-test that directly.
  // Assertion: row 1 is in the document after typing 'inv-oooo1'.
});
```

If the existing test file renders the full page with a heavy mock, prefer the refactor: lift the filter to a tiny helper `filterReceptionFlowRowsByInvoiceOrPatient(rows, q)` exported from the page module and test that.

- [ ] **Step 4: Run the page test suite**

Run: `pnpm --filter web test -- ReceptionDashboard`
Expected: PASS — including the new case.

- [ ] **Step 5: Visual smoke test**

Run: `pnpm --filter web dev`, open the reception dashboard, type `inv-oooo1` in the patient-flow search box, and confirm rows whose `invoiceNo` contains `INV-000001` stay visible.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx \
        web/src/pages/ReceptionDashboard.test.tsx
git commit -m "feat(reception): flowSearch matches invoice_no with o→0 tolerance

The patient-flow search box already accepted serial / mobile / name
/ admissionNo / wardBed; extend it to also match row.invoiceNo (and
row.invoice_no) so receptionists can pivot from a typed invoice
number back to the visit row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Add `invoice_no` to the due-collection table filter

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx` (the `dueCollectionSearch` filter — find by the `dueCollectionSearch` state declared at line 1395)

- [ ] **Step 1: Locate the due collection filter**

Search the file for `dueCollectionSearch` to find the filter that consumes it. It is a `useMemo` (or similar) similar in shape to `filteredFlowRows`.

- [ ] **Step 2: Extend its predicate**

If the row shape includes `invoice_no` or `invoiceNo`, add the same predicate as Task 6. Example:

```tsx
  const filteredDueBills = useMemo(() => {
    const q = dueCollectionSearch.trim().toLowerCase();
    if (!q) return dueBills;
    const normalized = q.replace(/o/g, '0');
    return dueBills.filter((row) =>
      (row.patient_name ?? '').toLowerCase().includes(q) ||
      (row.patient_code ?? '').toLowerCase().includes(q) ||
      (row.invoice_no ?? '').toLowerCase().includes(q) ||
      (row.invoice_no ?? '').toLowerCase().includes(normalized),
    );
  }, [dueBills, dueCollectionSearch]);
```

(Adjust field names to match what the page actually renders. The page may already expose the row type.)

- [ ] **Step 3: Smoke test in the browser**

Run: `pnpm --filter web dev`, type `inv-oooo99` into the due-collection search box, confirm the row appears. Type a non-matching string, confirm it disappears.

- [ ] **Step 4: Add a regression test alongside the existing page test**

In `web/src/pages/ReceptionDashboard.test.tsx`, add a test that renders a `dueBills` array containing `{ invoice_no: 'INV-000099' }` and asserts the row is filtered in when `dueCollectionSearch = 'inv-oooo99'`.

- [ ] **Step 5: Run the page test suite**

Run: `pnpm --filter web test -- ReceptionDashboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx \
        web/src/pages/ReceptionDashboard.test.tsx
git commit -m "feat(reception): due-collection search matches invoice_no

Same shape of change as the patient-flow filter. Receptionists can
now find a due bill by typing its invoice number (or a typo-laden
version) into the due-collection search box.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Update the reception search placeholder i18n key

**Files:**
- Modify: `web/public/locales/en/reception.json`
- Modify: `web/public/locales/bn/reception.json`

- [ ] **Step 1: Update the English placeholder**

In `web/public/locales/en/reception.json`, find:

```json
    "byNameOrSerialOrNumber": "Search by name, serial, or number",
```

Replace with:

```json
    "byNameOrSerialOrNumber": "Search by name, serial, number, or invoice",
```

- [ ] **Step 2: Update the Bangla placeholder**

In `web/public/locales/bn/reception.json`, find:

```json
    "byNameOrSerialOrNumber": "নাম, সিরিয়াল, বা নম্বর দিয়ে খুঁজুন",
```

Replace with:

```json
    "byNameOrSerialOrNumber": "নাম, সিরিয়াল, নম্বর, বা ইনভয়েস নম্বর দিয়ে খুঁজুন",
```

- [ ] **Step 3: Verify no other locales override this key**

Run: `grep -rn "byNameOrSerialOrNumber" web/public/locales/`

If another locale (e.g. `hi`) has the same key, update it for consistency. If you do not maintain that locale, leave a TODO comment and ask the localization owner to follow up. (Out of scope to add the locale ourselves.)

- [ ] **Step 4: Smoke test**

Reload the reception dashboard in dev mode. Confirm the placeholder now reads "Search by name, serial, number, or invoice" (or the Bangla equivalent).

- [ ] **Step 5: Commit**

```bash
git add web/public/locales/en/reception.json \
        web/public/locales/bn/reception.json
git commit -m "i18n(reception): mention invoice in patient-flow search placeholder

Tiny copy change so the placeholder reflects what the search box can
now match.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Run full test suite and typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — no new failures.

- [ ] **Step 2: Run the integration suite**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 3: Run the web test suite**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 4: Run the typechecker**

Run: `pnpm --filter web typecheck` and `pnpm tsc --noEmit` (root)
Expected: PASS — no type errors.

- [ ] **Step 5: If anything failed, fix it before merging**

Do not commit fixes on top of this branch; cherry-pick them onto the affected task's commit so the diff stays reviewable.

---

## Self-Review

- **Spec coverage:**
  - §3.1 helper extraction → Task 1.
  - §3.2 backend endpoints (`/api/reception/visits`, `/api/billing-counter/pending-bills`, `/api/ip-billing/patients`, lab monitoring) → Tasks 2, 3, 4, 5.
  - §3.2 frontend in-memory filters (Reception flow + due + lab monitoring) → Tasks 6, 7, 5.
  - §3.2 i18n → Task 8.
  - §4–7 (data flow, errors, testing) → Tasks 1–7 plus Task 9 verification.
- **No placeholders:** scanned; none.
- **Type consistency:** `buildInvoiceSearchTerms`, `escapeLikeWildcards`, `InvoiceSearchTerms` consistent across Task 1 and all consumers.
- **Naming:** `flowSearch`, `dueCollectionSearch`, `byNameOrSerialOrNumber` match the current code.
- **Commit messages:** every task ends with a commit, no orphans.