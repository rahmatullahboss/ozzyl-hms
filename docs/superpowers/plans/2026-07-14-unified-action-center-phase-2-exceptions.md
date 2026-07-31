# Unified Action Center Phase 2: Persistent Exceptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regenerated, non-actionable alert cards with persistent tenant-scoped exception cases that can be acknowledged, assigned, snoozed, resolved, dismissed, reopened, and audited.

**Architecture:** Rule detectors continue to read canonical source tables, but normalize observations into `admin_exception_cases`. A synchronization service upserts observations by tenant-scoped fingerprint and appends lifecycle events. The Action Center Exceptions page reads only persistent cases and deep-links back to source records.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQL migrations, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Migration number: `0500`. The initial `0424` reservation was abandoned after canonical-program review found an unapplied canonical block at `0423–0433` while production had already applied `0423_repair_clean_cash_handover_pending_approvals.sql`. `0423–0499` remains reserved for canonical rebase/renumber coordination.
- Never mutate source billing, handover, or inventory records from exception actions.
- Every state mutation must use a conditional update and event insert in one D1 batch.
- All list/detail/event/action routes must enforce tenant isolation.
- `dismiss` requires a reason; `resolve` requires a resolution code and note.
- Resolved cases reopen only when the rule policy explicitly permits recurrence.
- Do not regenerate a new open case for a dismissed fingerprint until the fingerprint changes or suppression expires.
- Preserve old `/api/dashboard/fraud-alerts` consumers until the new page is switched.

---

### Task 1: Add exception case and event schema

**Files:**
- Create: `migrations/0500_admin_exception_cases.sql`
- Create: `test/migrations/admin-exception-cases.test.ts`

**Interfaces:**

```sql
CREATE TABLE admin_exception_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical','warning','info')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_href TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','snoozed','resolved','dismissed')),
  assigned_to INTEGER,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_code TEXT,
  resolution_note TEXT,
  dismissed_by INTEGER,
  dismissed_at TEXT,
  dismissal_reason TEXT,
  snoozed_until TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, rule_key, fingerprint),
  UNIQUE(tenant_id, id)
);

CREATE TABLE admin_exception_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY(tenant_id, case_id)
    REFERENCES admin_exception_cases(tenant_id, id) ON DELETE RESTRICT
);
```

Add indexes for `(tenant_id,status,severity,updated_at)`, `(tenant_id,assigned_to,status)`, `(tenant_id,rule_key,last_detected_at)`, and `(tenant_id,case_id,created_at)`.

- [x] **Step 1: Write migration tests**

Assert both tables, all CHECK values, unique fingerprint constraint, foreign key, and indexes exist.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/migrations/admin-exception-cases.test.ts
```

Expected: migration file/table lookup fails.

- [x] **Step 3: Implement migration**

Use project migration conventions and no destructive changes to existing tables.

- [x] **Step 4: Run migration tests and manifest build**

```bash
pnpm exec vitest run test/migrations/admin-exception-cases.test.ts
pnpm build:migrations
```

Expected: both commands pass.

**Execution evidence (2026-07-14):** Initial RED failed 4/4 because the planned migration did not exist. After implementation, canonical branch review found that production had already applied `0423_repair_clean_cash_handover_pending_approvals.sql` while the isolated canonical program reserved `0423–0433`; the exception migration was therefore moved from `0424` to `0500`. A second RED reproduced missing composite tenant-FK and JSON constraints. Final GREEN passed 4/4 against real `node:sqlite`, proving both tables, approved status/severity constraints, tenant-scoped fingerprint uniqueness, cross-tenant event rejection, JSON validity, event foreign-key enforcement, and all four required indexes. `pnpm build:migrations` generated 434 migrations, root TypeScript passed, and `git diff --check` passed.

- [x] **Step 5: Commit**

```bash
git add migrations/0500_admin_exception_cases.sql test/migrations/admin-exception-cases.test.ts
git commit -m "feat(exceptions): add persistent case schema"
```

---

### Task 2: Define normalized detector contracts

**Files:**
- Create: `src/services/actionCenter/exceptions/types.ts`
- Create: `src/services/actionCenter/exceptions/detectors.ts`
- Create: `test/action-center-exception-detectors.test.ts` (root Vitest only includes `test/**/*.test.ts`)

**Interfaces:**

```ts
export interface ExceptionObservation {
  ruleKey: string;
  fingerprint: string;
  sourceType: string;
  sourceId: string;
  module: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  sourceHref: string;
  metadata: Record<string, unknown>;
  autoResolvable: boolean;
  allowRecurrence: boolean;
}

export interface ExceptionDetectorContext {
  db: D1Database;
  tenantId: string;
  now: string;
}

export type ExceptionDetector = (
  context: ExceptionDetectorContext,
) => Promise<ExceptionObservation[]>;
```

Initial detector keys:

```ts
export const EXCEPTION_RULES = {
  staleHandover: 'cash.stale_handover',
  highDiscount: 'billing.high_discount',
  billCancellation: 'billing.same_day_cancellation',
  lowStock: 'inventory.low_stock',
} as const;
```

Fingerprints must be stable and source-specific, for example `handover:${id}`, `bill:${id}:discount`, `bill:${id}:cancel`, and `medicine:${id}:low-stock`.

- [x] **Step 1: Write failing detector tests**

Cover stale handover threshold, zero-amount handover handling, tenant bind parameters, stable fingerprints, source hrefs, and no duplicate observations from one source row.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/action-center-exception-detectors.test.ts
```

- [x] **Step 3: Implement detectors**

Reuse the same eligibility used by the current dashboard/alerts where valid, but use stable source timestamps instead of `new Date()` for alert timestamps. Do not swallow query failures; let synchronization report them.

- [x] **Step 4: Run and verify GREEN**

Run the same command.

**Execution evidence (2026-07-14):** The original source-adjacent test command found no tests because the root Vitest config includes only `test/**/*.test.ts`; the plan path was corrected before production code. RED then failed because the detector module was absent. GREEN passed 5/5, covering the 24-hour stale threshold, zero-amount handovers, tenant/time binds, source-specific fingerprints and links, combined deduplication, source timestamps, and propagated query failures. Root TypeScript and `git diff --check` passed.

- [x] **Step 5: Commit**

```bash
git add src/services/actionCenter/exceptions test/action-center-exception-detectors.test.ts
git commit -m "feat(exceptions): normalize operational detectors"
```

---

### Task 3: Implement synchronization and lifecycle service

**Files:**
- Create: `src/services/actionCenter/exceptions/sync.ts`
- Create: `src/services/actionCenter/exceptions/transitions.ts`
- Create: `test/action-center-exception-sync.test.ts`
- Create: `test/action-center-exception-transitions.test.ts`
- Create: `test/helpers/sqlite-d1.ts`

**Interfaces:**

```ts
export async function syncExceptionCases(input: {
  db: D1Database;
  tenantId: string;
  actorId?: number;
  now: string;
}): Promise<{ observed: number; created: number; updated: number; autoResolved: number }>;

export type ExceptionTransition =
  | { action: 'acknowledge'; note?: string }
  | { action: 'assign'; assignedTo: number; note?: string }
  | { action: 'start'; note?: string }
  | { action: 'snooze'; snoozedUntil: string; note?: string }
  | { action: 'resolve'; resolutionCode: string; note: string }
  | { action: 'dismiss'; reason: string }
  | { action: 'reopen'; note: string };

export async function transitionExceptionCase(input: {
  db: D1Database;
  tenantId: string;
  caseId: number;
  actorId: number;
  transition: ExceptionTransition;
}): Promise<'updated' | 'not_found' | 'conflict'>;
```

- [x] **Step 1: Write failing synchronization tests**

Prove:

```text
same observation twice -> one case, updated last_detected_at
cleared auto-resolvable observation -> open case becomes resolved
resolved recurring rule observed later -> reopens with event
resolved non-recurring rule -> remains resolved
active dismissed fingerprint -> remains suppressed
```

- [x] **Step 2: Write failing transition tests**

Cover valid state graph, required notes/reasons, stale conditional update returning conflict, tenant isolation, and event insertion in the same batch.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run test/action-center-exception-sync.test.ts test/action-center-exception-transitions.test.ts
```

- [x] **Step 4: Implement synchronization**

Use `INSERT ... ON CONFLICT(tenant_id, rule_key, fingerprint) DO UPDATE` only for observation fields. Never overwrite resolved/dismissed state blindly.

- [x] **Step 5: Implement transition state map**

```ts
const ALLOWED: Record<string, string[]> = {
  open: ['acknowledged', 'in_progress', 'snoozed', 'resolved', 'dismissed'],
  acknowledged: ['in_progress', 'snoozed', 'resolved', 'dismissed'],
  in_progress: ['snoozed', 'resolved', 'dismissed'],
  snoozed: ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'],
  resolved: ['open'],
  dismissed: ['open'],
};
```

- [x] **Step 6: Run and verify GREEN**

Run the same command.

**Execution evidence (2026-07-14):** RED failed because `sync.ts` and `transitions.ts` were absent. GREEN passed 12/12 synchronization/transition tests and 17/17 across all exception service suites. Real SQLite-backed D1 tests prove tenant-scoped upsert behavior, auto-resolution, recurrence reopen, dismissal suppression, state validation, stale-write conflict handling, and update/event execution in one batch. Lifecycle event inserts are guarded by `changes() = 1`. Root TypeScript and `git diff --check` passed.

- [x] **Step 7: Commit**

```bash
git add src/services/actionCenter/exceptions test/action-center-exception-sync.test.ts test/action-center-exception-transitions.test.ts test/helpers/sqlite-d1.ts
git commit -m "feat(exceptions): add sync and lifecycle engine"
```

---

### Task 4: Add exception APIs

**Files:**
- Create: `src/routes/tenant/actionCenterExceptions.ts`
- Modify: `src/routes/tenant/actionCenter.ts`
- Test: `test/integration/routes/action-center-exceptions.test.ts`

**Interfaces:**

- `GET /api/action-center/exceptions`
- `GET /api/action-center/exceptions/:id`
- `GET /api/action-center/exceptions/:id/events`
- `POST /api/action-center/exceptions/sync`
- `PUT /api/action-center/exceptions/:id/acknowledge`
- `PUT /api/action-center/exceptions/:id/assign`
- `PUT /api/action-center/exceptions/:id/start`
- `PUT /api/action-center/exceptions/:id/snooze`
- `PUT /api/action-center/exceptions/:id/resolve`
- `PUT /api/action-center/exceptions/:id/dismiss`
- `PUT /api/action-center/exceptions/:id/reopen`

List query schema:

```ts
const exceptionListQuery = z.object({
  status: z.enum(['open','acknowledged','in_progress','snoozed','resolved','dismissed','all']).default('open'),
  severity: z.enum(['critical','warning','info']).optional(),
  type: z.string().trim().optional(),
  assignee: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

- [x] **Step 1: Write failing API tests**

Cover auth, permissions, pagination before response mapping, tenant isolation, event actor names, invalid transition 409, missing case 404, and validation 400.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-exceptions.test.ts
```

- [x] **Step 3: Implement routes**

Return source-safe IDs, source href, assignment data, SLA age, and timeline. Use `409` for stale transitions and `404` for cross-tenant or absent IDs.

- [x] **Step 4: Update `/api/action-center/summary`**

Read counts from `admin_exception_cases`, excluding active snoozes until `snoozed_until <= now`. Set `capabilities.persistentExceptions=true`.

- [x] **Step 5: Run and verify GREEN**

Run the focused test and `test/integration/routes/action-center.test.ts`.

**Execution evidence (2026-07-14):** RED failed 8/8 because the exception subrouter did not exist. GREEN passed 12/12 across exception API and Action Center summary integration. The API enforces role and tenant boundaries, SQL pagination before mapping, actor names, 400 validation, 404 absent/cross-tenant cases, 409 invalid or stale transitions, explicit synchronization, and tenant-safe assignee validation. Summary excludes future snoozes, reports critical/SLA/resolved-today counts, prioritizes critical exceptions, and sets `persistentExceptions=true`. Exception service regression passed 17/17; root TypeScript and `git diff --check` passed.

- [x] **Step 6: Commit**

```bash
git add src/routes/tenant/actionCenterExceptions.ts src/routes/tenant/actionCenter.ts test/integration/routes/action-center-exceptions.test.ts test/integration/routes/action-center.test.ts
git commit -m "feat(exceptions): expose actionable case APIs"
```

---

### Task 5: Replace Alerts & Exceptions UI

**Files:**
- Rewrite: `web/src/pages/admin/AlertsExceptions.tsx`
- Modify: `web/src/pages/admin/AlertsExceptions.test.tsx`
- Create: `web/src/components/action-center/ExceptionDetailDrawer.tsx`
- Create: `web/src/components/action-center/ExceptionDetailDrawer.test.tsx`
- Create: `web/src/components/action-center/exceptionTypes.ts`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/public/locales/en/adminPages.json`
- Modify: `web/public/locales/bn/adminPages.json`

**Interfaces:**
- Consumes exception list/detail/event/action APIs.
- Produces canonical Action Center Exceptions page inside `ActionCenterShell`.

- [x] **Step 1: Write failing queue tests**

Assert URL-backed status/severity/type/assignee filters, count badges, list loading/error/empty states, source link, and selected-case drawer.

- [x] **Step 2: Write failing action tests**

Cover acknowledge, assign-to-self, snooze, resolve dialog with required note, dismiss confirmation with required reason, reopen, disabled loading state, and 409 recovery message.

- [x] **Step 3: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/AlertsExceptions.test.tsx src/components/action-center/ExceptionDetailDrawer.test.tsx
```

- [x] **Step 4: Implement page and drawer**

Use semantic buttons, no browser prompts, visible labels, `aria-live="polite"` for mutation feedback, and a full-screen drawer/sheet at small widths. Keep all touch actions at least `min-h-11`.

- [x] **Step 5: Invalidate queries after actions**

Invalidate list, detail, events, and Action Center summary keys. Preserve drawer input when a mutation fails.

- [x] **Step 6: Run and verify GREEN**

Run the same command.

**Execution evidence (2026-07-14):** RED reproduced the legacy fraud-alert page contract and missing detail drawer. GREEN passed 13/13 queue and drawer tests. The page now uses URL-backed server filters, persistent counts, source links, SQL pagination results, loading/error/stale/empty states, and a shared Action Center shell. The drawer uses fixed endpoint-specific mutations with exact request bodies, required resolve/dismiss/reopen inputs, query invalidation and refetch, 409 recovery, initial focus, Escape close, body scroll lock, and focus restoration. Root TypeScript, English/Bengali locale JSON parsing, and `git diff --check` passed.

- [x] **Step 7: Commit**

```bash
git add web/src/pages/admin/AlertsExceptions.tsx web/src/pages/admin/AlertsExceptions.test.tsx web/src/components/action-center/ExceptionDetailDrawer.tsx web/src/components/action-center/ExceptionDetailDrawer.test.tsx web/src/components/action-center/exceptionTypes.ts web/src/lib/queryKeys.ts web/public/locales/en/adminPages.json web/public/locales/bn/adminPages.json
git commit -m "feat(exceptions): add actionable exception workspace"
```

---

### Task 6: Switch legacy alert consumers and dashboard links

**Files:**
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx`
- Modify: `web/src/pages/admin/Dashboard.tsx` if it directly reads fraud alerts
- Modify: related dashboard tests

**Interfaces:**
- Dashboard links to canonical exception filters.
- The dashboard may show counts from `/api/action-center/summary`; the exception page must not call `/api/dashboard/fraud-alerts`.

- [x] **Step 1: Write failing consumer tests**

Assert stale handover and discount cards use `/action/exceptions?...` and no Action Center page requests the old endpoint.

- [x] **Step 2: Run and verify RED**

Run the affected widget/dashboard test files.

- [x] **Step 3: Update consumers**

Keep `/api/dashboard/fraud-alerts` for unrelated backward compatibility, but remove it from the Action Center data path.

- [x] **Step 4: Run and verify GREEN**

Run the affected tests.

**Execution evidence (2026-07-14):** RED failed 7/7 because the widget still depended on `/api/dashboard/security-alerts` and short rule aliases. GREEN passed 7/7 after moving all Action Required counts to `/api/action-center/summary`, adding active `exceptions.byRule` counts, using full canonical rule keys, adding the persistent missing-discount-reference detector, and removing the duplicate cash-handover approval-subset card. Backend detector tests passed 5/5, summary/API integration passed 12/12, the full exception service/migration set passed 21/21, and the combined queue/drawer/widget frontend set passed 20/20. Root TypeScript, migration manifest generation, locale JSON parsing, and `git diff --check` passed.

- [x] **Step 5: Commit**

```bash
git add web/src/pages/admin/widgets/ActionRequiredPanel.tsx web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx web/src/pages/admin/Dashboard.tsx web/src/pages/admin/Dashboard.test.tsx
git commit -m "refactor(dashboard): consume persistent exceptions"
```

---

### Task 7: Phase 2 verification gate

- [x] **Step 1: Run migration and backend tests**

```bash
pnpm exec vitest run test/migrations/admin-exception-cases.test.ts test/action-center-exception-detectors.test.ts test/action-center-exception-sync.test.ts test/action-center-exception-transitions.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-exceptions.test.ts test/integration/routes/action-center.test.ts
```

- [x] **Step 2: Run frontend tests**

```bash
pnpm --filter web exec vitest run src/pages/admin/AlertsExceptions.test.tsx src/components/action-center/ExceptionDetailDrawer.test.tsx src/pages/admin/widgets/ActionRequiredPanel.test.tsx
```

- [x] **Step 3: Run compile/build gates**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
```

- [x] **Step 4: Run review checks**

```bash
git diff --check
```

Review fingerprint stability, recurrence rules, suppression, conditional updates, tenant isolation, missing actor data, timezone handling, and no source mutation.

**Execution evidence (2026-07-14):** Migration/service tests passed 21/21, Action Center API integration passed 13/13, and queue/drawer/dashboard frontend tests passed 20/20. Migration manifest generation, root TypeScript, all production bundles, locale JSON parsing, and `git diff --check` passed. Review confirmed stable tenant-scoped fingerprints, explicit recurrence/suppression policies, conditional update plus event batches, composite tenant foreign-key enforcement, no exception action writes to billing/cash/inventory source records, and separate authority from canonical migration-processing issues. The final adversarial pass found and fixed two important lifecycle defects before integration: active summary counts now deep-link to an explicit `status=active` queue that includes open, acknowledged, in-progress, and expired snoozed work while excluding future snoozes; date-scoped high-discount and missing-reference audit observations are non-auto-resolving/non-recurring so a calendar boundary cannot falsely mark an unchanged source record resolved. Initial review fixes were committed as `ae3807ef`; final pre-integration fixes are covered by fresh RED/GREEN tests.

Production migration evidence: D1 database `hms-super-admin-production-apac` had only `0500_admin_exception_cases.sql` pending; target tables and indexes were absent before apply; pre/post Time Travel bookmarks were captured; ledger row `449` applied the migration successfully; post-apply listing reported no pending migrations. Both tables, four indexes, JSON checks, and the composite `(tenant_id, case_id)` foreign key were verified. Initial case/event counts were zero.

Integration/deployment evidence: eight Phase 2 commits fast-forwarded `origin/main` from `95789b598` to `7cfda8829` without force push. `pnpm deploy:production` rebuilt the complete production asset set and deployed Worker version `b9c4cb2a-669a-4f80-8bbb-42bc7724b4bb` at 100% traffic. Unauthenticated smoke passed 12/12 and authenticated hospital-admin API/browser checks passed. One explicit authenticated `demo-hospital` synchronization observed and created one stale-handover case; summary/list and direct D1 verification confirmed one open case plus one `created` event. No source financial/custody record was mutated and no recurring sync schedule was enabled.

- [x] **Step 5: Commit review fixes**

```bash
git add migrations src web test
git commit -m "feat(action-center): complete persistent exceptions phase"
```
