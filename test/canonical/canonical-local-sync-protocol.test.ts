import { describe, expect, it } from 'vitest';
import {
  CanonicalSyncConflictError,
  createCanonicalSyncEnvelope,
  planCanonicalSyncApply,
  validateCanonicalSyncEnvelope,
  type CanonicalSyncDependency,
  type CanonicalSyncEnvelope,
  type CanonicalSyncEntityVersion,
  type CreateCanonicalSyncEnvelopeInput,
} from '../../src/lib/canonical/local-sync-protocol';

const TENANT = '100';
const NOW = '2026-07-25T00:00:00Z';

function baseInput(overrides: Partial<CreateCanonicalSyncEnvelopeInput> = {}): CreateCanonicalSyncEnvelopeInput {
  return {
    tenantId: TENANT,
    eventPublicId: 'event-invoice-1',
    entityType: 'invoice',
    entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.issued',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: NOW,
    sourceNodePublicId: 'node-local-1',
    payload: { totalMinor: 10000, currencyCode: 'BDT' },
    dependencies: [],
    ...overrides,
  };
}

async function envelope(overrides: Partial<CreateCanonicalSyncEnvelopeInput> = {}): Promise<CanonicalSyncEnvelope> {
  return createCanonicalSyncEnvelope(baseInput(overrides));
}

function current(overrides: Partial<CanonicalSyncEntityVersion> = {}): CanonicalSyncEntityVersion {
  return {
    tenantId: TENANT,
    entityType: 'invoice',
    entityPublicId: 'invoice-1',
    appliedVersion: 1,
    lastEventPublicId: 'event-invoice-1',
    lastOperation: 'upsert',
    lastPayloadSha256: 'a'.repeat(64),
    ...overrides,
  };
}

function dep(entityType: string, entityPublicId: string, minimumVersion = 1): CanonicalSyncDependency {
  return { entityType, entityPublicId, minimumVersion };
}

describe('canonical local sync protocol envelope', () => {
  it('produces stable payload hashes and idempotency keys independent of object/dependency order', async () => {
    const first = await envelope({
      payload: { b: 2, a: { y: true, x: 1 } },
      dependencies: [dep('service_event', 'svc-1'), dep('encounter', 'enc-1')],
    });
    const second = await envelope({
      payload: { a: { x: 1, y: true }, b: 2 },
      dependencies: [dep('encounter', 'enc-1'), dep('service_event', 'svc-1')],
    });

    expect(first.payloadSha256).toBe(second.payloadSha256);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.dependencies).toEqual([
      dep('encounter', 'enc-1'),
      dep('service_event', 'svc-1'),
    ]);
    await expect(validateCanonicalSyncEnvelope(first)).resolves.toEqual(first);
  });

  it('rejects tampered evidence and invalid envelope semantics', async () => {
    const valid = await envelope();
    await expect(validateCanonicalSyncEnvelope({
      ...valid,
      payload: { ...valid.payload, totalMinor: 9999 },
    })).rejects.toThrow(/payload digest/i);
    await expect(validateCanonicalSyncEnvelope({
      ...valid,
      idempotencyKey: 'wrong',
    })).rejects.toThrow(/idempotency/i);

    await expect(envelope({ aggregateVersion: 0 })).rejects.toThrow(/aggregateVersion/i);
    await expect(envelope({ occurredAtUtc: '2026-07-25 00:00:00' })).rejects.toThrow(/occurredAtUtc/i);
    await expect(envelope({ operation: 'delete' as 'upsert' })).rejects.toThrow(/operation/i);
    await expect(envelope({ dependencies: [dep('invoice', 'invoice-1')] })).rejects.toThrow(/self-dependency/i);
    await expect(envelope({ dependencies: [dep('encounter', 'enc-1'), dep('encounter', 'enc-1', 2)] })).rejects.toThrow(/duplicate dependency/i);
    await expect(envelope({ eventPublicId: '123' })).rejects.toThrow(/public identifier/i);
    await expect(envelope({ entityPublicId: '456' })).rejects.toThrow(/public identifier/i);
    await expect(envelope({ sourceNodePublicId: '789' })).rejects.toThrow(/public identifier/i);
  });

  it('accepts tombstones as protocol corrections without physical-delete semantics', async () => {
    const tombstone = await envelope({
      eventPublicId: 'event-invoice-2',
      aggregateVersion: 2,
      eventType: 'canonical.invoice.cancelled',
      operation: 'tombstone',
      payload: { reasonCode: 'owner_cancelled' },
    });
    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [tombstone],
      currentVersions: [current({
        lastPayloadSha256: (await envelope()).payloadSha256,
      })],
    });
    expect(plan.ready.map((item) => item.eventPublicId)).toEqual(['event-invoice-2']);
    expect(plan.ready[0].operation).toBe('tombstone');
  });
});

describe('canonical local sync apply planner', () => {
  it('fails closed on cross-tenant envelope or version input', async () => {
    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [await envelope({ tenantId: '200' })],
      currentVersions: [],
    })).rejects.toThrow(/tenant/i);
    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [],
      currentVersions: [current({ tenantId: '200' })],
    })).rejects.toThrow(/tenant/i);
  });

  it('classifies identical duplicate events as replay and conflicting duplicates as errors', async () => {
    const item = await envelope();
    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [item, structuredClone(item)],
      currentVersions: [],
    });
    expect(plan.ready).toHaveLength(1);
    expect(plan.replay).toHaveLength(1);

    const conflicting = await envelope({ payload: { totalMinor: 20000, currencyCode: 'BDT' } });
    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [item, conflicting],
      currentVersions: [],
    })).rejects.toBeInstanceOf(CanonicalSyncConflictError);
  });

  it('replays matching applied evidence and rejects mismatched historical evidence', async () => {
    const item = await envelope();
    const applied = current({ lastPayloadSha256: item.payloadSha256 });
    const replay = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [item],
      currentVersions: [applied],
    });
    expect(replay.replay.map((entry) => entry.eventPublicId)).toEqual(['event-invoice-1']);
    expect(replay.ready).toHaveLength(0);

    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [item],
      currentVersions: [current({ lastPayloadSha256: 'b'.repeat(64) })],
    })).rejects.toBeInstanceOf(CanonicalSyncConflictError);
  });

  it('blocks version gaps and missing dependencies with stable reasons', async () => {
    const gap = await envelope({ eventPublicId: 'event-invoice-3', aggregateVersion: 3 });
    const missing = await envelope({
      eventPublicId: 'event-payment-1',
      entityType: 'payment_receipt',
      entityPublicId: 'receipt-1',
      eventType: 'canonical.payment.receipt.posted',
      dependencies: [dep('invoice', 'invoice-1', 1)],
    });
    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [gap, missing],
      currentVersions: [],
    });
    expect(plan.blocked.map(({ envelope: item, reasons }) => ({ event: item.eventPublicId, reasons }))).toEqual([
      { event: 'event-invoice-3', reasons: ['VERSION_GAP'] },
      { event: 'event-payment-1', reasons: ['DEPENDENCY_MISSING'] },
    ]);
  });

  it('orders a complete canonical dependency chain deterministically', async () => {
    const encounter = await envelope({
      eventPublicId: 'event-encounter-1', entityType: 'encounter', entityPublicId: 'enc-1',
      eventType: 'canonical.encounter.started', payload: { patientId: 'pat-1' },
    });
    const request = await envelope({
      eventPublicId: 'event-request-1', entityType: 'service_request', entityPublicId: 'req-1',
      eventType: 'canonical.service_request.created', dependencies: [dep('encounter', 'enc-1')],
    });
    const serviceEvent = await envelope({
      eventPublicId: 'event-service-1', entityType: 'service_event', entityPublicId: 'svc-1',
      eventType: 'canonical.service_event.recorded', dependencies: [dep('service_request', 'req-1'), dep('encounter', 'enc-1')],
    });
    const invoice = await envelope({
      eventPublicId: 'event-invoice-1', dependencies: [dep('service_event', 'svc-1'), dep('encounter', 'enc-1')],
    });
    const payment = await envelope({
      eventPublicId: 'event-payment-1', entityType: 'payment_receipt', entityPublicId: 'receipt-1',
      eventType: 'canonical.payment.receipt.posted', dependencies: [dep('invoice', 'invoice-1')],
    });
    const deposit = await envelope({
      eventPublicId: 'event-deposit-1', entityType: 'deposit', entityPublicId: 'deposit-1',
      eventType: 'canonical.deposit.recorded', dependencies: [dep('payment_receipt', 'receipt-1')],
    });
    const compensation = await envelope({
      eventPublicId: 'event-compensation-1', entityType: 'compensation_accrual', entityPublicId: 'accrual-1',
      eventType: 'canonical.compensation.accrued', dependencies: [dep('invoice', 'invoice-1'), dep('service_event', 'svc-1')],
    });

    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [payment, invoice, serviceEvent, compensation, request, encounter, deposit],
      currentVersions: [],
    });
    expect(plan.ready.map((item) => item.eventPublicId)).toEqual([
      'event-encounter-1',
      'event-request-1',
      'event-service-1',
      'event-invoice-1',
      'event-compensation-1',
      'event-payment-1',
      'event-deposit-1',
    ]);
    expect(plan.blocked).toEqual([]);
  });

  it('plans multiple aggregate versions serially and rejects same-version conflicts', async () => {
    const first = await envelope();
    const second = await envelope({
      eventPublicId: 'event-invoice-2', aggregateVersion: 2, payload: { totalMinor: 11000 },
    });
    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [second, first],
      currentVersions: [],
    });
    expect(plan.ready.map((item) => item.eventPublicId)).toEqual(['event-invoice-1', 'event-invoice-2']);

    const conflict = await envelope({
      eventPublicId: 'event-invoice-other', aggregateVersion: 1, payload: { totalMinor: 12000 },
    });
    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [first, conflict],
      currentVersions: [],
    })).rejects.toBeInstanceOf(CanonicalSyncConflictError);
  });

  it('does not misclassify version-gapped circular input as an actionable dependency cycle', async () => {
    const first = await envelope({
      eventPublicId: 'event-gap-a', entityType: 'service_request', entityPublicId: 'a',
      aggregateVersion: 2,
      dependencies: [dep('service_event', 'b')],
    });
    const second = await envelope({
      eventPublicId: 'event-gap-b', entityType: 'service_event', entityPublicId: 'b',
      aggregateVersion: 2,
      dependencies: [dep('service_request', 'a')],
    });
    const plan = await planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [first, second],
      currentVersions: [],
    });
    expect(plan.blocked.map((entry) => entry.reasons)).toEqual([
      ['VERSION_GAP', 'DEPENDENCY_MISSING'],
      ['VERSION_GAP', 'DEPENDENCY_MISSING'],
    ]);
  });

  it('fails closed on actionable dependency cycles', async () => {
    const first = await envelope({
      eventPublicId: 'event-a', entityType: 'service_request', entityPublicId: 'a',
      dependencies: [dep('service_event', 'b')],
    });
    const second = await envelope({
      eventPublicId: 'event-b', entityType: 'service_event', entityPublicId: 'b',
      dependencies: [dep('service_request', 'a')],
    });
    await expect(planCanonicalSyncApply({
      tenantId: TENANT,
      envelopes: [first, second],
      currentVersions: [],
    })).rejects.toThrow(/cycle/i);
  });
});
