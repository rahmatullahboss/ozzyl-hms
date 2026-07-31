# P11 Canonical Terminal Semantics Policy Verification

**Checkpoint:** CDB-110I

**Verified:** 2026-07-25T22:31:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `b6afd871871eb9d595aba10eaa9b9f873169c0d8`

**Verified implementation head before this receipt:** `87476b449118ea13f4f6200aa38bfd657dafe1cd`

## Result

CDB-110I replaces the incorrect universal tombstone-readiness assumption with reviewed entity-specific terminal semantics. Canonical entities now declare one of:

- `tombstone`;
- `lifecycle_state`;
- `append_only_reversal`.

This avoids treating immutable ledger history or status-based lifecycle transitions as missing destructive deletes. It also exposes the four real terminal synchronization gaps instead of six generic tombstone blockers.

No runtime synchronization path was connected or activated.

## Registry v2

`docs/database/canonical-local-sync-entity-registry.yaml` is now version 2. Every entity records:

```text
terminalSemanticsPolicy
terminalSemanticsVerified
terminalSemanticsEvidencePath
terminalSemanticsEvidencePattern
```

The readiness checker requires exact evidence and rejects unknown policies, missing evidence, contradictory append-only/tombstone settings, and a verified tombstone policy without tombstone support.

## Reviewed classification

| Entity | Terminal policy | Status |
| --- | --- | --- |
| encounter | lifecycle state | missing cancellation sync contract |
| service request | lifecycle state | missing cancellation sync contract |
| service event | lifecycle state | missing cancellation/reversal sync contract |
| invoice | tombstone | verified |
| payment receipt | tombstone | verified |
| deposit | lifecycle state plus separate refund authority | missing deposit refund/reversal projection |
| compensation accrual | lifecycle state | verified through compensation adjustment/reversed status |
| inventory movement | append-only reversal | verified through linked compensating movement |

## Why compensation and inventory are not tombstones

Compensation accrual cancellation is represented by a guarded adjustment that moves the accrual to `reversed` and reduces payable authority to zero. The original accrual remains auditable.

Inventory movement authority is an immutable ledger. Reversal creates a new `reversal_in` or `reversal_out` movement linked by `reversal_of_movement_public_id`. Deleting or tombstoning the original movement would destroy stock history and is prohibited.

## True tombstone entities

Invoice cancellation and payment reversal already use authenticated sync envelopes with operation `tombstone`, validated business mutations, guarded target application, replay safety, and version progression. Their explicit `tombstoneSupport` remains true.

## Missing terminal synchronization paths

The remaining policy gaps are precise:

1. Encounter schema supports `cancelled`, but the sync contract currently supports only started/completed.
2. Service request schema supports cancellation state and time, but source command/outbox/projector/apply cancellation coverage is missing.
3. Service event schema supports cancelled/reversed states, but terminal event and request-projection compensation are missing.
4. Deposit refund is currently emitted under separate `canonical_refund` aggregate identity; ordered deposit lifecycle projection is not yet implemented.

These remain `TERMINAL_SEMANTICS_MISSING` and are not falsely marked complete.

## Readiness truthfulness

Verified output:

```text
entity count: 8
ready: 0
blocked: 8
runtime consumption connected: false
business apply connected: false
terminal semantics policy: reviewed_offline
```

All eight entities remain blocked by `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING`.

Only these four also carry `TERMINAL_SEMANTICS_MISSING`:

```text
deposit
encounter
service_event
service_request
```

No entity carries a false `TOMBSTONE_SUPPORT_MISSING` reason.

## Validation coverage

The readiness tests prove:

- verified lifecycle-state entities do not require tombstone support;
- verified append-only reversal entities do not require tombstone support;
- incomplete lifecycle-state entities receive `TERMINAL_SEMANTICS_MISSING`;
- true tombstone entities still require explicit tombstone support;
- contradictory policy/boolean combinations fail closed;
- missing evidence patterns fail closed;
- runtime consumption remains a blocker even when terminal semantics are verified.

## Checkpoint commits

- `2eea05d01` — CDB-110I terminal semantics policy design;
- `ee172a43e` — CDB-110I implementation plan;
- `87476b449` — registry v2, entity classification, checker policy validation, and readiness tests;
- `de65226c0` — tracker update and verification receipt.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused readiness tests | 7 tests passed |
| Tracker/readiness contract | 2 files, 13 tests passed |
| Full canonical suite | 168 files, 1,208 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; 4 terminal gaps |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Migration manifest | 474 migrations generated |
| Web production build | passed |
| Patient production build | passed; existing chunk-size warning only |
| Admin production build | passed; existing Vite deprecation warnings only |

Expected SQLite experimental warnings, the reviewed financial-shadow warning, and the reviewed settlement fallback warning did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: b6afd871871eb9d595aba10eaa9b9f873169c0d8
CDB implementation HEAD: 87476b449118ea13f4f6200aa38bfd657dafe1cd
main...CDB: 0 / 60
```

The CDB branch contains the latest local `main`. The owner-facing root checkout remained read-only and untouched.

## Continuation

The next safe scope is CDB-110J: implement and verify encounter cancellation and service-request cancellation lifecycle synchronization without network transport, runtime worker registration, or activation.

Service-event terminal projection and deposit refund/reversal projection remain later separately reviewable scopes.

## Safety

No physical canonical record deletion, push, deployment, production access, protected rehearsal-clone access, production mutation, network request, route registration, worker/scheduler registration, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
