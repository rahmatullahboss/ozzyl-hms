# P11 Payment Gateway Verify Verification

**Checkpoint:** CDB-111

**Verified:** 2026-07-24T13:07:42+06:00

**Branch:** `fix/canonical-payment-gateway-verify-20260724`

**Base:** local `main` at `8e2429e6bc156a3f4fd63168251cbca1155b6f8d`

**Boundary:** `payment-gateway.verify`

## Result

The boundary is implemented and locally verified as `integrated`.

`POST /api/payments/verify` keeps external gateway verification and the transient `pending -> verifying` claim outside the financial transaction. After the gateway confirms capture, the route executes the settlement through `executeStrictFinancialMutation`.

Disabled and shadow modes execute the original production legacy settlement batch. Shadow commits the legacy payment result first, restores the historical payment/deposit accounting events through a best-effort post-commit hook, and then attempts the canonical projection. Canonical shadow failure cannot roll back the legacy result or change the successful response.

Strict mode lazily prepares guarded legacy statements and submits them as the authoritative statements of one composite canonical command. The legacy payment, bill balance, income, optional overpayment deposit, employee cash transaction, gateway-log success state, accounting posting events, canonical payment authority, optional canonical advance-deposit authority, source mappings and outbox events commit or roll back together.

## Checkpoint commits

- `d0145cd4d` — gateway verification design, plan and continuation tracker
- `fb7274707` — composite canonical gateway settlement command
- `5f1207faa` — shadow-isolated legacy and strict settlement adapter
- `dd0389cdb` — payment route and financial coverage integration
- `c62592355` — exact governance allowance moved from the route to the canonical adapter

## Composite canonical authority

`settleGatewayPayment` owns one outer command idempotency envelope and accepts two optional settlement portions:

1. **Invoice payment portion**
   - one posted canonical payment receipt;
   - one captured gateway tender;
   - one persisted allocation to the mapped canonical invoice;
   - optimistic invoice paid/due/net-due update;
   - payment-receipt source mapping;
   - `canonical.payment.receipt.posted` child outbox event.

2. **Advance deposit portion**
   - one separate fully unallocated posted receipt;
   - one captured gateway tender;
   - one posted canonical deposit with full available balance;
   - payment-receipt and deposit source mappings;
   - `canonical.deposit.recorded` child outbox event.

The overpayment uses a separate receipt because canonical deposit authority requires a fully unallocated receipt. A partially allocated invoice-payment receipt is never reused as deposit authority.

The outer event is `canonical.gateway_payment.settled`. Exact replay returns the stored result. Conflicting evidence under the same command idempotency key is rejected. A stale canonical invoice balance rolls back the outer command claim, child events, canonical payment/deposit facts and strict authoritative legacy statements.

## Legacy and strict isolation

`prepareGatewayPaymentOriginalLegacyStatements` contains the original route SQL for:

- optional payment insert;
- bill paid/due/status update;
- income insert;
- optional advance-deposit insert;
- employee cash transaction;
- gateway-log success update.

It contains no `canonical_financial_batch_assertions`, canonical-only accounting inserts, `changes()` dependency, optimistic strict predicates or strict schema dependency.

`prepareGatewayPaymentLegacyStatements` attaches two non-enumerable hooks:

- lazy `strictAuthoritativeStatements`;
- best-effort `legacyPostCommit` accounting parity.

The strict factory is not evaluated in disabled or shadow mode. Strict statements enforce the exact bill tenant, patient, total, paid amount and status snapshot; payment/deposit identities; and gateway-log `verifying` state. Every critical mutation has a one-row assertion and the assertion rows are cleared before commit.

## Route behavior

The route now:

- verifies the external gateway before financial execution;
- reads the current legacy bill snapshot and splits confirmed money into invoice and advance portions;
- builds original legacy statements before policy resolution without preparing strict SQL;
- loads the canonical invoice mapping only inside the canonical callback;
- builds payment/deposit projections only inside the canonical callback;
- keeps the existing retry unlock after a failed final financial batch;
- retains diagnostic paid-status propagation after a successful settlement;
- queues accounting posting after settlement success.

`FINANCIAL_ROUTE_COVERAGE['payment-gateway.verify']` now records:

```text
status: integrated
canonicalCommand: settleGatewayPayment
```

## Adversarial review

Validated before the final gate:

1. The external gateway call is not inside the D1 financial batch.
2. Disabled and shadow modes do not prepare strict statements or query canonical mappings before legacy commit.
3. Legacy SQL is preserved in a dedicated adapter rather than reconstructed in the route.
4. Payment and advance-deposit canonical authority use separate deterministic receipts and tenders.
5. The strict bill update uses the exact route snapshot and fails on concurrent cashier mutation.
6. The strict gateway-log transition requires the log to remain `verifying`.
7. Payment/deposit accounting events are atomic in strict mode and best-effort post-commit in legacy/shadow mode.
8. A final-batch failure releases only a still-`verifying` log back to `pending` for retry.
9. The direct legacy-write governance allowance follows the exact adapter path; stale route allowances were removed.
10. No route-side duplicate payment/deposit accounting event write remains.

No unresolved Critical or High implementation finding remained at the final gate.

## Fresh verification

### Focused CDB-111 gate

- 8 test files passed
- 64 tests passed

Coverage includes the composite command, legacy/strict adapter, strict coordinator isolation, financial route coverage, schema governance, production gateway status constraints, route integration and cross-route shadow isolation.

### Full canonical gate

- 126 test files passed
- 883 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 467 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Worktree policy: passed
- `git diff --check`: passed

## Remaining work

The next financial writer boundary is `patient-chart.lab-billing.create`. Other registered fail-closed runtime writers remain:

- `patient-chart.radiology-billing.create`
- `pharmacy.billing.finalize`
- `radiology.billing.create`
- `reception.visit-billing.create`
- `settlement.finalize`

This checkpoint does not claim production strict readiness. Production deploy, migration/backfill, feature-flag activation, traffic movement, tenant mutation, shadow/strict observation, rollback and legacy retirement remain separately authorized work.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.
