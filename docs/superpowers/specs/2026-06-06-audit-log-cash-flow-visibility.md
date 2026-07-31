# Audit Log — Cash Flow Visibility (Amount + Operator)

**Date**: 2026-06-06
**Status**: Approved (user confirmation on 3 questions)
**Owner**: hospital admin (Patient Care Hospital)

## Problem

Current `/audit` and `/system-audit` pages and the dashboard's "Recent Activity" widget display audit entries as text rows with:
- Action badge (Created, Updated, Cancelled, …)
- Entity label (Invoice/Bill, Billing Deposits, …)
- Record ID
- Time

But the **financial substance** of each cash transaction is hidden inside the `old_value`/`new_value` JSON blob, and the data the dashboard widget returns does not even include those blobs. A hospital admin cannot see at a glance:

- How much cash was transacted (amount)
- Who performed the action (operator)
- Whether the cash is flowing in or out (sign/direction)

## User-confirmed answers

1. **Where to show the cash-flow info?** → On the existing audit log page itself, attached to every entry.
2. **What fields per entry?** → Amount (৳+X / -৳X with sign) + Operator name.
3. **Which audit page is primary?** → Update both `/audit` (AuditLogs.tsx, the page the user is currently on) and `/system-audit` (SystemAuditLog.tsx).

## Out of scope (deferred)

- Recipient (paid-to) and source/destination routing. The user accepted "Amount + Operator" as the minimum useful slice; can be added later if still needed.
- Cash flow summary chart on dashboard. Will add amount badge only.
- Backfill for the old `details: string` field. The field becomes a secondary line, with the structured amount taking visual priority.

## Design

### Entry card structure (after change)

```
┌──────────────────────────────────────────────────────────────────┐
│ [PAID]  Nusrat Jahan Sony · Billing Deposit · #152     ৳+5,000 │
│         Reason: Patient deposit for admission                   09:47 │
└──────────────────────────────────────────────────────────────────┘
```

For a cash entry with an amount, the amount renders as a right-aligned prominent badge:
- ৳+X in emerald (cash in: deposits, payments, refunds)
- ৳-X in red (cash out: expenses, handovers out, withdrawals)

For "other" entries (settings, patients, etc.), the amount badge is omitted.

Operator name is already shown in the left text; the only addition is a tiny `User` icon prefix when `user_name` is set, otherwise keep the existing `User #ID` fallback.

### Data flow

1. `formatAuditDetails` in `web/src/lib/auditGroups.tsx` is extended to return **structured** fields on the `AuditEntry` shape:
   - `amount?: number` (numeric, parsed from `new_value` or `old_value`)
   - `amountSign?: 'in' | 'out'` (derived from action + table)
   - `details: string` (kept for backwards compat — becomes the secondary reason/status/invoice/IP line)
2. `AuditEntryCard` uses `entry.amount` + `entry.amountSign` to render the amount badge.
3. `AuditGroupCard` (group container) optionally shows a footer sum:
   - For `cash` group: `৳+X in · ৳-Y out` for the visible entries
   - For `other` group: no change
4. Backend: `src/routes/tenant/dashboard.ts:132-139` — extend the Recent Activity SELECT to include `al.new_value` so the dashboard widget can also show amounts.
5. `RecentActivity` interface in `HospitalAdminDashboard.tsx` gains an optional `newValue?: string | null`; `toEnrichedEntry` passes it through.

### Amount-sign heuristic

| Action       | Table                       | Sign |
|--------------|-----------------------------|------|
| payment      | bills, billing              | in   |
| create       | billing_deposits            | in   |
| create       | emp_cash_transactions       | in   |
| create       | cash_drawer_movements       | out  (if movementType=cash_out) / in (if cash_in) |
| create       | expenses                    | out  |
| update       | billing_handovers (handover)| out  |
| create       | billing_handovers           | out  |
| create       | payments                    | in   |
| cancel       | bills, billing              | out  (refund direction) |
| anything else | (other)                     | (omit) |

If amount cannot be parsed → no badge. If sign is ambiguous → default `'in'`. Rule lives in a single `getAmountSign(entry)` helper inside `auditGroups.tsx`.

### Refactor: AuditLogs.tsx (the OLD page the user is on)

The page currently renders a `<table>` of audit rows. Replace it with the same two-card layout (`Cash & Transactions`, `Other Activity`) that `SystemAuditLog` uses, plus a filter bar. The raw JSON detail modal is dropped — the new entry cards already surface the parsed fields, and a "View all" link goes to `/system-audit` for the deep page.

`md/audit`, `director/audit`, `accountant/audit` already use this same component, so all three get the upgrade at once.

## Files to change

| File | Change |
|------|--------|
| `web/src/lib/auditGroups.tsx` | Extend `AuditEntry` with `amount`, `amountSign`. Add `parseAmount()` and `getAmountSign()` helpers. Update `formatAuditDetails` to populate the new fields. |
| `web/src/lib/auditGroups.test.ts` | Add tests for amount parsing + sign heuristic. Keep existing tests passing. |
| `web/src/components/AuditEntryCard.tsx` | Render amount badge; add small user icon prefix to operator. |
| `web/src/components/AuditEntryCard.test.tsx` | Tests for amount badge (in green / out red / no amount). |
| `web/src/components/AuditGroupCard.tsx` | Optional footer sum for cash group. |
| `web/src/components/AuditGroupCard.test.tsx` | Test for footer sum. |
| `web/src/pages/accounting/AuditLogs.tsx` | Refactor table → 2-card layout (group classifier + AuditGroupCard + AuditEntryCard). |
| `web/src/pages/accounting/AuditLogs.test.ts` | Add real component test (table → card, amount badge). |
| `web/src/pages/SystemAuditLog.tsx` | No structural change — uses AuditEntryCard which now renders the badge. |
| `web/src/pages/SystemAuditLog.test.ts` | Add test for amount badge in entry card. |
| `web/src/pages/HospitalAdminDashboard.tsx` | `RecentActivity` interface gains `newValue`; `toEnrichedEntry` passes it. |
| `src/routes/tenant/dashboard.ts` | Add `al.new_value as newValue` to the Recent Activity SELECT. |
| `web/public/locales/en/dashboard.json` | New keys: `auditGroup.cash.footer` (e.g. `৳+X in · ৳-Y out`), `audit.amount`, `audit.operator`, `audit.cashIn`, `audit.cashOut`. |
| `web/public/locales/bn/dashboard.json` | Bengali translations. |

## Tests / verification

- `pnpm --filter web test -- --run auditGroups` — all green, including new amount tests.
- `pnpm --filter web test -- --run AuditEntryCard` — amount badge renders correctly.
- `pnpm --filter web test -- --run AuditGroupCard` — footer sum renders.
- `pnpm --filter web test -- --run AuditLogs SystemAuditLog` — both pages render new layout.
- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web build` — succeeds.
- Deploy: `pnpm --filter web build && wrangler deploy --env production`.
- Manual verification on production: open `/h/patient-care-hospital/audit` and confirm each cash entry shows `৳+X` or `৳-X` and operator name is prominent.

## Rollout

- All changes ship together in one PR / one commit batch, but as **multiple atomic commits** so each step is independently testable.
- Reuses the existing `AuditEntryCard` and `AuditGroupCard` components from the previous interactive-audit PR. No new component file unless necessary.
