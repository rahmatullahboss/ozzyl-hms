# P10 Canonical Financial Writer Coverage Verification

**Date:** 2026-07-23

**Base local main:** `0ac5c8e4206725386c4a2acc4ca325120e20493e`

**Branch:** `fix/canonical-financial-writer-coverage-20260723`

**Implementation commit:** `f25e5c2d — fix(canonical): guard alternate financial writers`

**Production mutation:** false

## Scope

The previous strict financial route registry represented the primary billing, payment, deposit, credit-note and compensation routes, but did not discover alternate tenant routes that directly inserted into legacy `bills`, `payments`, or `billing_deposits` tables.

This checkpoint added a recursive source contract over `src/routes/tenant/**/*.ts`, registered every discovered direct-writer route, and made unsupported composite flows fail closed under canonical strict mode before any route financial mutation begins. Disabled and shadow behavior remains unchanged.

## Discovery

The source scan found 13 route files containing direct legacy financial authority inserts. Existing registry records already covered the primary writers in:

- `billing.ts`
- `deposits.ts`
- `approvals.ts`
- `reception.ts` admission deposits

The scan exposed alternate writers requiring explicit coverage in:

- `appointments.ts`
- `billingProvisional.ts`
- `ipBilling.ts`
- `lab.ts`
- `patients.ts`
- `payments.ts`
- `pharmacy/advanced.ts`
- `radiology/orders.ts`
- `reception.ts` visit-service billing
- `settlements.ts`

## New fail-closed boundaries

- `appointment.billing.finalize`
- `billing-provisional.finalize`
- `ipd-discharge.billing.finalize`
- `lab.billing.create`
- `payment-gateway.verify`
- `patient-chart.lab-billing.create`
- `patient-chart.radiology-billing.create`
- `pharmacy.billing.finalize`
- `radiology.billing.create`
- `reception.visit-billing.create`
- `settlement.finalize`

Each boundary is recorded as `blocked_in_strict` and invokes `assertStrictFinancialBoundaryDisabledOrSupported` before the corresponding financial flow proceeds. No boundary is falsely claimed as canonically integrated.

## Verification

| Gate | Result |
|---|---:|
| Financial coverage test | 1 file, 11 tests passed |
| Strict policy and affected route regression set | 11 files, 148 tests passed |
| Full canonical suite | 103 files, 729 tests passed |
| Migration manifest generation | 462 migrations generated |
| TypeScript `tsc --noEmit` | passed |
| Canonical schema governance | 0 issues |
| Full production build | passed |
| `git diff --check` | passed |

The first TypeScript attempt in the clean worktree failed only because `src/data/schema-migrations.generated.ts` had not yet been generated. Running the documented `pnpm build:migrations` command generated the 462-entry manifest, after which TypeScript passed without source correction.

## Safety review

- The source scanner uses a word-bounded SQL pattern and does not treat `bills_idempotency_keys` as a `bills` insert.
- Existing integrated boundaries remain unchanged.
- New guards execute before invoice, payment, deposit, stock, idempotency-claim, or settlement mutations in their respective flows.
- No migration, backfill, feature flag, production deployment, Worker traffic change, tenant mutation or legacy retirement occurred.
- Tenant 100 must remain shadow-only until blocked boundaries receive reviewed atomic canonical adapters and production evidence passes.

## Remaining strict blockers

Previously known blockers remain:

- `reception.admission.deposit.collect`
- `credit-note.cash-refund`
- `bill.cancel.unpaid`

The eleven alternate-writer boundaries above also remain blocked until implemented one flow at a time. This checkpoint prevents silent strict-mode bypass; it does not claim those business flows are canonically complete.
