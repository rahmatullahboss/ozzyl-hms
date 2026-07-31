# Executive Dashboard Due Control Design

**Date:** 2026-07-23
**Status:** Approved for implementation
**Target roles:** Hospital Admin, Managing Director, Director
**Primary workstream:** Executive dashboard + Unified Action Center collections
**Related program:** Controlled receivable write-off Phase 4

## 1. Problem

The executive dashboards show collection, cash, expense, and operational totals, but they do not provide a clear, actionable view of outstanding patient receivables. Management cannot quickly answer:

- how much money is currently outstanding;
- how many invoices make up that balance;
- which patients and invoices are responsible;
- how old each due is;
- which dues are promised, disputed, escalated, or waiting for follow-up;
- who is responsible for collection;
- what safe action is available next;
- whether a write-off has been requested, approved, rejected, or executed.

A number-only KPI is insufficient. Every executive amount must have a visible source, a drill-down path, and an auditable action boundary.

## 2. Goals

1. Add one shared due-control panel to the Hospital Admin, MD, and Director dashboards.
2. Reuse the existing Action Center collection-case query and live receivable authority; do not create a second due calculator.
3. Show full-dataset summary totals and a server-paginated list of the highest-risk open dues.
4. Give authorised users safe collection actions without allowing direct balance mutation from the dashboard.
5. Introduce write-off only as a controlled request-and-approval workflow.
6. Keep legacy, shadow, and canonical receivable modes compatible with the existing authority resolver.
7. Preserve tenant isolation, least privilege, auditability, idempotency, and accounting evidence.

## 3. Non-goals

- The dashboard will not directly decrement `bills.due` or canonical invoice balances.
- “Discharge with Due” is not a write-off and must remain a separate credit-discharge workflow.
- Discount, waiver, refund, cancellation, credit note, and write-off will not be merged into one ambiguous action.
- The dashboard will not create a second receivable source of truth.
- Phase 1 will not claim that a live receivable snapshot is a historical backdated balance.
- Shadow mismatch remediation is outside this feature; shadow evidence may be displayed but cannot alter the served balance.

## 4. Research and control basis

The design follows these principles:

- Receivable ageing should present total open exposure and ageing buckets with drill-down to the underlying transactions.
- A financial asset is written off only when there is no reasonable expectation of recovering all or part of it; a write-off is not a routine discount mechanism. This aligns with IFRS 9 paragraph 5.4.4.
- Sensitive financial actions require sequential server-side authorization, immutable transaction details, and revalidation at execution time.
- Separation of duties must prevent one person from requesting and finally approving the same write-off.
- Least-privilege and object-level authorization must be enforced on every tenant-scoped route.

## 5. Existing source of truth

The feature must use the existing collection stack:

- `GET /api/action-center/collections`
- `GET /api/action-center/collections/summary`
- `GET /api/action-center/collections/invoice/:sourceKey`
- `listCollectionCases(...)`
- `getLiveReceivable(...)`
- existing `CollectionQueueItem`, `CollectionSummary`, and authority-mode contracts
- existing approval engine for the future `receivable_write_off` request type

The legacy compatibility endpoint `/api/admin/due-receivables` remains supported, but the new panel should use the first-class Action Center API because it already supports status filters, ageing filters, sorting, pagination, collection status, and authority metadata.

## 6. Snapshot and date semantics

Outstanding due is a balance-sheet-style point-in-time exposure, not a selected-period income flow.

### Phase 1

- Default view: **All active open dues**.
- Data source: current live receivable authority.
- Label: **Live outstanding dues**.
- Display `lastRefreshedAt` so users do not mistake it for a historical period report.
- The dashboard start date must not be sent to the collection API because it would wrongly exclude older unpaid invoices.
- The selected dashboard range may not relabel live due as “due during this period”.

### Future historical snapshot

A historical “as of selected end date” mode may be added only when both legacy and canonical accounting projections can reliably reconstruct receivable balances at that date. Until then the UI must fail honestly rather than backdating current balances.

## 7. Panel information architecture

### 7.1 Header

- Title: `Outstanding Dues & Collection Control`
- Subtitle: `Live open patient receivables. Summary totals cover the full result set.`
- Live badge
- Last refresh timestamp
- Refresh action
- `View all dues` link to the canonical Action Center collection queue

### 7.2 Summary metrics

The panel displays:

1. Total outstanding due
2. Open invoice count
3. 0–7 day amount and count
4. 8–30 day amount and count
5. 31–60 day amount and count
6. 60+ day amount and count
7. Follow-up due count
8. Promised amount
9. Disputed amount
10. Shadow mismatch warning when non-zero

When multiple currencies exist:

- do not add different currencies into one false total;
- show `Multiple currencies` in the aggregate card;
- show per-currency totals from `amountsByCurrency`;
- rows always display their own `currencyCode`.

### 7.3 Preview table

Default query:

```text
status=active
sort=exposure
page=1
limit=8
```

Columns:

- Patient and contact
- Invoice
- Issued date
- Due amount
- Age / ageing bucket
- Collection status
- Promise or next follow-up
- Action menu

The preview must use server pagination. The dashboard initially displays eight rows; next/previous controls request the corresponding server page. Summary cards remain full-dataset totals and must not be recomputed from the eight visible rows.

### 7.4 Empty, loading, and error states

- Loading: stable skeleton preserving panel dimensions.
- Empty: `No active outstanding dues` with no alarming styling.
- Error: visible inline error with retry; never show a false zero total.
- Authority unavailable: show the server error and requested authority mode; do not silently fall back.

## 8. Row actions

### Available in the due panel

- View invoice / collection detail
- Open payment collection when the detail response reports `paymentCapability=available`
- Record contact
- Schedule follow-up
- Record payment promise
- Mark dispute
- Escalate
- Request write-off, only after Phase 4 capability is available

Dashboard actions should open the existing Collection Detail Drawer or deep-link to the Action Center queue. The dashboard must not duplicate the full workflow UI.

### Not available as direct dashboard actions

- Direct write-off execution
- Direct balance editing
- Direct credit note posting
- Self-approval
- Bulk write-off
- Silent status change

## 9. Write-off workflow

### 9.1 Request

The action label is `Request write-off`, never `Write off now`.

Required input:

- partial or full amount in integer minor units;
- live currency code;
- reason code;
- mandatory explanatory note;
- optional evidence references;
- acknowledgement that collection recovery is not reasonably expected for the requested amount.

Allowed reason codes:

- `uncollectible`
- `financial_hardship`
- `billing_dispute`
- `deceased`
- `administrative_adjustment`
- `other`

The server must load current due and currency; client-provided due is display-only and never authoritative.

### 9.2 Approval

- Requester and final approver must be different users.
- Approver must see invoice, patient reference, current due, requested amount, remaining due, reason, note, evidence, requester, and collection history.
- Approval revalidates live due, currency, authority mode, mapping, source status, and duplicate execution lock.
- Requested amount is never silently reduced. If live due is lower than the approved request, execution fails for review.
- Rejection does not close the collection case and produces no financial mutation.

### 9.3 Execution

Approved execution delegates to `ReceivableAdjustmentAuthority`:

- legacy mode: audited credit-note/accounting flow;
- shadow mode: legacy remains authoritative and canonical comparison is evidence only;
- canonical mode: canonical credit note, projection update, accounting/outbox evidence.

No route may directly run a bare balance decrement.

### 9.4 Result

- Full approved write-off closes the collection case as written off.
- Partial approved write-off leaves the remaining balance actionable.
- Every result links the approval, adjustment, invoice, collection case, requester, approver, previous due, applied amount, new due, currency, reason, and timestamps.

## 10. Authorization model

Capability checks must be permission-based and enforced by the backend. Role names are defaults, not sufficient authorization by themselves.

Proposed permissions:

- `receivables.view`
- `receivables.followup.manage`
- `receivables.payment.collect`
- `receivables.write_off.request`
- `receivables.write_off.approve`
- `receivables.write_off.audit`

Default role intent:

| Role | View | Follow-up | Collect | Request write-off | Approve write-off |
|---|---:|---:|---:|---:|---:|
| Hospital Admin | Yes | Yes | Policy based | Yes | Yes, except own request |
| MD | Yes | Yes | No by default | Yes | Yes, except own request |
| Director | Yes | Yes | No by default | Yes | Yes, except own request |
| Manager | Yes | Yes | Policy based | Yes | No by default |
| Accountant | Yes | Yes | Policy based | Yes | No by default |
| Auditor | Read/audit only | No | No | No | No |

Existing wildcard users must still pass the requester-versus-approver separation rule.

## 11. Audit and privacy

Audit events are required for:

- panel-sensitive state transitions initiated by a user;
- contact, promise, dispute, escalation, assignment, and follow-up changes;
- write-off request, information request, approval, rejection, execution attempt, execution failure, and execution success;
- credit note/accounting/outbox identifiers;
- previous and new due amounts.

Logs must minimize patient information. Routine application logs must not print patient names, mobile numbers, notes, or evidence contents.

## 12. Component design

Create a shared component:

```ts
<ExecutiveDuePanel
  role="hospital_admin" | "md" | "director"
  basePath={tenantBasePath}
  queryKeyScope="admin" | "md" | "director"
/>
```

Suggested files:

- `web/src/components/dashboard/ExecutiveDuePanel.tsx`
- `web/src/components/dashboard/ExecutiveDuePanel.test.tsx`
- `web/src/components/dashboard/executiveDuePanel.ts` for pure helpers only if needed

Reuse:

- `CollectionListResponse`
- `CollectionQueueItem`
- `CollectionSummary`
- `queryKeys.actionCenter.collections.list(...)`
- `formatCurrency(...)`
- existing Action Center status labels and drawer where practical

Do not create a dashboard-only copy of collection status rules.

## 13. Dashboard placement

### Hospital Admin

Place immediately after the top KPI summary and pending request section, before operational charts.

### MD

Place after `ExecutiveControlKpis`, before or immediately after `IPDBillingOverview`. Due exposure is a primary financial-control panel, not a lower-priority chart.

### Director

Place after `ExecutiveControlKpis`, before or immediately after `IPDBillingOverview` and ownership accounting sections.

The same component, query contract, totals, labels, and pagination rules must be used across all three dashboards.

## 14. API additions

Phase 1 requires no new due-calculation endpoint. Existing collection list and summary APIs are sufficient.

Phase 4 adds:

```text
POST /api/action-center/collections/invoice/:sourceKey/write-off-request
```

The existing approvals API handles review and execution through the new `receivable_write_off` type.

## 15. Testing requirements

### Frontend

- loads `status=active&sort=exposure&page=1&limit=8`;
- renders full summary separately from visible rows;
- paginates server-side;
- renders each row currency correctly;
- handles multiple currencies without false aggregation;
- shows ageing, status, promise, follow-up, and contact information;
- provides canonical `View all dues` navigation;
- supports Admin, MD, and Director placement;
- loading, empty, API error, authority error, and retry states;
- write-off request action is hidden or disabled until capability is available;
- keyboard and touch-target accessibility.

### Backend/write-off

- tenant isolation;
- role and permission matrix;
- requester cannot approve own request;
- positive safe integer amount and currency validation;
- request amount cannot exceed live due;
- duplicate pending request prevention;
- execution-time due/currency/mode/source revalidation;
- idempotent execution;
- partial and full write-off;
- rejection produces no financial mutation;
- credit-note, accounting, collection, approval, and audit evidence;
- legacy, shadow, canonical, missing-schema, and mapping-error behaviour.

## 16. Rollout

1. Ship read-only due panel first using existing Action Center APIs.
2. Verify parity between panel summary and full collection queue.
3. Add safe row actions that already exist in the collection drawer.
4. Implement controlled write-off Phase 4 behind capability checks.
5. Keep the write-off request control unavailable until migration, approval type, authority adapter, and tests are complete.
6. No production migration, main push, or deploy without separate authorization and the canonical-shadow deployment runbook.

## 17. Acceptance criteria

The feature is accepted when:

- Admin, MD, and Director see the same live due totals for the same tenant and refresh point;
- each displayed amount can be traced to invoices in the full collection queue;
- preview pagination does not change full-dataset summary totals;
- no error state appears as zero due;
- no dashboard action directly mutates a receivable balance;
- write-off requires a separate approver and produces complete financial and audit evidence;
- partial write-off preserves the remaining actionable due;
- Discharge with Due remains separate and never writes off the receivable;
- all focused tests, typecheck, build, and diff validation pass before integration.
