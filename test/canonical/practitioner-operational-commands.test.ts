import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  assignPractitionerClassification,
  createPractitioner,
  linkOrUnlinkPractitionerEmployee,
  linkOrUnlinkPractitionerUser,
  managePractitionerIdentifier,
  updateOrRetirePractitioner,
  type CreatePractitionerInput,
} from '../../src/lib/canonical/commands/manage-practitioner';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0545_canonical_practitioner_operational_adoption.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_practitioner_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    )
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function createInput(overrides: Partial<CreatePractitionerInput> = {}): CreatePractitionerInput {
  return {
    tenantId: 'tenant-a',
    practitionerPublicId: 'practitioner-101',
    practitionerKind: 'internal',
    displayName: 'Dr Example',
    status: 'active',
    sourceType: 'legacy_doctor',
    sourcePublicId: '101',
    sourceTable: 'doctors',
    sourceEvidenceSha256: 'a'.repeat(64),
    identifier: {
      system: 'bmdc',
      issuerKey: 'bmdc-bd',
      value: 'A-101',
      displayValue: 'A-101',
      verificationStatus: 'verified',
    },
    userLink: { legacyUserId: 501, evidenceType: 'approved_manual' },
    employeeLink: { legacyStaffId: 601, evidenceType: 'approved_manual' },
    specialty: { normalizedKey: 'cardiology', displayText: 'Cardiology', isPrimary: true },
    department: { normalizedKey: 'medicine', displayText: 'Medicine', isPrimary: true },
    idempotencyKey: 'practitioner-create-101',
    eventPublicId: 'practitioner-event-create-101',
    occurredAtUtc: '2026-07-26T08:00:00.000Z',
    businessDate: '2026-07-26',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical practitioner operational commands', () => {
  it('atomically creates internal practitioner facts, source mapping, compatibility, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_practitioner_compat(marker) VALUES (?)`).bind('doctor-101');
      await expect(createPractitioner(db, createInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          practitionerPublicId: 'practitioner-101',
          practitionerKind: 'internal',
          status: 'active',
          version: 1,
        },
      });
      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_employee_links')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_identifiers')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_specialties')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_departments')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_practitioner_compat')).toBe(1);

      const outbox = sqlite.prepare(`
        SELECT aggregate_type,aggregate_public_id,event_type,payload_json
        FROM canonical_outbox_events
      `).get() as Record<string, string>;
      expect(outbox).toMatchObject({
        aggregate_type: 'canonical_practitioner',
        aggregate_public_id: 'practitioner-101',
        event_type: 'canonical.practitioner.created',
      });
      for (const forbidden of ['Dr Example', 'A-101', 'Cardiology', 'Medicine']) {
        expect(outbox.payload_json).not.toContain(forbidden);
      }
      const envelope = JSON.parse(outbox.payload_json) as {
        event: Record<string, unknown>;
        command: { result: Record<string, unknown> };
      };
      expect(envelope.event).toEqual({
        practitionerPublicId: 'practitioner-101',
        practitionerKind: 'internal',
        status: 'active',
        version: 1,
      });
      for (const sensitiveKey of ['legacyUserId', 'legacyStaffId', 'displayName', 'identifierValue']) {
        expect(envelope.event).not.toHaveProperty(sensitiveKey);
        expect(envelope.command.result).not.toHaveProperty(sensitiveKey);
      }
    } finally {
      sqlite.close();
    }
  });

  it('creates an external practitioner without authentication or employee identity', async () => {
    const { sqlite, db } = harness();
    try {
      await createPractitioner(db, createInput({
        practitionerPublicId: 'external-301',
        practitionerKind: 'external',
        displayName: 'External Referrer',
        sourceType: 'legacy_external_referrer',
        sourcePublicId: '301',
        sourceTable: 'external_referring_doctors',
        identifier: undefined,
        userLink: undefined,
        employeeLink: undefined,
        department: undefined,
        specialty: { normalizedKey: 'neurology', displayText: 'Neurology', isPrimary: true },
        idempotencyKey: 'external-create-301',
        eventPublicId: 'external-event-301',
      }));
      expect(sqlite.prepare(`
        SELECT practitioner_kind,status FROM canonical_practitioners
        WHERE practitioner_public_id='external-301'
      `).get()).toEqual({ practitioner_kind: 'external', status: 'active' });
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(0);
      expect(count(sqlite, 'canonical_practitioner_employee_links')).toBe(0);
      expect(count(sqlite, 'canonical_practitioner_specialties')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('derives deterministic IDs, replays identical requests, and rejects changed replay', async () => {
    const { sqlite, db } = harness();
    try {
      const request = createInput({ practitionerPublicId: undefined, eventPublicId: undefined });
      const first = await createPractitioner(db, request);
      expect(first.result.practitionerPublicId).toMatch(/^pract_[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(createPractitioner(db, request)).resolves.toEqual({ status: 'replayed', result: first.result });
      await expect(createPractitioner(db, {
        ...request,
        displayName: 'Changed Name',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back canonical and outbox facts when a compatibility statement fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO legacy_practitioner_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_practitioner_compat(marker) VALUES ('duplicate')`);
      await expect(createPractitioner(db, createInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(count(sqlite, 'canonical_practitioners')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('updates and retires with exact expected-version guards', async () => {
    const { sqlite, db } = harness();
    try {
      await createPractitioner(db, createInput());
      await expect(updateOrRetirePractitioner(db, {
        tenantId: 'tenant-a',
        practitionerPublicId: 'practitioner-101',
        displayName: 'Dr Updated',
        status: 'inactive',
        expectedVersion: 1,
        sourceEvidenceSha256: 'b'.repeat(64),
        idempotencyKey: 'practitioner-update-101-v2',
        eventPublicId: 'practitioner-event-update-101-v2',
        occurredAtUtc: '2026-07-26T09:00:00.000Z',
        businessDate: '2026-07-26',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { practitionerPublicId: 'practitioner-101', status: 'inactive', version: 2 },
      });
      expect(sqlite.prepare(`
        SELECT display_name,status,version,source_evidence_sha256
        FROM canonical_practitioners WHERE practitioner_public_id='practitioner-101'
      `).get()).toEqual({
        display_name: 'Dr Updated',
        status: 'inactive',
        version: 2,
        source_evidence_sha256: 'b'.repeat(64),
      });
      await expect(updateOrRetirePractitioner(db, {
        tenantId: 'tenant-a',
        practitionerPublicId: 'practitioner-101',
        status: 'active',
        expectedVersion: 1,
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'practitioner-stale-101',
        eventPublicId: 'practitioner-event-stale-101',
        occurredAtUtc: '2026-07-26T10:00:00.000Z',
        businessDate: '2026-07-26',
      })).rejects.toThrow(/expectedVersion 1 does not match current version 2/);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('links and unlinks users and employees without deleting link history rows', async () => {
    const { sqlite, db } = harness();
    try {
      await createPractitioner(db, createInput({ userLink: undefined, employeeLink: undefined }));
      await linkOrUnlinkPractitionerUser(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', legacyUserId: 501,
        linkStatus: 'active', evidenceType: 'approved_manual', idempotencyKey: 'user-link-501',
        eventPublicId: 'user-link-event-501', occurredAtUtc: '2026-07-26T09:00:00.000Z', businessDate: '2026-07-26',
      });
      await linkOrUnlinkPractitionerEmployee(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', legacyStaffId: 601,
        linkStatus: 'active', evidenceType: 'approved_manual', idempotencyKey: 'staff-link-601',
        eventPublicId: 'staff-link-event-601', occurredAtUtc: '2026-07-26T09:05:00.000Z', businessDate: '2026-07-26',
      });
      await linkOrUnlinkPractitionerUser(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', legacyUserId: 501,
        linkStatus: 'retired', evidenceType: 'approved_manual', idempotencyKey: 'user-unlink-501',
        eventPublicId: 'user-unlink-event-501', occurredAtUtc: '2026-07-26T10:00:00.000Z', businessDate: '2026-07-26',
      });
      expect(sqlite.prepare(`SELECT link_status FROM canonical_practitioner_user_links`).get())
        .toEqual({ link_status: 'retired' });
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(1);
      expect(sqlite.prepare(`SELECT link_status FROM canonical_practitioner_employee_links`).get())
        .toEqual({ link_status: 'active' });
    } finally {
      sqlite.close();
    }
  });

  it('manages verified identifier lifecycle and rejects assignment to another practitioner', async () => {
    const { sqlite, db } = harness();
    try {
      await createPractitioner(db, createInput({ identifier: undefined }));
      await managePractitionerIdentifier(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', system: 'bmdc', issuerKey: 'bmdc-bd',
        value: 'A-101', displayValue: 'A-101', verificationStatus: 'verified',
        idempotencyKey: 'identifier-add-101', eventPublicId: 'identifier-event-add-101',
        occurredAtUtc: '2026-07-26T09:00:00.000Z', businessDate: '2026-07-26',
      });
      await managePractitionerIdentifier(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', system: 'bmdc', issuerKey: 'bmdc-bd',
        value: 'A-101', displayValue: 'A-101', verificationStatus: 'retired',
        idempotencyKey: 'identifier-retire-101', eventPublicId: 'identifier-event-retire-101',
        occurredAtUtc: '2026-07-26T10:00:00.000Z', businessDate: '2026-07-26',
      });
      expect(sqlite.prepare(`SELECT normalized_value,verification_status FROM canonical_practitioner_identifiers`).get())
        .toEqual({ normalized_value: 'A101', verification_status: 'retired' });

      await createPractitioner(db, createInput({
        practitionerPublicId: 'practitioner-102', sourcePublicId: '102', identifier: undefined,
        userLink: undefined, employeeLink: undefined, specialty: undefined, department: undefined,
        idempotencyKey: 'practitioner-create-102', eventPublicId: 'practitioner-event-create-102',
      }));
      await expect(managePractitionerIdentifier(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-102', system: 'bmdc', issuerKey: 'bmdc-bd',
        value: 'A-101', displayValue: 'A-101', verificationStatus: 'verified',
        idempotencyKey: 'identifier-conflict-102', eventPublicId: 'identifier-event-conflict-102',
        occurredAtUtc: '2026-07-26T11:00:00.000Z', businessDate: '2026-07-26',
      })).rejects.toThrow(/identifier already belongs to another practitioner/);
    } finally {
      sqlite.close();
    }
  });

  it('assigns specialty and department by normalized keys without using them as identity', async () => {
    const { sqlite, db } = harness();
    try {
      await createPractitioner(db, createInput({ specialty: undefined, department: undefined }));
      await assignPractitionerClassification(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', classificationType: 'specialty',
        normalizedKey: 'cardiology', displayText: 'Cardiology', isPrimary: true,
        idempotencyKey: 'specialty-101', eventPublicId: 'specialty-event-101',
        occurredAtUtc: '2026-07-26T09:00:00.000Z', businessDate: '2026-07-26',
      });
      await assignPractitionerClassification(db, {
        tenantId: 'tenant-a', practitionerPublicId: 'practitioner-101', classificationType: 'department',
        normalizedKey: 'medicine', displayText: 'Medicine', isPrimary: true,
        idempotencyKey: 'department-101', eventPublicId: 'department-event-101',
        occurredAtUtc: '2026-07-26T09:05:00.000Z', businessDate: '2026-07-26',
      });
      expect(sqlite.prepare(`SELECT normalized_key,is_primary FROM canonical_practitioner_specialties`).get())
        .toEqual({ normalized_key: 'cardiology', is_primary: 1 });
      expect(sqlite.prepare(`SELECT normalized_key,is_primary FROM canonical_practitioner_departments`).get())
        .toEqual({ normalized_key: 'medicine', is_primary: 1 });
      const payloads = sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events ORDER BY id`).all() as Array<{ payload_json: string }>;
      expect(payloads.map((row) => row.payload_json).join('\n')).not.toContain('Cardiology');
      expect(payloads.map((row) => row.payload_json).join('\n')).not.toContain('Medicine');
    } finally {
      sqlite.close();
    }
  });
});
