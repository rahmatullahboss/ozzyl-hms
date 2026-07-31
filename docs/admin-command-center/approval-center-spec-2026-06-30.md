# Approval Center Product Specification

Date: 2026-06-30
Project: Hms connect / Ozzyl HMS
Owner surface: Hospital admin / MD / Accounts / Manager
Primary route: `web/src/pages/admin/PendingApprovals.tsx`
Primary API: `src/routes/tenant/approvals.ts`

## 1. Purpose

Approval Center is the audited control room for sensitive hospital operations. It must centralize risky requests from billing, reception cash, accounting, inventory, pharmacy, and administration so an authorized reviewer can understand the full context, make a decision, and leave a reliable audit trail.

It is not only a pending-list page. It is a maker-checker workflow with policy, evidence, SLA, execution state, and immutable event history.

## 2. In-scope approval types

The Approval Center must support these normalized types:

- `discount`
- `refund`
- `expense`
- `bill_cancel`
- `payment_void`
- `cash_handover`
- `stock_adjustment`
- `doctor_payout`
- `manual_adjustment`
- `credit_note`
- `bill_edit`

Legacy aliases must continue to work:

- `bill_cancellation` -> `bill_cancel`
- `discount_approval` -> `discount`
- `cash_closing`, `cash_transfer_handover`, `shift_handover` -> `cash_handover`

## 3. Core business rules

### 3.1 Separation of duties

- A requester must not approve their own request.
- Bulk review must also block self-requested items.
- Cash handover final verification must be reviewed by someone other than the handover participants when possible.

### 3.2 Evidence rules

Evidence means a receipt, voucher, signed note, bank proof, denomination snapshot, stock photo, or equivalent supporting document reference in `request_data`.

Evidence is required for:

- `refund`
- `payment_void`
- `cash_handover`
- `expense`
- `stock_adjustment`
- `doctor_payout`
- `manual_adjustment`
- `credit_note`
- high-risk `bill_cancel`
- high-risk `discount`

If evidence is required and missing:

- show `Missing evidence` in the worklist
- show a warning in the detail drawer
- block quick approve
- require individual drawer review
- keep normal reject available so the approver can reject with notes

### 3.3 Risk rules

Default risk rules until tenant-configurable policy is fully enforced:

- Cash handover with non-zero variance: `high`
- Absolute approval amount >= 10,000: `high`
- Absolute approval amount >= 3,000: `medium`
- Otherwise: `low`

Risk reasons must be shown in human-readable form, such as:

- `Cash variance requires admin verification`
- `Amount is above high-risk threshold`
- `Refund requires maker-checker review`
- `Payment void requires audited reversal`

### 3.4 SLA rules

Default SLA:

- High risk: 4 hours
- Medium risk: 12 hours
- Low risk: 24 hours
- Cash handover: 2 hours
- Payment void/refund/bill cancellation: 4 hours
- Failed execution: immediate attention

The API should return an SLA due timestamp when the request has a usable `created_at`.

### 3.5 Side-effect execution

Approving a request may only run side effects through audited, idempotent execution logic.

Current side effects:

- `bill_cancel`: unpaid bill is cancelled; paid bill is converted into a pending credit note
- `payment_void`: original payment is preserved and a reversal entry is created
- `refund`: bill refund creates/uses credit note path or legacy payment reversal path

Future side effects:

- `expense`: mark approved and prepare accounting posting
- `stock_adjustment`: create inventory ledger movement
- `doctor_payout`: mark payout ready for payment
- `manual_adjustment`: apply controlled ledger/data correction
- `discount`: mark bill discount approved by authorized reviewer

## 4. UI requirements

### 4.1 Header

Display title as `Approval Center`, not only `Pending Approvals`.

Subtitle: `Manage pending approvals, evidence, SLA breaches, cash handovers, exceptions, and reviewed history from one audited workspace.`

### 4.2 KPI cards

Required KPI cards:

1. Total Pending
2. High Risk
3. Older than 24h / SLA Breached
4. Cash Handover
5. Missing Evidence
6. Failed Execution
7. Approved Today
8. Audit Ready / current filtered rows

### 4.3 Table columns

Required table columns:

- Request ID
- Type
- Reference / Context
- Requested By
- Department
- Amount / Variance
- Policy / Evidence
- Reason
- Submitted At / SLA
- Risk
- Status / Execution
- Actions

### 4.4 Detail drawer

Required drawer sections:

1. Request Summary
2. Financial / Cash Context
3. Operational Context
4. Policy & Evidence
5. Reason
6. Before / After Values
7. Supporting Document
8. Timeline / Audit Trail
9. Actions

### 4.5 Disallowed UI behavior

- No quick approve for high-risk, evidence-missing, cash handover, refund, payment void, bill cancellation, expense, stock adjustment, doctor payout, or manual adjustment.
- No approve without note for high-risk or note-required types.
- No delete/hide approval from UI.
- No raw JSON as the primary display.
- No bulk approve for unsafe types.

## 5. API response contract additions

`GET /api/approvals` should enrich each row with:

```ts
{
  approval_amount: number;
  approval_risk: 'low' | 'medium' | 'high';
  approval_note_required: boolean;
  bulk_approve_allowed: boolean;
  evidence_required: boolean;
  evidence_status: 'not_required' | 'provided' | 'missing';
  policy_reason: string;
  sla_minutes: number;
  sla_due_at: string | null;
  assigned_role: string;
  execution_status: 'not_required' | 'pending' | 'processing' | 'succeeded' | 'failed';
  execution_attempts: number;
}
```

`GET /api/approvals/summary` should include:

```ts
{
  totalPending: number;
  highPriority: number;
  olderThan24h: number;
  todayApproved: number;
  rejectedToday: number;
  cashHandoverPending: number;
  missingEvidence: number;
  executionFailed: number;
}
```

## 6. Acceptance criteria

- The Approval Center page displays evidence/SLA/policy information without requiring a DB migration.
- Missing-evidence requests are visible and filterable.
- Failed-execution requests are visible and filterable.
- Quick approve is blocked when evidence is missing.
- High-risk or note-required approvals still require drawer review.
- Backend list response returns policy/evidence/SLA metadata.
- Backend summary returns missingEvidence and executionFailed counts.
- Existing approval workflows and tests continue to pass.
