import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';
import { reconcileCollectionCase } from '../../../src/services/actionCenter/collections/reconcile';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');
const taskMigration = readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8');

function createLegacyHarness() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
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
      (7, 'tenant-a', 'Collection Admin'),
      (20, 'tenant-b', 'Other Tenant Admin');

    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Patient A', '01700000001'),
      (2, 'tenant-b', 'Patient B', '01800000002');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES
      (101, 'tenant-a', 1, 'INV-PAID', 100, 100, 0, 'paid', '2026-07-14 12:00:00'),
      (102, 'tenant-a', 1, 'INV-OPEN', 100, 20, 80, 'open', '2026-07-14 12:00:00'),
      (103, 'tenant-a', 1, 'INV-CANCELLED', 100, 0, 100, 'cancelled', '2026-07-14 12:00:00'),
      (104, 'tenant-a', 1, 'INV-REFUNDED', 100, 0, 100, 'refunded', '2026-07-14 12:00:00'),
      (201, 'tenant-b', 2, 'INV-B', 999, 999, 0, 'paid', '2026-07-14 12:00:00');

    INSERT INTO collection_cases (
      tenant_id, legacy_bill_id, status, latest_note, created_at_utc, updated_at_utc
    ) VALUES
      ('tenant-a', 101, 'contacted', 'Paid case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z'),
      ('tenant-a', 102, 'promised', 'Open case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z'),
      ('tenant-a', 103, 'disputed', 'Cancelled case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z'),
      ('tenant-a', 104, 'escalated', 'Refunded case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z'),
      ('tenant-b', 201, 'contacted', 'Tenant B case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z');
  `);
  return harness;
}

function createCanonicalHarness(mode: 'canonical' | 'shadow') {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
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
  harness.sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id, flag_key, domain, mode, is_enabled
    ) VALUES ('tenant-a', 'billing.receivables', 'billing', ?, 1)
  `).run(mode);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name)
    VALUES (7, 'tenant-a', 'Collection Admin');

    INSERT INTO patients (id, tenant_id, name, mobile)
    VALUES (1, 'tenant-a', 'Canonical Patient', '01700000001');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES (101, 'tenant-a', 1, 'LEG-101', 100, 20, 80, 'open', '2026-07-14 12:00:00');

    INSERT INTO canonical_invoices (
      tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
      currency_code, total_minor, paid_minor, due_minor, credited_minor,
      net_due_minor, status, issued_at_utc
    ) VALUES (
      'tenant-a', 'cinv-101', 'CINV-101', 1,
      'BDT', 10000, 10000, 0, 0, 0, 'posted', '2026-07-14T06:00:00.000Z'
    );

    INSERT INTO canonical_source_mappings (
      tenant_id, entity_type, canonical_public_id, source_type,
      source_public_id, source_table, mapping_status
    ) VALUES ('tenant-a', 'invoice', 'cinv-101', 'legacy_bill', '101', 'bills', 'mapped');

    INSERT INTO collection_cases (
      tenant_id, canonical_invoice_public_id, legacy_bill_id, status,
      latest_note, created_at_utc, updated_at_utc
    ) VALUES (
      'tenant-a', 'cinv-101', 101, 'contacted',
      'Mapped case', '2026-07-15T03:00:00.000Z', '2026-07-15T03:00:00.000Z'
    );
  `);
  return harness;
}

function insertLinkedTask(
  harness: ReturnType<typeof createLegacyHarness>,
  caseId: number,
  legacyBillId: number,
) {
  harness.sqlite.prepare(`
    INSERT INTO admin_action_tasks (
      tenant_id, title, source_type, source_public_id, source_href,
      source_metadata_json, priority, status, assigned_to, due_at_utc,
      created_by, created_at_utc, updated_at_utc
    ) VALUES (?, ?, 'collection', ?, ?, ?, 'medium', 'open', ?, ?, ?, ?, ?)
  `).run(
    'tenant-a',
    `Follow up collection case ${caseId}`,
    `collection-case:${caseId}`,
    `/action/collections?case=${caseId}`,
    JSON.stringify({ legacyBillId, collectionCaseId: caseId }),
    7,
    '2026-07-20T04:00:00.000Z',
    7,
    '2026-07-15T03:00:00.000Z',
    '2026-07-15T03:00:00.000Z',
  );
}

describe('collection authority reconciliation', () => {
  it('closes a paid legacy source, appends auto_closed_paid, and completes its linked task', async () => {
    const harness = createLegacyHarness();
    insertLinkedTask(harness, 1, 101);

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('closed');

    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc, updated_at_utc
      FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 101
    `).get()).toEqual({
      status: 'closed',
      closed_at_utc: '2026-07-15T04:00:00.000Z',
      updated_at_utc: '2026-07-15T04:00:00.000Z',
    });
    expect(harness.sqlite.prepare(`
      SELECT event_type, actor_id, old_status, new_status, metadata_json
      FROM collection_case_events
    `).get()).toEqual({
      event_type: 'auto_closed_paid',
      actor_id: 7,
      old_status: 'contacted',
      new_status: 'closed',
      metadata_json: JSON.stringify({
        financialStatus: 'paid',
        authorityMode: 'legacy',
        dueMinor: 0,
        currencyCode: 'BDT',
      }),
    });
    expect(harness.sqlite.prepare(`
      SELECT status, completed_by, completion_note
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a' AND source_public_id = 'collection-case:1'
    `).get()).toEqual({
      status: 'completed',
      completed_by: 7,
      completion_note: 'Collection source paid.',
    });
  });

  it('leaves a positive live due and its linked task unchanged', async () => {
    const harness = createLegacyHarness();
    insertLinkedTask(harness, 2, 102);

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 102 },
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('unchanged');

    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc, updated_at_utc
      FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 102
    `).get()).toEqual({
      status: 'promised',
      closed_at_utc: null,
      updated_at_utc: '2026-07-15T03:00:00.000Z',
    });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_case_events').get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare(`
      SELECT status, updated_at_utc
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a' AND source_public_id = 'collection-case:2'
    `).get()).toEqual({
      status: 'open',
      updated_at_utc: '2026-07-15T03:00:00.000Z',
    });
  });

  it('uses distinct terminal close events and cancels linked tasks for cancelled and reversed sources', async () => {
    const harness = createLegacyHarness();
    insertLinkedTask(harness, 3, 103);
    insertLinkedTask(harness, 4, 104);

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 103 },
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('closed');
    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 104 },
      actorId: 7,
      nowUtc: '2026-07-15T05:00:00.000Z',
    })).resolves.toBe('closed');

    expect(harness.sqlite.prepare(`
      SELECT event_type
      FROM collection_case_events
      ORDER BY id
    `).all()).toEqual([
      { event_type: 'auto_closed_cancelled' },
      { event_type: 'auto_closed_reversed' },
    ]);
    expect(harness.sqlite.prepare(`
      SELECT source_public_id, status
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a'
      ORDER BY source_public_id
    `).all()).toEqual([
      { source_public_id: 'collection-case:3', status: 'cancelled' },
      { source_public_id: 'collection-case:4', status: 'cancelled' },
    ]);
  });

  it('uses canonical net due in canonical mode', async () => {
    const harness = createCanonicalHarness('canonical');
    harness.sqlite.exec(`
      UPDATE collection_cases
      SET canonical_invoice_public_id = NULL
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 101;
    `);

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-101',
        legacyBillId: 101,
      },
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('closed');

    expect(harness.sqlite.prepare(`
      SELECT canonical_invoice_public_id, legacy_bill_id, status
      FROM collection_cases
    `).get()).toEqual({
      canonical_invoice_public_id: 'cinv-101',
      legacy_bill_id: 101,
      status: 'closed',
    });

    expect(harness.sqlite.prepare(`
      SELECT event_type, metadata_json FROM collection_case_events
    `).get()).toEqual({
      event_type: 'auto_closed_paid',
      metadata_json: JSON.stringify({
        financialStatus: 'paid',
        authorityMode: 'canonical',
        dueMinor: 0,
        currencyCode: 'BDT',
      }),
    });
  });

  it('keeps the case open in shadow mode when legacy due remains positive', async () => {
    const harness = createCanonicalHarness('shadow');

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-101',
        legacyBillId: 101,
      },
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('unchanged');

    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc FROM collection_cases
    `).get()).toEqual({ status: 'contacted', closed_at_utc: null });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM collection_case_events').get()).toEqual({ count: 0 });
  });

  it('returns not_found without revealing another tenant source', async () => {
    const harness = createLegacyHarness();

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 201 },
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).resolves.toBe('not_found');

    expect(harness.sqlite.prepare(`
      SELECT status FROM collection_cases
      WHERE tenant_id = 'tenant-b' AND legacy_bill_id = 201
    `).get()).toEqual({ status: 'contacted' });
  });

  it('rolls back auto-close when the event append fails', async () => {
    const harness = createLegacyHarness();
    harness.sqlite.exec(`
      CREATE TRIGGER block_collection_event
      BEFORE INSERT ON collection_case_events
      BEGIN
        SELECT RAISE(ABORT, 'event blocked');
      END;
    `);

    await expect(reconcileCollectionCase({
      db: harness.db,
      tenantId: 'tenant-a',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      nowUtc: '2026-07-15T04:00:00.000Z',
    })).rejects.toThrow(/event blocked/);

    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc, updated_at_utc
      FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 101
    `).get()).toEqual({
      status: 'contacted',
      closed_at_utc: null,
      updated_at_utc: '2026-07-15T03:00:00.000Z',
    });
  });
});
