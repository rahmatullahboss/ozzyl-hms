# Two-Person Approval with Optional Supporting Evidence

**Status:** Backlog / implementation-ready specification  
**Recorded:** 2026-07-19  
**Requested by:** Product owner  
**Primary surfaces:** Pending Approvals, Approval Detail Drawer, approval APIs and audit trail

## 1. Problem

The current approval experience can block approval when supporting evidence is missing. The UI displays messages such as:

- `Evidence: Missing`
- `Approval is blocked until the highlighted issue is resolved.`
- `Supporting evidence is required before quick approval.`

For this hospital workflow, an authorized executive approver must be able to approve a request even when no supporting document is attached. The compensating control is mandatory two-person approval.

A request must not become fully approved after one approval. The first valid approval moves it to **Partially Approved**. A second, distinct authorized approver must approve before it becomes **Fully Approved** and any approved business action may execute.

## 2. Product Decision

1. Supporting evidence is **recommended but optional** for authorized approval roles.
2. Missing evidence must be shown as a warning, not a hard blocker.
3. Every configured pending request requires **two distinct approvers**.
4. First approval status: `partially_approved`.
5. Second approval status: `fully_approved`.
6. The same user cannot provide both approvals.
7. The requester cannot approve their own request unless a future tenant policy explicitly enables self-approval. Default is prohibited.
8. Approved business execution must occur only after the second approval.
9. Rejecting the request at any stage moves it to `rejected` and prevents further approval.
10. Request Info may move the request to `info_requested`; previous approval history remains immutable, but whether prior approvals remain valid after resubmission must be controlled by policy. Default: prior approvals are invalidated after material request changes.

## 3. Eligible Approvers

Default eligible roles:

- `hospital_admin`
- `md`
- `director`
- `ceo`, if the tenant has this role

The backend must enforce eligibility. Hiding or showing a frontend button is not sufficient authorization.

Tenant configuration should eventually support an allowlist, for example:

```json
{
  "requiredApprovalCount": 2,
  "eligibleRoles": ["hospital_admin", "md", "director", "ceo"],
  "evidenceRequired": false,
  "requesterMayApprove": false,
  "resetApprovalsOnMaterialChange": true
}
```

For the initial implementation, the required count is fixed at two unless an existing approval-policy system can store this safely.

## 4. State Machine

### Allowed states

- `pending`
- `partially_approved`
- `fully_approved`
- `info_requested`
- `rejected`
- `execution_failed`, where supported by the current approval engine
- `cancelled`, where supported

### Transitions

| Current state | Action | Result |
|---|---|---|
| `pending` | First valid approval | `partially_approved` |
| `partially_approved` | Second valid approval by another user | `fully_approved` |
| `pending` | Reject | `rejected` |
| `partially_approved` | Reject | `rejected` |
| `pending` | Request Info | `info_requested` |
| `partially_approved` | Request Info | `info_requested` |
| `info_requested` | Requester resubmits materially changed request | `pending`, approval count reset |
| `fully_approved` | Execute approved operation | Existing execution workflow |

A second approval must be recorded and the transition to `fully_approved` must be atomic.

## 5. Evidence Behaviour

### Required UI behaviour

When no evidence exists:

- Show `Evidence: Missing` or `No evidence attached` as a warning.
- Do not disable the Approve button solely because evidence is missing.
- Show a confirmation message before approval:
  - `No supporting evidence is attached. Your approval will be recorded as one of two required approvals.`
- Keep `Request Info` and `Reject` available.

When evidence exists:

- Display the evidence normally.
- Do not change the two-approver requirement.

Quick approval may be allowed without evidence only when the same backend eligibility and two-person rules are enforced. The frontend must never convert a first quick approval directly to fully approved.

## 6. Approval Records and Database Requirements

Do not represent two approvals using only one mutable `approved_by` column. Preserve each decision as an immutable event/record.

The implementation should use the current approval-event model where possible. Each approval record needs at least:

- tenant ID
- request/approval ID
- approver user ID
- approver role at decision time
- decision: `approved`, `rejected`, or `info_requested`
- decision timestamp
- optional comment
- evidence-present boolean or evidence snapshot metadata
- request revision/version
- idempotency key

Database constraints or transactional checks must guarantee:

- One effective approval per approver per request revision
- Two approvals must come from two distinct users
- Tenant isolation
- No approval after rejection/cancellation
- No third approval changing an already fully approved request
- No duplicate execution

Recommended uniqueness:

```text
UNIQUE (tenant_id, approval_request_id, request_revision, approver_user_id, decision)
```

The exact constraint should match the existing schema and event semantics.

## 7. Atomic Approval Algorithm

Inside one transaction or D1 batch-safe operation:

1. Load the request for the authenticated tenant.
2. Confirm current status is approvable.
3. Confirm the current user has an eligible role.
4. Confirm the current user is not the requester, by default.
5. Confirm this user has not already approved this request revision.
6. Insert the immutable approval event using an idempotency key.
7. Count distinct valid approvals for the current revision.
8. If count is one, set request status to `partially_approved`.
9. If count reaches two, set status to `fully_approved`.
10. Trigger the approved business operation only after the fully-approved transition.
11. Record audit events for both the decision and any downstream execution.

Concurrency requirement: two approvers submitting at nearly the same time must result in exactly two events, one fully-approved transition and at most one downstream execution.

## 8. API Contract

The approval mutation response should include:

```json
{
  "requestId": "...",
  "status": "partially_approved",
  "requiredApprovalCount": 2,
  "currentApprovalCount": 1,
  "remainingApprovalCount": 1,
  "approvedByCurrentUser": true,
  "evidencePresent": false,
  "executionTriggered": false
}
```

After the second approval:

```json
{
  "requestId": "...",
  "status": "fully_approved",
  "requiredApprovalCount": 2,
  "currentApprovalCount": 2,
  "remainingApprovalCount": 0,
  "approvedByCurrentUser": true,
  "evidencePresent": false,
  "executionTriggered": true
}
```

Use `executionTriggered: false` if the request type requires a separate execution job, but the response and audit record must state that clearly.

Expected errors:

- `403`: user role cannot approve
- `409`: same user already approved
- `409`: requester cannot self-approve
- `409`: request already fully approved/rejected/cancelled
- `409`: request revision changed during approval
- `422`: malformed decision/comment payload

Missing evidence must not produce an approval-blocking error under this policy.

## 9. Frontend Requirements

Primary files likely affected:

- `web/src/pages/admin/PendingApprovals.tsx`
- `web/src/components/admin/ApprovalDetailDrawer.tsx`
- `web/src/pages/admin/PendingApprovals.test.tsx`
- `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Backend approval routes and approval-event service used by `/api/approvals`

Display requirements:

- `Pending` badge before any approval
- `Partially Approved (1/2)` after the first approval
- `Fully Approved (2/2)` after the second approval
- Show first approver name/role/time where permissions allow
- Show `Waiting for one more approver`
- Disable approval only for the same first approver, requester, unauthorized role or terminal state—not merely for missing evidence
- Preserve Reject and Request Info actions according to permission policy
- Refresh counts and status after mutation without requiring a full page reload

## 10. Audit and Reporting

Audit log must show:

- Request creation
- Evidence attached or absent at each approval decision
- First approval and resulting partial status
- Second approval and resulting full status
- Approver identities and roles
- Request Info/rejection events
- Any request revision that reset prior approvals
- Downstream execution result

Reports should distinguish:

- Pending: 0/2
- Partially approved: 1/2
- Fully approved: 2/2
- Rejected
- Information requested
- Execution failed

## 11. Security Rules

- All checks are server-side and tenant-scoped.
- Do not trust role, approval count or evidence state supplied by the browser.
- Do not allow one account to approve twice through retries, multiple tabs or different endpoints.
- Do not allow bulk approval to bypass the two-person rule.
- Bulk approval by one user contributes only one approval to each request.
- Approval events are immutable; corrections require a new audited event.
- Protect against stale revisions and TOCTOU races.
- Existing handover, expense and specialized approval mutation paths must receive equivalent enforcement or be explicitly excluded with documented reasoning.

## 12. Testing Requirements

### Backend

- First approver creates `partially_approved`, not fully approved
- Second distinct approver creates `fully_approved`
- Same approver cannot approve twice
- Requester cannot self-approve by default
- Unauthorized role cannot approve
- Missing evidence does not block an authorized approval
- Evidence-present request still requires two approvals
- Concurrent approvals result in one full transition and one execution
- Duplicate/idempotent retries do not duplicate events or execution
- Rejected and terminal requests cannot be approved
- Material resubmission invalidates prior approvals under default policy
- Tenant isolation is enforced

### Frontend

- Missing-evidence warning is visible but approval remains available to an eligible user
- First approval renders `Partially Approved (1/2)`
- First approver cannot provide the second approval
- Another eligible approver can provide the second approval
- Fully approved renders `Fully Approved (2/2)`
- Request Info and Reject remain usable as designed
- Bulk actions do not bypass dual approval

### End-to-end

Use two separate authorized accounts:

1. Create a request with no evidence.
2. First account approves; verify partial status and no business execution.
3. Same account attempts again; verify rejection.
4. Second account approves; verify full status and exactly one execution.
5. Verify immutable audit trail.

## 13. Migration and Rollout

Before migration, define how existing records map:

- Existing `pending` remains `pending` with 0/2.
- Existing approved/executed historical records remain historical and must not be retroactively reopened.
- Existing in-progress records with one recorded approver may map to `partially_approved` only when that approval event can be proven.

Rollout behind a tenant-scoped feature flag or approval-policy version. Start with a non-critical request type, then expand after audit and concurrency validation.

## 14. Acceptance Criteria

The feature is complete only when:

- An authorized admin, MD, director or configured executive can approve without an attachment.
- Missing evidence remains visibly warned.
- The first distinct approval produces `Partially Approved (1/2)`.
- No downstream approved action executes after only one approval.
- A second distinct authorized approver produces `Fully Approved (2/2)`.
- The downstream action executes at most once.
- The same user cannot satisfy both approvals.
- All decisions and evidence state are auditable.
- All specialized approval paths and bulk actions obey the same rule or are explicitly excluded by approved scope.
