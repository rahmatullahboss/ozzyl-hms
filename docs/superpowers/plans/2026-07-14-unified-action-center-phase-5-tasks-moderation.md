# Unified Action Center Phase 5: Tasks and Review Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generated read-only task cards with persistent assignments and complete Review Moderation as a structured, audited Patient Experience workflow.

**Architecture:** `admin_action_tasks` stores explicit operational assignments and source-linked follow-ups; it does not duplicate approval, exception, collection, invoice, or payment state. Source links use stable public references plus structured metadata so legacy-to-canonical financial cutover does not orphan tasks. Collection and exception services may create/update linked tasks through a narrow task service. Review moderation remains on `provider_reviews`, with structured moderation columns and an append-only event table.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQL migrations, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Migration number: `0503_action_tasks_review_moderation.sql`.
- Do not use isolated canonical migration numbers `0423–0433`.
- A task is an assignment/reminder, not a second approval, exception, collection, invoice, payment, or adjustment source of truth.
- Source-linked task uniqueness is tenant-scoped and uses stable `source_public_id`; repeated synchronization must not create duplicates.
- Financial source metadata may include `legacyBillId` and `canonicalInvoicePublicId`, but task state must never decide financial authority or balance.
- Completing a task must not silently resolve its source exception or alter a collection/invoice balance.
- Task and moderation timestamps are UTC ISO strings; event metadata must be valid JSON.
- Task events use a composite `(tenant_id, task_id)` foreign key so cross-tenant references fail at database level.
- Review rejection requires a structured reason code; moderation notes are optional but length-limited.
- Review approve/reject/reply permissions remain distinct from Action Center operational permissions.
- Replace all browser `prompt()` usage with accessible dialogs.
- Every mutation writes an event and uses conditional state transitions.
- Task mutations accept `expectedUpdatedAtUtc`; stale writes return `409` and must not append an event.
- A completed source-linked task is reopened in place only when an explicit new source follow-up is scheduled; passive synchronization never creates a duplicate or silently reopens terminal work.
- Review state remains `0 = pending`, `1 = approved`, `-1 = rejected`; approve/reject use one tenant-scoped conditional update from pending only.
- Review moderation events use a composite `(tenant_id, review_id)` foreign key backed by a unique `(target_tenant_id, id)` parent key.
- The migration also formalizes the currently referenced provider reply/moderation compatibility columns so existing endpoints cannot depend on out-of-band production schema.
- Phase 5 E2E must not require Phase 4 write-off. Write-off maker-checker coverage remains deferred to the Phase 4 release gate.
- Root backend tests belong under `test/action-center/tasks/` and `test/marketplace/`; do not place them beside source files excluded by root Vitest.

---

### Task 1: Add persistent task and review moderation audit schema

**Files:**
- Create: `migrations/0503_action_tasks_review_moderation.sql`
- Create: `test/migrations/action-tasks-review-moderation.test.ts`

**Interfaces:**

```sql
CREATE TABLE admin_action_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT,
  source_public_id TEXT,
  source_href TEXT,
  source_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_metadata_json)),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
  assigned_to INTEGER,
  due_at_utc TEXT,
  completed_by INTEGER,
  completed_at_utc TEXT,
  completion_note TEXT,
  created_by INTEGER,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(due_at_utc IS NULL OR substr(due_at_utc, -1) = 'Z'),
  CHECK(completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  CHECK(substr(updated_at_utc, -1) = 'Z'),
  CHECK(
    (
      status = 'completed'
      AND completed_by IS NOT NULL
      AND completed_at_utc IS NOT NULL
      AND completion_note IS NOT NULL
      AND length(trim(completion_note)) > 0
    )
    OR (
      status <> 'completed'
      AND completed_by IS NULL
      AND completed_at_utc IS NULL
      AND completion_note IS NULL
    )
  ),
  CHECK(
    (source_type IS NULL AND source_public_id IS NULL)
    OR (source_type IN ('exception','collection','manual') AND source_public_id IS NOT NULL AND length(trim(source_public_id)) > 0)
  ),
  UNIQUE(tenant_id, id)
);

CREATE UNIQUE INDEX uq_admin_action_tasks_source
  ON admin_action_tasks(tenant_id, source_type, source_public_id)
  WHERE source_type IS NOT NULL AND source_public_id IS NOT NULL AND status != 'cancelled';

CREATE TABLE admin_action_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(length(trim(event_type)) > 0),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY(tenant_id, task_id) REFERENCES admin_action_tasks(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE provider_reviews ADD COLUMN moderation_reason TEXT;
ALTER TABLE provider_reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply_at TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply_by INTEGER;
ALTER TABLE provider_reviews ADD COLUMN moderation_reason_code TEXT;
ALTER TABLE provider_reviews ADD COLUMN moderation_note TEXT;
ALTER TABLE provider_reviews ADD COLUMN moderated_by INTEGER;
ALTER TABLE provider_reviews ADD COLUMN moderated_at_utc TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply_at_utc TEXT;

CREATE UNIQUE INDEX uq_provider_reviews_tenant_id
  ON provider_reviews(target_tenant_id, id);

CREATE TABLE provider_review_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  review_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('approved','rejected','reply_posted')),
  actor_id INTEGER NOT NULL,
  reason_code TEXT,
  note TEXT,
  old_state INTEGER,
  new_state INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(old_state IS NULL OR old_state IN (-1,0,1)),
  CHECK(new_state IS NULL OR new_state IN (-1,0,1)),
  CHECK(
    (event_type = 'approved' AND old_state IS 0 AND new_state IS 1 AND reason_code IS NULL)
    OR (event_type = 'rejected' AND old_state IS 0 AND new_state IS -1 AND reason_code IS NOT NULL)
    OR (
      event_type = 'reply_posted'
      AND old_state IS NOT NULL
      AND new_state IS NOT NULL
      AND old_state = new_state
      AND reason_code IS NULL
    )
  ),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY(tenant_id, review_id)
    REFERENCES provider_reviews(target_tenant_id, id) ON DELETE RESTRICT
);
```

Add task indexes for tenant/status/due, tenant/assignee/status, and task events; add review-event tenant/review/date index.

- [x] **Step 1: Write failing migration tests**

Assert task constraints/indexes and review columns/event table. Apply the migration once to the tracked legacy schema and prove existing review rows survive; D1 migration-ledger execution is the project idempotency boundary.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/migrations/action-tasks-review-moderation.test.ts
```

- [x] **Step 3: Implement migration**

Use the tracked legacy `provider_reviews` schema as the migration input. The additive migration is applied once by D1 ledger order; release preflight must verify the compatibility columns are not already present out of band.

- [x] **Step 4: Run migration and manifest checks**

```bash
pnpm exec vitest run test/migrations/action-tasks-review-moderation.test.ts
pnpm build:migrations
```

- [x] **Step 5: Commit**

```bash
git add migrations/0503_action_tasks_review_moderation.sql test/migrations/action-tasks-review-moderation.test.ts docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md
git commit -m "feat(action-center): add tasks and moderation audit schema"
```

**Verification evidence (2026-07-15):** Initial RED failed 5/5 because `0503_action_tasks_review_moderation.sql` was absent. The implemented migration passed 5/5 focused tests and the combined `0500`–`0503` migration regression passed 14/14. Adversarial RED proved moderation events could record an `approved` decision with a null old state; event-specific approve/reject/reply transition checks fixed it. The migration manifest generated 436 entries; root TypeScript and `git diff --check` passed. No migration was applied to production.

---

### Task 2: Implement task service and source-link API

**Files:**
- Create: `src/services/actionCenter/tasks/types.ts`
- Create: `src/services/actionCenter/tasks/service.ts`
- Create: `test/action-center/tasks/service.test.ts`

**Interfaces:**

```ts
export interface TaskSourceMetadata {
  legacyBillId?: number;
  canonicalInvoicePublicId?: string;
  collectionCaseId?: number;
  exceptionCaseId?: number;
}

export interface UpsertSourceTaskInput {
  db: D1Database;
  tenantId: string;
  sourceType: 'exception' | 'collection' | 'manual';
  sourcePublicId: string;
  sourceHref: string;
  sourceMetadata?: TaskSourceMetadata;
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo?: number;
  dueAtUtc?: string;
  actorId: number;
  reopenCompleted?: boolean;
  nowUtc?: string;
}

export async function upsertSourceTask(input: UpsertSourceTaskInput): Promise<number>;

export async function createManualTask(input: {
  db: D1Database;
  tenantId: string;
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo?: number;
  dueAtUtc?: string;
  actorId: number;
  nowUtc?: string;
}): Promise<number>;

export type TaskTransition =
  | { action: 'assign'; assignedTo: number; note?: string }
  | { action: 'start'; note?: string }
  | { action: 'reschedule'; dueAtUtc: string; note?: string }
  | { action: 'complete'; note: string }
  | { action: 'cancel'; note: string };

export async function transitionTask(input: {
  db: D1Database;
  tenantId: string;
  taskId: number;
  actorId: number;
  expectedUpdatedAtUtc?: string;
  transition: TaskTransition;
  nowUtc?: string;
}): Promise<'updated' | 'not_found' | 'conflict'>;
```

- [x] **Step 1: Write failing service tests**

Cover source deduplication, manual task creation, assign/start/reschedule/complete/cancel transitions, required completion/cancellation note, stale conflict, tenant isolation, event batching, completed-source relinking, and same-millisecond optimistic timestamp monotonicity.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/tasks/service.test.ts
```

- [x] **Step 3: Implement task service**

Use conditional updates. Completing/cancelling a task changes only task state; source mutation requires an explicit source action in its own service. Passive source synchronization may refresh href/identity metadata on a completed task, but it cannot reopen or erase completion evidence.

- [x] **Step 4: Run and verify GREEN**

Run the same command.

- [x] **Step 5: Commit**

```bash
git add src/services/actionCenter/tasks test/action-center/tasks/service.test.ts docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md
git commit -m "feat(tasks): add persistent assignment service"
```

**Verification evidence (2026-07-15):** Initial RED failed because the task service module was absent. The first implementation passed 8/8 focused tests. Adversarial RED then reproduced two lifecycle gaps: a completed task did not retain canonical source relink evidence, and two writes sharing one requested millisecond could retain the same optimistic timestamp. The final service records a state-preserving `source_relinked` event, advances timestamps by at least one millisecond, and passed 9/9 focused tests. Combined Task 1–2 migration/service verification passed 14/14; root TypeScript and `git diff --check` passed. No production migration, merge, push, or deployment occurred.

---

### Task 3: Add task APIs and Action Center summary integration

**Files:**
- Create: `src/services/actionCenter/tasks/query.ts`
- Create: `src/routes/tenant/actionCenterTasks.ts`
- Modify: `src/routes/tenant/actionCenter.ts`
- Modify: `src/routes/admin/withActionCenterCollections.ts`
- Create: `test/integration/routes/action-center-tasks.test.ts`
- Modify: `test/integration/routes/action-center.test.ts`
- Modify: `test/integration/routes/action-center-collections.test.ts`
- Modify: `test/admin-alerts-tasks.test.ts`

**Interfaces:**

- `GET /api/action-center/tasks`
- `POST /api/action-center/tasks`
- `GET /api/action-center/tasks/:id`
- `GET /api/action-center/tasks/:id/events`
- `PUT /api/action-center/tasks/:id/assign`
- `PUT /api/action-center/tasks/:id/start`
- `PUT /api/action-center/tasks/:id/reschedule`
- `PUT /api/action-center/tasks/:id/complete`
- `PUT /api/action-center/tasks/:id/cancel`

List query:

```ts
const taskListQuery = z.object({
  view: z.enum(['mine','team','due_today','overdue','completed','all']).default('mine'),
  priority: z.enum(['critical','high','medium','low']).optional(),
  sourceType: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

Legacy `/api/admin/tasks` becomes a compatibility adapter over persistent tasks and must stop generating duplicate due/refund/expense cards from source tables.

- [x] **Step 1: Write failing API tests**

Cover views, user ownership, management-only team scope, pagination, creation validation, tenant isolation, event actor names, invalid transitions, role-accessible next-best-action links, and legacy adapter behaviour.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-tasks.test.ts
```

- [x] **Step 3: Implement routes**

Return task source href and source status summary without mutating source state. Use `409` for stale transitions. Non-management readers are restricted to `view=mine`, their assigned task details/events/actions, and self-assigned manual creation; management roles retain team-wide views.

- [x] **Step 4: Update Action Center summary**

Read open/overdue/assigned-to-me counts from `admin_action_tasks` and set `capabilities.persistentTasks=true`. Management receives the team overdue route; non-management receives an accessible `view=mine` next-best-action only when their own assigned work is overdue.

- [x] **Step 5: Run and verify GREEN**

Run task and action-center summary tests.

- [x] **Step 6: Commit**

```bash
git add src/services/actionCenter/tasks/query.ts src/routes/tenant/actionCenterTasks.ts src/routes/tenant/actionCenter.ts src/routes/admin/withActionCenterCollections.ts test/integration/routes/action-center-tasks.test.ts test/integration/routes/action-center.test.ts test/integration/routes/action-center-collections.test.ts test/admin-alerts-tasks.test.ts docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md docs/superpowers/progress/2026-07-14-unified-action-center-progress.md
git commit -m "feat(tasks): expose persistent task APIs"
```

**Verification evidence (2026-07-15):** Initial API RED failed 7/7 because the task route was absent, summary counts/capability were placeholders, and the legacy endpoint still synthesized source-table cards. The first implementation passed 7/7. Adversarial RED then proved accountants could bypass team restrictions through `all`, `overdue`, and `completed`, read/mutate another assignee's task, create tasks for another user, and receive a forbidden management-only next-action link. Ownership/view gates and role-aware summary routing fixed those defects. Final focused task API/summary tests passed 9/9; combined Action Center/collections/tasks/admin compatibility integrations passed 25/25; Task 1–2 migration/service regressions passed 14/14; the production admin-wrapper unit suite passed 4/4; root TypeScript and `git diff --check` passed. No production migration, merge, push, or deployment occurred.

---

### Task 4: Integrate source-created follow-up tasks

**Files:**
- Modify: `src/services/actionCenter/exceptions/transitions.ts`
- Modify: `src/services/actionCenter/collections/transitions.ts`
- Modify: `src/services/actionCenter/collections/reconcile.ts`
- Modify: `src/services/actionCenter/tasks/service.ts`
- Modify: `src/routes/tenant/actionCenterCollections.ts`
- Modify: `test/action-center-exception-transitions.test.ts`
- Modify: `test/action-center/collections/transitions.test.ts`
- Modify: `test/action-center/collections/reconcile.test.ts`
- Modify: `test/integration/routes/action-center-collections.test.ts`

**Interfaces:**
- Assigning/starting an exception may upsert a linked task only when an assignee or due date is present.
- Setting a collection next follow-up upserts one linked task with stable source key `collection-case:<caseId>` and source metadata containing any `legacyBillId`/`canonicalInvoicePublicId` known to the collection case.
- Resolving/closing a source completes or cancels its linked task through the task service in the same request flow. A financial authority switch updates metadata/href only; it does not create a duplicate task.

- [x] **Step 1: Write failing integration tests at service level**

Prove repeated follow-up updates modify one task, source closure completes the linked task, and completing a task alone does not resolve the source.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/action-center-exception-transitions.test.ts test/action-center/collections/transitions.test.ts test/action-center/collections/reconcile.test.ts test/action-center/tasks/service.test.ts
```

- [x] **Step 3: Implement narrow task-service calls**

Avoid circular imports by keeping task service independent of exception/collection internals.

- [x] **Step 4: Run and verify GREEN**

Run the same command plus the related Action Center route and compatibility integration suites.

- [x] **Step 5: Commit**

```bash
git add src/routes/tenant/actionCenterCollections.ts src/services/actionCenter/collections/reconcile.ts src/services/actionCenter/collections/transitions.ts src/services/actionCenter/exceptions/transitions.ts src/services/actionCenter/tasks/service.ts test/action-center-exception-transitions.test.ts test/action-center/collections/reconcile.test.ts test/action-center/collections/transitions.test.ts test/integration/routes/action-center-collections.test.ts docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md docs/superpowers/progress/2026-07-14-unified-action-center-progress.md
git commit -m "feat(tasks): link operational follow-ups to source cases"
```

**Verification evidence (2026-07-15):** Source-linked exception and collection tests first established stable task upserts, duplicate prevention, metadata enrichment, source-close settlement, positive-due preservation, already-closed repair, and one-way source independence. Adversarial RED then reproduced two exception request-flow defects: a cross-tenant assignee could mutate the source before task validation failed, and a terminal-source retry did not repair a task left open by task-event failure. Pre-mutation tenant participant validation and idempotent terminal retry repair fixed both defects. A route-boundary RED/GREEN also proved authenticated collection detail reconciliation forwards actor evidence into linked-task completion. Final Task 4 service verification passed 37/37; related Action Center route/admin compatibility verification passed 27/27; root TypeScript and diff validation passed. Migration `0503` was not applied to production, and no merge, push, or deployment occurred.

---

### Task 5: Rebuild Tasks & Follow-ups page

**Files:**
- Rewrite: `web/src/pages/admin/TasksFollowups.tsx`
- Modify: `web/src/pages/admin/TasksFollowups.test.tsx`
- Create: `web/src/components/action-center/TaskDetailDrawer.tsx`
- Create: `web/src/components/action-center/TaskDetailDrawer.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/public/locales/en/adminPages.json`
- Modify: `web/public/locales/bn/adminPages.json`

**Interfaces:**
- Consumes persistent task list/detail/events/actions.
- Produces canonical `/action/tasks` page in `ActionCenterShell`.

- [x] **Step 1: Write failing view tests**

Cover My Tasks, Team Tasks, Due Today, Overdue, Completed, URL-backed filters, pagination, loading/error/empty states, and source links.

- [x] **Step 2: Write failing action tests**

Cover assign, start, reschedule, complete with mandatory note, cancel with mandatory note, loading disablement, 409 recovery, and timeline refresh.

- [x] **Step 3: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/TasksFollowups.test.tsx src/components/action-center/TaskDetailDrawer.test.tsx
```

- [x] **Step 4: Implement page and drawer**

Use dense accessible table/cards, semantic statuses, minimum 44px controls, no browser prompts, and one primary action per modal.

- [x] **Step 5: Run and verify GREEN**

Run the same command.

- [x] **Step 6: Commit**

```bash
git add web/src/pages/admin/TasksFollowups.tsx web/src/pages/admin/TasksFollowups.test.tsx web/src/components/action-center/TaskDetailDrawer.tsx web/src/components/action-center/TaskDetailDrawer.test.tsx web/src/lib/queryKeys.ts web/public/locales/en/adminPages.json web/public/locales/bn/adminPages.json
git commit -m "feat(tasks): add actionable task workspace"
```

**Verification evidence (2026-07-15):** RED first proved the page still depended on the legacy generated `/api/admin/tasks` contract and that the persistent task drawer did not exist. The canonical workspace now provides management and ownership-safe views, URL-backed server filters and pagination, tenant-safe source links, loading/error/empty states, and an accessible detail/timeline drawer with assign, start, reschedule, complete, and cancel actions using optimistic concurrency evidence. Complete and cancel require notes, pending mutations disable actions, successful writes invalidate summary/list state and refresh detail/events, and `409` recovery resets stale mutation state before refetching. Adversarial review added nested-dialog focus entry and trigger-focus restoration. Final focused task suites passed 16/16, query-key regressions passed 5/5, web TypeScript, English/Bengali locale JSON parsing, and `git diff --check` passed. Migration `0503` was not applied, and no merge, push, or deployment occurred.

---

### Task 6: Add structured review moderation service and API

**Files:**
- Create: `src/services/marketplace/reviewModeration.ts`
- Create: `test/marketplace/review-moderation.test.ts`
- Modify: `src/routes/marketplace-reviews.ts`
- Modify: marketplace review integration tests

**Interfaces:**

```ts
export type ReviewRejectionReason =
  | 'abusive_language'
  | 'personal_information'
  | 'spam'
  | 'irrelevant_content'
  | 'conflict_of_interest'
  | 'fraudulent_review'
  | 'other';

export async function moderateProviderReview(input: {
  db: D1Database;
  tenantId: string;
  reviewId: number;
  actorId: number;
  decision: 'approve' | 'reject';
  reasonCode?: ReviewRejectionReason;
  note?: string;
}): Promise<'updated' | 'not_found' | 'conflict'>;
```

- [x] **Step 1: Write failing service tests**

Cover approve, reject reason required, optional note limits, already-moderated conflict, tenant isolation, and event insertion.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/marketplace/review-moderation.test.ts
```

- [x] **Step 3: Implement service and route validation**

Use conditional update on `is_approved = 0`. Existing approve/reject endpoints may remain but must call the service. Return `409` for a stale second decision.

- [x] **Step 4: Add moderation events endpoint**

- `GET /api/v1/marketplace/reviews/:id/moderation-events`

Return actor names and tenant-isolated history.

- [x] **Step 5: Run and verify GREEN**

Run service and marketplace route tests.

- [x] **Step 6: Commit**

```bash
git add src/services/marketplace/reviewModeration.ts test/marketplace/review-moderation.test.ts src/routes/marketplace-reviews.ts test
git commit -m "feat(reviews): add structured moderation audit"
```

**Verification evidence (2026-07-15):** RED first proved that the structured moderation service and history endpoint were absent, rejection accepted no reason code, and a stale second decision still returned success. The service now performs tenant-scoped conditional moderation and immutable event insertion in one D1 batch, requires schema-backed rejection reasons, trims and bounds optional notes, records audited provider replies, joins actor names in tenant-isolated history, and returns `409` for already-moderated reviews. Adversarial RED/GREEN additionally rejected malformed JSON and non-text inputs, validated runtime decision values, captured the live review state for concurrent reply events, preserved the legacy `{ reason }` request as structured `other` evidence until Task 7 replaces the prompt UI, and maintained legacy SQL datetime columns alongside canonical UTC fields. Focused service/route suites passed 21/21; migration plus moderation regressions passed 26/26; root TypeScript and `git diff --check` passed. Migration `0503` was not applied, and no merge, push, or deployment occurred.

---

### Task 7: Replace review prompts with a Patient Experience moderation drawer

**Files:**
- Rewrite: `web/src/pages/marketplace/ReviewModerationPage.tsx`
- Modify: `web/src/pages/marketplace/ReviewModerationPage.test.ts`
- Create: `web/src/components/marketplace/ReviewModerationDrawer.tsx`
- Create: `web/src/components/marketplace/ReviewModerationDrawer.test.tsx`
- Modify: `web/public/locales/en/marketplace.json`
- Modify: `web/public/locales/bn/marketplace.json`

**Interfaces:**
- Page remains under `/patient-experience/reviews` with legacy alias.
- Drawer shows reviewer, target, rating, full review, publication state, provider reply, and moderation timeline.

- [x] **Step 1: Write failing UI tests**

Cover opening a full review, approve action, rejection reason select, optional note, reply form, timeline, loading state, stale 409 message, Escape/close behaviour, and focus return.

- [x] **Step 2: Assert no browser prompt usage**

```ts
expect(source).not.toContain('prompt(');
expect(source).not.toContain('confirm(');
```

- [x] **Step 3: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/marketplace/ReviewModerationPage.test.ts src/components/marketplace/ReviewModerationDrawer.test.tsx
```

- [x] **Step 4: Implement page/drawer**

Use a semantic dialog/drawer, labelled form controls, inline error, disabled pending state, and full review text without irreversible truncation.

- [x] **Step 5: Run and verify GREEN**

Run the same command.

- [x] **Step 6: Commit**

```bash
git add web/src/pages/marketplace/ReviewModerationPage.tsx web/src/pages/marketplace/ReviewModerationPage.test.ts web/src/components/marketplace/ReviewModerationDrawer.tsx web/src/components/marketplace/ReviewModerationDrawer.test.tsx web/public/locales/en/marketplace.json web/public/locales/bn/marketplace.json
git commit -m "feat(reviews): add patient experience moderation workspace"
```

**Verification evidence (2026-07-15):** RED first proved that the prompt-driven table had no full-review drawer, semantic loading/error states, touch-sized controls, structured rejection form, audited timeline, or stale-decision recovery. The Patient Experience workspace now keeps the canonical `/patient-experience/reviews` route and legacy redirect, opens the complete review in a semantic drawer, shows reviewer/target/rating/publication state/provider reply/timeline, and performs approve, structured reject, and reply actions without browser prompts. Pending writes disable controls, `409` conflicts can refresh the timeline, successful actions invalidate and refetch the list/history, and bilingual labels cover all reason and event states. Adversarial RED/GREEN additionally closes the drawer after successful mutations to prevent stale selected-review state and hides the background drawer from assistive technology while a nested action dialog is active. Focused page/drawer tests passed 13/13 and the production web build passed. Migration `0503` was not applied, and no merge, push, or deployment occurred.

---

### Task 8: Final system verification and end-to-end coverage

**Files:**
- Create: `test/e2e/action-center-workflows.spec.ts`
- Modify: only test-owned fixtures/helpers required by this spec.

- [x] **Step 1: Add E2E scenarios**

Cover:

```text
admin opens canonical Action Center and legacy aliases redirect
admin acknowledges, assigns, and resolves an exception
collector records contact and promise to pay
collector requests write-off and separate approver approves it
admin assigns and completes a source-linked task
moderator rejects a review with structured reason
browser back restores Action Center filters
```

- [x] **Step 2: Run focused backend/frontend suites**

```bash
pnpm exec vitest run test/migrations/action-tasks-review-moderation.test.ts test/action-center/tasks/service.test.ts test/marketplace/review-moderation.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-tasks.test.ts test/integration/routes/action-center-exceptions.test.ts test/integration/routes/action-center-collections.test.ts test/integration/routes/approvals.test.ts
pnpm --filter web exec vitest run src/pages/admin/TasksFollowups.test.tsx src/components/action-center/TaskDetailDrawer.test.tsx src/pages/marketplace/ReviewModerationPage.test.ts src/components/marketplace/ReviewModerationDrawer.test.tsx
```

- [x] **Step 3: Run E2E in the approved local/test environment**

```bash
pnpm exec playwright test test/e2e/action-center-workflows.spec.ts
```

Expected: all scenarios pass; generated reports remain uncommitted.

- [x] **Step 4: Run final gates**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

- [x] **Step 5: Accessibility and responsive review**

Verify 375px, 768px, 1024px, and 1440px layouts; keyboard-only operation; visible focus; dialog focus trap/return; reduced motion; no colour-only status; no page-level horizontal overflow; and minimum action target sizing.

- [x] **Step 6: Adversarial review**

Review task/source duplication, source closure vs task completion, moderation races, cross-tenant event access, stale query caches, route aliases, count consistency, and no direct financial mutation outside the approved write-off executor.

- [x] **Step 7: Commit final review fixes and E2E spec**

```bash
git add migrations src web test/e2e/action-center-workflows.spec.ts
git commit -m "feat(action-center): complete tasks and moderation phase"
```

**Verification evidence (2026-07-15):** The focused migration/task/moderation suites passed 24/24, integration route suites passed 126/126, and task/review frontend suites passed 29/29. The exact Playwright command collected eight scenarios and passed seven without retries; the receivable write-off request/approval scenario remains explicitly skipped because Phase 4 financial authority is intentionally gated and was not simulated. Browser coverage verifies canonical and legacy routes, exception resolution evidence, contact and promise state, source-linked task assignment/completion, structured review rejection, Back navigation, reduced motion, keyboard-only dialog operation, focus return, minimum 44px targets, no page-level horizontal overflow, and 375px/768px/1024px/1440px layouts. Adversarial review added deterministic third-party network isolation, current in-memory authentication, config-level production-preview lifecycle, custom local host/port support, project-only invocation support, and remote URL rejection; runner config regressions passed 3/3 and a representative existing portal E2E passed. Migration manifest generation, root TypeScript, the full multi-app production build, and `git diff --check` passed. Generated Playwright reports remain excluded from the intended commit; migration `0503` was not applied, and no merge, push, or deployment occurred.
