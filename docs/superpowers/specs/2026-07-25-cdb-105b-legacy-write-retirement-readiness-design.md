# CDB-105B Legacy-Write Retirement Readiness Design

## Status

Approved local-only continuation design. This checkpoint prepares and enforces retirement gates; it does not retire a write.

## Goal

Prevent any registered legacy direct-write allowance from being removed merely because its historical target phase has passed. A write becomes retirement-eligible only when exact domain cutover, read promotion, observation, rollback, and authorization evidence are all explicitly complete.

## Inputs

- `docs/database/legacy-table-disposition.yaml` — exact current direct-write inventory and lifecycle classification.
- `docs/database/legacy-write-retirement-gates.yaml` — explicit per-domain retirement gates.

## Domains

The five registered legacy tables map to four retirement domains:

| Domain | Tables |
| --- | --- |
| `billing_invoice` | `bills`, `invoice_items` |
| `payment_collection` | `payments` |
| `practitioner_compensation` | `doctor_commission_accruals` |
| `inventory_movement` | `InventoryStockTransaction` |

Every registered table must belong to exactly one domain. Every allowance inherits the domain of its table.

## Common retirement gates

Each domain records these booleans:

- `productionCutoverComplete`;
- `canonicalReadPromotionComplete`;
- `observationComplete`;
- `rollbackEvidenceFresh`;
- `ownerAuthorizationPresent`.

All common gates must be true before any write in the domain can become eligible.

## Lifecycle-specific gates

The allowance lifecycle adds one required approval:

- `legacy_authority` requires `legacyAuthorityRetirementApproved`;
- `canonical_compatibility` requires `compatibilityAdapterRetirementApproved`;
- `protected_fixture` requires `fixtureRetirementApproved`.

This distinction prevents a canonical strict/shadow compatibility projection or protected smoke fixture from being retired by a generic domain switch.

## Evidence metadata

Every domain gate entry includes:

- exact non-empty `blocker` while any gate is false;
- `reviewedAtUtc` as ISO-8601 UTC;
- `retirementTask` equal to `CDB-105B`;
- optional non-sensitive evidence references only after evidence exists.

The gate file must not contain production credentials, tenant data, protected paths, tokens, or authorization payloads.

## Readiness result

The local checker emits deterministic aggregate JSON:

- allowance counts by domain and lifecycle;
- eligible and blocked allowance counts;
- exact eligible scopes;
- blocked scopes with stable reason codes;
- domain gate state.

Current expected result is zero eligible allowances because production cutover, read promotion, observation, fresh rollback evidence, and retirement authorization are incomplete.

## Fail-closed rules

The checker rejects:

- missing or duplicate domain IDs;
- a registered table mapped to zero or multiple domains;
- unknown tables in gate definitions;
- missing booleans or invalid timestamps;
- a false gate with an empty blocker;
- an allowance missing a lifecycle-specific approval field;
- duplicate allowance scope or invalid lifecycle evidence.

No file mutation, database access, network request, production inspection, flag change, or runtime route change is permitted.

## Integration policy

This work remains on `program/cdb-main-continuous-20260725`. Reviewed `main` updates continue to flow into CDB before new slices. No CDB checkpoint is merged into `main` until final program completion, review, and verification.

## Completion boundary

CDB-105B local readiness preparation is complete when the gate document, checker, tests, real-repository report, tracker, and verification receipt pass. Actual legacy write removal remains blocked until one or more domains produce fully eligible exact scopes under fresh authorized evidence.
