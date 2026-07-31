import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  registerOrLinkPatient,
  type RegisterOrLinkPatientInput,
} from '../../src/lib/canonical/commands/register-or-link-patient';

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
      meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) },
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
  sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_patient_compat (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      UNIQUE(tenant_id, source_key)
    );
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

function verifiedInput(overrides: Partial<RegisterOrLinkPatientInput> = {}): RegisterOrLinkPatientInput {
  return {
    tenantId: 'tenant-a',
    patientLinkPublicId: 'ptl_01',
    legacyPatientId: 101,
    globalPatientUhid: 'UHID-101',
    linkStatus: 'verified',
    verificationLevel: 'verified',
    evidenceType: 'unique_uhid',
    evidenceSha256: 'a'.repeat(64),
    effectiveAtUtc: '2026-07-26T00:00:00.000Z',
    eventType: 'verified_linked',
    reasonCode: 'exact_unique_uhid',
    actorSystemKey: 'canonical.patient-link.test',
    sourceType: 'legacy_patient',
    sourcePublicId: '101',
    sourceTable: 'patients',
    idempotencyKey: 'patient-link-101-v1',
    eventPublicId: 'evt_patient_link_101_v1',
    businessDate: '2026-07-26',
    ...overrides,
  };
}

function unlinkedInput(overrides: Partial<RegisterOrLinkPatientInput> = {}): RegisterOrLinkPatientInput {
  return verifiedInput({
    globalPatientUhid: null,
    linkStatus: 'unlinked',
    verificationLevel: 'unverified',
    evidenceType: 'no_link_placeholder',
    eventType: 'registered',
    reasonCode: 'registered_without_global_identity',
    ...overrides,
  });
}

describe('register-or-link-patient canonical command', () => {
  it('commits caller-owned legacy compatibility in the same Canonical batch', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, unlinkedInput(), {
        authoritativeStatements: [
          db.prepare(`INSERT INTO legacy_patient_compat (id,tenant_id,source_key) VALUES (?,?,?)`)
            .bind(101, 'tenant-a', 'import-row-101'),
        ],
      });
      expect(sqlite.prepare(`SELECT id,tenant_id,source_key FROM legacy_patient_compat`).get()).toEqual({
        id: 101,
        tenant_id: 'tenant-a',
        source_key: 'import-row-101',
      });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_tenant_patient_links`).get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('atomically creates current link, immutable event, source mapping, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(registerOrLinkPatient(db, verifiedInput())).resolves.toEqual({
        status: 'applied',
        result: { patientLinkPublicId: 'ptl_01', linkStatus: 'verified', version: 1 },
      });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_links').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_link_events').get()).toEqual({ count: 1 });
      expect(sqlite.prepare("SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='patient_link'").get())
        .toEqual({ count: 1 });
      const outbox = sqlite.prepare(`
        SELECT aggregate_type,aggregate_public_id,event_type,payload_json
        FROM canonical_outbox_events
      `).get() as Record<string, string>;
      expect(outbox).toMatchObject({
        aggregate_type: 'canonical_patient_link',
        aggregate_public_id: 'ptl_01',
        event_type: 'canonical.patient-link.verified_linked',
      });
      expect(outbox.payload_json).not.toContain('UHID-101');
      expect(outbox.payload_json).not.toContain('legacyPatientId');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        patientLinkPublicId: 'ptl_01',
        linkStatus: 'verified',
        verificationLevel: 'verified',
        evidenceType: 'unique_uhid',
        version: 1,
      });
    } finally {
      sqlite.close();
    }
  });

  it('derives stable public IDs from tenant, source, and idempotency when callers omit them', async () => {
    const { sqlite, db } = harness();
    try {
      const request = verifiedInput({
        patientLinkPublicId: undefined,
        eventPublicId: undefined,
      });
      const first = await registerOrLinkPatient(db, request);
      expect(first.status).toBe('applied');
      expect(first.result.patientLinkPublicId).toMatch(/^ptlink_[0-9A-HJKMNP-TV-Z]{26}$/);
      const stored = sqlite.prepare(`
        SELECT l.patient_link_public_id,e.event_public_id
        FROM canonical_tenant_patient_links l
        JOIN canonical_tenant_patient_link_events e
          ON e.tenant_id=l.tenant_id AND e.patient_link_public_id=l.patient_link_public_id
      `).get() as { patient_link_public_id: string; event_public_id: string };
      expect(stored.patient_link_public_id).toBe(first.result.patientLinkPublicId);
      expect(stored.event_public_id).toMatch(/^ptlevt_[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(registerOrLinkPatient(db, request)).resolves.toEqual({
        status: 'replayed',
        result: first.result,
      });
    } finally {
      sqlite.close();
    }
  });

  it('replays the same request and rejects a changed semantic request', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, verifiedInput());
      await expect(registerOrLinkPatient(db, verifiedInput())).resolves.toEqual({
        status: 'replayed',
        result: { patientLinkPublicId: 'ptl_01', linkStatus: 'verified', version: 1 },
      });
      await expect(registerOrLinkPatient(db, verifiedInput({ globalPatientUhid: 'UHID-OTHER' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_links').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_link_events').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('updates an existing link with guarded version progression and immutable sequence', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, unlinkedInput());
      await expect(registerOrLinkPatient(db, verifiedInput({
        expectedVersion: 1,
        idempotencyKey: 'patient-link-101-v2',
        eventPublicId: 'evt_patient_link_101_v2',
        effectiveAtUtc: '2026-07-26T01:00:00.000Z',
      }))).resolves.toEqual({
        status: 'applied',
        result: { patientLinkPublicId: 'ptl_01', linkStatus: 'verified', version: 2 },
      });
      expect(sqlite.prepare(`
        SELECT link_status,verification_level,global_patient_uhid,version
        FROM canonical_tenant_patient_links
      `).get()).toEqual({
        link_status: 'verified',
        verification_level: 'verified',
        global_patient_uhid: 'UHID-101',
        version: 2,
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,sequence
        FROM canonical_tenant_patient_link_events ORDER BY sequence
      `).all()).toEqual([
        { event_type: 'registered', from_status: null, to_status: 'unlinked', sequence: 1 },
        { event_type: 'verified_linked', from_status: 'unlinked', to_status: 'verified', sequence: 2 },
      ]);

      await expect(registerOrLinkPatient(db, verifiedInput({
        expectedVersion: 1,
        idempotencyKey: 'patient-link-101-stale',
        eventPublicId: 'evt_patient_link_101_stale',
        effectiveAtUtc: '2026-07-26T02:00:00.000Z',
      }))).rejects.toThrow(/expectedVersion/i);
    } finally {
      sqlite.close();
    }
  });

  it('rejects forbidden identity evidence and invalid actor/effective-time inputs before writing', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(registerOrLinkPatient(db, verifiedInput({ evidenceType: 'phone_match' as never })))
        .rejects.toThrow(/evidenceType/i);
      await expect(registerOrLinkPatient(db, verifiedInput({ actorSystemKey: null, actorUserId: null })))
        .rejects.toThrow(/actor/i);
      await expect(registerOrLinkPatient(db, verifiedInput({ effectiveAtUtc: '2026-07-26 00:00:00' })))
        .rejects.toThrow(/effectiveAtUtc/i);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_links').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_outbox_events').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('records a stable processing issue for candidate evidence without claiming verification', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, unlinkedInput({
        linkStatus: 'candidate',
        verificationLevel: 'candidate',
        evidenceType: 'ambiguous_candidate',
        eventType: 'candidate_detected',
        reasonCode: 'phone_or_name_candidate_only',
        issuePublicId: 'issue_patient_link_101',
        issueFingerprint: 'f'.repeat(64),
      }));
      expect(sqlite.prepare(`
        SELECT link_status,verification_level,global_patient_uhid
        FROM canonical_tenant_patient_links
      `).get()).toEqual({
        link_status: 'candidate',
        verification_level: 'candidate',
        global_patient_uhid: null,
      });
      expect(sqlite.prepare(`
        SELECT issue_code,severity,status,entity_public_id
        FROM canonical_processing_issues
      `).get()).toEqual({
        issue_code: 'PATIENT_IDENTITY_AMBIGUOUS',
        severity: 'warning',
        status: 'open',
        entity_public_id: 'ptl_01',
      });
    } finally {
      sqlite.close();
    }
  });

  it('records unlink and merge/unmerge transitions with monotonic versions and explicit source/target evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, verifiedInput());
      await expect(registerOrLinkPatient(db, verifiedInput({
        globalPatientUhid: null,
        linkStatus: 'unlinked',
        verificationLevel: 'unverified',
        evidenceType: 'no_link_placeholder',
        eventType: 'unlinked',
        reasonCode: 'approved_unlink',
        expectedVersion: 1,
        idempotencyKey: 'patient-link-101-unlink',
        eventPublicId: 'evt_patient_link_101_unlink',
        effectiveAtUtc: '2026-07-26T01:00:00.000Z',
      }))).resolves.toMatchObject({
        status: 'applied',
        result: { linkStatus: 'unlinked', version: 2 },
      });
      await expect(registerOrLinkPatient(db, verifiedInput({
        globalPatientUhid: null,
        linkStatus: 'merged',
        verificationLevel: 'reviewed',
        evidenceType: 'reviewed_manual',
        eventType: 'merged',
        reasonCode: 'reviewed_duplicate_merge',
        sourceLegacyPatientId: 101,
        targetLegacyPatientId: 202,
        expectedVersion: 2,
        idempotencyKey: 'patient-link-101-merge',
        eventPublicId: 'evt_patient_link_101_merge',
        effectiveAtUtc: '2026-07-26T02:00:00.000Z',
      }))).resolves.toMatchObject({
        status: 'applied',
        result: { linkStatus: 'merged', version: 3 },
      });
      await expect(registerOrLinkPatient(db, verifiedInput({
        globalPatientUhid: null,
        linkStatus: 'unlinked',
        verificationLevel: 'unverified',
        evidenceType: 'no_link_placeholder',
        eventType: 'unmerged',
        reasonCode: 'approved_unmerge',
        sourceLegacyPatientId: 101,
        targetLegacyPatientId: 202,
        expectedVersion: 3,
        idempotencyKey: 'patient-link-101-unmerge',
        eventPublicId: 'evt_patient_link_101_unmerge',
        effectiveAtUtc: '2026-07-26T03:00:00.000Z',
      }))).resolves.toMatchObject({
        status: 'applied',
        result: { linkStatus: 'unlinked', version: 4 },
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,source_legacy_patient_id,
               target_legacy_patient_id,sequence
        FROM canonical_tenant_patient_link_events ORDER BY sequence
      `).all()).toEqual([
        { event_type: 'verified_linked', from_status: null, to_status: 'verified', source_legacy_patient_id: null, target_legacy_patient_id: null, sequence: 1 },
        { event_type: 'unlinked', from_status: 'verified', to_status: 'unlinked', source_legacy_patient_id: null, target_legacy_patient_id: null, sequence: 2 },
        { event_type: 'merged', from_status: 'unlinked', to_status: 'merged', source_legacy_patient_id: 101, target_legacy_patient_id: 202, sequence: 3 },
        { event_type: 'unmerged', from_status: 'merged', to_status: 'unlinked', source_legacy_patient_id: 101, target_legacy_patient_id: 202, sequence: 4 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back all facts when a global identity uniqueness guard fails', async () => {
    const { sqlite, db } = harness();
    try {
      await registerOrLinkPatient(db, verifiedInput());
      await expect(registerOrLinkPatient(db, verifiedInput({
        patientLinkPublicId: 'ptl_02',
        legacyPatientId: 102,
        sourcePublicId: '102',
        idempotencyKey: 'patient-link-102-v1',
        eventPublicId: 'evt_patient_link_102_v1',
      }))).rejects.toThrow(/UNIQUE constraint failed/);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_links').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_tenant_patient_link_events').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_outbox_events').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_source_mappings').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });
});
