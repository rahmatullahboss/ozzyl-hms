# Unified Action Center Phase 3: Canonical-Ready Collections Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only due page with an accurate, paginated collection workspace that tracks ownership, contact attempts, follow-ups, promises, disputes, and escalation while remaining compatible with both the current legacy billing authority and the in-progress canonical invoice/payment model.

**Architecture:** Collection cases store workflow state only. Financial balances are read through a `ReceivableAuthority` adapter that resolves tenant mode as `legacy`, `shadow`, or `canonical`. Legacy mode reads `bills`; canonical mode reads `canonical_invoices` and canonical payment/adjustment projections; shadow mode serves legacy financial results while recording canonical comparison diagnostics. The collection schema stores stable source references and integer minor-unit promises, but never duplicates authoritative totals, paid amounts, or due balances.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQL migrations, React, TanStack Query, Vitest, Testing Library.

## Canonical Contracts Reviewed

- `cdb-050-canonical-invoicing/migrations/0428_canonical_invoices.sql`
  - Stable `invoice_public_id`
  - Integer `subtotal_minor`, `total_minor`, and canonical invoice status
- `cdb-060-canonical-payments/migrations/0429_canonical_payments.sql`
  - Integer `paid_minor`, `due_minor`
  - Receipt, tender, and allocation authority
- `cdb-061-canonical-adjustments/migrations/0430_canonical_adjustments.sql`
  - Integer `credited_minor`, `net_due_minor`
  - Canonical credit-note authority
- `cdb-020-canonical-foundation/migrations/0423_canonical_program_foundation.sql`
  - `canonical_source_mappings`
  - `canonical_feature_flags` with `legacy`, `shadow`, `canonical`, and `disabled` modes
- `docs/database/legacy-table-disposition.yaml`
  - `bills` and `payments` remain active legacy authorities only until cutover

## Global Constraints

- Migration number: `0501_collection_cases.sql`.
- Do not use the isolated canonical branch numbers `0423–0433`; those migrations must be rebased and renumbered before their own integration.
- Never duplicate or overwrite invoice totals, paid amounts, credits, or due balances in collection tables.
- Persist money only as integer minor units with an explicit three-letter `currency_code`; never introduce new `REAL` money columns.
- Collection source identity must support both `legacy_bill_id` and `canonical_invoice_public_id` without requiring canonical tables to exist at Phase 3 migration time.
- API source type is `invoice`; do not expose synthetic IPD or corporate source types unless a real authority adapter supports them.
- Summary amounts must be calculated over the entire filtered dataset, not the current page.
- All workflow mutations must be tenant-scoped, conditional, and append an event in the same D1 batch.
- `Collect payment` must deep-link to the active payment authority; it must not create a second payment engine.
- A case closes automatically only when the live authority reports zero due or a terminal source state.
- If a tenant is configured for canonical mode but required canonical tables are absent, return a service-configuration error; do not silently fall back to legacy financial authority.
- In shadow mode, legacy remains the served authority. Canonical mismatches are diagnostics and must not alter displayed balances.
- Root Vitest discovers tests under `test/**/*.test.ts`; backend service tests in this plan must be created under `test/action-center/collections/`.

---

### Task 1: Add canonical-ready collection case and event schema

**Files:**
- Create: `migrations/0501_collection_cases.sql`
- Create: `test/migrations/collection-cases.test.ts`

**Interfaces:**

```sql
CREATE TABLE collection_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'invoice' CHECK(source_type = 'invoice'),
  canonical_invoice_public_id TEXT,
  legacy_bill_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN (
    'new','contact_due','contacted','promised','disputed','escalated','write_off_requested','closed'
  )),
  assigned_to INTEGER,
  next_followup_at_utc TEXT,
  promise_date TEXT,
  promise_amount_minor INTEGER,
  currency_code TEXT,
  latest_note TEXT,
  last_contacted_at_utc TEXT,
  closed_at_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(canonical_invoice_public_id IS NOT NULL OR legacy_bill_id IS NOT NULL),
  CHECK(legacy_bill_id IS NULL OR legacy_bill_id > 0),
  CHECK(promise_amount_minor IS NULL OR promise_amount_minor > 0),
  CHECK(currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code))),
  CHECK(next_followup_at_utc IS NULL OR substr(next_followup_at_utc, -1) = 'Z'),
  CHECK(last_contacted_at_utc IS NULL OR substr(last_contacted_at_utc, -1) = 'Z'),
  CHECK(closed_at_utc IS NULL OR substr(closed_at_utc, -1) = 'Z'),
  UNIQUE(tenant_id, id)
);

CREATE UNIQUE INDEX uq_collection_cases_canonical_invoice
  ON collection_cases(tenant_id, canonical_invoice_public_id)
  WHERE canonical_invoice_public_id IS NOT NULL;

CREATE UNIQUE INDEX uq_collection_cases_legacy_bill
  ON collection_cases(tenant_id, legacy_bill_id)
  WHERE legacy_bill_id IS NOT NULL;

CREATE TABLE collection_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(tenant_id, case_id) REFERENCES collection_cases(tenant_id, id)
);
```

Add indexes for tenant/status/follow-up, tenant/assignee/status, tenant/source references, and tenant/case/event time.

- [x] **Step 1: Write failing migration tests**

Assert table shape, status CHECK values, integer promise fields, UTC checks, JSON validity, partial source uniqueness, composite tenant foreign key, and required indexes.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/migrations/collection-cases.test.ts
```

Expected: fail because `0501_collection_cases.sql` does not exist.

- [x] **Step 3: Implement migration and build manifest**

```bash
pnpm exec vitest run test/migrations/collection-cases.test.ts
pnpm build:migrations
```

Expected: both commands pass and manifest contains 435 conforming migrations at the current branch baseline.

- [x] **Step 4: Commit**

**Execution evidence (2026-07-14):** RED failed 5/5 because `migrations/0501_collection_cases.sql` was absent. GREEN passed 5/5 with real SQLite enforcement for source identity, partial tenant uniqueness, integer minor-unit promises, currency/UTC checks, JSON validity, composite tenant foreign key, and queue/timeline indexes. Migration manifest generated 435 conforming migrations; root TypeScript and `git diff --check` passed.

```bash
git add migrations/0501_collection_cases.sql test/migrations/collection-cases.test.ts docs/superpowers/plans docs/superpowers/progress

git commit -m "feat(collections): add canonical-ready workflow schema"
```

---

### Task 2: Build receivable authority resolver and adapters

**Files:**
- Create: `src/services/actionCenter/collections/types.ts`
- Create: `src/services/actionCenter/collections/authority.ts`
- Create: `src/services/actionCenter/collections/legacyAdapter.ts`
- Create: `src/services/actionCenter/collections/canonicalAdapter.ts`
- Create: `test/action-center/collections/authority.test.ts`
- Create: `test/action-center/collections/adapters.test.ts`

**Interfaces:**

```ts
export type ReceivableAuthorityMode = 'legacy' | 'shadow' | 'canonical';

export interface ReceivableSourceRef {
  sourceType: 'invoice';
  legacyBillId?: number;
  canonicalInvoicePublicId?: string;
}

export interface ReceivableRecord {
  source: ReceivableSourceRef;
  invoiceNumber: string;
  patientId: number;
  patientName: string;
  patientMobile: string | null;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  dueMinor: number;
  issuedAtUtc: string;
  financialStatus: 'open' | 'paid' | 'cancelled' | 'reversed';
}

export interface ReceivableAuthorityResolution {
  mode: ReceivableAuthorityMode;
  canonicalSchemaAvailable: boolean;
  requestedMode: 'legacy' | 'shadow' | 'canonical' | null;
}

export async function resolveReceivableAuthority(input: {
  db: D1Database;
  tenantId: string;
}): Promise<ReceivableAuthorityResolution>;
```

Resolution rules:

1. If `canonical_feature_flags` is absent, return `legacy`.
2. Read flag key `billing.receivables` when the table exists.
3. `legacy` or disabled/missing flag returns legacy.
4. `shadow` requires canonical invoice schema; serve legacy records and expose comparison diagnostics.
5. `canonical` requires `canonical_invoices`, payment projection columns, and adjustment projection columns; otherwise throw `ReceivableAuthorityConfigurationError`.
6. Legacy adapter converts major-unit `bills` amounts to integer minor units with one shared rounding helper and uses `BDT` until tenant currency becomes canonicalised.
7. Canonical adapter reads `canonical_invoices.net_due_minor`, falling back only to `due_minor` when the adjustment migration is not yet part of the canonical contract being tested.

- [x] **Step 1: Write failing authority tests**

Cover missing canonical tables, legacy flag, shadow flag, canonical flag, disabled flag, and canonical misconfiguration.

- [x] **Step 2: Write failing adapter tests**

Cover tenant isolation, legacy major-to-minor rounding, canonical integer values, cancelled/reversed terminal states, patient contact joins, and stable source references.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/collections/authority.test.ts test/action-center/collections/adapters.test.ts
```

Expected: fail because authority/adapters are absent.

- [x] **Step 4: Implement resolver and adapters**

Keep all SQL tenant-bound. Detect optional canonical schema through `sqlite_master`/`pragma_table_info` before preparing SQL that references optional tables or columns.

- [x] **Step 5: Run and verify GREEN**

Run the same command. Expected: all tests pass.

- [x] **Step 6: Commit**

**Execution evidence (2026-07-14):** RED failed at module import because authority and adapter modules were absent. GREEN passed authority 7/7 and adapters 4/4. Combined Task 1–2 regression passed 16/16; root TypeScript and `git diff --check` passed. The resolver fails closed for missing shadow/canonical projections, all source and patient joins are tenant-scoped, legacy money converts once at the adapter boundary, and canonical balances remain integer projections.

```bash
git add src/services/actionCenter/collections test/action-center/collections

git commit -m "feat(collections): add receivable authority adapters"
```

---

### Task 3: Build full-dataset collection query service

**Files:**
- Create: `src/services/actionCenter/collections/query.ts`
- Create: `test/action-center/collections/query.test.ts`

**Interfaces:**

```ts
export interface CollectionListQuery {
  status?: 'new' | 'contact_due' | 'contacted' | 'promised' | 'disputed' | 'escalated' | 'write_off_requested' | 'closed' | 'active' | 'all';
  assignee?: number;
  followup?: 'due' | 'upcoming' | 'none';
  ageBucket?: '0-7' | '8-30' | '31-60' | '60+';
  minAmountMinor?: number;
  maxAmountMinor?: number;
  search?: string;
  sort?: 'exposure' | 'oldest' | 'followup';
  page: number;
  limit: number;
}

export interface CollectionCurrencySummary {
  currencyCode: string;
  totalDueMinor: number;
  totalInvoices: number;
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  promisedAmountMinor: number;
  disputedAmountMinor: number;
}

export interface CollectionSummary {
  totalDueMinor: number | null;
  totalInvoices: number;
  currentMinor: number | null;
  days30Minor: number | null;
  days60Minor: number | null;
  days90PlusMinor: number | null;
  followupDue: number;
  promisedAmountMinor: number | null;
  disputedAmountMinor: number | null;
  currencyCode: string | null;
  amountsByCurrency: CollectionCurrencySummary[];
  supportedSourceTypes: ['invoice'];
  authorityMode: ReceivableAuthorityMode;
  shadowMismatchCount: number;
}

export async function listCollectionCases(input: {
  db: D1Database;
  tenantId: string;
  query: CollectionListQuery;
}): Promise<{ data: CollectionQueueRow[]; summary: CollectionSummary; pagination: PaginationMeta }>;
```

Implementation rules:

- Use the resolved authority adapter as the source CTE/input.
- Join workflow state by canonical public ID when available and by legacy bill ID otherwise.
- Compute count and amount aggregates from the full filtered dataset, then fetch the page separately.
- Monetary aggregates are grouped by currency. Single-currency result sets may expose flat amount fields; mixed-currency result sets must set flat monetary fields to `null` and use `amountsByCurrency`.
- Exclude zero/negative due and terminal records from active queues while still allowing detail/reconciliation access.
- In shadow mode, the served total remains legacy. Count canonical mismatches without blending two authorities.
- Return only `supportedSourceTypes: ['invoice']`.

- [x] **Step 1: Write failing full-dataset tests**

Seed more rows than the page limit and prove summary totals include all rows while `data.length` respects pagination. Cover paid/cancelled/refunded/draft legacy exclusion, canonical cancelled/reversed exclusion, tenant isolation, amount filters in minor units, and mixed currencies returning `currencyCode: null`.

- [x] **Step 2: Write failing shadow tests**

Prove shadow mode serves legacy amounts, reports mismatch count, and does not duplicate mapped invoices.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/collections/query.test.ts
```

- [x] **Step 4: Implement query service**

Use locale-neutral integer values and UTC timestamps; formatting remains a frontend responsibility.

- [x] **Step 5: Run and verify GREEN**

Run the same command.

- [x] **Step 6: Commit**

**Execution evidence (2026-07-15):** Initial RED failed at import because `query.ts` was absent. The first implementation exposed a SQLite outer-alias limitation in a correlated subquery; direct partial-unique source joins fixed the root cause and preserved canonical-case priority without duplicate invoices. Query tests passed 5/5. Adversarial review then reproduced an invalid cross-currency total; the currency-safe RED required grouped `amountsByCurrency` and nullable flat monetary fields for mixed currencies. Final query tests passed 5/5; combined collection schema/authority/adapter/query regression passed 21/21; root TypeScript and `git diff --check` passed.

```bash
git add src/services/actionCenter/collections/query.ts test/action-center/collections/query.test.ts

git commit -m "feat(collections): add canonical-ready receivable query service"
```

---

### Task 4: Add collection lifecycle and authority reconciliation

**Files:**
- Create: `src/services/actionCenter/collections/liveSource.ts`
- Create: `src/services/actionCenter/collections/transitions.ts`
- Create: `src/services/actionCenter/collections/reconcile.ts`
- Modify: `src/services/actionCenter/collections/legacyAdapter.ts`
- Modify: `src/services/actionCenter/collections/canonicalAdapter.ts`
- Create: `test/action-center/collections/transitions.test.ts`
- Create: `test/action-center/collections/reconcile.test.ts`

**Interfaces:**

```ts
export type CollectionAction =
  | { action: 'contact'; channel: 'phone' | 'sms' | 'whatsapp' | 'in_person' | 'other'; outcome: string; note: string; nextFollowupAtUtc?: string }
  | { action: 'follow_up'; nextFollowupAtUtc: string; note?: string }
  | { action: 'promise'; promiseDate: string; promiseAmountMinor: number; currencyCode: string; note: string }
  | { action: 'dispute'; reason: string; note: string }
  | { action: 'escalate'; reason: string; note: string; assignedTo?: number };

export async function transitionCollectionCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  actorId: number;
  expectedUpdatedAtUtc?: string;
  action: CollectionAction;
}): Promise<{ caseId: number; status: string } | 'not_found' | 'conflict'>;

export async function reconcileCollectionCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  actorId?: number;
}): Promise<'closed' | 'unchanged' | 'not_found'>;
```

- [x] **Step 1: Write failing transition tests**

Cover lazy case creation, dual source references, contact metadata, promise amount/currency validation against live due, dispute/escalation reasons, UTC follow-up validation, stale conflict, tenant isolation, and same-batch event writes.

- [x] **Step 2: Write failing reconciliation tests**

Prove live zero due closes with `auto_closed_paid`; cancelled/reversed source closes with distinct terminal events; positive due remains actionable; canonical mode never reads a client balance; shadow mode reconciles against served legacy authority.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/collections/transitions.test.ts test/action-center/collections/reconcile.test.ts
```

- [x] **Step 4: Implement conditional transition batching**

Persist only workflow fields relevant to each action. Promise amounts are integer minor units and must match the live authority currency.

- [x] **Step 5: Implement authority reconciliation**

Read live source state through the adapter inside the same request flow before a conditional close. Never accept client-supplied due.

- [x] **Step 6: Run and verify GREEN**

Run the same command.

- [x] **Step 7: Commit**

**Execution evidence (2026-07-15):** Initial RED failed at import because lifecycle and reconciliation modules were absent. GREEN passed transitions 8/8 and reconciliation 7/7 using real SQLite-backed D1 batches, including event-trigger rollback proofs. Adversarial cutover review added two RED regressions proving legacy-only cases were not enriched with validated canonical invoice IDs during transition or reconciliation; both now backfill the canonical reference without replacing the case. Final transitions passed 9/9, reconciliation 7/7, combined Task 1–4 collection regression passed 37/37, root TypeScript and `git diff --check` passed. Single-source adapter lookups avoid full-dataset scans for mutations.

```bash
git add src/services/actionCenter/collections test/action-center/collections

git commit -m "feat(collections): add lifecycle and authority reconciliation"
```

---

### Task 5: Add collection APIs and retire capped legacy totals

**Files:**
- Create: `src/routes/tenant/actionCenterCollections.ts`
- Modify: `src/routes/tenant/actionCenter.ts`
- Create: `src/routes/admin/withActionCenterCollections.ts`
- Modify: `src/index.ts`
- Modify: `src/services/actionCenter/collections/query.ts`
- Modify: `src/services/actionCenter/collections/types.ts`
- Create: `test/integration/routes/action-center-collections.test.ts`
- Create: `test/integration/routes/admin-due-receivables.test.ts`
- Modify: `test/integration/routes/action-center.test.ts`
- Modify: `test/admin-detail-routes.test.ts`

**Interfaces:**

- `GET /api/action-center/collections`
- `GET /api/action-center/collections/summary`
- `GET /api/action-center/collections/invoice/:sourceKey`
- `GET /api/action-center/collections/invoice/:sourceKey/events`
- `POST /api/action-center/collections/invoice/:sourceKey/contact`
- `PUT /api/action-center/collections/invoice/:sourceKey/follow-up`
- `PUT /api/action-center/collections/invoice/:sourceKey/promise`
- `PUT /api/action-center/collections/invoice/:sourceKey/dispute`
- `PUT /api/action-center/collections/invoice/:sourceKey/escalate`

`sourceKey` format:

- `legacy-bill:<positive integer>`
- `canonical-invoice:<URL-encoded public ID>`

The API response must also return the structured `source` object; clients must not parse source keys for financial decisions.

Legacy `/api/admin/due-receivables` becomes a compatibility adapter over `listCollectionCases` with no hidden `LIMIT 100` summary calculation. It preserves its historical major-unit response shape only at that adapter boundary.

- [x] **Step 1: Write failing API tests**

Cover auth, query validation, source-key validation, page/summary consistency, authority mode, detail ownership, events, action validation, 404/409/422/503 responses, tenant isolation, and legacy API totals over more than 100 rows.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-collections.test.ts
```

- [x] **Step 3: Implement routes**

Use zod schemas with `limit <= 100`, search length limits, safe-integer minor amounts, uppercase currency validation, and UTC timestamp validation. Never expose another tenant's source existence.

- [x] **Step 4: Update Action Center summary**

Use collection service aggregates, expose amount values in minor units with currency, and set `capabilities.persistentCollections=true`.

- [x] **Step 5: Run and verify GREEN**

Run collection, Action Center summary, and legacy admin route tests.

- [x] **Step 6: Commit**

**Execution evidence (2026-07-15):** Initial route RED returned 404 because the collection subrouter did not exist. Collection API tests then passed 9/9 with source-key validation, tenant isolation, list/summary/detail/timeline/actions, 404/409/422/503 semantics, and fail-closed canonical configuration. A separate full-dataset RED proved the legacy admin view still capped summary totals at 100 rows; the production admin composition wrapper now returns at most 100 compatibility rows while its totals, amount buckets, and aging counts cover all 105 seeded invoices. Action Center summary was moved from a direct `bills` aggregate to `listCollectionCases`, exposes minor-unit/currency metadata, enables `persistentCollections`, and prioritizes due collection follow-ups. Brittle mock summary tests were replaced with real SQLite authority tests. Final full integration passed 250/250 files and 6,067/6,067 tests; root TypeScript and `git diff --check` passed. No migration, merge, push, or deployment occurred.

```bash
git add src/routes/tenant/actionCenterCollections.ts src/routes/tenant/actionCenter.ts src/routes/admin/withActionCenterCollections.ts src/index.ts src/services/actionCenter/collections/query.ts src/services/actionCenter/collections/types.ts test/action-center/collections/query.test.ts test/integration/routes/action-center-collections.test.ts test/integration/routes/admin-due-receivables.test.ts test/integration/routes/action-center.test.ts test/admin-detail-routes.test.ts

git commit -m "feat(collections): expose canonical-ready collection APIs"
```

---

### Task 6: Rebuild Collections UI and canonicalize navigation

**Files:**
- Rewrite: `web/src/pages/admin/DueReceivables.tsx`
- Modify: `web/src/pages/admin/DueReceivables.test.tsx`
- Create: `web/src/components/action-center/CollectionDetailDrawer.tsx`
- Create: `web/src/components/action-center/CollectionDetailDrawer.test.tsx`
- Create: `web/src/components/action-center/collectionTypes.ts`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/src/lib/tenantRedirect.ts`
- Modify: `web/public/locales/en/adminReceivables.json`
- Modify: `web/public/locales/bn/adminReceivables.json`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.action-center.test.tsx`
- Modify: `web/src/pages/BillingDashboard.tsx`
- Modify: `web/src/pages/BillingDashboard.test.ts`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx`
- Modify: `web/src/components/dashboard/Breadcrumbs.tsx`
- Modify: `web/src/components/dashboard/Breadcrumbs.test.tsx`

**Interfaces:**

- Consumes minor-unit list/detail/events/actions.
- Displays API-provided currency; never assumes a symbol from amount alone.
- Shows authority status as operational metadata: Legacy, Shadow verification, or Canonical.
- `Collect payment` uses an API-provided `paymentHref`; the frontend must not infer which payment authority is active.
- `/cash/dues` → `/action/collections`
- `/cash/followups` → `/action/collections?followup=due`

- [x] **Step 1: Write failing summary/capability tests**

Assert cards use `totalDueMinor`, aging amount fields, API currency, and only real source capabilities.

- [x] **Step 2: Write failing workflow tests**

Cover row selection, contact, follow-up, promise in minor units, dispute, escalation, payment deep link, timeline, loading disablement, validation, 409 recovery, and 503 authority-configuration state.

- [x] **Step 3: Write failing responsive/accessibility/navigation tests**

Assert semantic desktop table, mobile cards, labelled controls, focus management, no browser prompts, query-preserving redirects, scalar Collections breadcrumb, and dashboard exposure link.

- [x] **Step 4: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/DueReceivables.test.tsx src/components/action-center/CollectionDetailDrawer.test.tsx src/App.action-center.test.tsx src/pages/admin/widgets/ActionRequiredPanel.test.tsx src/components/dashboard/Breadcrumbs.test.tsx
```

- [x] **Step 5: Implement queue, drawer, and redirects**

Use URL-backed filters, server pagination, sticky controls, right-aligned tabular amounts, one primary action per dialog, accessible drawer focus behaviour, and no `prompt()`/`confirm()`.

- [x] **Step 6: Run and verify GREEN**

Run the same command.

- [x] **Step 7: Commit**

**Execution evidence (2026-07-15):** Initial RED reproduced the old client-derived dues page, missing collection drawer, uncoupled legacy routes, wrong breadcrumb label, and dashboard use of major-unit exposure. The rebuilt workspace consumes only canonical collection APIs, uses URL-backed server filters/pagination, renders currency-aware minor-unit summaries, semantic desktop tables and mobile cards, and exposes an explicit fail-closed 503 authority state. The accessible drawer implements focus/scroll restoration, timeline, contact/follow-up/promise/dispute/escalation forms, safe decimal-to-minor conversion, optimistic timestamps, mutation disablement, and 409 refresh recovery without browser prompts. Legacy dues/follow-up routes now merge and preserve query intent. An additional payment deep-link RED proved `/billing?collectBillId=` was previously inert; Billing Dashboard now resolves the invoice from current or due data, opens its payment modal, and removes the consumed query parameter. Final focused frontend verification passed 6/6 files and 30/30 tests; web TypeScript passed and both EN/BN locale JSON files parsed successfully. No migration, merge, push, or deployment occurred.

```bash
git add web/src/pages/admin/DueReceivables.tsx web/src/pages/admin/DueReceivables.test.tsx web/src/components/action-center/CollectionDetailDrawer.tsx web/src/components/action-center/CollectionDetailDrawer.test.tsx web/src/components/action-center/collectionTypes.ts web/src/lib/queryKeys.ts web/src/lib/tenantRedirect.ts web/public/locales/en/adminReceivables.json web/public/locales/bn/adminReceivables.json web/src/App.tsx web/src/App.action-center.test.tsx web/src/pages/BillingDashboard.tsx web/src/pages/BillingDashboard.test.ts web/src/pages/admin/widgets/ActionRequiredPanel.tsx web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx web/src/components/dashboard/Breadcrumbs.tsx web/src/components/dashboard/Breadcrumbs.test.tsx

git commit -m "feat(collections): add canonical-ready operations workspace"
```

---

### Task 7: Phase 3 verification and canonical cutover review

- [x] **Step 1: Run migration and service tests**

```bash
pnpm exec vitest run test/migrations/collection-cases.test.ts test/action-center/collections/authority.test.ts test/action-center/collections/adapters.test.ts test/action-center/collections/query.test.ts test/action-center/collections/transitions.test.ts test/action-center/collections/reconcile.test.ts
```

- [x] **Step 2: Run integration tests**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-collections.test.ts test/integration/routes/action-center.test.ts test/integration/routes/admin-due-receivables.test.ts
```

- [x] **Step 3: Run frontend tests**

```bash
pnpm --filter web exec vitest run src/pages/admin/DueReceivables.test.tsx src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/ActionCenterOverview.test.tsx src/App.action-center.test.tsx src/pages/admin/widgets/ActionRequiredPanel.test.tsx src/components/dashboard/Breadcrumbs.test.tsx src/pages/BillingDashboard.test.ts
```

- [x] **Step 4: Run full gates**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

- [x] **Step 5: Adversarial review**

Review full-dataset totals, page boundaries, integer overflow, major-to-minor conversion, mixed currencies, zero/negative due, source terminal states, promise precision, UTC validation, double-submit conflicts, tenant isolation, unsupported sources, canonical schema absence, canonical misconfiguration, shadow mismatch behaviour, source mapping collisions, and payment deep-link authority.

- [x] **Step 6: Record canonical integration boundary**

Document that Phase 3 can ship in legacy mode before canonical migrations are integrated. Canonical or shadow mode must remain disabled until the rebased canonical foundation/invoice/payment/adjustment migrations and their backfills are deployed and reconciled.

- [x] **Step 7: Commit review fixes**

**Verification evidence (2026-07-15):** Migration/service verification passed 6/6 files and 37/37 tests. Collection, summary, and legacy compatibility integration verification passed 3/3 files and 16/16 tests. Frontend collections, overview, routing, dashboard, breadcrumb, drawer, and payment deep-link verification passed 7/7 files and 35/35 tests. The migration manifest generated 435 conforming migrations; root TypeScript, all production builds, and `git diff --check` passed.

**Adversarial findings and fixes:** The review reconfirmed full-dataset pagination/aging totals, safe legacy major-to-minor conversion, integer promise precision, UTC enforcement, atomic event writes, stale conflicts, terminal reconciliation, tenant isolation, source-key validation, shadow legacy precedence, and canonical fail-closed schema gating. It found and fixed two additional defects: Action Center Overview flattened a mixed-currency summary into fake BDT `৳0.00`, and the legacy compatibility route converted unexpected database failures into a false `200` empty state. Overview now renders API currency codes or per-currency breakdowns and links to the active queue; unexpected compatibility failures return `500`, while canonical configuration failures remain explicit `503`.

**Canonical integration boundary:** Phase 3 is releasable in `legacy` authority mode after migration `0501` is reviewed and applied. `shadow` and `canonical` flags must remain disabled until the isolated canonical foundation, invoice, payment, and adjustment migrations are rebased/renumbered, deployed, backfilled, and reconciled. Shadow requires the canonical invoice/payment projection; canonical additionally requires `credited_minor` and `net_due_minor`. No canonical flag may be enabled merely because Phase 3 code is present.

```bash
git add migrations src web test docs/superpowers

git commit -m "feat(action-center): complete canonical-ready collections phase"
```
