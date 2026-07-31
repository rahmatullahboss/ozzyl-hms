import type { CanonicalBatchDatabase } from './command-batch';
import { parseCanonicalCommandEnvelope, stableCanonicalJson } from './idempotency';
import { createCanonicalSyncBusinessPayload } from './local-sync-business-payload';
import {
  CANONICAL_SYNC_BUSINESS_PROJECTED_EVENT_TYPES,
  projectCanonicalSyncBusinessMutation,
} from './local-sync-business-projector';
import {
  createCanonicalSyncEnvelope,
  type CanonicalSyncDependency,
  type CanonicalSyncEnvelope,
  type CanonicalSyncOperation,
} from './local-sync-protocol';

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
  businessDate: string | null;
  status: string;
}

interface StoredOutboxRow {
  id: number;
  tenant_id: string;
  event_public_id: string;
  aggregate_type: string;
  aggregate_public_id: string;
  event_type: string;
  event_version: number;
  payload_json: string;
  occurred_at_utc: string;
  business_date: string | null;
  status: string;
}

interface EventMapping {
  aggregateType: string;
  entityType: string;
  identityField: string;
  entityIdentityField?: string;
  versionScope?: 'aggregate' | 'deposit_lifecycle';
  allowedEventTypes: readonly string[];
  operationByEventType: Readonly<Record<string, CanonicalSyncOperation>>;
}

interface CountRow {
  total_count: number;
  unsupported_count: number;
}

interface ServiceRequestDependencyRow {
  encounter_public_id: string;
}

interface ServiceEventDependencyRow {
  request_public_id: string;
  encounter_public_id: string;
}

interface InvoiceAuthorityRow {
  present: number;
}

interface InvoiceEncounterDependencyRow {
  encounter_public_id: string;
}

interface PublicIdRow {
  public_id: string;
}

interface CompensationDependencyRow {
  invoice_public_id: string;
  service_event_public_id: string | null;
}

interface InventoryDependencyRow {
  invoice_public_id: string | null;
  service_event_public_id: string | null;
}

export class CanonicalSyncOutboxConversionError extends Error {
  readonly code = 'CANONICAL_SYNC_OUTBOX_CONVERSION';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncOutboxConversionError';
  }
}

const ALLOWED_SOURCE_STATUSES = new Set(['pending', 'processing', 'published', 'retry']);

const MAPPINGS: readonly EventMapping[] = [
  {
    aggregateType: 'canonical_encounter',
    entityType: 'encounter',
    identityField: 'encounterPublicId',
    allowedEventTypes: [
      'canonical.encounter.started',
      'canonical.encounter.completed',
      'canonical.encounter.cancelled',
    ],
    operationByEventType: {
      'canonical.encounter.started': 'upsert',
      'canonical.encounter.completed': 'upsert',
      'canonical.encounter.cancelled': 'upsert',
    },
  },
  {
    aggregateType: 'canonical_service_request',
    entityType: 'service_request',
    identityField: 'requestPublicId',
    allowedEventTypes: [
      'canonical.service_request.created',
      'canonical.service_request.cancelled',
    ],
    operationByEventType: {
      'canonical.service_request.created': 'upsert',
      'canonical.service_request.cancelled': 'upsert',
    },
  },
  {
    aggregateType: 'canonical_service_event',
    entityType: 'service_event',
    identityField: 'eventPublicId',
    allowedEventTypes: [
      'canonical.service_event.recorded',
      'canonical.service_event.cancelled',
    ],
    operationByEventType: {
      'canonical.service_event.recorded': 'upsert',
      'canonical.service_event.cancelled': 'upsert',
    },
  },
  {
    aggregateType: 'canonical_invoice',
    entityType: 'invoice',
    identityField: 'invoicePublicId',
    allowedEventTypes: ['canonical.invoice.issued', 'canonical.invoice.cancelled'],
    operationByEventType: {
      'canonical.invoice.issued': 'upsert',
      'canonical.invoice.cancelled': 'tombstone',
    },
  },
  {
    aggregateType: 'canonical_payment_receipt',
    entityType: 'payment_receipt',
    identityField: 'receiptPublicId',
    allowedEventTypes: [
      'canonical.payment.receipt.posted',
      'canonical.payment.receipt.pending',
      'canonical.payment.receipt.failed',
      'canonical.payment.reversed',
    ],
    operationByEventType: {
      'canonical.payment.receipt.posted': 'upsert',
      'canonical.payment.receipt.pending': 'upsert',
      'canonical.payment.receipt.failed': 'upsert',
      'canonical.payment.reversed': 'tombstone',
    },
  },
  {
    aggregateType: 'canonical_deposit',
    entityType: 'deposit',
    identityField: 'depositPublicId',
    versionScope: 'deposit_lifecycle',
    allowedEventTypes: ['canonical.deposit.recorded', 'canonical.deposit.applied'],
    operationByEventType: {
      'canonical.deposit.recorded': 'upsert',
      'canonical.deposit.applied': 'upsert',
    },
  },
  {
    aggregateType: 'canonical_refund',
    entityType: 'deposit',
    identityField: 'refundPublicId',
    entityIdentityField: 'depositPublicId',
    versionScope: 'deposit_lifecycle',
    allowedEventTypes: ['canonical.deposit.refunded'],
    operationByEventType: {
      'canonical.deposit.refunded': 'upsert',
    },
  },
  {
    aggregateType: 'compensation_accrual',
    entityType: 'compensation_accrual',
    identityField: 'accrualPublicId',
    allowedEventTypes: [
      'canonical.compensation.accrued',
      'canonical.compensation.adjusted',
      'canonical.compensation.performer-reserve.accrued',
    ],
    operationByEventType: {
      'canonical.compensation.accrued': 'upsert',
      'canonical.compensation.adjusted': 'upsert',
      'canonical.compensation.performer-reserve.accrued': 'upsert',
    },
  },
  {
    aggregateType: 'canonical_inventory_movement',
    entityType: 'inventory_movement',
    identityField: 'movementPublicId',
    allowedEventTypes: [
      'canonical.inventory.stock_movement.recorded',
      'canonical.inventory.movement.posted',
    ],
    operationByEventType: {
      'canonical.inventory.stock_movement.recorded': 'upsert',
      'canonical.inventory.movement.posted': 'upsert',
    },
  },
] as const;

const MAPPING_BY_PAIR = new Map<string, EventMapping>();
const MAPPING_BY_AGGREGATE = new Map<string, EventMapping>();
for (const mapping of MAPPINGS) {
  MAPPING_BY_AGGREGATE.set(mapping.aggregateType, mapping);
  for (const eventType of mapping.allowedEventTypes) {
    MAPPING_BY_PAIR.set(`${mapping.aggregateType}\u0000${eventType}`, mapping);
  }
}

function exact(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new CanonicalSyncOutboxConversionError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalSyncOutboxConversionError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalSyncOutboxConversionError(`${label} must be a plain object`);
  }
  stableCanonicalJson(value);
  return value as Record<string, unknown>;
}

function parseEventPayload(payloadJson: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    throw new CanonicalSyncOutboxConversionError('Canonical outbox payload is not valid JSON', { cause: error });
  }
  const record = plainObject(parsed, 'Canonical outbox payload');
  if (
    Object.prototype.hasOwnProperty.call(record, 'schemaVersion')
    || Object.prototype.hasOwnProperty.call(record, 'command')
  ) {
    let envelope;
    try {
      envelope = parseCanonicalCommandEnvelope<unknown>(payloadJson);
    } catch (error) {
      throw new CanonicalSyncOutboxConversionError('Canonical outbox command envelope is invalid or unsupported', { cause: error });
    }
    return plainObject(envelope.event, 'Canonical outbox command event payload');
  }
  return record;
}

function sourceRow(row: StoredOutboxRow): CanonicalOutboxSourceRow {
  const id = Number(row.id);
  const eventVersion = Number(row.event_version);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new CanonicalSyncOutboxConversionError('Canonical outbox source id must be a positive safe integer');
  }
  if (!Number.isSafeInteger(eventVersion) || eventVersion < 1) {
    throw new CanonicalSyncOutboxConversionError('Canonical outbox event schema version is invalid');
  }
  return {
    id,
    tenantId: exact(row.tenant_id, 'tenantId'),
    eventPublicId: exact(row.event_public_id, 'eventPublicId'),
    aggregateType: exact(row.aggregate_type, 'aggregateType'),
    aggregatePublicId: exact(row.aggregate_public_id, 'aggregatePublicId'),
    eventType: exact(row.event_type, 'eventType'),
    eventVersion,
    payloadJson: exact(row.payload_json, 'payloadJson'),
    occurredAtUtc: exact(row.occurred_at_utc, 'occurredAtUtc'),
    businessDate: row.business_date == null ? null : exact(row.business_date, 'businessDate'),
    status: exact(row.status, 'status'),
  };
}

async function loadSourceRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  eventPublicId: string,
): Promise<CanonicalOutboxSourceRow> {
  const row = await db.prepare(`
    SELECT id,tenant_id,event_public_id,aggregate_type,aggregate_public_id,
           event_type,event_version,payload_json,occurred_at_utc,business_date,status
    FROM canonical_outbox_events
    WHERE tenant_id = ? AND event_public_id = ?
    LIMIT 1
  `).bind(tenantId, eventPublicId).first<StoredOutboxRow>();
  if (!row) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox event not found for ${tenantId}/${eventPublicId}`,
    );
  }
  return sourceRow(row);
}

function mappingFor(row: CanonicalOutboxSourceRow): EventMapping {
  const mapping = MAPPING_BY_PAIR.get(`${row.aggregateType}\u0000${row.eventType}`);
  if (!mapping) {
    throw new CanonicalSyncOutboxConversionError(
      `Unsupported canonical outbox aggregate/event mapping: ${row.aggregateType}/${row.eventType}`,
    );
  }
  if (row.eventVersion !== 1) {
    throw new CanonicalSyncOutboxConversionError(
      `Unsupported canonical outbox event schema version ${row.eventVersion} for ${row.eventType}`,
    );
  }
  if (!ALLOWED_SOURCE_STATUSES.has(row.status)) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox source status is not convertible: ${row.status}`,
    );
  }
  return mapping;
}

function assertAggregateIdentity(
  row: CanonicalOutboxSourceRow,
  mapping: EventMapping,
  payload: Record<string, unknown>,
): void {
  const identity = payload[mapping.identityField];
  if (typeof identity !== 'string' || identity !== row.aggregatePublicId) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox payload aggregate identity mismatch for ${mapping.identityField}`,
    );
  }
}

function resolveEntityPublicId(
  row: CanonicalOutboxSourceRow,
  mapping: EventMapping,
  payload: Record<string, unknown>,
): string {
  if (!mapping.entityIdentityField) return row.aggregatePublicId;
  const identity = payload[mapping.entityIdentityField];
  if (typeof identity !== 'string' || identity.trim() !== identity || identity.length === 0) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox payload entity identity mismatch for ${mapping.entityIdentityField}`,
    );
  }
  return identity;
}

async function deriveAggregateVersion(
  db: CanonicalBatchDatabase,
  row: CanonicalOutboxSourceRow,
  mapping: EventMapping,
  entityPublicId: string,
): Promise<number> {
  let count: CountRow | null;
  if (mapping.versionScope === 'deposit_lifecycle') {
    count = await db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE
          WHEN o.aggregate_type = 'canonical_deposit'
            AND o.event_type IN ('canonical.deposit.recorded','canonical.deposit.applied')
            AND o.event_version = 1
            AND CASE WHEN json_valid(o.payload_json)
              THEN COALESCE(
                json_extract(o.payload_json,'$.depositPublicId'),
                json_extract(o.payload_json,'$.event.depositPublicId')
              ) ELSE NULL END = ?
            THEN 0
          WHEN o.aggregate_type = 'canonical_refund'
            AND o.event_type = 'canonical.deposit.refunded'
            AND o.event_version = 1
            AND CASE WHEN json_valid(o.payload_json)
              THEN COALESCE(
                json_extract(o.payload_json,'$.refundPublicId'),
                json_extract(o.payload_json,'$.event.refundPublicId')
              ) ELSE NULL END = o.aggregate_public_id
            AND CASE WHEN json_valid(o.payload_json)
              THEN COALESCE(
                json_extract(o.payload_json,'$.depositPublicId'),
                json_extract(o.payload_json,'$.event.depositPublicId')
              ) ELSE NULL END = ?
            THEN 0
          ELSE 1
        END), 0) AS unsupported_count
      FROM canonical_outbox_events o
      WHERE o.tenant_id = ? AND o.id <= ? AND (
        (o.aggregate_type = 'canonical_deposit' AND o.aggregate_public_id = ?)
        OR (
          o.aggregate_type = 'canonical_refund'
          AND EXISTS (
            SELECT 1 FROM canonical_refunds r
            WHERE r.tenant_id = o.tenant_id
              AND r.refund_public_id = o.aggregate_public_id
              AND r.source_type = 'deposit'
              AND r.deposit_public_id = ?
          )
        )
      )
    `).bind(
      entityPublicId,
      entityPublicId,
      row.tenantId,
      row.id,
      entityPublicId,
      entityPublicId,
    ).first<CountRow>();
  } else {
    const placeholders = mapping.allowedEventTypes.map(() => '?').join(',');
    count = await db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE
          WHEN event_type IN (${placeholders}) AND event_version = 1 THEN 0
          ELSE 1
        END), 0) AS unsupported_count
      FROM canonical_outbox_events
      WHERE tenant_id = ?
        AND aggregate_type = ?
        AND aggregate_public_id = ?
        AND id <= ?
    `).bind(
      ...mapping.allowedEventTypes,
      row.tenantId,
      row.aggregateType,
      row.aggregatePublicId,
      row.id,
    ).first<CountRow>();
  }
  const total = Number(count?.total_count ?? 0);
  const unsupported = Number(count?.unsupported_count ?? 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new CanonicalSyncOutboxConversionError('Canonical outbox aggregate rank is invalid');
  }
  if (!Number.isSafeInteger(unsupported) || unsupported !== 0) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox aggregate has an unsupported predecessor before ${row.eventPublicId}`,
    );
  }
  return total;
}

function dependency(entityType: string, entityPublicId: string): CanonicalSyncDependency {
  return {
    entityType,
    entityPublicId: exact(entityPublicId, `${entityType} dependency public ID`),
    minimumVersion: 1,
  };
}

async function loadRepeatedPublicIds(
  db: CanonicalBatchDatabase,
  sql: string,
  params: readonly unknown[],
): Promise<string[]> {
  const values: string[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`${sql} LIMIT 1 OFFSET ?`)
      .bind(...params, offset)
      .first<PublicIdRow>();
    if (!row) break;
    values.push(exact(row.public_id, 'Canonical dependency public ID'));
  }
  return values;
}

function payloadPublicId(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox payload is missing dependency field ${field}`,
    );
  }
  return value;
}

function dedupeDependencies(dependencies: readonly CanonicalSyncDependency[]): CanonicalSyncDependency[] {
  const byScope = new Map<string, CanonicalSyncDependency>();
  for (const item of dependencies) {
    const key = `${item.entityType}\u0000${item.entityPublicId}`;
    const existing = byScope.get(key);
    if (existing && existing.minimumVersion !== item.minimumVersion) {
      throw new CanonicalSyncOutboxConversionError(
        `Conflicting canonical dependency versions for ${item.entityType}/${item.entityPublicId}`,
      );
    }
    byScope.set(key, item);
  }
  return [...byScope.values()].sort((left, right) => (
    left.entityType.localeCompare(right.entityType)
    || left.entityPublicId.localeCompare(right.entityPublicId)
  ));
}

async function extractDependencies(
  db: CanonicalBatchDatabase,
  row: CanonicalOutboxSourceRow,
  mapping: EventMapping,
  payload: Record<string, unknown>,
): Promise<CanonicalSyncDependency[]> {
  const dependencies: CanonicalSyncDependency[] = [];
  if (mapping.entityType === 'encounter') return dependencies;

  if (mapping.entityType === 'service_request') {
    const authority = await db.prepare(`
      SELECT encounter_public_id
      FROM canonical_service_requests
      WHERE tenant_id = ? AND request_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<ServiceRequestDependencyRow>();
    if (!authority) {
      throw new CanonicalSyncOutboxConversionError('Canonical service-request dependency authority is missing');
    }
    dependencies.push(dependency('encounter', authority.encounter_public_id));
  } else if (mapping.entityType === 'service_event') {
    const authority = await db.prepare(`
      SELECT request_public_id,encounter_public_id
      FROM canonical_service_events
      WHERE tenant_id = ? AND event_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<ServiceEventDependencyRow>();
    if (!authority) {
      throw new CanonicalSyncOutboxConversionError('Canonical service-event dependency authority is missing');
    }
    dependencies.push(
      dependency('encounter', authority.encounter_public_id),
      dependency('service_request', authority.request_public_id),
    );
  } else if (mapping.entityType === 'invoice') {
    const authority = await db.prepare(`
      SELECT 1 AS present
      FROM canonical_invoices
      WHERE tenant_id = ? AND invoice_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<InvoiceAuthorityRow>();
    if (!authority) {
      throw new CanonicalSyncOutboxConversionError('Canonical invoice dependency authority is missing');
    }
    const encounterLink = await db.prepare(`
      SELECT encounter_public_id
      FROM canonical_invoice_encounter_links
      WHERE tenant_id = ? AND invoice_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<InvoiceEncounterDependencyRow>();
    if (encounterLink) {
      dependencies.push(dependency('encounter', encounterLink.encounter_public_id));
    }
    const serviceEvents = await loadRepeatedPublicIds(
      db,
      `SELECT service_event_public_id AS public_id
       FROM canonical_invoice_lines
       WHERE tenant_id = ? AND invoice_public_id = ?
         AND service_event_public_id IS NOT NULL
       ORDER BY service_event_public_id`,
      [row.tenantId, row.aggregatePublicId],
    );
    dependencies.push(...serviceEvents.map((publicId) => dependency('service_event', publicId)));
  } else if (mapping.entityType === 'payment_receipt') {
    const invoices = await loadRepeatedPublicIds(
      db,
      `SELECT invoice_public_id AS public_id
       FROM canonical_payment_allocations
       WHERE tenant_id = ? AND receipt_public_id = ?
       ORDER BY invoice_public_id`,
      [row.tenantId, row.aggregatePublicId],
    );
    dependencies.push(...invoices.map((publicId) => dependency('invoice', publicId)));
  } else if (mapping.entityType === 'deposit') {
    if (row.eventType === 'canonical.deposit.recorded') {
      dependencies.push(dependency('payment_receipt', payloadPublicId(payload, 'receiptPublicId')));
    } else if (row.eventType === 'canonical.deposit.applied') {
      dependencies.push(dependency('invoice', payloadPublicId(payload, 'invoicePublicId')));
    }
  } else if (mapping.entityType === 'compensation_accrual') {
    const authority = await db.prepare(`
      SELECT invoice_public_id,service_event_public_id
      FROM canonical_compensation_accruals
      WHERE tenant_id = ? AND accrual_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<CompensationDependencyRow>();
    if (!authority) {
      throw new CanonicalSyncOutboxConversionError('Canonical compensation dependency authority is missing');
    }
    dependencies.push(dependency('invoice', authority.invoice_public_id));
    if (authority.service_event_public_id) {
      dependencies.push(dependency('service_event', authority.service_event_public_id));
    }
  } else if (mapping.entityType === 'inventory_movement') {
    const authority = await db.prepare(`
      SELECT invoice_public_id,service_event_public_id
      FROM canonical_inventory_movements
      WHERE tenant_id = ? AND movement_public_id = ?
      LIMIT 1
    `).bind(row.tenantId, row.aggregatePublicId).first<InventoryDependencyRow>();
    if (!authority) {
      throw new CanonicalSyncOutboxConversionError('Canonical inventory dependency authority is missing');
    }
    if (authority.invoice_public_id) dependencies.push(dependency('invoice', authority.invoice_public_id));
    if (authority.service_event_public_id) {
      dependencies.push(dependency('service_event', authority.service_event_public_id));
    }
  }

  return dedupeDependencies(dependencies);
}

export async function convertCanonicalOutboxEventToSyncEnvelope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    sourceNodePublicId: string;
  },
): Promise<CanonicalSyncEnvelope> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const eventPublicId = exact(input.eventPublicId, 'eventPublicId');
  const sourceNodePublicId = exact(input.sourceNodePublicId, 'sourceNodePublicId');
  const row = await loadSourceRow(db, tenantId, eventPublicId);
  const mapping = mappingFor(row);
  const payload = parseEventPayload(row.payloadJson);
  assertAggregateIdentity(row, mapping, payload);
  const entityPublicId = resolveEntityPublicId(row, mapping, payload);
  const aggregateVersion = await deriveAggregateVersion(db, row, mapping, entityPublicId);
  const dependencies = await extractDependencies(db, row, mapping, payload);
  const operation = mapping.operationByEventType[row.eventType];
  if (!operation) {
    throw new CanonicalSyncOutboxConversionError(`Unsupported operation mapping for ${row.eventType}`);
  }

  try {
    let envelopePayload: Record<string, unknown> = payload;
    if (CANONICAL_SYNC_BUSINESS_PROJECTED_EVENT_TYPES.some((eventType) => eventType === row.eventType)) {
      const mutation = await projectCanonicalSyncBusinessMutation(db, {
        tenantId: row.tenantId,
        entityType: mapping.entityType,
        entityPublicId,
        eventType: row.eventType,
        occurredAtUtc: row.occurredAtUtc,
        businessDate: row.businessDate,
        event: payload,
      });
      envelopePayload = createCanonicalSyncBusinessPayload({ event: payload, mutation });
    }
    return await createCanonicalSyncEnvelope({
      tenantId: row.tenantId,
      eventPublicId: row.eventPublicId,
      entityType: mapping.entityType,
      entityPublicId,
      eventType: row.eventType,
      aggregateVersion,
      operation,
      occurredAtUtc: row.occurredAtUtc,
      sourceNodePublicId,
      payload: envelopePayload,
      dependencies,
    });
  } catch (error) {
    if (error instanceof CanonicalSyncOutboxConversionError) throw error;
    throw new CanonicalSyncOutboxConversionError(
      `Canonical outbox event cannot be converted: ${row.eventPublicId}`,
      { cause: error },
    );
  }
}

export const CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST = Object.freeze(
  MAPPINGS.flatMap((mapping) => mapping.allowedEventTypes.map((eventType) => ({
    aggregateType: mapping.aggregateType,
    entityType: mapping.entityType,
    eventType,
    operation: mapping.operationByEventType[eventType],
  }))),
);

export const CANONICAL_SYNC_OUTBOX_AGGREGATE_TYPES = Object.freeze(
  [...MAPPING_BY_AGGREGATE.keys()].sort(),
);
