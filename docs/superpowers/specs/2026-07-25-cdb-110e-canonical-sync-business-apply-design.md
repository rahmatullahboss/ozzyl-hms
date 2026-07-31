# CDB-110E Canonical Sync Business Apply Design

## Status

Approved offline implementation design. CDB-110E adds versioned event-time mutation payloads and entity-specific canonical apply handlers. It does not claim or publish source outbox events, register routes or workers, start local-server synchronization, or activate transport.

## Goal

Convert the CDB-110D event envelope into enough authenticated business mutation evidence to reproduce canonical state on another database, then apply that evidence atomically with the CDB-110C inbox receipt and entity-version transition.

## Critical audit findings

### Raw event payloads are incomplete

Current outbox event payloads intentionally contain compact result facts. They do not contain the complete canonical mutation authority required by target schemas:

- encounter, service request, invoice, payment, and deposit rows require patient identity resolution;
- invoice issue requires invoice number, currency, source evidence, and typed lines;
- payment collection requires receipt, tender, allocation, and invoice balance facts;
- deposit application requires exact deposit and invoice before/after balances;
- compensation requires rule, calculation, accrual, and adjustment facts;
- inventory movement requires unit conversion, balance version, source, lot, and location facts.

### Current-row snapshots are unsafe for historical events

The converter may process an older outbox event after later canonical mutations have already changed the current row. Copying the current row would leak later state into an earlier aggregate version.

CDB-110E therefore reconstructs **event-time mutation deltas** from:

1. the exact immutable outbox event;
2. immutable canonical source facts;
3. immutable mutation fact rows such as allocations, applications, reversals, adjustments, and inventory movements;
4. stable external public identity keys.

Mutable current status, balances, and projections are never copied as historical authority unless the selected event itself owns that exact after-state.

## Versioned business payload

The CDB-110D converter is extended to place a versioned wrapper in the sync envelope payload:

```ts
interface CanonicalSyncBusinessPayloadV1 {
  schemaVersion: 1;
  event: Record<string, unknown>;
  mutation: CanonicalSyncMutationV1;
}
```

The existing envelope `payloadSha256` and `idempotencyKey` therefore authenticate both the compact source event and all target business mutation facts.

A raw legacy event payload is rejected by the business apply module. This prevents unauthenticated side-channel snapshot data from being applied.

## External identity rules

Raw numeric database IDs are not transported as cross-database identity.

### Patient identity

Patient-bearing mutations include `patientSyncKey`, sourced from `patients.sync_key`. The target resolves exactly one local `patients.id` using tenant plus sync key. Missing, blank, or ambiguous patient identity fails closed.

### Other external dependencies

Canonical public IDs remain the authority for:

- service catalog items;
- practitioners;
- compensation rules;
- inventory items, locations, lots, and transfers.

Target foreign keys and guarded `INSERT ... SELECT` statements ensure those dependencies exist. Zero-row mutations are rejected by business assertions.

## Event-time mutation families

### Encounter

#### `canonical.encounter.started`

Mutation evidence:

- patient sync key;
- encounter type;
- start timestamp;
- source evidence digest.

Apply:

- insert one encounter in `in_progress` state;
- ended/signature fields are null;
- an existing row is accepted only when immutable and initial-state facts exactly match.

#### `canonical.encounter.completed`

Mutation evidence:

- encounter type and original start timestamp;
- exact completion timestamp;
- source evidence digest.

Apply:

- compare-and-swap `in_progress` with null end timestamp to `completed`;
- immutable facts must match.

### Service request

#### `canonical.service_request.created`

Mutation evidence:

- patient sync key;
- optional encounter public ID;
- service public ID;
- requested quantity and timestamp;
- source evidence digest.

Apply initial state only:

- fulfilled quantity 0;
- last event null;
- status `active`.

### Service event

#### `canonical.service_event.recorded`

Mutation evidence:

- request, encounter, and service public IDs;
- event subtype and quantity;
- event timestamp and source evidence;
- exact request status after the event.

Apply:

- guarded request fulfillment increment (`accepted` does not increment);
- exact derived request status verification;
- insert immutable service-event fact;
- reject out-of-order or over-fulfilling events for retry/dead-letter handling.

### Invoice

#### `canonical.invoice.issued`

Mutation evidence:

- invoice number;
- patient sync key;
- currency, immutable totals, issued timestamp, and source evidence;
- every typed invoice line in deterministic order.

Apply:

- insert posted invoice with initial paid/credited values zero and due/net due equal total;
- insert every line with exact public-ID and service-event foreign keys;
- assert header and each line mutation.

#### `canonical.invoice.cancelled`

Mutation evidence:

- exact unpaid invoice cancellation timestamp and total;
- immutable compensation cancellation adjustments linked to the invoice and event timestamp.

Apply:

- compare-and-swap only an unpaid, uncredited posted invoice;
- insert each compensation adjustment and update its accrual using exact before/after balances;
- set invoice projection guard only after all affected accruals are non-payable;
- payload compensation count and total must equal projected adjustments.

### Payment receipt

#### posted, pending, or failed receipt

Mutation evidence:

- receipt number, patient sync key, currency, totals, status timestamps, business date, source evidence;
- exact tenders;
- exact allocations including invoice due before/after values.

Apply:

- insert receipt and tenders;
- for posted receipts, compare-and-swap each invoice balance and insert allocations in deterministic order;
- pending and failed receipts cannot contain allocations;
- initialize refund/reversal projection columns from original amounts.

#### `canonical.payment.reversed`

Mutation evidence:

- exact payment reversal row;
- exact refund row;
- receipt, tender, allocation, and invoice before/after balances.

Apply all reversal facts and projections in one batch. Any stale balance or compensation guard mismatch fails closed.

### Deposit

#### `canonical.deposit.recorded`

Mutation evidence:

- deposit number, patient sync key, currency, amount, timestamps, business date, receipt, and source evidence.

Apply posted initial state with zero applied/refunded and full available balance.

#### `canonical.deposit.applied`

Mutation evidence is the immutable deposit-application row, including exact deposit and invoice before/after balances.

Apply:

- insert application;
- compare-and-swap deposit and invoice balances;
- verify balance guard.

### Compensation accrual

#### accrued and performer-reserve accrued

Mutation evidence is the immutable original accrual calculation authority:

- invoice/line/service-event links;
- practitioner and role;
- rule public ID/version;
- calculation basis/rate;
- currency and all base amounts;
- accrued time, business date, and evidence digest.

Apply initial adjusted/settled values as zero and payable equal earned.

#### adjusted

Mutation evidence is the exact compensation adjustment row, including accrual before/after balances and status after.

Apply adjustment insertion and accrual compare-and-swap atomically.

### Inventory movement

Mutation evidence is the immutable inventory movement row plus the exact inventory balance version before and after.

Apply:

- ensure the balance row exists at version 0 when appropriate;
- compare-and-swap exact quantity/version;
- insert immutable movement fact with balance guard;
- out-of-order movement facts fail closed for retry.

## Business assertion contract

`completeCanonicalSyncInboxEvent()` already atomically commits caller-supplied business statements, entity-version mutation, and inbox completion. CDB-110E business statements add their own temporary assertions in `canonical_sync_batch_assertions`:

1. clear the event-specific business assertion key;
2. execute one guarded business mutation;
3. insert an assertion requiring the previous statement to change the exact expected row count;
4. repeat for every owned row;
5. clear the event-specific assertions.

A zero-row compare-and-swap, missing external dependency, duplicate conflicting fact, or unexpected multi-row mutation violates the assertion CHECK and rolls back the entire inbox completion batch.

## Handler interface

```ts
export function prepareCanonicalSyncBusinessApplyStatements(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    appliedAtUtc: string;
  },
): Promise<readonly CanonicalPreparedStatement[]>;

export async function completeCanonicalSyncBusinessEvent(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    claimPublicId: string;
    appliedAtUtc: string;
  },
): Promise<void>;
```

The completion wrapper delegates to CDB-110C `completeCanonicalSyncInboxEvent()` with the reviewed statements. It is not called by a route, cron, queue, or worker in CDB-110E.

## Replay and conflict policy

- Exact inbox replay is handled before claim/apply by CDB-110C.
- Aggregate version must advance exactly by one.
- Business rows use stable tenant/public-ID unique constraints.
- Version 1 creation may accept an already-present row only if every authenticated initial fact matches; conflicting rows change zero and fail the assertion.
- Later events require exact prior state and fail closed when stale or out of order.
- Tombstones never hard-delete canonical rows.

## Runtime boundary

CDB-110E must not:

- connect source outbox claiming or publication;
- register HTTP or local-server routes;
- start or configure a transport;
- call network APIs;
- mutate production or a live tenant;
- activate sync flags;
- merge CDB into `main`.

## Completion boundary

CDB-110E completes authenticated offline business mutation projection and apply handlers. Runtime source claiming/publication, transport delivery, automatic claim/apply orchestration, disconnected recovery rehearsal, and explicit owner activation authorization remain later CDB-110 work.
