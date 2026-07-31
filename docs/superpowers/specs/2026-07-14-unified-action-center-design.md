# Unified Action Center Design

**Date:** 2026-07-14  
**Status:** Approved direction, implementation-ready specification  
**Scope:** Hospital-admin Action Center, approvals, operational exceptions, receivables collection, tasks, review moderation navigation, and dashboard deep links.

## 1. Problem Statement

The current admin workflow is split across several pages with overlapping names and inconsistent behaviour:

- `Pending Approval` is the real auditable decision queue.
- `Approval Center` is a navigation hub, but appears to be a second approval queue.
- `Alerts & Exceptions` displays calculated alerts without persistent acknowledgement, assignment, resolution, dismissal, or timeline state.
- `Due & Receivables` is read-only, exposes unsupported-looking tabs, and does not provide collection or write-off workflows.
- `Collection Follow-up` has a frontend/backend contract mismatch and no persisted follow-up lifecycle.
- `Review Moderation` is grouped with operational action queues even though it belongs to patient experience and marketplace reputation management.
- Dashboard `Action Required` cards deep-link to pages that often provide no action.

The result is a set of monitoring screens rather than a coherent operational command workflow.

## 2. Goals

1. Create one predictable Action Center entry point for all admin work that requires attention.
2. Preserve the existing approval engine and maker-checker controls.
3. Make operational exceptions persistently actionable with ownership and lifecycle state.
4. Turn receivables into a real collection workflow, including controlled write-off requests.
5. Remove duplicate navigation concepts and dead-end pages without breaking old URLs.
6. Keep review moderation as a separate patient-experience workflow.
7. Apply the existing Ozzyl HMS design system consistently, using the UI/UX Pro Max guidance for accessibility, density, interaction feedback, and responsive behaviour.

## 3. Non-Goals

- Do not replace the existing approval engine with a generic workflow platform.
- Do not merge approvals, alerts, collections, and tasks into one polymorphic database table.
- Do not allow direct receivable deletion or direct write-off from the collection page.
- Do not rebuild unrelated dashboard, billing, pharmacy, inventory, or marketplace modules.
- Do not introduce a new application-wide font or colour system for this feature.
- Do not hide unsupported functionality behind tabs that appear operational.

## 4. Chosen Architecture

Use a **Unified Action Center shell with domain-owned workflows**.

The shell normalizes navigation, counts, filters, detail presentation, and deep links. Each domain keeps its own source of truth:

- Approvals: existing `approval_requests`, `billing_handovers`, expenses, pharmacy queues, and current approval adapters.
- Exceptions: new persistent exception case and event tables, backed by rule detectors.
- Collections: new collection case and event tables linked to canonical receivable sources.
- Tasks: existing admin task/follow-up source, adapted into the shell.
- Review moderation: existing marketplace review source, moved to Patient Experience navigation.

This avoids the fragmentation of the current product while avoiding the risk and complexity of a universal case engine.

## 5. Information Architecture

### 5.1 Canonical routes

- `/h/:slug/action` — Action Center Overview
- `/h/:slug/action/approvals` — Approvals queue
- `/h/:slug/action/exceptions` — Exceptions queue
- `/h/:slug/action/collections` — Collections queue
- `/h/:slug/action/tasks` — Tasks and follow-ups
- `/h/:slug/patient-experience/reviews` — Review Moderation

### 5.2 Backward-compatible routes

- `/h/:slug/approvals` redirects to `/h/:slug/action`.
- `/h/:slug/action/pending-approvals` redirects to `/h/:slug/action/approvals` while preserving supported query parameters.
- `/h/:slug/alerts` redirects to `/h/:slug/action/exceptions`.
- Existing dues and collection-follow-up routes redirect to `/h/:slug/action/collections` with the equivalent view/filter.
- `/h/:slug/review-moderation` remains a route alias for bookmarked links.

### 5.3 Sidebar structure

**Action Center**

- Overview
- Approvals
- Exceptions
- Collections
- Tasks

**Patient Experience**

- Review Moderation
- Marketplace Booking
- Patient Feedback when available

The active item must reflect the canonical route, not the alias used to enter it.

## 6. Shared Action Center Shell

Create a shared `ActionCenterShell` used by Overview, Approvals, Exceptions, Collections, and Tasks.

### 6.1 Page structure

1. Compact page header with title, description, last refresh, and one primary action when relevant.
2. Persistent primary tabs with live counts.
3. Optional health/filter toolbar with URL-backed filters.
4. Main list/table area.
5. Right-side detail drawer on desktop and full-screen sheet on small screens.
6. Empty, loading, error, and permission states with a recovery action.

### 6.2 Shared query state

Use URL search parameters for:

- status
- type
- severity/priority
- assignee
- SLA state
- date range
- search
- page
- selected item where deep-linking is appropriate

Back navigation must restore filter and scroll context.

### 6.3 Design rules

The UI/UX Pro Max recommendation is interpreted as a dense, calm enterprise healthcare console:

- Reuse existing semantic Ozzyl HMS tokens and typography.
- Use white/surface cards, visible borders, restrained shadows, and teal/cyan primary accents.
- Use semantic colour plus icon/text; never colour alone.
- Keep interactive targets at least 44px high where practical.
- Keep table numbers tabular and right-aligned.
- Use 150–250ms state transitions and respect reduced motion.
- Keep one visual primary action per view.
- Use native buttons, links, tables, headings, and ARIA labels.
- No hover-only actions; row actions remain keyboard and touch accessible.
- At 375px, convert dense tables into summary cards or a horizontally safe priority layout rather than forcing page-level horizontal scroll.

## 7. Overview

The Overview is a command summary, not another queue.

### 7.1 Primary metrics

- My open work
- Unassigned work
- High priority
- SLA breached
- Financial exposure
- Resolved today

### 7.2 Workstream cards

Each card links to a filtered canonical queue:

- Approvals requiring decision
- Open exceptions
- Collection follow-ups due
- Overdue tasks

Cards must use one aggregated summary API so counts are internally consistent.

### 7.3 Next best action

Show the oldest/highest-risk item the current user is authorised to act on. If no item exists, show a healthy empty state rather than a disabled review button.

## 8. Approvals

The existing audited Pending Approvals implementation remains the approval work surface.

### 8.1 Behaviour retained

- Pending, approved, rejected, and full history views.
- Approve, reject, and request-information where the source supports it.
- Evidence status and decision blockers.
- Separation of duties.
- Source-safe IDs and source-specific action routing.
- Cash handover variance/dispute logic.
- Timeline and audit history.

### 8.2 Integration changes

- Render the current approvals content inside `ActionCenterShell`.
- Canonicalise the route to `/action/approvals`.
- Rename the sidebar item from `Pending Approval` to `Approvals`.
- Remove duplicate page-level navigation that the shell now owns.
- Keep type, health, reviewed-date, and status filters server-side before pagination.

### 8.3 Approval Center legacy page

The current card hub is replaced by the Action Center Overview. Any source-specific queue that is not adapted into `/api/approvals` remains linked from the Overview with an explicit label such as `Open pharmacy approval queue`; it must not be presented as part of the unified approval count until its adapter is implemented.

## 9. Persistent Exceptions

Calculated alerts must become persistent operational cases.

### 9.1 Tables

#### `admin_exception_cases`

- `id`
- `tenant_id`
- `rule_key`
- `fingerprint`
- `source_type`
- `source_id`
- `module`
- `severity` (`critical`, `warning`, `info`)
- `title`
- `description`
- `status` (`open`, `acknowledged`, `in_progress`, `snoozed`, `resolved`, `dismissed`)
- `assigned_to`
- `first_detected_at`
- `last_detected_at`
- `acknowledged_by`, `acknowledged_at`
- `resolved_by`, `resolved_at`, `resolution_code`, `resolution_note`
- `dismissed_by`, `dismissed_at`, `dismissal_reason`
- `snoozed_until`
- `metadata_json`
- `created_at`, `updated_at`

Unique tenant-scoped key: `(tenant_id, rule_key, fingerprint)`.

#### `admin_exception_events`

- case ID
- tenant ID
- event type
- actor ID
- old status
- new status
- note
- metadata JSON
- created timestamp

### 9.2 Detector contract

Rule detectors produce normalized observations:

```ts
interface ExceptionObservation {
  ruleKey: string;
  fingerprint: string;
  sourceType: string;
  sourceId: string;
  module: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  sourceHref?: string;
  metadata?: Record<string, unknown>;
}
```

A synchronization service:

1. Upserts observed cases.
2. Updates `last_detected_at` and current metadata.
3. Reopens a previously resolved case only when the rule-specific reopening policy allows it.
4. Auto-resolves an open case when its source condition is no longer true and the rule is marked auto-resolvable.
5. Keeps dismissed false positives suppressed until the fingerprint changes or the dismissal expires.

### 9.3 Initial rules

- Stale cash handover
- High discount requiring investigation
- Same-day bill cancellation requiring review
- Low stock/expiry exceptions where the canonical inventory source supports stable IDs

Each rule must deep-link to the real source record.

### 9.4 Actions

- Acknowledge
- Assign to self
- Assign to another authorised user
- Start work
- Snooze with expiry
- Resolve with reason and note
- Dismiss as false positive with mandatory reason
- Reopen
- Open source record

All transitions use conditional updates and append an event in the same database batch.

## 10. Collections and Receivables

Receivables are operational collection cases, not approval requests.

### 10.1 Source of truth

The bill/invoice remains the financial source of truth. Collection records store workflow state, notes, ownership, promises, and escalation history; they do not duplicate the receivable balance.

### 10.2 Tables

#### `collection_cases`

- `id`
- `tenant_id`
- `source_type`
- `source_id`
- `party_type`
- `party_id`
- `status` (`new`, `contact_due`, `contacted`, `promised`, `disputed`, `escalated`, `write_off_requested`, `closed`)
- `assigned_to`
- `next_followup_at`
- `promise_date`
- `promise_amount`
- `latest_note`
- `last_contacted_at`
- `closed_at`
- `created_at`, `updated_at`

Unique tenant-scoped source key: `(tenant_id, source_type, source_id)`.

#### `collection_case_events`

- case ID
- event type
- actor ID
- note
- structured metadata
- created timestamp

### 10.3 Queue behaviour

The collections page provides:

- Accurate full-dataset totals and aging amounts.
- Server-side pagination, search, type, age, status, assignee, follow-up due, and amount filters.
- A detail drawer with invoice, patient/party, payment history, contact details, and collection timeline.
- Actions: record contact, set next follow-up, record promise to pay, mark dispute, escalate, collect payment, request write-off, and close when paid.

### 10.4 Unsupported source types

Do not show functional-looking IPD or corporate tabs unless the backend returns those source types. The UI may show a disabled capability with an explanation only when product communication requires it. Default implementation should derive available type filters from returned capabilities/data.

### 10.5 Payment collection

`Collect payment` deep-links to the canonical billing/due-collection workflow with the invoice preselected. Collection cases close automatically when the source due reaches zero.

### 10.6 Write-off control

`Request write-off` creates an approval request of type `receivable_write_off` with:

- source bill/invoice
- current due
- requested write-off amount
- reason code
- explanatory note
- evidence where required

Only an approved request may execute the financial write-off. Requester and approver separation of duties applies. Rejection returns the collection case to its previous actionable state with a timeline event.

## 11. Tasks

The existing tasks/follow-ups endpoint is adapted into the Action Center shell.

Required views:

- My tasks
- Team tasks
- Due today
- Overdue
- Completed

Task actions must persist status, assignee, due date, completion note, and timeline. If the existing source cannot support these states, implement the minimum schema extension rather than simulating state only in the frontend.

## 12. Review Moderation

Review Moderation remains a distinct marketplace/patient-experience workflow.

Changes:

- Move it from Action Center navigation to Patient Experience.
- Keep existing route as an alias.
- Replace browser prompts with a proper detail drawer/modal.
- Require a structured rejection reason and optional note.
- Show patient, rating, review, publication state, response, and moderation history.
- Keep approve/reject/reply permissions separate from operational exception permissions.

It does not contribute to Action Center operational counts unless a future product decision explicitly adds moderation tasks.

## 13. Dashboard Deep Links

Every `Action Required` card must link to a filtered actionable view:

- Receivable exposure → Collections, ordered by amount/risk.
- Discount audit → Exceptions filtered to discount rules or Approvals if a decision request exists.
- Cash variance → Approvals filtered to cash handover.
- Stale handover → Exceptions filtered to stale handover.
- Pending expense → Approvals filtered to expense.

A dashboard card must not say `Action Required` when the destination is read-only. Read-only insights use labels such as `Review report` instead.

## 14. API Design

### 14.1 Aggregation

- `GET /api/action-center/summary`

Returns counts and exposure grouped by workstream and user ownership. It must use the same eligibility logic as the queue endpoints.

### 14.2 Exceptions

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

### 14.3 Collections

- `GET /api/action-center/collections`
- `GET /api/action-center/collections/summary`
- `GET /api/action-center/collections/:id`
- `GET /api/action-center/collections/:id/events`
- `POST /api/action-center/collections/:id/contact`
- `PUT /api/action-center/collections/:id/follow-up`
- `PUT /api/action-center/collections/:id/promise`
- `PUT /api/action-center/collections/:id/dispute`
- `PUT /api/action-center/collections/:id/escalate`
- `POST /api/action-center/collections/:id/write-off-request`

Existing approval endpoints remain canonical for approval decisions.

## 15. Permissions and Audit

Define explicit permissions for:

- approval review
- exception acknowledge
- exception assign
- exception resolve
- exception dismiss
- collection view
- collection contact/update
- collection escalation
- receivable write-off request
- receivable write-off approval
- review moderation

Every mutation must:

1. Require tenant context.
2. Verify source record tenant ownership.
3. Use a conditional state transition.
4. Record actor, role, timestamp, previous state, new state, and note.
5. Return `409` for stale or invalid transitions.
6. Avoid exposing cross-tenant IDs through detail or event endpoints.

## 16. Error and Empty States

- Queue load failure: show cause-neutral message, retry button, and preserve current filters.
- Mutation failure: keep drawer open, retain entered notes, and show a recovery message.
- Permission failure: explain that the item is visible but action requires another role.
- Empty queue: state what is healthy and provide the most relevant navigation action.
- Unsupported source capability: explain that the source is not configured; do not show zero as if it were live data.
- Background synchronization failure: keep last known cases visible and show a stale-data indicator.

## 17. Migration and Backfill

1. Add exception case/event tables and indexes.
2. Add collection case/event tables and indexes.
3. Backfill collection cases only for currently open positive-due sources.
4. Run exception synchronization after migration rather than inserting guessed alerts in SQL.
5. Preserve all existing approval history.
6. Do not mutate financial balances during backfill.
7. Make migrations idempotent where supported by project conventions.

## 18. Testing Strategy

### 18.1 Backend integration

- Tenant isolation for all list, detail, event, and mutation routes.
- Exception fingerprint upsert and no-duplicate behaviour.
- Acknowledge, assignment, snooze, resolution, dismissal, reopen, and invalid transition tests.
- Auto-resolution when a source condition clears.
- Collections totals over the full dataset, independent of pagination.
- Contact, promise, dispute, escalation, and follow-up timeline tests.
- Write-off request creation and separation-of-duties approval tests.
- Collection auto-close after payment.
- Dashboard summary counts match queue eligibility.

### 18.2 Frontend component tests

- Canonical route and redirect behaviour.
- URL-backed filters and browser back restoration.
- Accessible tabs, tables, drawers, menus, and dialogs.
- Mobile card/table adaptation.
- Action loading, success, stale-state conflict, and permission failure.
- No dead buttons or unsupported tabs.
- Dashboard cards open the expected filtered queue.

### 18.3 End-to-end tests

- Admin reviews and approves an approval request.
- Admin acknowledges, assigns, and resolves an exception.
- Collector records contact and promise to pay.
- Collector requests write-off; separate approver approves it.
- Review moderator rejects a review with a structured reason.
- Legacy bookmarked URLs redirect without losing intent.

### 18.4 Quality gates

- Focused backend and frontend suites.
- Root TypeScript validation.
- Full web build and full monorepo build before deployment.
- Migration manifest build.
- `git diff --check`.
- Production smoke tests only after controlled deployment approval.

## 19. Delivery Phases

### Phase 1 — Shell and navigation

- Add canonical routes and redirects.
- Build `ActionCenterShell` and Overview.
- Embed the existing Approvals page.
- Move Review Moderation navigation.
- Correct dashboard deep links and read-only labels.

### Phase 2 — Persistent exceptions

- Add exception schema, detector synchronization, actions, timeline, and UI.
- Start with stale handover and existing risk rules.

### Phase 3 — Collections workflow

- Correct receivable API totals/pagination.
- Add collection schema and lifecycle.
- Add contact, promise, dispute, escalation, payment deep-link, and timeline.

### Phase 4 — Controlled write-off

- Add `receivable_write_off` approval type and execution path.
- Add maker-checker UI and audit evidence.

### Phase 5 — Tasks and moderation polish

- Adapt tasks into the shared shell.
- Complete Review Moderation drawer, structured reasons, and audit history.
- Run accessibility, responsive, and performance review.

## 20. Acceptance Criteria

The design is complete when:

1. Users see one Action Center concept, not two competing approval concepts.
2. Existing approval decisions remain auditable and functionally intact.
3. An alert can be acknowledged, assigned, resolved, dismissed, and reviewed in a timeline.
4. Resolved exceptions do not reappear unless their source condition genuinely recurs under the rule policy.
5. Receivables have actionable collection state and accurate full-dataset totals.
6. Write-offs require a separate approval and cannot be executed directly by a collector.
7. Unsupported receivable categories are not shown as live zero-data workflows.
8. Dashboard Action Required cards always open an actionable filtered queue.
9. Review Moderation is located under Patient Experience and uses structured dialogs.
10. All new routes are tenant-safe, permission-controlled, tested, responsive, and keyboard accessible.
