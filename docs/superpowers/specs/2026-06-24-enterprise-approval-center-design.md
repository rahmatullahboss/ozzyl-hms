# Enterprise Approval Center Design

## Goal

Turn the existing admin Pending Approvals page into a richer enterprise Approval Center while keeping the current route usable. The page should manage all hospital approval workflows from one place: pending reviews, approved requests, rejected requests, and historical audit context.

## Scope

This design covers the Approval Center UI and the approval-list API shape needed to power it. It focuses on request review, details, status/history visibility, and cash handover inclusion. It does not redesign every upstream module that creates approval requests, but the data model must support those modules sending richer metadata over time.

## Supported approval categories

The page should support these categories as first-class filters and badges:

- Discount
- Refund / credit note
- Bill cancellation
- Payment void
- Cash handover / cash closing final verification
- Expense approval
- Doctor payout
- Stock adjustment
- Manual accounting adjustment
- Future custom operational approvals

Cash handover should be visible in the same approval queue when a cashier closes or hands over cash and admin final approval is required. The row must show expected amount, counted amount, variance, cashier/receiver references, and status.

## Page structure

The page should keep the current sidebar entry and route, but the internal title and experience should behave like an Approval Center.

Primary regions:

1. Header: page title, short subtitle, quick refresh/status text.
2. KPI strip: pending, high-risk, stale, cash handover pending, approved today, rejected today.
3. Status tabs: Pending, Approved, Rejected, All History.
4. Type tabs: All plus every approval category.
5. Filter bar: search, type/status/date range, requester, department, amount range, high-risk, stale.
6. Approval table: dense but readable enterprise queue.
7. Detail drawer: full request context, timeline, evidence, and action controls.
8. Bulk action bar: only for safe pending items.

## Approval table columns

The table should show enough context without requiring the drawer for every row:

- Checkbox, when item is pending and bulk-review safe
- Request ID
- Type
- Priority/risk
- Requested by
- Department/source module
- Patient, invoice, bill, handover, or document reference
- Amount or cash variance context
- Age/submitted time
- Status
- Last reviewer/review time when not pending

For small screens, lower-priority columns can collapse, but ID/type/requester/reference/status must remain easy to scan.

## Detail drawer

Clicking any request should open a rich drawer. The drawer should include:

- Request summary: ID, type, status, risk, submitted time, requester, department.
- Financial context: amount, original amount, discount percent, expected/counted cash, variance, payment method, payout period, stock value, or adjustment value depending on type.
- Clinical/billing context where available: patient, invoice number, bill id, receipt number, service/test, doctor, visit/admission reference.
- Before/after values from `oldValue` and `newValue` in a readable diff-style section.
- Reason and notes.
- Attachments or receipt/document links when present.
- Timeline/history: requested, reviewed, approved/rejected, side effect completed, with reviewer and timestamp when available.
- Audit evidence: immutable request metadata and review notes without exposing secrets or unnecessary PHI.
- Actions: approve/reject with note for pending items only. Historical items are read-only.

## API design

The existing `/api/approvals` list endpoint should continue working, but it should enrich returned rows where practical:

- Parse `request_data` safely.
- Include cash handover final verifications in pending list when status is pending and type is absent/all/cash_handover.
- Support `status=pending|approved|rejected|all` for history views.
- Support optional `type`, `q`, `from`, `to`, `page`, and `limit` parameters.
- Include pagination totals by status.
- Include a normalized `display` object if needed by the frontend for reference label, amount, risk, requester label, and timeline.

The frontend should remain tolerant of older rows that only have raw `request_data`.

## Data and audit rules

Approval requests remain tenant-scoped. Review actions must continue to use audited review endpoints. No sensitive patient data, tokens, or sync payloads should be logged. The page can display contextual patient or invoice identifiers already authorized for admin review, but API logs must stay minimal.

## Design-system rules

The page should use the HMS design system rather than ad-hoc gray/blue styling:

- Cards use existing `card` classes and CSS variables.
- Buttons use `btn-primary`, `btn-secondary`, and destructive variants consistently.
- Badges should use token-compatible pastel styles.
- Drawer/table spacing should match current admin pages.
- Empty, loading, and error states should use shared components where possible.

## Testing plan

Add or update focused tests for:

- Pending, approved, rejected, and all-history status queries.
- Cash handover rows appearing in the approval queue.
- Nested amount extraction from legacy request data.
- Detail drawer showing before/after values and cash handover fields.
- Historical rows being read-only.
- Bulk action shown only for pending safe rows.
- Human-readable type labels, including cash handover.

## Incremental implementation plan

1. Stabilize current page on the latest main branch.
2. Add API tests for status/history and cash handover inclusion.
3. Enhance frontend mapping helpers for normalized metadata and nested fields.
4. Upgrade the Approval Center UI shell: status tabs, richer KPI cards, type tabs, filter bar.
5. Upgrade table columns and design-system styling.
6. Upgrade detail drawer for timeline, before/after values, cash handover details, and read-only history mode.
7. Run focused tests, frontend build, and merge only after verification.

## Out of scope for this slice

- Adding a full custom approval workflow builder.
- Migrating every upstream module to richer request metadata in one pass.
- Adding new database tables unless existing `approval_requests` and `billing_handovers` cannot support the minimum experience.
- Production deployment.
