# CDB-110D Canonical Outbox-to-Envelope Conversion Design

## Status

Approved offline implementation design. This checkpoint converts one exact canonical outbox row into a validated CDB-110B sync envelope. It does not claim, publish, acknowledge, transport, or mutate the source outbox row and does not register a route or worker.

## Goal

Build a fail-closed bridge from `canonical_outbox_events` to the CDB-110B public-ID sync protocol while preserving exact source semantics and dependency evidence.

## Audit findings

Canonical outbox rows currently have:

- tenant-scoped event and idempotency identity;
- aggregate type/public ID;
- event type and `event_version`;
- canonical JSON payload;
- occurrence and business dates;
- delivery status and source row `id`.

Two payload shapes exist:

1. `runCanonicalBatch()` stores a schema-versioned command envelope whose business payload is under `event`;
2. direct canonical inserts store the business event object directly.

`event_version` is an event-schema version. It is not an aggregate sequence and must never be copied into `aggregateVersion`.

## Supported aggregate/event allowlist

CDB-110D supports only these exact pairs:

| Source aggregate type | Sync entity type | Event types | Operation |
| --- | --- | --- | --- |
| `canonical_encounter` | `encounter` | `canonical.encounter.started`, `canonical.encounter.completed` | `upsert` |
| `canonical_service_request` | `service_request` | `canonical.service_request.created` | `upsert` |
| `canonical_service_event` | `service_event` | `canonical.service_event.recorded` | `upsert` |
| `canonical_invoice` | `invoice` | `canonical.invoice.issued` | `upsert` |
| `canonical_invoice` | `invoice` | `canonical.invoice.cancelled` | `tombstone` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.receipt.posted`, `canonical.payment.receipt.pending`, `canonical.payment.receipt.failed` | `upsert` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.reversed` | `tombstone` |
| `canonical_deposit` | `deposit` | `canonical.deposit.recorded`, `canonical.deposit.applied` | `upsert` |
| `compensation_accrual` | `compensation_accrual` | `canonical.compensation.accrued`, `canonical.compensation.adjusted`, `canonical.compensation.performer-reserve.accrued` | `upsert` |
| `canonical_inventory_movement` | `inventory_movement` | `canonical.inventory.stock_movement.recorded`, `canonical.inventory.movement.posted` | `upsert` |

Every supported source row must use `event_version = 1`. A new schema version requires a reviewed converter update.

## Aggregate version authority

The sync aggregate version is derived from committed source outbox order, not event-schema version:

```text
aggregateVersion = count of rows for the exact tenant + aggregate type + aggregate public ID
                   whose source outbox id is <= the selected row id
```

Before using that rank, the converter proves that every predecessor/current row in the sequence is an allowlisted event for the same aggregate type. An unsupported predecessor fails closed rather than creating a version gap that remote apply cannot explain.

Source outbox `id` is used only as local ordering evidence. It is never exposed as protocol identity or payload.

## Source status policy

Conversion is allowed for:

- `pending`;
- `processing`;
- `published`;
- `retry`.

`cancelled` and `dead_letter` rows are rejected. Conversion is read-only, so allowing `published` supports deterministic replay/recovery evidence without mutating delivery state.

## Payload normalization

The converter parses canonical JSON and accepts only a plain object.

- A command envelope must have `schemaVersion = 1`, a plain `event` object, and a structurally valid command block.
- A direct payload is used as-is.
- Arrays, nulls, class-like shapes, malformed JSON, and unsupported command-envelope versions fail closed.

The aggregate identity field, when defined by the mapped event, must exist and exactly match `aggregate_public_id`:

- `encounterPublicId`;
- `requestPublicId`;
- `eventPublicId`;
- `invoicePublicId`;
- `receiptPublicId`;
- `depositPublicId`;
- `accrualPublicId`;
- `movementPublicId`.

## Dependency extraction

Dependencies are derived from canonical authority, never guessed from legacy IDs.

### Encounter

No internal canonical sync dependency. Patient identity remains an external dependency outside the eight-aggregate protocol registry.

### Service request

Read `canonical_service_requests.encounter_public_id` and require encounter version 1.

### Service event

Read `canonical_service_events.request_public_id` and `encounter_public_id`; require service request and encounter version 1.

### Invoice

Read `canonical_invoices.encounter_public_id` when present. Read all non-null `canonical_invoice_lines.service_event_public_id`. Require encounter and each service event version 1.

### Payment receipt

Read all `canonical_payment_allocations.invoice_public_id` for the receipt and require each invoice version 1.

### Deposit

For `recorded`, require payload `receiptPublicId` and payment receipt version 1.

For `applied`, require payload `invoicePublicId` and invoice version 1. The deposit is the aggregate itself and is not a self-dependency.

### Compensation accrual

Read `canonical_compensation_accruals.invoice_public_id` and optional `service_event_public_id`; require invoice and service event version 1.

### Inventory movement

Read optional `canonical_inventory_movements.service_event_public_id` and `invoice_public_id`; require those canonical dependencies when present.

Duplicate dependency scopes are collapsed only when the minimum version is identical. Conflicting dependency requirements fail closed.

## Converter interface

```ts
export interface CanonicalOutboxSourceRow {
  id: number;
  tenantId: string;
  eventPublicId: string;
  aggregateType: string;
  aggregatePublicId: string;
  eventType: string;
  eventVersion: number;
  payloadJson: string;
  occurredAtUtc: string;
  status: string;
}

export async function convertCanonicalOutboxEventToSyncEnvelope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    sourceNodePublicId: string;
  },
): Promise<CanonicalSyncEnvelope>;
```

The output is created with `createCanonicalSyncEnvelope()`, so public-ID, UTC, digest, dependency ordering, and idempotency validation remain centralized.

## Fail-closed conditions

The converter rejects:

- missing or cross-tenant source rows;
- unsupported aggregate/event pair;
- unsupported event-schema version;
- cancelled/dead-letter source status;
- malformed or unsupported payload shape;
- aggregate identity mismatch;
- unsupported predecessor in the aggregate sequence;
- missing canonical dependency authority;
- raw numeric public IDs;
- duplicate/conflicting dependency evidence;
- source aggregate rank outside positive safe integer range.

## Runtime boundary

CDB-110D must not:

- update outbox status, lock, attempts, errors, or publication timestamps;
- insert into the sync inbox;
- call receive/claim/apply automatically;
- register an HTTP route or scheduled worker;
- access network or production;
- activate local-server synchronization;
- merge CDB into `main`.

## Completion boundary

CDB-110D completes deterministic offline source conversion only. Runtime outbox claiming/publishing, entity-specific business apply handlers, transport wiring, recovery rehearsal, and explicit activation authorization remain later CDB-110 work.
