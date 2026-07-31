# Compact Refund Review Drawer Design

Date: 2026-07-23

## Goal

Reduce the refund approval drawer's visual height, repeated text, and cognitive load while preserving every decision-critical fact and keeping technical/audit details accessible on demand.

This is a frontend information-hierarchy change only. It does not change refund, cash-hold, dispute, collection, commission, approval, accounting, or counter-session behavior.

## Current Problems

The drawer repeats the same information across the summary card, decision checklist, request summary, financial context, operational context, policy/evidence, reason, and action sections. The result is a long review flow where important facts are harder to identify quickly.

Key issues:

- Requester, reference, status, risk, amount, patient, and invoice appear multiple times.
- Decision checklist overlaps with policy/evidence details.
- Refund amount appears in both the generic financial section and refund impact section.
- Approve, Request Info, and Reject actions are rendered twice.
- Item allocation and doctor commission rows are always expanded.
- Refund reason appears too far down the drawer.
- Long cash-state explanations occupy too much vertical space.

## Approved Approach

Use a compact default view with one expandable `More details` section.

### Default View

The default view shows only the information needed to decide:

1. **Compact header summary**
   - Approval type and request ID
   - Status and risk badges
   - Refund amount
   - Submitted time

2. **People and bill context**
   - Patient name
   - Invoice or bill reference
   - Requester and department

3. **Refund reason**
   - Prominent and close to the top
   - One concise card without a duplicate reason section later

4. **Cash state**
   - Held, consumed, disputed, released, or settled
   - Amount
   - One short operational sentence only when needed

5. **Financial impact summary**
   - Collection reduction
   - Resulting collection total when available
   - Doctor commission reduction
   - Blocking state when already-paid commission prevents approval

6. **Critical warning**
   - Render only one decision-blocking or evidence warning
   - Do not repeat the same warning in multiple sections

7. **Single action area**
   - Approve
   - Request Info when supported
   - Reject
   - Actions remain in the drawer action bar; the duplicate lower Actions section is removed

### More Details

The collapsed `More details` section contains:

- Item-wise refund allocation
- Doctor-wise commission breakdown
- Bill total, paid, and due
- Allocation mode and allocation error
- Approval progress and policy
- Evidence state, assigned role, SLA, and execution details
- Counter session, hold ID, credit note ID, and dispute identifiers
- Timeline and audit history
- Before/after raw values
- Previous requester approval history
- Supporting document link
- Information-request history

The section is collapsed by default for refund approvals and can be expanded without leaving the dashboard.

## Layout

- Keep the existing large drawer width.
- Reduce content padding and vertical spacing for refund approvals.
- Use a two-column compact summary on desktop and a single column on mobile.
- Use small metric cards for refund amount, cash state, collection impact, and commission impact.
- Avoid nested cards unless they communicate a distinct financial state.
- Item and commission rows use compact table-like rows rather than full cards.

## Conditional Rendering

- The compact layout applies specifically to `approval.type === 'refund'`.
- Other approval types retain their existing layout and behavior.
- Missing values are omitted where possible instead of rendering repeated `-` fields.
- Allocation or commission sections render only when data exists.
- A commission block or execution failure remains visible in the default view.
- Disputed cash remains visible in the default cash-state metric.

## Interaction

- `More details` is controlled by local component state.
- Opening a different approval resets `More details` to collapsed.
- Selecting Approve, Reject, or Request Info keeps the existing note-validation behavior.
- No navigation to a separate page is introduced.
- Accessibility:
  - Expand/collapse control uses `aria-expanded` and `aria-controls`.
  - Status is not communicated by color alone.
  - Action buttons retain visible labels.

## Testing

Update component tests to verify:

- Refund reason, patient, invoice, requester, amount, cash state, collection reduction, and commission reduction are visible by default.
- Duplicate generic sections and duplicate lower action buttons are absent for refund approvals.
- Item allocation, commission rows, policy, technical IDs, and timeline are hidden before expansion.
- Clicking `More details` reveals the advanced information.
- Critical commission or execution blockers remain visible while details are collapsed.
- Non-refund approval layouts remain unchanged.

## Out of Scope

- Backend response changes
- Refund calculation changes
- Cash-hold or counter-close changes
- Commission reservation or restoration changes
- Dispute settlement changes
- General redesign of all approval drawer types
