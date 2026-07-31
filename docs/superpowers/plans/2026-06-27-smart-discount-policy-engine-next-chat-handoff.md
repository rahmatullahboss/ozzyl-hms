# Next Chat Handoff — Smart Discount + Billing Master Enterprise Plan

Date: 2026-06-27
Continue-from file: `docs/superpowers/plans/2026-06-27-smart-discount-policy-engine-implementation.md`
Related spec: `docs/superpowers/specs/2026-06-27-smart-discount-policy-engine.md`
Current main commit at time of handoff: `a9d9f0ad update`
Branch/worktree used: `.worktrees/print-direct-main` on `main`
Deploy status: **Do not deploy unless explicitly asked.** Latest requested work was pushed to main only.

## Current implementation status

### Completed / pushed to main

- Discount allocation foundation.
- Advanced discount allocation editor foundation.
- Billing Master Overview / Health Check.
- Billing Master Price Matrix foundation.
- Billing Counter `service-items` endpoint supports explicit selected item refresh by `ids` with `price_category_id`.
- Billing Counter can refresh selected service lines when price category/scheme changes.
- Scheme/Benefit UI foundation in Billing Counter.
- Billing Master scheme form has advanced policy-oriented fields, including discount source, default price category, validity, cap, approval/reference/note flags, and auto-suggest option.
- Main is clean and pushed to origin/main.

### Last verified checks

- `npm test -- test/integration/routes/billing-counter.test.ts` passed: 57/57.
- `pnpm --filter web build` passed.
- Full suite previously passed in same workstream: 669 files / 14257 tests.

## Remaining high-priority work

The next implementation should continue from **Phase 3 / Phase 8D**:

1. Add real scheme/member/code apply endpoint.
2. Add Billing Master scheme member/eligibility records.
3. Connect Staff/VIP/Owner/Shareholder/Corporate/Charity scheme types to discount allocation source mapping.
4. Record scheme usage when a scheme is applied to a bill.
5. Add cap validation: per bill, per month, per year.
6. Add manual scheme/code/member ID lookup UI and validation in Billing Counter first.
7. Then extend same Scheme / Benefit panel to ReceptionDashboard quick bill, visit service bill, final bill, appointment payment, IPD provisional/discharge, and settlements.

## Recommended next task

Implement the first small safe slice:

**Task name:** `Billing scheme eligibility and apply API`

### Backend

Add or complete endpoints under Billing Master / billing policy:

```text
GET /api/billing-master/scheme-eligibility?patient_id=&scheme_code=&member_code=&service_category=&subtotal=
POST /api/billing-master/apply-scheme-preview
```

Return a preview object:

```json
{
  "eligible": true,
  "scheme_id": 1,
  "scheme_name": "Staff Family Benefit",
  "scheme_type": "staff",
  "discount_mode": "percent",
  "discount_value": 25,
  "max_amount_per_bill": 5000,
  "suggested_discount": 5000,
  "allocation_type": "staff_benefit_discount",
  "requires_approval": false,
  "blockers": []
}
```

### Data model

Prefer extension tables, without duplicating `billing_schemes`:

```sql
billing_scheme_members
billing_scheme_usage
billing_scheme_policies -- if current billing_schemes fields are not enough
```

If migration scope is too large, first use existing `billing_schemes` fields and add member/code lookup in a backward-compatible way.

### Frontend

In Billing Counter:

- Add `Scheme / Benefit` panel with:
  - eligible scheme dropdown
  - scheme/member/code input
  - Check button
  - Apply button
  - preview card
- Applying a scheme should:
  - set discount amount
  - set discount allocation source
  - set reference/name if required
  - keep print clean: only total discount shown

### Tests

Add tests for:

- scheme preview by scheme code
- invalid/expired/inactive scheme blocked
- cap calculation
- staff/vip/owner/shareholder/corporate source mapping
- Billing Counter submit includes scheme allocation metadata

## Important design rules

- Do not create a duplicate scheme system. Reuse `billing_schemes` as the tariff/entitlement source.
- Scheme/member eligibility is separate from discount allocation accounting source.
- Print should never show internal scheme/source breakdown unless explicitly configured.
- Doctor commission waiver is not a scheme; it is payable reduction and must later be capped by available unpaid commission.
- Do not deploy from the next chat unless the user explicitly asks.

## Suggested first prompt for next chat

```text
@Hms connect continue from docs/superpowers/plans/2026-06-27-smart-discount-policy-engine-next-chat-handoff.md. Do not deploy. Implement Billing scheme eligibility and apply API first, then Billing Counter Scheme/Benefit apply UI.
```
