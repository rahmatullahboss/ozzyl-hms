# Invoice Number Search Across Patient/Bill Lists — Design

Date: 2026-07-01
Branch: `feature/invoice-number-search`
Status: Proposed / implementation-ready

## 1. Goal

Receptionists and billing operators need to find a bill by its invoice number from every surface that lists patients or bills. Today only some endpoints honour `invoice_no` in search, and several high-traffic lists ignore it entirely.

This design adds partial, typo-tolerant `invoice_no` matching (reusing the existing smart-search helper) to every patient/bill list in the product, with the smallest possible UI churn.

## 2. Scope

### In scope

- Backend endpoints that return bills but do **not** currently accept `invoice_no` in `search`:
  - `GET /api/reception/visits`
  - `GET /api/ip-billing/patients`
  - `GET /api/billing-counter/pending-bills`
  - any lab-monitoring / lab-dashboard endpoint that returns bills and currently lacks invoice search
- Frontend tables whose data already carries `invoice_no` but the in-memory `.filter()` does not include it:
  - `web/src/pages/ReceptionDashboard.tsx` — `flowSearch` filter at line 2776
  - `web/src/pages/ReceptionDashboard.tsx` — `dueCollectionSearch` filter (state declared at line 1395)
  - `web/src/pages/LabMonitoringDashboard.tsx` — `search` filter at line 455 (rows already carry `invoice_no`)
- i18n update of the one patient-flow placeholder text in both `en` and `bn`.

### Endpoints that already support `invoice_no` (no change)

- `GET /api/billing` (already searches `b.invoice_no`)
- `GET /api/billing/due` (already searches `b.invoice_no`)
- `GET /api/global-search` (already bills + typo-tolerant helper)
- `GET /api/pharmacy/invoices`
- `GET /api/settlements/pending` (already filters by `invoice_no` client-side)

### Out of scope

- No new index migration (`idx_bills_invoice_no` already exists from migration `0001_fix_schema_add_missing_tables.sql:347`; `idx_bills_invoice_code` covers `(tenant_id, invoice_code, invoice_no)` from `0158_danphe_billing_gaps.sql:180`).
- No top-bar global-search upgrade. Reception top bar continues to call `/api/patients/global-search` (patients only).
- No new "Find Bill" modal.
- No changes to `/api/billing` or `/api/billing/due`.

## 3. Approach

Two coordinated changes.

### 3.1 Lift `buildInvoiceSearchTerms` into a shared library

The helper that produces `{ original, normalized, padded }` LIKE patterns currently lives as a private function inside `src/routes/tenant/global-search.ts`. Lift it to a new module so route handlers in multiple files can import the same logic.

- New file: `src/lib/invoice-search.ts`.
- The file exports a single pure function `buildInvoiceSearchTerms(raw: string)` and a tiny convenience export `invoiceLikePatterns(raw: string): string[]` that returns the patterns in priority order.
- `src/routes/tenant/global-search.ts` re-exports the function from the new module to preserve any existing import path.

Pure function, zero runtime dependencies, easy to unit test.

### 3.2 Apply `invoice_no` matching

Apply at three layers:

#### Backend endpoints

For each endpoint listed in §2, accept an existing or new `search` query parameter and extend the WHERE clause to:

```sql
AND (
  b.invoice_no LIKE ?
  OR b.invoice_no LIKE ?
  OR b.invoice_no LIKE ?
)
```

Bindings are the three LIKE patterns returned by `buildInvoiceSearchTerms`. Special LIKE wildcards (`%`, `_`) in the user input are escaped before being substituted into the patterns.

Tenant scoping is already enforced by every touched handler; the new clause is appended under the same `tenant_id = ?` constraint.

#### Frontend in-memory filters

Where the table holds rows that already include `invoice_no` (or `invoiceNo`) and the existing predicate does substring matching on other fields, add one more predicate:

```ts
(row.invoice_no ?? '').toLowerCase().includes(q) ||
(row.invoiceNo ?? '').toLowerCase().includes(q)
```

Optionally apply normalization (replace `o/O` with `0`) when the project decides to. Initial implementation literal-only; the smarter matching is server-side anyway via the endpoint path.

#### i18n

Update the existing key `placeholder.byNameOrSerialOrNumber` (en + bn) on `web/public/locales/{en,bn}/reception.json` to read:

- `en`: `"Search by name, serial, number, or invoice"`
- `bn`: `"নাম, সিরিয়াল, নম্বর, বা ইনভয়েস নম্বর দিয়ে খুঁজুন"`

The other search placeholders are not changed.

## 4. Components touched

### New file

- `src/lib/invoice-search.ts`

### Modified — backend

- `src/routes/tenant/global-search.ts` — replace private helper with re-export
- `src/routes/tenant/reception.ts` — `/api/reception/visits` (`search` clause)
- `src/routes/tenant/billingCounter.ts` — `/api/billing-counter/pending-bills` (new `search` param)
- `src/routes/tenant/ipBilling.ts` — `/api/ip-billing/patients` (`search` clause)
- `src/routes/tenant/lab.ts` — whichever lab-monitoring endpoint returns bills

### Modified — frontend

- `web/src/pages/ReceptionDashboard.tsx` — `flowSearch` predicate, `dueCollectionSearch` predicate, placeholder text
- `web/src/pages/LabMonitoringDashboard.tsx` — `search` predicate at line 455

### Modified — i18n

- `web/public/locales/en/reception.json`
- `web/public/locales/bn/reception.json`

### Tests

- `test/unit/invoice-search.test.ts` — new unit test for the extracted helper (original, normalized, padded, edge cases)
- `test/integration/routes/reception-visits-invoice.test.ts` — server returns a visit when only its invoice_no matches a typo-laden query
- `test/integration/routes/ip-billing-patients-invoice.test.ts` — same for IP billing
- `test/integration/routes/billing-counter-pending-bills-invoice.test.ts` — same for pending bills
- `web/src/pages/ReceptionDashboard.test.tsx` — extend to assert `flowSearch` matches by `invoiceNo`

## 5. Data flow

Reception patient-flow search (worst-case path):

1. User types `inv-oooo12` in the patient-flow search box.
2. Frontend `flowSearch` predicate lower-cases, strips whitespace, and substring-matches against `row.invoiceNo`.
3. For surfaces that pre-fetch and re-filter server-side (e.g. when scoping changes from `today` to all-open), the in-memory match covers the loaded rows.
4. For surfaces that go through `/api/reception/visits?search=...`, the SQL now includes the three LIKE patterns produced by `buildInvoiceSearchTerms('inv-oooo12')`:
   - `%inv-oooo12%` (original)
   - `%inv-0000012%` (o→0 normalized)
   - padded numeric portion `%0000012%`
5. Matching visits render. No schema change. No new index.

## 6. Error handling

- Empty / whitespace `search` → no `invoice_no` clause appended (existing behavior).
- LIKE wildcards in user input → escape (`\\%` and `\\_`) before composing the pattern; already done in `src/routes/tenant/global-search.ts` — copy the pattern.
- Helper throws on non-string input → guard at the route handler with `typeof raw === 'string'` check.
- Backend DB errors → existing error envelopes; no new shapes.

## 7. Testing

Unit (Vitest):

- Original pass-through.
- `o/O` → `0` normalization.
- Numeric input gets padded-style match (`23` ⇒ `%000023%`).
- Empty / whitespace input returns empty array.
- Special-character LIKE escaping.

Integration (D1 / real DB harness):

- One test per touched endpoint proves `?search=INV-oooo1` returns the row whose `invoice_no = 'INV-000001'`.
- Negative test: search for an `invoice_no` that does not exist returns zero rows, never errors.

UI (Vitest + React Testing Library):

- `ReceptionDashboard.test.tsx`: a visit row with `invoiceNo: 'INV-000001'` matches `flowSearch = 'inv-oooo1'`.

## 8. Risk and mitigation

| Risk | Mitigation |
|------|------------|
| Backend LIKE pattern with `%` in user input scans every row of `bills` | Escape user input before building the pattern. |
| Some endpoints query on `tenant_id, visit_id` and may not touch the `bills` table | Confirm by reading each endpoint. If a surface has no bill join, skip it (e.g., patient-only searches). |
| Frontend `.filter()` after long arrays feels slow | Data sets here are paginated at the server; in-memory filters only run on what the API returned (typically ≤ a few hundred rows). |
| Typo tolerance in client-only filters shows occasional false positives (e.g. "12" matches any invoice ending in 12) | Acceptable: existing patient-name search has the same behaviour. Server-side fuzzy match is more selective. |

## 9. Out of scope

- Nothing new in the dashboard-snapshot endpoint.
- No top-bar global search upgrade (per user decision).
- No "Find Bill" modal (per user decision).
- No schema or migration changes.

## 10. Open questions answered during brainstorming

- Q: Match tolerance? **A: Partial + typo-tolerant. Reuse `buildInvoiceSearchTerms`.**
- Q: Treat existing patient/bill lists how? **A: Add `invoice_no` to existing search where it fits.**
- Q: Scope of surfaces? **A: Everywhere patients or bills appear.**
