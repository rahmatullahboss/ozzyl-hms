# Canonical Tenant 100 Readiness Audit

**Date:** 2026-07-22  
**Scope:** latest `origin/main`, dashboard doctor-compensation continuation, production canonical financial parity, targeted production repair, and Tenant 100 strict/reporting readiness.
**Production posture:** three explicitly scoped production backfills were executed after exact source validation. No feature flag, strict-mode setting, migration, deployment, broad import, or unrelated issue mutation was performed.

## Executive verdict

Tenant 100 financial aggregates are now at **zero variance**, but Tenant 100 is still **not ready** for canonical strict financial or reporting cutover.

The targeted repair corrected:

- two admission deposits totaling BDT 600;
- one bounded pre-deployment consultation invoice/payment gap;
- the related canonical compensation accrual and runtime shadow-write issue.

The final financial reconciliation reports `issueCount: 0`, `secondPassNewRows: 0`, and exact legacy/canonical equality for invoice, payment, allocation, and deposit lifecycle aggregates. Open Tenant 100 runtime `financial_shadow_write` issues are now `0`.

Strict/reporting activation remains a NO-GO because the broader canonical issue registry still contains 761 historical error-level issues, reporting preflight has 19 blockers, 41 archival foreign-key violations remain, and multiple direct legacy financial writers have not completed strict-boundary classification or integration.

The dashboard doctor-compensation label/detail change is presentation-compatible with canonical role semantics, but active dashboard endpoints still use legacy analytics rather than the provider-selected canonical reporting adapter.

## Local integration state

The work was isolated in a clean worktree from `origin/main`. Existing dirty `.ai-bridge` work in the local main worktree was not overwritten or discarded.

The repair branch contains guarded, idempotent production runners and real SQLite regression tests for:

- admission deposit repair;
- pre-deployment invoice/payment repair;
- pre-deployment compensation repair and exact shadow-issue resolution.

## Dashboard compensation compatibility

### Compatible presentation semantics

The following labels align with canonical compensation concepts:

- Referrer Commission
- Performer Reserve
- Performer / Prescriber / Referrer roles
- Separate referral and performer detail rows

### Remaining source-of-truth gap

The dashboard routes in `src/routes/tenant/dashboard.ts` still call the legacy analytics functions in `src/lib/executive-doctor-analytics.ts`. Those queries read legacy tables including:

- `bills`
- `payments`
- `invoice_items`
- `doctor_commission_accruals`
- `diagnostic_performer_reserves`

A canonical doctor-performance reporting implementation exists under `src/lib/canonical/reporting/doctor-performance.ts`, but it is not yet the provider-selected source for the dashboard response contract. The display change is safe; dashboard canonical-read cutover remains incomplete.

## Production repair summary

### Admission deposits

Missing legacy receipts:

- `DEP-000048`, BDT 300
- `DEP-000049`, BDT 300

Created and verified:

- 2 canonical payment receipts;
- 2 canonical payment tenders;
- 2 canonical deposits;
- 6 exact source mappings.

The reception route correction on main prevents future admission deposits from silently bypassing canonical shadow projection. The mixed admission/deposit boundary remains `blocked_in_strict` because admission concurrency guards and canonical deposit creation do not yet share one reviewed conditional atomic command.

### Pre-deployment consultation invoice and payment

Repaired source:

- Bill `6917`
- Invoice `INV-A-2026-000037`
- Payment `1907`
- Receipt `RCP-000269`
- Gross BDT 500
- Discount BDT 100
- Net/paid BDT 400
- Due BDT 0

The source transaction occurred at 17:07:53 Asia/Dhaka. The canonical-integrated production Worker reached production at 17:14:53, making this a bounded pre-deployment gap rather than a current-main billing writer bypass.

Created and verified:

- 1 canonical invoice;
- 2 canonical invoice lines;
- 1 invoice mapping;
- 1 canonical receipt;
- 1 tender;
- 1 allocation;
- 1 payment mapping.

No historical outbox event was emitted, avoiding duplicate downstream side effects.

### Related compensation accrual

Repaired source:

- Legacy accrual `2637`
- Doctor `101`
- Bill `6917`
- Gross BDT 500
- Discounted base BDT 400
- Earned/payable BDT 400

The original `doctor-compensation.accrue` shadow write failed because the canonical invoice line did not exist when the legacy accrual committed. The practitioner and compensation rule were already correctly mapped. After the invoice repair, the targeted runner created:

- 1 canonical compensation accrual;
- 1 compensation-accrual source mapping;
- exact resolution of issue `canissue_2CR9CW4BCSBDA5H7XFA5QBVAKK` using `TARGETED_CANONICAL_BACKFILL`.

Open Tenant 100 runtime financial shadow-write issues after repair: `0`.

## Final Tenant 100 financial reconciliation

| Measure | Legacy | Canonical | Variance |
|---|---:|---:|---:|
| Invoice count | 275 | 275 | 0 |
| Invoice gross minor | 1,087,186,600 | 1,087,186,600 | 0 |
| Invoice discount minor | 31,933,500 | 31,933,500 | 0 |
| Invoice net minor | 1,055,253,100 | 1,055,253,100 | 0 |
| Invoice paid minor | 1,031,253,100 | 1,031,253,100 | 0 |
| Invoice due minor | 24,000,000 | 24,000,000 | 0 |
| Receipt count | 333 | 333 | 0 |
| Receipt total minor | 1,104,667,900 | 1,104,667,900 | 0 |
| Allocation total minor | 976,867,900 | 976,867,900 | 0 |
| Deposit received minor | 127,800,000 | 127,800,000 | 0 |
| Deposit applied minor | 54,385,200 | 54,385,200 | 0 |
| Deposit refunded minor | 50,054,800 | 50,054,800 | 0 |

Financial reconciliation controls:

- `issueCount: 0`
- `secondPassNewRows: 0`
- source-mapping duplicates: 0
- cross-tenant rows: 0
- unresolved critical reconciliation issues: 0
- blocked outbox rows: 0
- blocked accounting rows: 0

This proves current aggregate financial parity. It does not prove that every historical canonical domain record or every future financial writer is strict-ready.

## Remaining direct legacy financial writers

The repository still contains active direct writers that require integration or explicit strict blocking:

| Area | Legacy operation | Risk before strict promotion |
|---|---|---|
| `billingProvisional.ts` | deposit application/adjustment | canonical deposit balance may not decrease |
| `settlements.ts` | settlement deposit application | canonical application lifecycle may be incomplete |
| `pharmacy/advanced.ts` | deposit-deduction paths | canonical available balance may diverge |
| `payments.ts` | gateway overpayment creates deposit | canonical receipt may be omitted |
| `ipBilling.ts` | discharge deposit application/refund | canonical lifecycle may diverge |

Current aggregate application/refund parity means these paths did not create the repaired variances, but they remain future-write strict coverage blockers.

## Broader canonical database review

Production has all required canonical reporting tables and no pending canonical migration according to D1 migration status. Migration completion is not equivalent to data completeness.

Tenant 100 still has 761 historical open error-level canonical processing issues, including:

| Domain / issue | Open count |
|---|---:|
| Invoice typed line unresolved | 230 |
| Payment invoice unresolved | 211 |
| Compensation invoice line unresolved | 103 |
| Deposit receipt unresolved | 44 |
| Service catalog duplicate code | 32 |
| Service operation quantity invalid | 32 |
| Inventory balance variance | 31 |
| Payment allocation exceeds outstanding | 21 |
| Deposit transaction type unsupported | 12 |
| Encounter admission/visit unresolved | 12 |
| Other open errors | 33 |
| **Total** | **761** |

Production also reports 41 foreign-key violations in archival `doctor_commission_accruals_old_0391`. These do not demonstrate corruption of active canonical tables, but formal repair or reviewed disposition is still required before cutover.

The configured production migration-manifest evidence object is also unavailable, so manifest integrity is not currently proven despite D1 reporting no pending migration.

## Reporting preflight

The read-only production reporting preflight still reports:

- `preparationReady: false`
- `nightExecutionReady: false`
- 19 blockers
- no authorized canary tenant
- no current cutover authorization
- no approved maintenance window
- no rollback/observation ownership evidence
- no approved import/flag command
- 41 foreign-key violations

Reporting canonical cutover remains unauthorized and operationally incomplete.

## Tenant 100 strict activation decision

**Decision: NO-GO. Keep Tenant 100 in shadow mode.**

Minimum safe sequence:

1. Integrate or explicitly block every remaining direct financial writer.
2. Resolve or formally disposition the 761 historical processing errors by domain.
3. Resolve or formally disposition the 41 archival foreign-key violations.
4. Restore and checksum-verify production migration-manifest evidence.
5. Complete provider-aware canonical dashboard/reporting contract parity.
6. Prepare an authorized canary, maintenance window, rollback plan, observation owners, and smoke tests.
7. Re-run zero-variance reconciliation immediately before activation.
8. Activate strict only for Tenant 100 under separate reviewed authorization, observe, and retain immediate rollback to shadow.

## Verification performed

- Guarded admission deposit runner: mock, partial-state, exact-existing, and real SQLite tests.
- Guarded invoice/payment runner: mock, partial-state, exact-existing, and real SQLite tests.
- Guarded compensation runner: mock, partial-state, exact-existing, and real SQLite tests.
- Live invoice/payment/compensation projection regressions.
- Root TypeScript typecheck.
- Final production financial reconciliation: zero variance and zero new-row second pass.
- Runtime financial shadow issue query: 0 open.
- Reporting preflight: rejected with 19 blockers.
- Tenant 100 broader issue registry: 761 open historical errors.
