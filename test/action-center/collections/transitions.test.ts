import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';
import {
  CollectionTransitionValidationError,
  transitionCollectionCase,
} from '../../../src/services/actionCenter/collections/transitions';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');
const taskMigration = readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8');

function createLegacyHarness() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      name TEXT NOT NULL
    );

    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT
    );

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT,
      created_at TEXT
    );
  `);
  harness.sqlite.exec(providerReviewsMigration);
  harness.sqlite.exec(collectionMigration);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name) VALUES
      (7, 'tenant-a', 'Collector A'),
      (8, 'tenant-a', 'Supervisor A'),
      (20, 'tenant-b', 'Private Tenant B User');

    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Patient A', '01700000001'),
      (2, 'tenant-b', 'Patient B', '01800000002');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES
      (101, 'tenant-a', 1, 'INV-101', 100, 20, 80, 'open', '2026-07-14 12:00:00'),
      (102, 'tenant-a', 1, 'INV-102', 50, 0, 50, 'open', '2026-07-14 12:00:00'),
      (201, 'tenant-b', 2, 'INV-201', 999, 0, 999, 'open', '2026-07-14 12:00:00');
  `);
  return harness;
}

function createCanonicalHarness() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      name TEXT NOT NULL
    );

    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT
    );

    CREATE TABLE canonical_feature_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      UNIQUE(tenant_id, flag_key)
    );

    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL,
      credited_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      UNIQUE(tenant_id, invoice_public_id)
    );

    CREATE TABLE canonical_source_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL
    );
  `);
  harness.sqlite.exec(providerReviewsMigration);
  harness.sqlite.exec(collectionMigration);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name)
    VALUES (7, 'tenant-a', 'Collector A');

    INSERT INTO patients (id, tenant_id, name, mobile)
    VALUES (1, 'tenant-a', 'Canonical Patient', '01700000001');

    INSERT INTO canonical_feature_flags (
      tenant_id, flag_key, domain, mode, is_enabled
    ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1);

    INSERT INTO canonical_invoices (
      tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
      currency_code, total_minor, paid_minor, due_minor, credited_minor,
      net_due_minor, status, issued_at_utc
    ) VALUES (
      'tenant-a', 'cinv-101', 'CINV-101', 1,
      'BDT', 10000, 2000, 8000, 1000, 7000, 'posted', '2026-07-14T06:00:00.000Z'
    );

    INSERT INTO canonical_source_mappings (
      tenant_id, entity_type, canonical_public_id, source_type,
      source_public_id, source_table, mapping_status
    ) VALUES ('tenant-a', 'invoice', 'cinv-101', 'legacy_bill', '101', 'bills', 'mapped');
  `);
  return harness;
}

describe('collection lifecycle transitions', () => {
  it('lazily creates a contacted case and append-only contact event in one request', async () => {
    const harness = createLegacyHarness();

    const result = await transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'contact',
        channel: 'phone',
        outcome: 'Patient answered',
        note: 'Explained the outstanding invoice.',
        nextFollowupAtUtc: '2026-07-17T04:00:00.000Z',
      },
    });

    expect(result).toEqual({ caseId: expect.any(Number), status: 'contacted' });
    expect(harness.sqlite.prepare(`
      SELECT tenant_id, legacy_bill_id, canonical_invoice_public_id, status,
             last_contacted_at_utc, next_followup_at_utc, latest_note,
             created_at_utc, updated_at_utc
      FROM collection_cases
    `).get()).toEqual({
      tenant_id: 'tenant-a',
      legacy_bill_id: 101,
      canonical_invoice_public_id: null,
      status: 'contacted',
      last_contacted_at_utc: '2026-07-15T04:00:00.000Z',
      next_followup_at_utc: '2026-07-17T04:00:00.000Z',
      latest_note: 'Explained the outstanding invoice.',
      created_at_utc: '2026-07-15T04:00:00.000Z',
      updated_at_utc: '2026-07-15T04:00:00.000Z',
    });

    const event = harness.sqlite.prepare(`
      SELECT event_type, actor_id, old_status, new_status, note, metadata_json
      FROM collection_case_events
    `).get() as Record<string, unknown>;
    expect(event).toMatchObject({
      event_type: 'contacted',
      actor_id: 7,
      old_status: 'new',
      new_status: 'contacted',
      note: 'Explained the outstanding invoice.',
    });
    expect(JSON.parse(String(event.metadata_json))).toEqual({
      channel: 'phone',
      outcome: 'Patient answered',
      nextFollowupAtUtc: '2026-07-17T04:00:00.000Z',
    });
  });

  it('upserts one stable linked task when collection follow-up changes repeatedly', async () => {
    const harness = createLegacyHarness();

    const first = await transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'follow_up',
        nextFollowupAtUtc: '2026-07-17T04:00:00.000Z',
        note: 'Call again after two days.',
      },
    });
    expect(first).toEqual({ caseId: expect.any(Number), status: 'contact_due' });

    const caseId = Number((first as { caseId: number }).caseId);
    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T04:00:00.000Z',
      nowUtc: '2026-07-15T05:00:00.000Z',
      action: {
        action: 'follow_up',
        nextFollowupAtUtc: '2026-07-18T04:00:00.000Z',
        note: 'Rescheduled after patient request.',
      },
    })).resolves.toEqual({ caseId, status: 'contact_due' });

    expect(harness.sqlite.prepare(`
      SELECT id, source_public_id, source_href, source_metadata_json,
             title, status, due_at_utc, assigned_to
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a' AND source_type = 'collection'
    `).all()).toEqual([
      expect.objectContaining({
        source_public_id: `collection-case:${caseId}`,
        source_href: `/action/collections?case=${caseId}`,
        source_metadata_json: JSON.stringify({
          legacyBillId: 101,
          collectionCaseId: caseId,
        }),
        title: 'Follow up collection INV-101',
        status: 'open',
        due_at_utc: '2026-07-18T04:00:00.000Z',
        assigned_to: null,
      }),
    ]);
    expect(harness.sqlite.prepare(`
      SELECT event_type
      FROM admin_action_task_events
      WHERE tenant_id = 'tenant-a'
      ORDER BY id
    `).all()).toEqual([
      { event_type: 'created' },
      { event_type: 'source_updated' },
    ]);
  });

  it('enriches the same collection task when canonical invoice identity becomes available', async () => {
    const harness = createCanonicalHarness();
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, legacy_bill_id, status, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'contact_due', ?, ?)
    `).run(
      'tenant-a',
      101,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T03:00:00.000Z',
    );
    const caseId = Number((harness.sqlite.prepare(`
      SELECT id FROM collection_cases WHERE tenant_id = 'tenant-a'
    `).get() as { id: number }).id);
    harness.sqlite.prepare(`
      INSERT INTO admin_action_tasks (
        tenant_id, title, source_type, source_public_id, source_href,
        source_metadata_json, priority, status, due_at_utc, created_by,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'collection', ?, ?, ?, 'medium', 'open', ?, ?, ?, ?)
    `).run(
      'tenant-a',
      'Follow up collection LEG-101',
      `collection-case:${caseId}`,
      `/action/collections?case=${caseId}`,
      JSON.stringify({ legacyBillId: 101, collectionCaseId: caseId }),
      '2026-07-17T04:00:00.000Z',
      7,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T03:00:00.000Z',
    );

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-101',
        legacyBillId: 101,
      },
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T03:00:00.000Z',
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'follow_up',
        nextFollowupAtUtc: '2026-07-19T04:00:00.000Z',
        note: 'Canonical invoice confirmed.',
      },
    })).resolves.toEqual({ caseId, status: 'contact_due' });

    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count, source_metadata_json, due_at_utc
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a' AND source_public_id = ?
    `).get(`collection-case:${caseId}`)).toEqual({
      count: 1,
      source_metadata_json: JSON.stringify({
        legacyBillId: 101,
        canonicalInvoicePublicId: 'cinv-101',
        collectionCaseId: caseId,
      }),
      due_at_utc: '2026-07-19T04:00:00.000Z',
    });
  });

  it('stores both canonical and legacy source identities for a canonical case', async () => {
    const harness = createCanonicalHarness();

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-101',
        legacyBillId: 101,
      },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'promise',
        promiseDate: '2026-07-20',
        promiseAmountMinor: 6_000,
        currencyCode: 'BDT',
        note: 'Patient promised a partial payment.',
      },
    })).resolves.toEqual({ caseId: expect.any(Number), status: 'promised' });

    expect(harness.sqlite.prepare(`
      SELECT canonical_invoice_public_id, legacy_bill_id, promise_amount_minor,
             currency_code, status
      FROM collection_cases
    `).get()).toEqual({
      canonical_invoice_public_id: 'cinv-101',
      legacy_bill_id: 101,
      promise_amount_minor: 6000,
      currency_code: 'BDT',
      status: 'promised',
    });
  });

  it('enriches a legacy-only workflow case with the validated canonical invoice identity', async () => {
    const harness = createCanonicalHarness();
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, legacy_bill_id, status, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'new', ?, ?)
    `).run(
      'tenant-a',
      101,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T03:00:00.000Z',
    );

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-101',
        legacyBillId: 101,
      },
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T03:00:00.000Z',
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'contact',
        channel: 'phone',
        outcome: 'Answered',
        note: 'Canonical identity confirmed during contact.',
      },
    })).resolves.toEqual({ caseId: expect.any(Number), status: 'contacted' });

    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count,
             canonical_invoice_public_id,
             legacy_bill_id,
             status
      FROM collection_cases
    `).get()).toEqual({
      count: 1,
      canonical_invoice_public_id: 'cinv-101',
      legacy_bill_id: 101,
      status: 'contacted',
    });
  });

  it('rejects promises that exceed live due, mismatch currency, or use an invalid date', async () => {
    const harness = createLegacyHarness();

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'promise',
        promiseDate: '2026-07-20',
        promiseAmountMinor: 8_001,
        currencyCode: 'BDT',
        note: 'Too much.',
      },
    })).rejects.toThrow(/cannot exceed the live due/i);

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'promise',
        promiseDate: '2026-07-20',
        promiseAmountMinor: 5_000,
        currencyCode: 'USD',
        note: 'Wrong currency.',
      },
    })).rejects.toThrow(/currency/i);

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'promise',
        promiseDate: '2026-07-14',
        promiseAmountMinor: 5_000,
        currencyCode: 'BDT',
        note: 'Past promise.',
      },
    })).rejects.toThrow(/promise date/i);

    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_cases').get()).toEqual({ count: 0 });
  });

  it('validates future follow-up timestamps and required dispute/escalation evidence', async () => {
    const harness = createLegacyHarness();

    const invalidActions = [
      {
        action: 'follow_up' as const,
        nextFollowupAtUtc: '2026-07-15T03:59:59.000Z',
        note: 'Past follow-up',
      },
      {
        action: 'dispute' as const,
        reason: ' ',
        note: 'Patient disagrees.',
      },
      {
        action: 'escalate' as const,
        reason: 'Repeated non-response',
        note: ' ',
      },
    ];

    for (const action of invalidActions) {
      await expect(transitionCollectionCase({
        db: harness.db,
        tenantId: 'tenant-a',
        source: { sourceType: 'invoice', legacyBillId: 101 },
        actorId: 7,
        nowUtc: '2026-07-15T04:00:00.000Z',
        action,
      })).rejects.toBeInstanceOf(CollectionTransitionValidationError);
    }
  });

  it('validates an escalation assignee inside the same tenant', async () => {
    const harness = createLegacyHarness();

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'escalate',
        reason: 'Repeated non-response',
        note: 'Escalating to supervisor.',
        assignedTo: 20,
      },
    })).rejects.toThrow(/assignee/i);

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'escalate',
        reason: 'Repeated non-response',
        note: 'Escalating to supervisor.',
        assignedTo: 8,
      },
    })).resolves.toEqual({ caseId: expect.any(Number), status: 'escalated' });

    expect(harness.sqlite.prepare('SELECT assigned_to, status FROM collection_cases').get()).toEqual({
      assigned_to: 8,
      status: 'escalated',
    });
  });

  it('returns conflict for a stale expected timestamp and does not append a second event', async () => {
    const harness = createLegacyHarness();
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, legacy_bill_id, status, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'new', ?, ?)
    `).run('tenant-a', 101, '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z');

    const first = await transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T03:00:00.000Z',
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'follow_up',
        nextFollowupAtUtc: '2026-07-17T04:00:00.000Z',
        note: 'Call again.',
      },
    });
    expect(first).toEqual({ caseId: expect.any(Number), status: 'contact_due' });

    const stale = await transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T03:00:00.000Z',
      nowUtc: '2026-07-15T05:00:00.000Z',
      action: {
        action: 'contact',
        channel: 'phone',
        outcome: 'Answered',
        note: 'This stale update must not win.',
      },
    });

    expect(stale).toBe('conflict');
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_case_events').get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare('SELECT status, latest_note FROM collection_cases').get()).toEqual({
      status: 'contact_due',
      latest_note: 'Call again.',
    });
  });

  it('does not reveal or mutate another tenant source', async () => {
    const harness = createLegacyHarness();

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 201 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'contact',
        channel: 'phone',
        outcome: 'Answered',
        note: 'Should not be visible.',
      },
    })).resolves.toBe('not_found');

    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_cases').get()).toEqual({ count: 0 });
  });

  it('rolls back the case mutation when the event append fails', async () => {
    const harness = createLegacyHarness();
    harness.sqlite.exec(`
      CREATE TRIGGER block_collection_event
      BEFORE INSERT ON collection_case_events
      BEGIN
        SELECT RAISE(ABORT, 'event blocked');
      END;
    `);

    await expect(transitionCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
      action: {
        action: 'contact',
        channel: 'phone',
        outcome: 'Answered',
        note: 'Must roll back.',
      },
    })).rejects.toThrow(/event blocked/);

    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_cases').get()).toEqual({ count: 0 });
  });
});
