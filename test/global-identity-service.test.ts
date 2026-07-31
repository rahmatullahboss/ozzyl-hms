import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMockDB } from './integration/helpers/mock-db';

describe('global identity claim schema migration', () => {
  it('includes lifecycle columns, linkage fields, and indexes', () => {
    const sql = readFileSync(
      resolve(__dirname, '../migrations/0105_global_identity_claims.sql'),
      'utf8',
    );

    expect(sql).toContain("ALTER TABLE global_patient_identity ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed';");
    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN claimed_auth_user_id INTEGER;');
    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN claimed_at TEXT;');
    expect(sql).toContain("ALTER TABLE global_patient_identity ADD COLUMN created_source TEXT NOT NULL DEFAULT 'hospital';");
    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN created_tenant_id TEXT;');
    expect(sql).toContain('ALTER TABLE global_patient_auth ADD COLUMN identity_id INTEGER;');
    expect(sql).toContain('ALTER TABLE patients ADD COLUMN global_identity_id INTEGER;');
    expect(sql).toContain('CREATE INDEX idx_gpi_claim_status ON global_patient_identity(claim_status);');
    expect(sql).toContain('CREATE UNIQUE INDEX idx_gpa_identity_id ON global_patient_auth(identity_id) WHERE identity_id IS NOT NULL;');
    expect(sql).toContain('CREATE INDEX idx_patients_global_identity ON patients(global_identity_id);');
  });

  it('allows nullable national_id for unclaimed and self-signup identities', () => {
    const sql = readFileSync(
      resolve(__dirname, '../migrations/0106_global_identity_nullable.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE global_patient_identity_new');
    expect(sql).toContain('national_id TEXT UNIQUE');
    expect(sql).not.toContain('national_id TEXT NOT NULL UNIQUE');
  });
});

describe('global identity service', () => {
  let resolveOrCreateGlobalIdentity: typeof import('../src/lib/global-identity').resolveOrCreateGlobalIdentity;
  let claimGlobalIdentity: typeof import('../src/lib/global-identity').claimGlobalIdentity;

  beforeAll(async () => {
    const mod = await import('../src/lib/global-identity');
    resolveOrCreateGlobalIdentity = mod.resolveOrCreateGlobalIdentity;
    claimGlobalIdentity = mod.claimGlobalIdentity;
  });

  it('returns existing identity when UHID already exists', async () => {
    const mock = createMockDB({
      queryOverride: (sql, params) => {
        if (sql.includes('FROM global_patient_identity') && params[0] === 'OZ-000123') {
          return {
            results: [{
              id: 7,
              uhid: 'OZ-000123',
              claim_status: 'unclaimed',
              created_source: 'hospital',
            }],
          };
        }
        return null;
      },
    });

    const result = await resolveOrCreateGlobalIdentity(mock.db, {
      tenantId: 'tenant-1',
      uhid: 'OZ-000123',
      name: 'Rahim Uddin',
      source: 'hospital',
    });

    expect(result.id).toBe(7);
    expect(result.uhid).toBe('OZ-000123');
    expect(result.created).toBe(false);
  });

  it('creates unclaimed hospital-sourced identity when no match exists', async () => {
    const mock = createMockDB();

    const result = await resolveOrCreateGlobalIdentity(mock.db, {
      tenantId: 'tenant-1',
      nationalId: '1234567890',
      phone: '01712345678',
      name: 'Rahim Uddin',
      source: 'hospital',
    });

    expect(result.created).toBe(true);
    expect(result.uhid).toMatch(/^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(result.claimStatus).toBe('unclaimed');
    expect(result.createdSource).toBe('hospital');

    const insertQuery = mock.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO global_patient_identity'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params).toContain('unclaimed');
    expect(insertQuery?.params).toContain('hospital');
    expect(insertQuery?.params).toContain('tenant-1');
  });

  it('does not treat phone-only matches as the same global identity', async () => {
    const mock = createMockDB({
      queryOverride: (sql, params) => {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from global_patient_identity') && normalized.includes('where primary_phone = ?') && params[0] === '01712345678') {
          return {
            first: {
              id: 99,
              uhid: 'OZ-000099',
              claim_status: 'claimed',
              created_source: 'hospital',
            },
          };
        }

        return null;
      },
    });

    const result = await resolveOrCreateGlobalIdentity(mock.db, {
      tenantId: 'tenant-1',
      phone: '01712345678',
      name: 'Different Family Member',
      source: 'hospital',
    });

    expect(result.created).toBe(true);
    expect(result.uhid).toMatch(/^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('claimGlobalIdentity marks an identity as claimed', async () => {
    const mock = createMockDB();

    await claimGlobalIdentity(mock.db, 7, 99);

    const updateQuery = mock.queries.find((q) => q.method === 'run' && q.sql.includes('UPDATE global_patient_identity'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.params).toEqual([99, 7]);
  });

  it('falls back to legacy identity schema when claim lifecycle columns are missing', async () => {
    const mock = createMockDB({
      queryOverride: (sql, params) => {
        const normalized = sql.toLowerCase();

        if (normalized.includes('pragma table_info(global_patient_identity)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'primary_name' },
              { name: 'primary_phone' },
              { name: 'primary_email' },
              { name: 'date_of_birth' },
              { name: 'gender' },
            ],
          };
        }

        if (normalized.includes('where national_id = ?') && params[0] === '1234567890') {
          return {
            results: [{
              id: 13,
              uhid: 'OZ-000013',
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
              created_source: 'hospital',
            }],
          };
        }

        return null;
      },
    });

    const result = await resolveOrCreateGlobalIdentity(mock.db, {
      nationalId: '1234567890',
      email: 'legacy@example.com',
      name: 'Legacy Patient',
      source: 'self_signup',
    });

    expect(result.id).toBe(13);
    expect(result.uhid).toBe('OZ-000013');
    expect(result.claimStatus).toBe('unclaimed');
    expect(result.created).toBe(false);
  });

  it('creates identity without claim columns when running against legacy schema', async () => {
    const mock = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();

        if (normalized.includes('pragma table_info(global_patient_identity)') || normalized.includes('pragma table_info("global_patient_identity")')) {
          return {
            results: [
              { name: 'id' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'primary_name' },
              { name: 'primary_phone' },
              { name: 'primary_email' },
              { name: 'date_of_birth' },
              { name: 'gender' },
            ],
          };
        }

        return null;
      },
    });

    const result = await resolveOrCreateGlobalIdentity(mock.db, {
      nationalId: '1234567890',
      phone: '01712345678',
      name: 'Legacy Signup',
      source: 'self_signup',
    });

    expect(result.created).toBe(true);
    expect(result.uhid).toMatch(/^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const insertQuery = mock.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO global_patient_identity'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.sql).not.toContain('claim_status');
    expect(insertQuery?.sql).not.toContain('created_source');
  });
});
