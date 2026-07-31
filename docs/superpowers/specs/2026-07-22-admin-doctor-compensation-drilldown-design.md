# Admin Doctor Compensation Drilldown Design

**Date:** 2026-07-22
**Status:** Implemented and verified on isolated branch
**Reviewed base:** `main` at `2353587d8`
**Implementation branch:** `feat/admin-doctor-compensation-drilldown-20260722`

## Goal

Make doctor-wise diagnostic activity and compensation understandable without manual calculation. The admin must be able to see how many tests a doctor referred, how many tests the doctor performed, how much test discount and performer reserve applied, how commission was calculated, how much the doctor waived, how much became payable, how much was paid, and how much remains outstanding.

## Existing foundation retained

Current `main` already includes:

- doctor-wise visit and test analytics;
- separate referrer commission and performer reserve totals;
- payable commission calculation after doctor waiver;
- doctor detail tabs for visits, tests, and commissions;
- readable compensation source and role labels;
- performer reserve rows as separate compensation facts;
- server-side pagination.

This change is additive. It does not replace billing, commission accrual, performer reserve, or settlement ledgers.

## User-facing model

### Doctor summary table

The table uses focused management columns:

1. Doctor
2. Visits
3. Referred tests
4. Discounted tests
5. Test discount
6. Performed tests
7. Test collection
8. Earned compensation
9. Doctor waiver
10. Payable compensation
11. Paid compensation
12. Outstanding compensation

The existing visit, referral, performer reserve, other, and total compensation fields remain in the API for compatibility, but the default table no longer presents all of them as equal-priority columns.

### Five compensation states

- **Earned:** compensation generated before doctor waiver.
- **Doctor waiver:** the portion of earned commission surrendered to fund the patient discount.
- **Payable:** earned minus doctor waiver, never below zero.
- **Paid:** amount already settled or paid.
- **Outstanding:** payable minus paid, never below zero.

Performer reserve has no doctor waiver. Its reserved amount is earned/payable; a paid reserve contributes to Paid, and an unpaid reserve contributes to Outstanding.

### Doctor detail drawer

The drawer header shows server-calculated period totals:

- visits;
- referred tests;
- discounted tests;
- performed tests;
- test gross;
- test discount;
- performer reserve;
- earned;
- doctor waiver;
- payable;
- paid;
- outstanding.

Tabs:

- **Visits:** existing visit evidence.
- **Referred tests:** each test shows gross, discount, net billed, collected, due, commission base, earned, waiver, payable, paid, and outstanding.
- **Compensation ledger:** each accrual or performer reserve shows source, role, test/detail, invoice/reference, gross, discount, reserve, commission base, rate, earned, waiver, payable, paid, outstanding, settlement, and status.

The drawer totals always describe the complete filtered result, not only the visible page.

## Data semantics

### Test billing amounts

For invoice test lines:

```text
Gross = unit price × quantity
Net billed = line total
Discount = max(0, Gross − Net billed)
```

A fully discounted line therefore has non-zero Gross, equal Discount, and zero Net billed. It must not fall back to Gross as billed amount.

### Commission accrual amounts

For eligible non-performer commission accruals:

```text
Discount = max(0, Gross − Performer reserve − Commission base)
Earned = explicit earned amount, or deterministic rule fallback
Waiver = explicit doctor waiver
Payable = reconciled payable amount
Paid = min(Payable, recorded paid amount)
Outstanding = max(0, Payable − Paid), using recorded balance when valid
```

### Performer reserve amounts

```text
Gross = unit service amount
Discount = unit discount amount
Commission base = net unit service amount
Earned = reserved amount
Waiver = 0
Payable = reserved amount
Paid = reserved amount when status is paid, otherwise 0
Outstanding = reserved amount when status is reserved, otherwise 0
```

Cancelled and reversed reserve rows are excluded.

### Double-count prevention

Performer compensation is sourced from `diagnostic_performer_reserves`. Linked or legacy performer-style rows in `doctor_commission_accruals` are excluded from the non-performer commission aggregate and detail union.

## API changes

### Doctor performance summary

Extend each row and totals with:

```ts
referredTests: number;
discountedTests: number;
testGrossAmount: number;
testDiscountAmount: number;
performedTests: number;
earnedCommission: number;
doctorWaiver: number;
payableCommission: number;
paidCommission: number;
outstandingCommission: number;
```

Legacy `tests`, `performerReserveCount`, and `totalCommission` remain aliases/compatibility fields during migration.

### Doctor details response

Add a complete-result `summary` object independent of pagination.

Extend test rows with:

```ts
grossAmount: number;
discountAmount: number;
netBilledAmount: number;
performerReserveAmount: number;
commissionBaseAmount: number;
earnedAmount: number;
waiverAmount: number;
payableAmount: number;
paidAmount: number;
outstandingAmount: number;
```

Extend compensation rows with the same calculation fields plus:

```ts
rateLabel: string | null;
settlementNo: string | null;
waiverReason: string | null;
```

## Canonical cutover compatibility

The active dashboard remains on the legacy operational projection today. Enabling the generic canonical reporting database or its canary endpoints must not silently mix canonical summary rows with legacy drill-down rows.

Both doctor summary and detail responses therefore expose the stable `doctor-compensation-v1` query contract with:

- explicit `dataSource: legacy` evidence;
- BDT major-unit money semantics;
- Asia/Dhaka tenant-business-date semantics;
- `explicit-provider-switch` cutover policy.

A future canonical provider must return the same summary/detail shape and pass parity tests before the provider switch is enabled. Summary and drill-down must switch together; partial or automatic switching from `canonical_reporting_v1` is prohibited. This keeps the current legacy dashboard working when canonical tables are introduced and prevents an unreviewed mixed-source state during future cutover.

## Error and empty states

- A complete zero is shown only after a successful response.
- Missing optional row detail displays `—`, not fabricated zero text where meaning is unknown.
- A failed detail request displays an explicit error and does not reuse stale rows from another doctor.
- Pagination resets when doctor, tab, or date range changes.

## Accessibility and responsive behavior

- Summary cards contain text labels, not color-only status.
- Tables retain semantic headers.
- The wide ledger has horizontal scrolling on desktop and a readable stacked/card representation on narrow screens where practical.
- The dialog supports Escape close, focus entry, and focus restoration.
- Money uses BDT formatting with two decimals in detailed views.

## Performance constraints

- Summary remains one bounded doctor analytics query.
- Detail summary and paginated rows may use two bounded queries executed together.
- No row-by-row database queries.
- No complete detail payload in the doctor summary endpoint.
- Existing tenant/date indexes remain the access path.

## Acceptance criteria

1. The summary clearly distinguishes referred and performed tests.
2. Discounted test count and discount amount are visible doctor-wise.
3. Earned, waiver, payable, paid, and outstanding amounts are separate.
4. A full doctor waiver produces earned > 0, waiver = earned, payable = 0, paid = 0, outstanding = 0.
5. A paid performer reserve produces earned/payable/paid equal to the reserve and outstanding 0.
6. An unpaid performer reserve produces earned/payable/outstanding equal to the reserve and paid 0.
7. Fully discounted tests show Gross and Discount correctly and Net billed 0.
8. Test and compensation detail rows expose the calculation chain.
9. Drawer summary totals reconcile to all matching facts, not the current page.
10. Existing doctor analytics consumers remain compatible.

## Implementation evidence

Implemented on `feat/admin-doctor-compensation-drilldown-20260722` through these checkpoints:

- `26a70bd91` — doctor compensation lifecycle totals;
- `ee90b6a6c` — calculation-chain detail response and complete-result summary;
- `94dd3c541` — focused doctor performance table;
- `76978b5b` — explained doctor detail drawer;
- `54e6e619` — adversarial-review reconciliation fixes.

The implementation preserves legacy response aliases while adding the explicit referred/discounted/performed test and earned/waiver/payable/paid/outstanding fields.

## Adversarial review

Four material consistency issues were found and fixed before completion:

1. Invoice-only test lines could appear in collection/detail evidence while being omitted from doctor summary count, gross, and discount. The summary now unions invoice-backed tests with unbilled lab-order tests and prevents linked rows from being counted twice.
2. A linked commission accrual on an unpaid bill could appear as payable in the referred-test row while the doctor summary and compensation ledger correctly excluded it. Test-row compensation attribution now uses the same fully-paid eligibility rule.
3. React Query placeholder data could briefly expose a previously opened doctor's summary or rows while a new doctor/date/tab request was loading or failing. The drawer now suppresses placeholder evidence and disables cross-key placeholder reuse.
4. Referral-source compensation rows could omit the linked test name even when the accrual had a lab-order item. Referral and lab-test sources now share the same test-name attribution.

Regression fixtures prove:

- an invoice-only test contributes to referred-test count, gross, discount, collection, and detail;
- an unpaid test remains visible as billing evidence but reports zero earned, waiver, payable, paid, and outstanding compensation;
- a full doctor waiver exposes earned commission while payable remains zero;
- a fully discounted test reports non-zero gross, equal discount, and zero net billed;
- paid and unpaid performer reserves remain separate and are not double-counted through legacy performer accrual rows.

## Verification evidence

Fresh focused verification on 2026-07-22:

```text
Backend integration: 3 files, 21 tests passed
Frontend components: 4 files, 30 tests passed
Root TypeScript: passed
Web production build: passed
Git whitespace check: passed
```

No schema migration, tenant-permission change, production mutation, deployment, push, or merge was performed by this branch.
