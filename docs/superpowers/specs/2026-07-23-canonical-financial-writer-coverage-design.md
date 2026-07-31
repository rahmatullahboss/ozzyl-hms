# Canonical Financial Writer Coverage Design

**Date:** 2026-07-23
**Base:** local `main` at `0ac5c8e4206725386c4a2acc4ca325120e20493e`
**Status:** Approved by the user's direct instruction to complete the remaining canonical work from current local `main`.

## Problem

The strict financial boundary registry covers the primary billing, payment, deposit, credit-note and compensation routes, but several alternate tenant routes still insert directly into legacy `bills`, `payments`, or `billing_deposits` tables. A Tenant-100 strict activation could therefore allow an unregistered legacy writer to bypass canonical validation and create drift.

The immediate safe checkpoint is to make the repository fail closed before attempting large route-specific canonical adapters. Existing shadow-mode production behavior must remain unchanged.

## Decision

1. Treat source-wide discovery of direct inserts into `bills`, `payments`, and `billing_deposits` as a governance contract.
2. Every route file containing such a writer must be represented by at least one `FINANCIAL_ROUTE_COVERAGE` record.
3. Existing integrated writers remain `integrated`.
4. Alternate writers without a reviewed atomic canonical adapter become explicit `blocked_in_strict` boundaries.
5. Each blocked route invokes `assertStrictFinancialBoundaryDisabledOrSupported` before any financial mutation or sequence allocation that could reserve an external identity.
6. Disabled and shadow policies continue current legacy behavior. Strict policy rejects the request before a partial legacy write.

## New strict boundaries

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

These boundaries are intentionally `blocked_in_strict` in this checkpoint. They are not falsely labeled integrated until each route can produce deterministic canonical identities and commit legacy and canonical facts atomically.

## Route mapping

| Boundary | Route file | Legacy facts |
|---|---|---|
| `appointment.billing.finalize` | `src/routes/tenant/appointments.ts` | bill, optional payment |
| `billing-provisional.finalize` | `src/routes/tenant/billingProvisional.ts` | bill, optional payment, optional deposit application |
| `ipd-discharge.billing.finalize` | `src/routes/tenant/ipBilling.ts` | bill, optional payment, deposit application/refund |
| `lab.billing.create` | `src/routes/tenant/lab.ts` | bill and invoice lines |
| `payment-gateway.verify` | `src/routes/tenant/payments.ts` | payment and overpayment deposit |
| `patient-chart.lab-billing.create` | `src/routes/tenant/patients.ts` | quick lab order bill and invoice lines |
| `patient-chart.radiology-billing.create` | `src/routes/tenant/patients.ts` | quick radiology order bill and invoice lines |
| `pharmacy.billing.finalize` | `src/routes/tenant/pharmacy/advanced.ts` | pharmacy invoice, stock movement, optional deposit application |
| `radiology.billing.create` | `src/routes/tenant/radiology/orders.ts` | bill and invoice lines |
| `reception.visit-billing.create` | `src/routes/tenant/reception.ts` | bill and invoice lines |
| `settlement.finalize` | `src/routes/tenant/settlements.ts` | payments and deposit applications across bills |

## Contract test

The canonical route-coverage test recursively scans `src/routes/tenant/**/*.ts` for direct SQL inserts into the three legacy financial authority tables. It compares discovered files against the typed route registry. This prevents a future writer from being added silently.

The test also verifies:

- every new boundary is registered as `blocked_in_strict`;
- each blocked route contains the matching guard call;
- pharmacy's two finalization flows each contain a guard;
- existing integrated routes remain integrated.

## Error behavior

- **Disabled:** legacy behavior is unchanged.
- **Shadow:** legacy behavior is unchanged; no new canonical claim is made by these routes.
- **Strict:** the route throws `CANONICAL_STRICT_BOUNDARY_UNSUPPORTED` before legacy financial mutation.

## Non-goals

- No production deploy, migration, backfill, flag change or Tenant-100 strict activation.
- No invented canonical invoice, receipt, deposit or stock identity.
- No broad refactor of large route modules.
- No claim that inventory, clinical/service operations, accounting posting, cash refund or unpaid cancellation are complete.

## Follow-up order

After this guard checkpoint, integrate the blocked boundaries one business flow at a time, beginning with unpaid invoice cancellation and deterministic appointment/provisional billing, then IPD/settlement/deposit flows, gateway overpayment and pharmacy inventory. Each integration must replace `blocked_in_strict` with `integrated` only after route-level strict/shadow/idempotency tests pass.
