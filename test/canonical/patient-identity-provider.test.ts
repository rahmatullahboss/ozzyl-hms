import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  providePatientIdentityProjection,
  resolvePatientAuthScope,
  resolvePatientIdentityLink,
  resolvePatientIdentityProviderMode,
  type PatientIdentityProviderDatabase,
  type PatientIdentityProviderPreparedStatement,
} from '../../src/lib/canonical/patient-identity-provider';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PatientIdentityProviderPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: PatientIdentityProviderDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_code TEXT,
      uhid TEXT,
      name TEXT NOT NULL,
      father_husband TEXT NOT NULL,
      address TEXT NOT NULL,
      mobile TEXT,
      guardian_mobile TEXT,
      age INTEGER,
      gender TEXT,
      blood_group TEXT,
      email TEXT,
      date_of_birth TEXT
    );
    INSERT INTO patients VALUES (
      101,'tenant-a','P-101','UHID-101','Sensitive Patient','Sensitive Guardian',
      'Sensitive Address','01700000000','01800000000',35,'male','O+','patient@example.com','1991-01-01'
    );
    INSERT INTO patients VALUES (
      10101,'tenant-b','P-B','UHID-B','Other Tenant','Other Guardian',
      'Other Address','01900000000',NULL,40,'female','A+',NULL,'1986-01-01'
    );
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES (
      'tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      '${'1'.repeat(64)}','2026-07-27T00:00:00.000Z',1
    );
  `);
  return {
    sqlite,
    db: { prepare: (sql: string) => new Statement(sqlite, sql) },
  };
}

function flag(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_patient_identity_provider_v1','identity',?,?,
      '2026-07-27T00:00:00.000Z','2026-07-27T00:00:00.000Z')
    ON CONFLICT(tenant_id,flag_key) DO UPDATE SET mode=excluded.mode,is_enabled=excluded.is_enabled
  `).run(mode, enabled);
}

describe('patient identity provider', () => {
  it('defaults missing, disabled, and malformed configuration to legacy', async () => {
    const empty = new DatabaseSync(':memory:');
    try {
      const db = { prepare: (sql: string) => new Statement(empty, sql) };
      await expect(resolvePatientIdentityProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
    } finally {
      empty.close();
    }

    const { sqlite, db } = harness();
    try {
      flag(sqlite, 'canonical', 0);
      await expect(resolvePatientIdentityProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      flag(sqlite, 'disabled', 0);
      await expect(resolvePatientIdentityProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
    } finally {
      sqlite.close();
    }
  });

  it('keeps legacy projection stable while exposing an exact available relationship', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await providePatientIdentityProjection(db, {
        tenantId: 'tenant-a',
        legacyPatientId: 101,
      });
      expect(result).toMatchObject({
        mode: 'legacy',
        legacy: {
          legacyPatientId: 101,
          patientCode: 'P-101',
          name: 'Sensitive Patient',
          mobile: '01700000000',
        },
        relationship: {
          patientLinkPublicId: 'ptl-101',
          legacyPatientId: 101,
          linkStatus: 'unlinked',
          version: 1,
        },
      });
      await expect(resolvePatientIdentityLink(db, {
        tenantId: 'tenant-a', legacyPatientId: 101,
      })).resolves.toMatchObject({ patientLinkPublicId: 'ptl-101' });
    } finally {
      sqlite.close();
    }
  });

  it('returns PHI-free aggregate parity in shadow mode and canonical relationship in canonical mode', async () => {
    const { sqlite, db } = harness();
    try {
      flag(sqlite, 'shadow');
      const shadow = await providePatientIdentityProjection(db, {
        tenantId: 'tenant-a', legacyPatientId: 101, identitySensitive: true,
      });
      expect(shadow.mode).toBe('shadow');
      expect(shadow.parity).toEqual({
        ok: true,
        exactTenantPatientLink: true,
        legacyPatientAgreement: true,
        activeRelationship: true,
        effectiveInterval: true,
        positiveVersion: true,
      });
      expect(JSON.stringify(shadow.parity)).not.toMatch(/Sensitive|01700000000|patient@example/i);

      flag(sqlite, 'canonical');
      const canonical = await providePatientIdentityProjection(db, {
        tenantId: 'tenant-a', legacyPatientId: 101, identitySensitive: true,
      });
      expect(canonical).toMatchObject({
        mode: 'canonical',
        relationship: { patientLinkPublicId: 'ptl-101', legacyPatientId: 101 },
      });
      await expect(resolvePatientAuthScope(db, {
        tenantId: 'tenant-a', legacyPatientId: 101,
      })).resolves.toEqual({
        mode: 'canonical', legacyPatientId: 101, patientLinkPublicId: 'ptl-101',
      });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed for missing, retired, or cross-tenant relationship evidence', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`DELETE FROM canonical_tenant_patient_links WHERE tenant_id='tenant-a'`).run();
      await expect(providePatientIdentityProjection(db, {
        tenantId: 'tenant-a', legacyPatientId: 101, identitySensitive: true,
      })).rejects.toThrow(/exact active tenant patient link/i);

      sqlite.exec(`
        INSERT INTO canonical_tenant_patient_links (
          tenant_id,patient_link_public_id,legacy_patient_id,link_status,
          verification_level,evidence_type,evidence_sha256,effective_from_utc,
          effective_to_utc,version
        ) VALUES (
          'tenant-a','ptl-101-retired',101,'retired','unverified','migration_evidence',
          '${'2'.repeat(64)}','2026-07-27T00:00:00.000Z','2026-07-27T01:00:00.000Z',1
        );
      `);
      flag(sqlite, 'canonical');
      await expect(providePatientIdentityProjection(db, {
        tenantId: 'tenant-a', legacyPatientId: 101,
      })).rejects.toThrow(/exact active tenant patient link/i);

      await expect(providePatientIdentityProjection(db, {
        tenantId: 'tenant-a', legacyPatientId: 10101, identitySensitive: true,
      })).rejects.toThrow(/legacy patient source not found/i);
    } finally {
      sqlite.close();
    }
  });

  it('does not use names, phones, or mutable demographics as relationship matching predicates', () => {
    const source = readFileSync('src/lib/canonical/patient-identity-provider.ts', 'utf8');
    expect(source).not.toMatch(/WHERE[\s\S]{0,240}(?:name|mobile|email|address)\s*=/i);
    expect(source).not.toMatch(/LIKE\s*\?/i);
    expect(source).toContain('tenant_id=? AND legacy_patient_id=?');
  });
});
