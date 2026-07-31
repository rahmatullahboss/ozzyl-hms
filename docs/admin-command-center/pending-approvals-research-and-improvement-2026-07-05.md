# Pending Approvals Research & Improvement Note — 2026-07-05

## Goal

Turn Admin Pending Approvals into a decision cockpit, not only a filtered table. The approver should quickly know what needs action, what is risky, what is blocked, what is ageing, what can be bulk-approved, and what evidence/audit trail supports each decision.

## Reference patterns reviewed

### Microsoft Power Automate Approvals

Power Automate surfaces approval work through an approvals center, email, and mobile app. A good approval request has a title, assigned approver, details, response, comments, and a downstream update back to the original record.

Ozzyl implication: comments and decision notes must be part of the visible audit trail, and the worklist should expose enough context to decide which item to open first.

### Jira Service Management Approvals

Jira approval setup defines when approval is required, who approves, who cannot approve, and what status transition happens after approve or decline. It also uses clear approve and decline transitions.

Ozzyl implication: the page should show policy trigger, assigned approval role, and safe boundaries for quick or bulk approval. High-risk or conflict-sensitive work should force individual review.

### Enterprise data-table UX

Enterprise data-table guidance emphasizes toolbar search/filter controls, pagination, selection, batch actions, row hover, inline actions, and progressive disclosure for dense data.

Ozzyl implication: use a strong toolbar, bulk actions only for safe rows, visible row actions, sticky headers, skeleton loading, and a details drawer for decision evidence.

## What best approval pages include

1. Queue summary: total pending, high risk, SLA breached, due soon, blocked, today approved/rejected, oldest pending, average age, and total pending value.
2. Triage lanes: escalate now, review now, standard review, and history.
3. Decision safety: risk badge, evidence status, policy trigger, assigned role, note-required indicator, and no quick approve for unsafe rows.
4. Worklist controls: status tabs, type filters, global search, health filters, clear filter state, and pagination.
5. Row content: request ID, type, reference/context, requester, department, amount/variance, policy/evidence, reason, SLA, risk, status, and actions.
6. Detail drawer: recommendation, checklist, financial/cash context, operational context, policy/evidence, info request status, before/after values, attachment, timeline, and required note handling.

## What should not be included

- No one-click approve for high-risk, missing-evidence, failed-execution, cash handover, refund, bill cancel, payment void, stock adjustment, doctor payout, credit note, manual adjustment, or expense requests.
- No bulk approve for risky or execution-backed requests.
- No hidden decision without notes where audit needs explanation.
- No table-only experience that hides queue urgency.
- No destructive action without explicit confirmation path.
- No noisy UI that makes every row equally urgent.

## Current Ozzyl HMS gaps found

- KPI cards exist, but queue health is not exposed as a true cockpit.
- Backend summary does not expose due-soon, blocked, actionable, oldest pending, average age, or total pending amount.
- Frontend fallback summary incorrectly uses fallback total as `todayApproved`.
- Filters do not include due soon or blocked even though the page can infer them.
- Worklist title does not clearly explain priority order.
- Empty state is generic.
- Drawer is good, but should reset note/action state when switching requests.

## Implemented improvement direction

- Add backend summary metrics for actionable, blocked, due soon, oldest pending, average age, and pending value.
- Add frontend queue intelligence strip.
- Add triage lane cards.
- Add Due soon and Blocked filters.
- Improve empty state with filter-reset action.
- Improve worklist microcopy so users know the table is priority-sorted.
- Tighten decision drawer state when switching requests.
