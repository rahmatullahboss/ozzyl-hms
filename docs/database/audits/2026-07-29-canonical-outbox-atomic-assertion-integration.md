# CDB-V1-030O Canonical Outbox Atomic Assertion Integration

Date: 2026-07-29  
Branch: `program/cdb-main-continuous-20260725`  
Worktree: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

## Result

`CDB-V1-030O-CANONICAL-OUTBOX-ATOMIC-ASSERTION-INTEGRATION` completes the protected-core Canonical command-coverage stage locally. All six remaining `accounting_posting_events` writer pairs are registered behind reviewed Canonical command/outbox and atomic assertion boundaries:

- `src/lib/billing-refund-commission.ts` — `canonical-outbox.refund-commission`;
- `src/lib/billing-refund-dispute.ts` — `canonical-outbox.refund-dispute`;
- `src/lib/canonical/appointment-billing-finalization.ts` — `canonical-outbox.appointment-finalization`;
- `src/lib/canonical/compensation-accrual-route-integration.ts` — `canonical-outbox.compensation-accrual`;
- `src/lib/canonical/gateway-payment-verification.ts` — `canonical-outbox.gateway-verification`;
- `src/lib/executed-refund.ts` — `canonical-outbox.executed-refund`.

The protected writer registry now records:

- 234 protected writers;
- 117 Canonical-command writers;
- 110 atomic-compatibility writers;
- 3 governed-external writers;
- 0 strict-blocked writers;
- 0 command-required writers;
- 4 isolated fixtures;
- 0 unclassified writers;
- 0 remaining implementation groups.

`programState.commandCoverageComplete` is now true and routes the serial program to `CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON`.

## Runtime corrections

### Refund commission replay recovery

`applyRefundCommissionImpact` previously executed a standalone `db.batch`. It now:

- claims `canonical.refund_commission.impact` through `runCanonicalBatch`;
- reads exact replay before state-dependent validation;
- fails changed replay through the Canonical request fingerprint conflict;
- retains existing refund row guards;
- verifies deterministic refund-guard cleanup through `canonical_financial_batch_assertions`;
- stores only IDs, exact amounts, row counts and a SHA-256 source-evidence digest in the outbox event;
- commits commission compatibility changes, accounting posting events, assertion cleanup and the outbox receipt atomically.

### Authorized refund-dispute write-off

`completeRefundDisputeWriteoff` previously executed its workflow with a direct `db.batch`. It now:

- claims `canonical.refund_dispute.writeoff` through `runCanonicalBatch`;
- performs exact replay before mutable-state reads;
- rejects changed replay;
- verifies dispute, accounting and cash-hold row counts with Canonical financial assertions;
- retains commission-reservation guards in the same transaction;
- commits the write-off accounting event, dispute state, cash-hold state, commission state, assertion cleanup and non-PHI outbox evidence atomically;
- rolls back the outbox claim and every compatibility write when a guarded row is stale.

## Deterministic evidence

Regenerated in dependency order:

1. `docs/database/canonical-authority-access-registry.yaml` — 260 governed tables, 1,031 writers and 2,689 readers;
2. `docs/database/canonical-identity-episode-provider-coverage-registry.json` — 849 reader pairs, 296 paths, 63 tables and 0 unknown assignments;
3. `docs/database/protected-core-v1-surface-inventory.json` — 939 surfaces, 234 writers, 509 readers and 84 tables;
4. `docs/database/protected-core-v1-writer-command-coverage.json` — 117 Canonical-command, 110 atomic-compatibility, 0 command-required and 0 implementation groups.

Identity/episode promotion evidence hashes were refreshed to the regenerated registry. No provider was enabled.

## Verification

The focused checkpoint suite covers command replay/conflict, non-PHI outbox evidence, tenant-scoped identity, guarded row counts, stale-state rollback, accounting compatibility and governance closure:

- 13 focused files / 60 tests / 0 failures;
- TypeScript passing;
- the 504-migration manifest passing;
- full `canonical:check` passed;
- main source `0ee410d65c0342d8e42c85503d1a43767788f110` synchronized as merge `9527a7574`;
- post-main-sync verification: 15 files / 65 tests, TypeScript, the 504-migration manifest and full `canonical:check` passed;
- no production query, mutation, migration/backfill, provider activation, deployment, traffic change, push or CDB-to-main integration.

## Next bounded checkpoint

`CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON`

The next checkpoint may implement provider-selected reads and local/sanitized shadow comparison evidence. It does not authorize production reads, provider activation, deployment, traffic change, migration/backfill, legacy retirement or destructive cleanup.
