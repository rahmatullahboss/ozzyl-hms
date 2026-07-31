import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  listMarketplacePractitioners,
  resolveEncounterParticipant,
  resolvePractitionerForGlobalSearch,
  resolvePractitionerProviderMode,
  resolvePractitionerProjection,
  validateAppointmentPractitioner,
  type PractitionerProviderDatabase,
  type PractitionerProviderPreparedStatement,
} from '../../src/lib/canonical/practitioner-provider';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PractitionerProviderPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: PractitionerProviderDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0545_canonical_practitioner_operational_adoption.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER,
      bmdc_reg_no TEXT,
      specialty TEXT,
      department TEXT,
      is_marketplace_visible INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT
    );
    CREATE TABLE external_referring_doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT
    );
  `);
  const db: PractitionerProviderDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
  };
  return { sqlite, db };
}

function seedMappedInternal(sqlite: DatabaseSync, options: {
  legacyName?: string;
  canonicalName?: string;
  legacyActive?: number;
  canonicalStatus?: string;
  marketplace?: number;
} = {}): void {
  sqlite.prepare(`
    INSERT INTO doctors (
      id,tenant_id,name,is_active,user_id,bmdc_reg_no,specialty,department,
      is_marketplace_visible,password_hash
    ) VALUES (101,'tenant-a',?,?,?,?,?,?,?,?)
  `).run(
    options.legacyName ?? 'Legacy Doctor Name',
    options.legacyActive ?? 1,
    501,
    'A-101',
    'Cardiology',
    'Medicine',
    options.marketplace ?? 1,
    'secret-hash',
  );
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal',?,?,1,?)
  `).run(options.canonicalName ?? 'Canonical Doctor Name', options.canonicalStatus ?? 'active', 'a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','practitioner','practitioner-101','legacy_doctor','101',
      'doctors','mapped',1,?)
  `).run('a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a','practitioner-101',501,'active','approved_manual')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_identifiers (
      tenant_id,practitioner_public_id,identifier_system,issuer_key,normalized_value,
      display_value,verification_status
    ) VALUES ('tenant-a','practitioner-101','bmdc','bmdc-bd','A101','A-101','verified')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_specialties (
      tenant_id,practitioner_public_id,normalized_key,display_text,is_primary
    ) VALUES ('tenant-a','practitioner-101','cardiology','Cardiology',1)
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_departments (
      tenant_id,practitioner_public_id,normalized_key,display_text,is_primary
    ) VALUES ('tenant-a','practitioner-101','medicine','Medicine',1)
  `).run();
}

function setMode(sqlite: DatabaseSync, mode: 'legacy' | 'shadow' | 'canonical', enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_practitioner_provider_v1','practitioner',?,?,
      '2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z')
  `).run(mode, enabled);
}

describe('canonical practitioner provider', () => {
  it('defaults fail-closed to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolvePractitionerProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolvePractitionerProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.prepare(`DELETE FROM canonical_feature_flags`).run();
      setMode(sqlite, 'shadow');
      await expect(resolvePractitionerProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.prepare(`UPDATE canonical_feature_flags SET mode='canonical'`).run();
      await expect(resolvePractitionerProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally {
      sqlite.close();
    }
  });

  it('legacy mode resolves identity only through explicit source mapping, never name', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,is_active,user_id,bmdc_reg_no,specialty,department,is_marketplace_visible)
        VALUES (101,'tenant-a','Same Name',1,501,'A-101','Cardiology','Medicine',1)
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
        ) VALUES ('tenant-a','unmapped-same-name','internal','Same Name','active',1,?)
      `).run('a'.repeat(64));
      const projection = await resolvePractitionerProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101,
      });
      expect(projection.mode).toBe('legacy');
      expect(projection.practitionerPublicId).toBeNull();
      expect(projection.displayName).toBe('Same Name');
      await expect(resolvePractitionerProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101, identitySensitive: true,
      })).rejects.toThrow(/explicit practitioner source mapping is required/);
    } finally {
      sqlite.close();
    }
  });

  it('shadow mode compares mapped facts but ignores display-name differences as identity evidence', async () => {
    const { sqlite, db } = harness();
    try {
      seedMappedInternal(sqlite, { legacyName: 'Legacy Name', canonicalName: 'Different Canonical Name' });
      setMode(sqlite, 'shadow');
      const projection = await resolvePractitionerProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101, identitySensitive: true,
      });
      expect(projection.mode).toBe('shadow');
      expect(projection.displayName).toBe('Legacy Name');
      expect(projection.practitionerPublicId).toBe('practitioner-101');
      expect(projection.parity).toMatchObject({ ok: true, mapping: true, kind: true, status: true });
      expect(projection.parity).not.toHaveProperty('displayName');

      sqlite.prepare(`UPDATE canonical_practitioners SET status='inactive'`).run();
      const drift = await resolvePractitionerProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101, identitySensitive: true,
      });
      expect(drift.parity).toMatchObject({ ok: false, status: false });
    } finally {
      sqlite.close();
    }
  });

  it('canonical mode returns canonical associations and never exposes authentication secrets', async () => {
    const { sqlite, db } = harness();
    try {
      seedMappedInternal(sqlite);
      setMode(sqlite, 'canonical');
      const projection = await resolvePractitionerProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101, identitySensitive: true,
      });
      expect(projection).toMatchObject({
        mode: 'canonical',
        practitionerPublicId: 'practitioner-101',
        practitionerKind: 'internal',
        status: 'active',
        legacy: { sourceType: 'legacy_doctor', legacyId: 101 },
        legacyUserId: 501,
      });
      expect(projection.identifiers).toEqual([
        { system: 'bmdc', issuerKey: 'bmdc-bd', verificationStatus: 'verified' },
      ]);
      expect(projection.specialties).toEqual([{ normalizedKey: 'cardiology', isPrimary: true }]);
      expect(projection.departments).toEqual([{ normalizedKey: 'medicine', isPrimary: true }]);
      expect(JSON.stringify(projection)).not.toContain('secret-hash');
      expect(projection).not.toHaveProperty('passwordHash');
    } finally {
      sqlite.close();
    }
  });

  it('provides disabled-safe adapters for search, appointment, marketplace, and encounter resolution', async () => {
    const { sqlite, db } = harness();
    try {
      seedMappedInternal(sqlite, { marketplace: 1 });
      const search = await resolvePractitionerForGlobalSearch(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101,
      });
      expect(search.mode).toBe('legacy');
      expect(search.practitionerPublicId).toBe('practitioner-101');

      const appointment = await validateAppointmentPractitioner(db, {
        tenantId: 'tenant-a', legacyDoctorId: 101,
      });
      expect(appointment).toEqual({ practitionerPublicId: 'practitioner-101', legacyDoctorId: 101 });

      const marketplace = await listMarketplacePractitioners(db, 'tenant-a');
      expect(marketplace).toHaveLength(1);
      expect(marketplace[0]).toMatchObject({ practitionerPublicId: 'practitioner-101', legacy: { legacyId: 101 } });

      const encounter = await resolveEncounterParticipant(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101, role: 'treating',
      });
      expect(encounter).toEqual({
        practitionerPublicId: 'practitioner-101',
        legacyId: 101,
        role: 'treating',
      });
    } finally {
      sqlite.close();
    }
  });
});
