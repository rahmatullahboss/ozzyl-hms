# CDB-V1-020 Canonical Core V1 Authority and Contract Freeze

**Checkpoint:** `CDB-V1-020-CORE-V1-AUTHORITY-AND-CONTRACT-FREEZE`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Contract date:** 2026-07-28  
**Production access or mutation performed:** no

## Result

The protected Canonical Core V1 authority boundary is frozen in:

- `docs/database/protected-core-v1-authority-contracts.json`
- builder: `scripts/canonical/protected-core-authority-contract-freeze.ts`
- generator: `scripts/canonical/generate-protected-core-authority-contract-freeze.ts`
- validator: `scripts/canonical/check-protected-core-authority-contract-freeze.ts`
- contract test: `test/canonical/protected-core-authority-contract-freeze.test.ts`

The deterministic artifact contains **22 protected concept contracts**:

| Owner boundary | Count |
|---|---:|
| Canonical table authority | 19 |
| Governed external table authority | 2 |
| Governed registry authority | 1 |

The two external authorities remain deliberately external:

- `users` owns application authentication actor, tenant role and access identity;
- `global_patient_identity` owns global patient person identity.

No second Canonical user or patient-demographics authority is allowed. The Canonical patient boundary owns the exact tenant-to-global relationship, not a duplicate person record.

The protected metric boundary is owned by `docs/database/metric-registry.yaml`. Dashboard queries and report SQL are providers/consumers, not metric-definition authority.

**Unresolved duplicate authorities:** `0`  
**Non-production scope leakage:** `0`

## Frozen contract fields

Every concept now has an exact frozen contract for:

1. one owner boundary and its tables or registry;
2. current source tables and their compatibility/archive disposition;
3. command names and implementation status;
4. atomic transaction, idempotency, audit and outbox rules;
5. provider key, supported modes, default mode and rollback mode;
6. exact patient, practitioner, appointment, encounter or source identity rules;
7. status vocabulary and immutable correction/reversal rules;
8. integer-minor-unit equations where money is present;
9. reconciliation checks and fail-closed abort conditions;
10. protected HTTP/UI compatibility routes;
11. migration/backfill and second-pass requirements;
12. legacy retirement and separately authorized physical-deletion gates.

## Existing and contract-only implementation boundaries

The freeze distinguishes current implementation from the next implementation checkpoints.

- **17 command boundaries now exist** in reviewed Canonical modules, including the CDB-V1-030B1 compensation-rule create/replace/retire commands.
- **3 command boundaries remain frozen contracts for CDB-V1-030 implementation:** service catalog/pricing, cash custody, and metric/provider promotion governance.
- User/auth and global patient identity remain governed external command boundaries.
- **6 protected providers already exist:** patient identity/linkage, practitioner identity/account links, appointment and encounter.
- **12 provider boundaries are frozen contracts for CDB-V1-040 implementation.** They cover service, invoice, payment, deposit, credit/refund, compensation, custody and reporting reads.
- Governance-only and externally governed providers remain outside runtime Canonical promotion.

A contract-only module path is intentionally a future implementation binding. The validator requires current modules only when their implementation status is `existing` or `governance_only`; it still freezes the future module path and provider key so later work cannot create competing boundaries.

## Exact identity rules

The freeze rejects heuristic identity:

- tenant identity must match the authenticated tenant;
- patient linkage requires an exact tenant source key and exact governed global patient public ID;
- practitioner linkage requires an exact practitioner public ID and reviewed user/employee mapping;
- appointment-to-encounter linkage is explicit;
- service request/event identity requires exact patient, encounter, service and typed participant links;
- financial identity requires exact invoice, line, receipt, tender, allocation, credit/refund and settlement lineage;
- name, phone, specialty, label, timestamp proximity and numeric-ID coincidence are not identity evidence;
- ambiguity creates a stable non-PHI processing issue.

## Exact money rules

All protected financial values use integer minor units. Frozen equations include:

```text
invoice_net_minor = gross_minor - discount_minor + tax_minor
invoice_paid_minor = sum(successful_allocation_minor) - sum(reversed_allocation_minor)
invoice_due_minor = invoice_net_minor - invoice_paid_minor - applied_credit_minor
receipt_amount_minor = sum(captured_tender_minor)
receipt_unallocated_minor = receipt_amount_minor - sum(successful_allocation_minor)
deposit_available_minor = deposited_minor - applied_minor - refunded_minor + reversed_refund_minor
net_refund_minor = refund_minor - refund_reversal_minor
accrual_balance_minor = original_accrual_minor + adjustment_minor - reversed_adjustment_minor - settled_allocation_minor
settlement_unallocated_minor = settlement_total_minor - sum(settlement_allocation_minor)
custody_balance_minor = opening_minor + inflow_minor - outflow_minor
```

Every financial reconciliation requires `unexplainedVarianceMinor = 0`. Floating-point storage/comparison is prohibited. Percentage rules use integer basis points and a named deterministic rounding rule before persistence.

## Status and correction rules

The artifact freezes exact vocabularies already represented by current Canonical schemas, including:

- practitioner: `active|inactive|unknown`;
- practitioner link: `active|rejected|retired`;
- appointment: `requested|scheduled|confirmed|arrived|checked_in|fulfilled|cancelled|no_show|rescheduled|entered_in_error`;
- service request: `planned|active|partially_fulfilled|fulfilled|cancelled|unknown`;
- service event: `posted|cancelled|reversed`;
- invoice: `draft|posted|cancelled|reversed`;
- receipt/tender/allocation lifecycle;
- compensation accrual, settlement, allocation and refund-reservation lifecycle.

Posted money facts, immutable allocations, signed history, source mappings and reconciliation receipts are never corrected in place. Corrections use append-only reversal, replacement, supersession or entered-in-error evidence.

## Compatibility and rollback

The contract derives protected HTTP and UI route families from the verified CDB-V1-010 inventory. Existing status codes, response envelopes, public identifiers, money units and permission failures remain compatible until a separately versioned API contract is approved.

Every runtime provider remains production-disabled. Existing or future providers use explicit `legacy`, `shadow` and `canonical` modes where applicable and retain an immediate rollback mode. Rollback does not delete either legacy or Canonical history and must bind the exact build, tenant scope and evidence receipt.

## Migration and retirement boundary

This checkpoint performed no migration or backfill. Future work must be:

- bound to an exact source snapshot and commit;
- tenant-bounded, resumable, idempotent and checkpointed;
- second-pass stable with **zero new business rows**;
- exact on tenant scope, public IDs and foreign keys;
- zero-variance for every minor-unit equation;
- fail-closed on ambiguous identity or missing rollback binding.

Legacy writers/readers remain active until CDB-V1-030 through CDB-V1-080 gates pass. Physical deletion always requires a separate destructive authorization after archive/retention obligations are satisfied.

## Verification

```text
pnpm canonical:protected-core-contract-generate
pnpm canonical:protected-core-contract-check
pnpm vitest run test/canonical/protected-core-authority-contract-freeze.test.ts
pnpm canonical:check
pnpm exec tsc --noEmit
pnpm worktree:check -- --mode=task --allow-dirty
```

The checker fails on stale artifacts, a missing protected concept, duplicate owner table assignment, missing existing command/provider modules, enabled production providers, incomplete identity/status/correction contracts, missing financial equations, non-zero unexplained variance, missing second-pass rules, scope leakage or weakened production/retirement gates.

## Exit decision

`CDB-V1-020` meets its repository exit condition:

- every protected fact has one exact owner boundary;
- unresolved duplicate authority is zero;
- non-production scope leakage is zero;
- external user and patient identity authorities remain explicit;
- command/provider gaps are named contract-only boundaries rather than competing implementations.

The next checkpoint is `CDB-V1-030-PROTECTED-CORE-CANONICAL-COMMAND-COVERAGE`. It must implement and route every protected mutation through these frozen command boundaries without changing the owner, provider key, public-ID, status, money, compatibility or retirement contracts. Production remains separately authorized.
