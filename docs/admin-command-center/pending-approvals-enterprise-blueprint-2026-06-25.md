# Admin Pending Approvals — Enterprise Review & Blueprint

Date: 2026-06-25
Project: Hms connect / Ozzyl HMS
Scope: Admin panel `action/pending-approvals`, `/api/approvals`, related approval queues.

## Executive summary

The current page is a good first version of an admin action center: it has KPI cards, status tabs, type tabs, search, row detail drawer, single approve/reject, and limited bulk review. However, it is not yet enterprise-grade because approvals are not truly centralized, the backend type model is narrower than the UI, risk/SLA logic is mostly frontend-derived, policy configuration is disconnected from review execution, and some high-risk financial/clinical actions lack consistent maker-checker, audit, escalation, attachment, and idempotent execution guarantees.

Enterprise-level HMS approval centers should work like a controlled command queue: all approval sources feed one normalized inbox; policies decide who can approve, whether one or two approvers are needed, whether attachment/notes are mandatory, what SLA applies, and what exact side effect will run; every decision is immutable, attributable, searchable, and exportable for audit.

## Current implementation map

### Frontend

- Route: `web/src/App.tsx` -> `action/pending-approvals`
- Main page: `web/src/pages/admin/PendingApprovals.tsx`
- Detail drawer: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Dashboard alert: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Pharmacy has separate approval queue: `web/src/pages/pharmacy/ApprovalQueuePage.tsx`
- Local schema destructive approvals have separate UI: `admin-panel/src/pages/LocalSchemaSync.tsx`

### Backend

- Core route: `src/routes/tenant/approvals.ts`
- Schema validation: `src/schemas/approval.ts`
- DB schema: `src/db/schema/approval-requests.ts`, migration `migrations/0279_approval_billing_shift_tables.sql`
- Admin policy read endpoint exists: `GET /api/admin/approval-policies`
- Separate approval-like sources also exist:
  - Pharmacy GRN/write-off approvals
  - Stock adjustment approvals
  - Cash variance / billing handover final verification
  - Local schema sync destructive approvals
  - Credit note approval flow
  - Settlement discount approval guard

## Enterprise comparison baseline

An enterprise approval center should include:

1. Centralized approval inbox across billing, reception cash, pharmacy, inventory, HR, accounting, lab, clinical, local-server operations.
2. Policy-driven routing by type, amount, department, risk, branch, requester role, payment mode, patient category, and working/non-working hours.
3. Maker-checker / separation of duties: requester cannot approve; collector cannot verify their own handover; same person cannot create and approve high-risk financial reversal.
4. Multi-level approval for high-value or high-risk items: manager -> finance/admin -> MD/director.
5. SLA and escalation: due time, overdue state, escalation target, notification trail.
6. Required evidence: attachments, receipt photo, before/after diff, bill/payment links, cash drawer snapshot, stock snapshot, patient/admission context.
7. Risk scoring produced by backend, not only UI.
8. Atomic, idempotent approval side effects with transaction/audit/event consistency.
9. Immutable audit trail: who, role, IP/device, time, before/after, reason, decision, policy matched, side effect result.
10. Secure access: least privilege, deny-by-default, per-request permission check, branch/tenant scope, and approval permission granularity.
11. Operational UX: priority queue, filters, saved views, detail comparison, warnings, duplicate detection, reassignment/escalation, audit export.
12. Reporting: approval aging, rejection reasons, requester pattern, approver workload, high-discount trends, cash variance trends.

## Problems found

### P0 — Must fix before enterprise use

1. UI approval types do not match backend schema.
   - UI includes `expense`, `stock_adjustment`, `doctor_payout`, `manual_adjustment`, `bill_cancellation`.
   - Backend schema only accepts: `bill_edit`, `bill_cancel`, `discount`, `refund`, `payment_void`, `cash_handover`.
   - Query schema also rejects unsupported `type` filters.
   - Result: the page looks broader than the actual `/api/approvals` system.

2. DB migration check constraint is older than current schema.
   - Migration `0279` table check allows only `bill_edit`, `bill_cancel`, `discount`, `refund`.
   - Later code uses `payment_void` and virtual `cash_handover`.
   - This can break inserts in environments where the CHECK constraint is active.

3. Approval queues are fragmented.
   - Core `approval_requests` does not include pharmacy GRN, pharmacy write-off, stock adjustment, schema sync approvals, credit notes, etc.
   - Admin page gives impression of one approval center but many approval items live in separate endpoints/pages.

4. Bulk approval is unsafe for enterprise high-risk actions.
   - Bulk approve exists for all non-cash-handover items in the visible list.
   - There is no policy saying which approval types are bulk-safe.
   - High-risk financial reversals/cancellations should not be bulk-approved without type-specific confirmation and notes.

5. Review update is not fully atomic with side effects.
   - Side effect runs before status update for executable types.
   - If side effect succeeds but approval status update fails, state can become inconsistent.
   - D1 batch is used in parts, but the whole review action is not modeled as an idempotent approval execution state machine.

6. Status race condition risk.
   - Single review fetches pending then updates by `id` only.
   - Safer update should include `WHERE id = ? AND tenant_id = ? AND status = 'pending'` and verify changed row count.
   - Bulk has similar race concerns when multiple admins act on same queue.

7. Policy endpoint exists but is not connected to the approval workflow.
   - `/api/admin/approval-policies` lists policies, but core review route does not appear to enforce policy required role, threshold, attachment, SLA, escalation, or multi-level approval.

8. Cash handover is virtual, not normalized into approval_requests.
   - `/api/approvals` appends handover rows from `billing_handovers` to the result list.
   - Single approve sends handover to `/api/billing-counter/handovers/:id/admin-verify`.
   - This split is acceptable as a bridge, but not ideal for enterprise audit/reporting because it creates two approval models.

### P1 — High priority gaps

9. Backend does not return normalized display fields.
   - UI infers requestedBy, department, amount, risk, context, reference from arbitrary JSON keys.
   - Enterprise-grade queue should return a stable shape: `title`, `summary`, `amount`, `currency`, `riskScore`, `riskReasons`, `requester`, `department`, `branch`, `patient`, `entity`, `policy`, `sla`.

10. Risk scoring is hardcoded in frontend.
    - Example: amount >= 10000 high, >= 3000 medium, cash variance high.
    - Risk should be backend-calculated based on hospital policy, action type, amount, variance percentage, repeat requester, unusual hour, missing attachment, and critical module.

11. SLA/aging is basic.
    - UI only has `olderThan24h`.
    - Enterprise systems need due time, SLA remaining, overdue severity, escalation stage, last notified time.

12. Approver permission is too broad by role.
    - `hospital_admin`, `md`, `director`, `manager`, `accountant` can review all core approval types.
    - Need granular permissions: `approvals:billing_discount:approve`, `approvals:cash_handover:verify`, `approvals:payment_void:approve`, `approvals:pharmacy_writeoff:approve`, etc.

13. Notes are optional for approval.
    - Reject requires note, approve does not.
    - For high-risk approval, note/comment should be mandatory, especially bill cancellation, payment void, refund, cash variance, stock write-off, backdated changes.

14. Attachment handling is passive.
    - Drawer can show `attachmentUrl`, but route does not enforce attachment required based on policy.
    - For expenses, bank deposit proof, refund, high discount reference, stock write-off, and cash variance, attachment/evidence should be policy-enforced.

15. No multi-level approval state.
    - Current statuses are only pending/approved/rejected.
    - Enterprise needs `pending_l1`, `pending_l2`, `escalated`, `approved_pending_execution`, `executed`, `execution_failed`, `cancelled`, `expired`.

16. No assignment / claim mechanism.
    - Multiple admins may act on same item.
    - Need `assigned_to`, `claimed_by`, `claimed_at`, `lock_expires_at`, and reassignment.

17. No requester pattern intelligence.
    - Drawer supports `previousRequests` but backend does not populate it.
    - Need previous approvals/rejections, total amount, repeat high-discount, repeat voids, variance history by cashier.

18. No direct entity deep-links.
    - Detail drawer should open bill, patient, payment, cash session, stock item, GRN, expense, bank deposit, journal entry.

19. Pagination is incomplete in UI.
    - Backend returns pagination; UI hardcodes `limit=100` and does not render pagination/infinite scroll.
    - Search/filter is client-side only over the first 100 rows.

20. Count and list may disagree.
    - `/counts` includes pending final handovers; list appends handovers only on pending/all and cash_handover/all. Separate sources are excluded.
    - UI KPI summary can be derived from current page, not full dataset.

21. Query keys are not filter-complete.
    - `queryKeys.approvals.list(undefined, statusView)` does not include type/page/search, increasing cache collision risk when filters are added.

22. Local time handling is inconsistent.
    - Many SQL statements use `datetime('now', '+6 hours')`.
    - Better enterprise pattern: store UTC timestamps, render Asia/Dhaka in UI, and include timezone explicitly in reports.

### P2 — UX/reporting/maintainability gaps

23. Type labels and status labels are partly hardcoded English.
24. No saved filters: finance view, MD view, cash-only view, high-risk view.
25. No keyboard shortcuts or quick triage mode.
26. No reviewer checklist per type.
27. No compare preview for bill edit/cancel beyond raw JSON.
28. No before/after impact projection for accounting ledger, stock ledger, cash drawer, patient dues.
29. No reason taxonomy: wrong bill, duplicate entry, patient refund, doctor discount, reference discount, cash shortage, stock damage, expiry, etc.
30. No approval export PDF/CSV for daily/monthly audit.
31. No notification center integration for SLA breach or escalation.
32. No feature flag / tenant-level rollout for new approval types.
33. No policy simulator/test page for admins.
34. No failure recovery screen for `execution_failed` approvals.
35. No tamper-evident approval event chain beyond general audit logs.

## Target architecture

### Unified approval tables

Create a normalized enterprise approval model:

```sql
approval_requests_v2 (
  id,
  tenant_id,
  branch_id,
  module,
  type,
  action,
  entity_type,
  entity_id,
  entity_no,
  title,
  summary,
  amount,
  currency,
  risk_score,
  risk_level,
  risk_reasons_json,
  requested_by,
  requested_role,
  requested_department,
  requested_at_utc,
  status,
  current_step,
  required_steps_json,
  assigned_to,
  claimed_by,
  claimed_at_utc,
  due_at_utc,
  escalated_at_utc,
  policy_id,
  policy_snapshot_json,
  payload_json,
  old_value_json,
  new_value_json,
  evidence_required,
  evidence_status,
  idempotency_key,
  execution_status,
  execution_error,
  executed_at_utc,
  created_at_utc,
  updated_at_utc
)
```

```sql
approval_decisions (
  id,
  approval_id,
  step_no,
  decision,
  decided_by,
  decided_role,
  decided_at_utc,
  notes,
  ip_address,
  user_agent,
  device_id,
  mfa_verified,
  policy_snapshot_json
)
```

```sql
approval_events (
  id,
  approval_id,
  event_type,
  actor_user_id,
  event_at_utc,
  event_data_json,
  hash_prev,
  hash_current
)
```

```sql
approval_evidence (
  id,
  approval_id,
  file_url,
  file_type,
  file_hash,
  uploaded_by,
  uploaded_at_utc,
  verification_status
)
```

### Canonical type list

Core financial:
- `discount_approval`
- `bill_edit`
- `bill_cancel`
- `payment_void`
- `refund`
- `credit_note`
- `settlement_discount`
- `manual_journal_adjustment`

Cash/reception:
- `cash_handover`
- `cash_variance`
- `cash_drop`
- `bank_deposit`
- `counter_force_close`
- `drawer_transfer`

Pharmacy/inventory:
- `grn_approval`
- `purchase_order_approval`
- `stock_adjustment`
- `stock_writeoff`
- `expired_stock_disposal`
- `narcotic_stock_adjustment`

HR/admin:
- `leave_request`
- `payroll_adjustment`
- `user_role_change`
- `permission_grant`

Clinical/operations:
- `critical_result_override`
- `discharge_clearance_override`
- `clinical_record_amendment`
- `patient_merge_unmerge`
- `schema_destructive_change`

## Policy engine blueprint

Policy fields:

- `type`
- `module`
- `condition_json`
- `risk_formula_json`
- `required_steps_json`
- `allowed_approver_roles_json`
- `denied_same_user_roles_json`
- `attachment_required`
- `approval_note_required`
- `mfa_required`
- `sla_minutes`
- `escalation_chain_json`
- `bulk_allowed`
- `active_from`, `active_to`

Example policies:

- Discount 0–10%: reception can apply directly if reference recorded.
- Discount >10% or amount > 1,000: manager approval required.
- Discount >20% or amount > 5,000: admin/MD approval required, note + reference required.
- Payment void: accountant/admin approval, note required, no bulk.
- Paid bill cancellation: create credit note approval instead of direct cancellation.
- Cash variance non-zero: receiver verification + admin final verification; approver cannot be cashier or receiver.
- Stock write-off above threshold: pharmacy manager + admin approval, evidence required.
- User role change/admin permission grant: two-person approval + MFA.

## UI blueprint

### Page layout

Header:
- Title: Approval Center
- Subtitle: Pending, overdue, high-risk, and reviewed decisions.
- Actions: Export, Policy Settings, Audit Report, Refresh

KPI row:
- Total Pending
- High Risk
- Overdue
- Due in 1 hour
- Cash/Finance Pending
- Execution Failed
- Approved Today
- Rejected Today

Left filters:
- Status
- Module
- Type
- Branch
- Department
- Risk
- SLA
- Amount range
- Requester
- Assigned to me
- Missing evidence
- Execution failed

Main queue table columns:
- Priority
- SLA / age
- Type
- Reference
- Patient / entity
- Requester
- Department / branch
- Amount / variance
- Risk reasons
- Required approval step
- Evidence
- Status
- Actions

Detail drawer sections:
1. Decision summary
2. Policy matched and required approver
3. Financial/operational impact
4. Before/after diff
5. Evidence checklist
6. Entity deep links
7. Requester history
8. Approval timeline
9. Execution result
10. Decision box with note, checklist, MFA when required

### Bulk rules

Bulk action should be allowed only when:
- policy.bulk_allowed = true
- all selected items are same type and same risk class
- no item requires attachment review, MFA, or second-level approval
- no financial reversal/cancellation/void/refund/cash variance is included
- reject always requires shared reason + optional per-item reason

## Backend/API blueprint

### Endpoints

- `GET /api/approval-center/summary`
- `GET /api/approval-center/requests?status=&type=&module=&risk=&sla=&page=&limit=&search=`
- `GET /api/approval-center/requests/:id`
- `POST /api/approval-center/requests`
- `POST /api/approval-center/requests/:id/claim`
- `POST /api/approval-center/requests/:id/release`
- `POST /api/approval-center/requests/:id/decision`
- `POST /api/approval-center/bulk-decision`
- `GET /api/approval-center/policies`
- `POST /api/approval-center/policies/simulate`
- `GET /api/approval-center/audit-export`
- `GET /api/approval-center/metrics`

### Normalized response shape

```json
{
  "id": 123,
  "type": "payment_void",
  "module": "billing",
  "title": "Void receipt RCP-00042",
  "summary": "Reverse cash payment for bill INV-00091",
  "entity": { "type": "payment", "id": 42, "no": "RCP-00042" },
  "patient": { "id": 9, "name": "...", "uhid": "..." },
  "amount": 1500,
  "currency": "BDT",
  "risk": { "level": "high", "score": 82, "reasons": ["payment reversal", "cash drawer affected"] },
  "requester": { "id": 5, "name": "...", "role": "reception" },
  "policy": { "id": 7, "name": "Payment void approval", "steps": 1, "noteRequired": true, "mfaRequired": false, "bulkAllowed": false },
  "sla": { "dueAt": "2026-06-25T10:00:00Z", "status": "overdue", "minutesOverdue": 45 },
  "evidence": { "required": true, "status": "missing" },
  "status": "pending_l1",
  "isActionableByCurrentUser": true,
  "actions": ["approve", "reject", "request_more_info", "claim"]
}
```

## Implementation phases

### Phase 1 — Stabilize current page

1. Align type enum across DB, backend schema, frontend tabs.
2. Add missing migration for approval type expansion.
3. Fix review update with conditional pending update.
4. Add branch/tenant scoped query indexes: `(tenant_id, status, created_at)`, `(tenant_id, status, type, created_at)`.
5. Return backend summary instead of frontend summary fallback.
6. Disable bulk approve for high-risk/executable financial types.
7. Make approval note mandatory for bill_cancel, payment_void, refund, cash_handover variance.
8. Add pagination/infinite scroll and server-side search.

### Phase 2 — Normalize approval center

1. Build `approval_center` service adapter that reads from core approval_requests + cash handovers + pharmacy + stock + schema sync.
2. Normalize all sources into one response shape.
3. Add detail endpoint with entity links and requester history.
4. Add SLA/risk backend calculation.
5. Add evidence requirement flags.
6. Add `assigned_to/claimed_by` behavior.

### Phase 3 — Policy-driven approvals

1. Extend `approval_policies` schema.
2. Enforce policy at request creation and review.
3. Add multi-level approval status.
4. Add escalation jobs/notifications.
5. Add policy simulator UI.
6. Add per-type reviewer checklist.

### Phase 4 — Enterprise audit/reporting

1. Add immutable `approval_events` chain.
2. Add audit export PDF/CSV.
3. Add approval aging dashboard.
4. Add anomaly reports: repeat requester, repeat void, high-discount trend, cash variance trend.
5. Add execution failed recovery page.
6. Add backup/retention policy for approval logs and evidence.

## Acceptance criteria

- Admin can see all pending approval items from billing, cash, pharmacy, inventory, HR, accounting, lab, and local-server destructive changes in one queue.
- Every row shows risk, SLA, policy, requester, amount, evidence, and entity context.
- Current user sees only approvals they are authorized to approve.
- Requester cannot approve own request.
- Cash handover requester/receiver cannot final-verify the same handover unless a break-glass policy is used and audited.
- High-risk approvals cannot be bulk-approved.
- Payment void/bill cancel/refund/cash variance approval requires notes.
- Review execution is idempotent and cannot be double-run.
- Audit trail includes who/what/when/where/why/policy/side-effect.
- Approved/rejected history can be searched, filtered, and exported.

## Recommended immediate coding tasks

1. Update `src/schemas/approval.ts` type enum to include all intended central approval types, or remove unsupported UI tabs until adapters are ready.
2. Add migration to relax/expand `approval_requests.type` constraints.
3. Add server-side summary endpoint for pending approvals.
4. Add conditional review update and result check.
5. Restrict bulk review to low-risk, non-executable, policy-approved approval types.
6. Add `review_requires_note(type, risk)` helper.
7. Add stable normalized fields to `/api/approvals` response.
8. Add tests for type mismatch, bulk restrictions, self-approval, race conditions, and side-effect idempotency.
