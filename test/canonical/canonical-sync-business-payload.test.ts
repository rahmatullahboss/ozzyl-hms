import { describe, expect, it } from 'vitest';
import {
  CanonicalSyncBusinessPayloadError,
  createCanonicalSyncBusinessPayload,
  parseCanonicalSyncBusinessPayload,
} from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

const event = {
  encounterPublicId: 'encounter-1',
  encounterType: 'outpatient',
  status: 'in_progress',
};

const mutation = {
  kind: 'encounter_started' as const,
  entityPublicId: 'encounter-1',
  patientSyncKey: 'uhid:P-001',
  encounterType: 'outpatient' as const,
  startedAtUtc: '2026-07-25T01:00:00Z',
  sourceEvidenceSha256: 'a'.repeat(64),
};

async function envelope(payload: Record<string, unknown> = createCanonicalSyncBusinessPayload({
  event,
  mutation,
})) {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: 'outbox-encounter-1',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: '2026-07-25T01:00:00Z',
    sourceNodePublicId: 'node-local-1',
    payload,
  });
}

describe('canonical sync business payload contract', () => {
  it('creates and parses an authenticated version-one event-time mutation wrapper', async () => {
    const wrapped = createCanonicalSyncBusinessPayload({ event, mutation });
    expect(wrapped).toEqual({ schemaVersion: 1, event, mutation });

    const parsed = parseCanonicalSyncBusinessPayload(await envelope(wrapped));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.event).toEqual(event);
    expect(parsed.mutation).toEqual(mutation);
  });

  it('rejects a raw compact event payload without authenticated mutation authority', async () => {
    await expect(async () => parseCanonicalSyncBusinessPayload(await envelope(event)))
      .rejects.toThrow(/business payload/i);
  });

  it('rejects unsupported schemas and non-plain event or mutation values', async () => {
    await expect(async () => parseCanonicalSyncBusinessPayload(await envelope({
      schemaVersion: 2,
      event,
      mutation,
    }))).rejects.toThrow(/schemaVersion/i);

    await expect(async () => parseCanonicalSyncBusinessPayload(await envelope({
      schemaVersion: 1,
      event: [],
      mutation,
    }))).rejects.toThrow(/plain object/i);
  });

  it('rejects entity, event, operation, mutation-kind, and identity mismatches', async () => {
    const base = createCanonicalSyncBusinessPayload({ event, mutation });
    const wrongKind = await envelope({
      ...base,
      mutation: { ...mutation, kind: 'invoice_issued' },
    });
    expect(() => parseCanonicalSyncBusinessPayload(wrongKind)).toThrow(/mutation kind/i);

    const wrongIdentity = await envelope({
      ...base,
      mutation: { ...mutation, entityPublicId: 'encounter-other' },
    });
    expect(() => parseCanonicalSyncBusinessPayload(wrongIdentity)).toThrow(/entity identity/i);

    const wrongOperation = await createCanonicalSyncEnvelope({
      ...(await envelope(base)),
      operation: 'tombstone',
    });
    expect(() => parseCanonicalSyncBusinessPayload(wrongOperation)).toThrow(/operation/i);
  });

  it('rejects raw numeric public identities and malformed UTC/hash authority', async () => {
    const numeric = await envelope(createCanonicalSyncBusinessPayload({
      event,
      mutation: { ...mutation, patientSyncKey: '12345' },
    }));
    expect(() => parseCanonicalSyncBusinessPayload(numeric)).toThrow(/patientSyncKey/i);

    const badUtc = await envelope(createCanonicalSyncBusinessPayload({
      event,
      mutation: { ...mutation, startedAtUtc: '2026-07-25 01:00:00' },
    }));
    expect(() => parseCanonicalSyncBusinessPayload(badUtc)).toThrow(/startedAtUtc/i);

    const badHash = await envelope(createCanonicalSyncBusinessPayload({
      event,
      mutation: { ...mutation, sourceEvidenceSha256: 'bad' },
    }));
    expect(() => parseCanonicalSyncBusinessPayload(badHash)).toThrow(/sourceEvidenceSha256/i);
  });

  it('rejects payment reversal balance or refund authority tampering', async () => {
    const reversalMutation = {
      kind: 'payment_reversed' as const,entityPublicId: 'receipt-1',reversalPublicId: 'reversal-1',
      refundPublicId: 'refund-1',receiptPublicId: 'receipt-1',tenderPublicId: 'tender-1',
      allocationPublicId: 'allocation-1',invoicePublicId: 'invoice-1',amountMinor: 200,
      reasonCode: 'operator_correction',tenderType: 'cash' as const,methodCode: 'cash',
      reversedAtUtc: '2026-07-25T06:00:00Z',businessDate: '2026-07-25',
      allocationReversedBeforeMinor: 0,allocationReversedAfterMinor: 200,
      tenderReversedBeforeMinor: 0,tenderReversedAfterMinor: 200,
      receiptRefundedBeforeMinor: 0,receiptRefundedAfterMinor: 200,
      invoicePaidBeforeMinor: 800,invoicePaidAfterMinor: 600,
      invoiceDueBeforeMinor: 200,invoiceDueAfterMinor: 400,
      invoiceNetDueBeforeMinor: 200,invoiceNetDueAfterMinor: 400,
      sourceEvidenceSha256: 'a'.repeat(64),refundSourceEvidenceSha256: 'b'.repeat(64),
    };
    const reversalEvent = {
      allocationPublicId: 'allocation-1',amountMinor: 200,receiptPublicId: 'receipt-1',
      refundPublicId: 'refund-1',reversalPublicId: 'reversal-1',tenderPublicId: 'tender-1',
    };
    const invalid = await createCanonicalSyncEnvelope({
      tenantId: '100',eventPublicId: 'outbox-reversal-1',entityType: 'payment_receipt',
      entityPublicId: 'receipt-1',eventType: 'canonical.payment.reversed',aggregateVersion: 2,
      operation: 'tombstone',occurredAtUtc: '2026-07-25T06:00:00Z',sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: reversalEvent,
        mutation: { ...reversalMutation, invoiceDueAfterMinor: 399 },
      }),
    });
    expect(() => parseCanonicalSyncBusinessPayload(invalid)).toThrow(/balances/i);
  });

  it('accepts encounter and service-request lifecycle cancellation mutations as upserts', async () => {
    const encounterCancellation = await createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: 'outbox-encounter-cancel',
      entityType: 'encounter',
      entityPublicId: 'encounter-1',
      eventType: 'canonical.encounter.cancelled',
      aggregateVersion: 2,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T02:00:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: { encounterPublicId: 'encounter-1', status: 'cancelled' },
        mutation: {
          kind: 'encounter_cancelled',
          entityPublicId: 'encounter-1',
          encounterType: 'outpatient',
          startedAtUtc: '2026-07-25T01:00:00Z',
          cancelledAtUtc: '2026-07-25T02:00:00Z',
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      }),
    });
    expect(parseCanonicalSyncBusinessPayload(encounterCancellation).mutation.kind)
      .toBe('encounter_cancelled');

    const requestCancellation = await createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: 'outbox-request-cancel',
      entityType: 'service_request',
      entityPublicId: 'request-1',
      eventType: 'canonical.service_request.cancelled',
      aggregateVersion: 2,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T01:30:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: { requestPublicId: 'request-1', status: 'cancelled', fulfilledQuantity: 1 },
        mutation: {
          kind: 'service_request_cancelled',
          entityPublicId: 'request-1',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          fulfilledQuantity: 1,
          requestedAtUtc: '2026-07-25T01:10:00Z',
          cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'b'.repeat(64),
        },
      }),
    });
    expect(parseCanonicalSyncBusinessPayload(requestCancellation).mutation.kind)
      .toBe('service_request_cancelled');

    const wrongOperation = await createCanonicalSyncEnvelope({
      ...requestCancellation,
      operation: 'tombstone',
    });
    expect(() => parseCanonicalSyncBusinessPayload(wrongOperation)).toThrow(/operation/i);

    const fulfilled = await createCanonicalSyncEnvelope({
      ...requestCancellation,
      payload: createCanonicalSyncBusinessPayload({
        event: { requestPublicId: 'request-1', status: 'cancelled', fulfilledQuantity: 2 },
        mutation: {
          kind: 'service_request_cancelled',
          entityPublicId: 'request-1',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          fulfilledQuantity: 2,
          requestedAtUtc: '2026-07-25T01:10:00Z',
          cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'b'.repeat(64),
        },
      }),
    });
    expect(() => parseCanonicalSyncBusinessPayload(fulfilled)).toThrow(/fulfilledQuantity/i);
  });

  it('accepts service-event cancellation and deposit refund lifecycle upserts', async () => {
    const eventCancellation = await createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: 'outbox-service-event-cancel',
      entityType: 'service_event',
      entityPublicId: 'service-event-1',
      eventType: 'canonical.service_event.cancelled',
      aggregateVersion: 2,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T01:30:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: {
          eventPublicId: 'service-event-1',
          requestPublicId: 'request-1',
          status: 'cancelled',
          fulfilledQuantityBefore: 2,
          fulfilledQuantityAfter: 0,
          requestStatusAfter: 'active',
          previousEventPublicId: null,
        },
        mutation: {
          kind: 'service_event_cancelled',
          entityPublicId: 'service-event-1',
          requestPublicId: 'request-1',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          serviceEventType: 'completed',
          quantity: 2,
          requestedQuantity: 5,
          fulfilledQuantityBefore: 2,
          fulfilledQuantityAfter: 0,
          requestStatusBefore: 'partially_fulfilled',
          requestStatusAfter: 'active',
          previousEventPublicId: null,
          occurredAtUtc: '2026-07-25T01:20:00Z',
          cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'c'.repeat(64),
        },
      }),
    });
    expect(parseCanonicalSyncBusinessPayload(eventCancellation).mutation.kind)
      .toBe('service_event_cancelled');

    const depositRefund = await createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: 'outbox-deposit-refund',
      entityType: 'deposit',
      entityPublicId: 'deposit-1',
      eventType: 'canonical.deposit.refunded',
      aggregateVersion: 2,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T02:00:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: {
          refundPublicId: 'refund-1',
          depositPublicId: 'deposit-1',
          amountMinor: 100,
          tenderType: 'cash',
        },
        mutation: {
          kind: 'deposit_refunded',
          entityPublicId: 'deposit-1',
          refundPublicId: 'refund-1',
          amountMinor: 100,
          tenderType: 'cash',
          methodCode: 'cash',
          refundedAtUtc: '2026-07-25T02:00:00Z',
          businessDate: '2026-07-25',
          depositAvailableBeforeMinor: 500,
          depositAvailableAfterMinor: 400,
          depositRefundedBeforeMinor: 0,
          depositRefundedAfterMinor: 100,
          depositSourceEvidenceSha256: 'd'.repeat(64),
          refundSourceEvidenceSha256: 'e'.repeat(64),
        },
      }),
    });
    expect(parseCanonicalSyncBusinessPayload(depositRefund).mutation.kind)
      .toBe('deposit_refunded');
  });

  it('rejects terminal mutation balance, status, and timestamp tampering', async () => {
    const eventEnvelope = async (overrides: Record<string, unknown>) => createCanonicalSyncEnvelope({
      tenantId: '100',eventPublicId: 'outbox-service-event-cancel',entityType: 'service_event',
      entityPublicId: 'service-event-1',eventType: 'canonical.service_event.cancelled',aggregateVersion: 2,
      operation: 'upsert',occurredAtUtc: '2026-07-25T01:30:00Z',sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: { eventPublicId: 'service-event-1', requestPublicId: 'request-1', status: 'cancelled' },
        mutation: {
          kind: 'service_event_cancelled',entityPublicId: 'service-event-1',requestPublicId: 'request-1',
          encounterPublicId: 'encounter-1',servicePublicId: 'service-1',serviceEventType: 'completed',
          quantity: 2,requestedQuantity: 5,fulfilledQuantityBefore: 2,fulfilledQuantityAfter: 0,
          requestStatusBefore: 'partially_fulfilled',requestStatusAfter: 'active',previousEventPublicId: null,
          occurredAtUtc: '2026-07-25T01:20:00Z',cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'c'.repeat(64),...overrides,
        },
      }),
    });
    const badBalance = await eventEnvelope({ fulfilledQuantityAfter: 1 });
    const badStatus = await eventEnvelope({ requestStatusAfter: 'fulfilled' });
    const badTime = await eventEnvelope({ cancelledAtUtc: '2026-07-25T01:10:00Z' });
    expect(() => parseCanonicalSyncBusinessPayload(badBalance)).toThrow(/balances/i);
    expect(() => parseCanonicalSyncBusinessPayload(badStatus)).toThrow(/statuses/i);
    expect(() => parseCanonicalSyncBusinessPayload(badTime)).toThrow(/cannot precede/i);

    const invalidDeposit = await createCanonicalSyncEnvelope({
      tenantId: '100',eventPublicId: 'outbox-deposit-refund',entityType: 'deposit',
      entityPublicId: 'deposit-1',eventType: 'canonical.deposit.refunded',aggregateVersion: 2,
      operation: 'upsert',occurredAtUtc: '2026-07-25T02:00:00Z',sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: { refundPublicId: 'refund-1', depositPublicId: 'deposit-1', amountMinor: 100, tenderType: 'cash' },
        mutation: {
          kind: 'deposit_refunded',entityPublicId: 'deposit-1',refundPublicId: 'refund-1',amountMinor: 100,
          tenderType: 'cash',methodCode: 'cash',refundedAtUtc: '2026-07-25T02:00:00Z',businessDate: '2026-07-25',
          depositAvailableBeforeMinor: 500,depositAvailableAfterMinor: 399,
          depositRefundedBeforeMinor: 0,depositRefundedAfterMinor: 100,
          depositSourceEvidenceSha256: 'd'.repeat(64),refundSourceEvidenceSha256: 'e'.repeat(64),
        },
      }),
    });
    expect(() => parseCanonicalSyncBusinessPayload(invalidDeposit)).toThrow(/balances/i);
  });

  it('binds mutation authority into payload digest and idempotency identity', async () => {
    const first = await envelope(createCanonicalSyncBusinessPayload({ event, mutation }));
    const second = await envelope(createCanonicalSyncBusinessPayload({
      event,
      mutation: { ...mutation, patientSyncKey: 'uhid:P-002' },
    }));
    expect(first.payloadSha256).not.toBe(second.payloadSha256);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('exposes a stable typed error for unsupported payloads', async () => {
    try {
      parseCanonicalSyncBusinessPayload(await envelope(event));
      throw new Error('Expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSyncBusinessPayloadError);
      expect((error as CanonicalSyncBusinessPayloadError).code).toBe('CANONICAL_SYNC_BUSINESS_PAYLOAD');
    }
  });
});
