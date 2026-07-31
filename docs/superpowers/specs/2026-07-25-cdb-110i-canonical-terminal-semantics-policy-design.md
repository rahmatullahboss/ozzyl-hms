# CDB-110I Canonical Terminal Semantics Policy Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-25

**Scope:** replace the universal tombstone-readiness assumption with reviewed entity-specific terminal semantics policy and truthful evidence

## Context

The canonical local-sync readiness registry currently models every entity with one boolean:

```text
tombstoneSupport
```

The checker treats `false` as `TOMBSTONE_SUPPORT_MISSING` for every entity. This is not semantically correct for all canonical authorities.

Canonical entities use three different terminal models:

1. **True tombstone transition** — an existing entity is cancelled or reversed through a sync envelope whose operation is `tombstone`.
2. **Lifecycle-state transition** — the entity remains present and authoritative while its status changes to a terminal state such as `cancelled`, `reversed`, or `completed`.
3. **Append-only reversal** — the original immutable record remains untouched and a separate compensating/reversal record becomes the new authority.

Treating all three as a required destructive tombstone creates false blockers for immutable and lifecycle-state entities. It also hides the real missing coverage for entities whose terminal state exists in schema but is not yet represented in source-to-target sync.

## Audit result

### Invoice — true tombstone, verified

- source event: `canonical.invoice.cancelled`;
- sync operation: `tombstone`;
- business mutation: `invoice_cancelled`;
- target apply updates invoice cancellation state and compensation adjustments.

### Payment receipt — true tombstone, verified

- source event: `canonical.payment.reversed`;
- sync operation: `tombstone`;
- business mutation: `payment_reversed`;
- target apply records reversal/refund and guarded financial projections.

### Compensation accrual — lifecycle state, verified

- source event: `canonical.compensation.adjusted`;
- business mutation: `compensation_adjusted`;
- adjustment validation requires a reviewed status transition to `reversed` for cancellation semantics;
- the accrual row remains authoritative and payable becomes zero.

A destructive tombstone is not the canonical model.

### Inventory movement — append-only reversal, verified

- canonical movements are immutable stock ledger entries;
- reversal is represented by a new `reversal_in` or `reversal_out` movement;
- `reversal_of_movement_public_id` links the compensating movement to the original;
- the original movement remains present.

A tombstone would destroy ledger history and is prohibited.

### Encounter — lifecycle state, sync coverage missing

- schema supports terminal status `cancelled`;
- current sync business contract supports only `started` and `completed`;
- no reviewed `canonical.encounter.cancelled` source event/projector/apply contract exists.

### Service request — lifecycle state, sync coverage missing

- schema supports `cancelled` plus `cancelled_at_utc`;
- current command/outbox/sync contract supports only `canonical.service_request.created`;
- cancellation source event/projector/apply coverage is missing.

### Service event — lifecycle state, sync coverage missing

- schema supports event/status values `cancelled` and `reversed`;
- current command and sync mutation type allow only accepted/delivered/completed/dispensed/occupied;
- terminal service-event recording and request-projection compensation are not implemented.

### Deposit — lifecycle state and separate refund authority, sync coverage missing

- deposit state is changed through refund/reversal accounting rather than deletion;
- `canonical.deposit.refunded` is currently emitted on aggregate type `canonical_refund` with refund public identity;
- the deposit registry entry cannot yet derive ordered deposit aggregate versions or target deposit/refund projection from that separate aggregate.

A direct deposit tombstone would be financially incorrect.

## Selected registry model

Bump the registry schema to version 2 and add to every entity:

```ts
terminalSemanticsPolicy:
  | 'tombstone'
  | 'lifecycle_state'
  | 'append_only_reversal';
terminalSemanticsVerified: boolean;
terminalSemanticsEvidencePath: string;
terminalSemanticsEvidencePattern: string;
```

Keep `tombstoneSupport` temporarily for explicit true-tombstone capability and backward-readable evidence. Its meaning becomes narrow:

- required only when `terminalSemanticsPolicy === 'tombstone'`;
- must be `false` for `append_only_reversal`;
- may remain `false` for lifecycle-state entities because their terminal model is not a tombstone.

## Checker semantics

Add readiness reason:

```text
TERMINAL_SEMANTICS_MISSING
```

The checker rules become:

```text
policy=tombstone:
  tombstoneSupport must be true
  terminalSemanticsVerified must be true

policy=lifecycle_state:
  terminalSemanticsVerified must be true
  tombstoneSupport is not required

policy=append_only_reversal:
  terminalSemanticsVerified must be true
  tombstoneSupport must be false
```

Readiness reasons:

- `TOMBSTONE_SUPPORT_MISSING` only when a true-tombstone entity lacks tombstone support;
- `TERMINAL_SEMANTICS_MISSING` when the reviewed entity policy is not fully implemented/verified.

The checker must read the configured evidence path and require the exact evidence pattern for every entity, whether verified or not. For incomplete entities, the evidence proves the reviewed current domain state while the boolean remains false.

## Registry classification

| Entity | Policy | Verified after CDB-110I | Tombstone support |
| --- | --- | --- | --- |
| encounter | lifecycle_state | false | false |
| service_request | lifecycle_state | false | false |
| service_event | lifecycle_state | false | false |
| invoice | tombstone | true | true |
| payment_receipt | tombstone | true | true |
| deposit | lifecycle_state | false | false |
| compensation_accrual | lifecycle_state | true | false |
| inventory_movement | append_only_reversal | true | false |

## Expected readiness output

CDB-110I does not connect runtime consumption and does not make any entity ready.

Expected result:

```text
entity count: 8
ready: 0
blocked: 8
all 8: LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING
encounter: TERMINAL_SEMANTICS_MISSING
service_request: TERMINAL_SEMANTICS_MISSING
service_event: TERMINAL_SEMANTICS_MISSING
deposit: TERMINAL_SEMANTICS_MISSING
compensation_accrual: no terminal-semantics blocker
inventory_movement: no terminal-semantics blocker
invoice/payment_receipt: tombstone verified
```

This is more truthful than reporting six generic tombstone gaps.

## Validation requirements

Registry validation must reject:

- unknown terminal policy;
- missing evidence path/pattern;
- missing evidence pattern in the referenced file;
- `append_only_reversal` with `tombstoneSupport: true`;
- `tombstone` with `terminalSemanticsVerified: true` but `tombstoneSupport: false`;
- ready entities with incomplete terminal semantics;
- blocked entities without blocker text.

## Tests

Update readiness fixtures and add cases proving:

1. lifecycle-state verified entities do not require tombstone support;
2. append-only reversal verified entities do not require tombstone support;
3. incomplete lifecycle-state entities receive `TERMINAL_SEMANTICS_MISSING`;
4. true-tombstone entities still require `tombstoneSupport`;
5. contradictory policy/boolean combinations fail registry validation;
6. real repository output is 0 ready / 8 blocked with only four terminal gaps.

## Readiness evidence status

Add protocol-foundation metadata:

```json
{
  "terminalSemanticsPolicyStatus": "reviewed_offline",
  "terminalSemanticsDesign": "docs/superpowers/specs/2026-07-25-cdb-110i-canonical-terminal-semantics-policy-design.md",
  "terminalSemanticsTest": "test/canonical/canonical-local-sync-readiness.test.ts"
}
```

This indicates policy review, not completion of the four missing terminal sync paths.

## Tracker

CDB-110I should record:

```text
current checkpoint: terminal semantics policy reviewed
verified terminal policies: 4
missing terminal sync paths: 4
runtime consumption connected: false
activation authorized: false
```

The next exact action is CDB-110J: implement encounter and service-request lifecycle terminal sync contracts, followed by service-event and deposit terminal projection work in separately reviewable checkpoints if required.

## Safety

No terminal policy change may:

- physically delete canonical financial or clinical history;
- reinterpret append-only reversal as a destructive tombstone;
- mark runtime consumption connected;
- mark any entity ready while local runtime consumption remains false;
- activate synchronization;
- change production data or flags;
- retire legacy writes;
- merge CDB into main.
