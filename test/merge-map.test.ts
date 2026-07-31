import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PATIENT_REFERENCE_REGISTRY } from '../src/lib/patient-reference-registry';

describe('Merge Map — Legacy Migration Schema', () => {
  let migrationSql: string;

  beforeAll(() => {
    migrationSql = fs.readFileSync(path.resolve(__dirname, '../migrations/0103_merge_map.sql'), 'utf-8');
  });

  it('preserves the legacy patient_merge_map table for old rollback records', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS patient_merge_map');
    expect(migrationSql).toContain('merge_log_id INTEGER NOT NULL REFERENCES patient_merge_log(id)');
    expect(migrationSql).toContain('table_name TEXT NOT NULL');
    expect(migrationSql).toContain('record_id INTEGER NOT NULL');
    expect(migrationSql).toContain('original_patient_id INTEGER NOT NULL');
    expect(migrationSql).toContain('target_patient_id INTEGER NOT NULL');
  });

  it('keeps the legacy rollback lookup indexes', () => {
    expect(migrationSql).toContain('idx_merge_map_log');
    expect(migrationSql).toContain('idx_merge_map_record');
    expect(migrationSql).toContain('idx_merge_map_tenant');
  });
});

describe('Merge Map — Current Column-Aware Contract', () => {
  let mergeSource: string;
  let migrationSql: string;

  beforeAll(() => {
    mergeSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/mpi-merge.ts'), 'utf-8');
    migrationSql = fs.readFileSync(path.resolve(__dirname, '../migrations/0547_patient_merge_map_hardening.sql'), 'utf-8');
  });

  it('creates the column-aware patient_merge_record_map table and unique record identity', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS patient_merge_record_map');
    expect(migrationSql).toContain('column_name TEXT NOT NULL');
    expect(migrationSql).toContain('idx_merge_map_unique_record');
    expect(migrationSql).toContain('(merge_log_id, table_name, column_name, record_id)');
  });

  it('records a merge log before mapped row movement statements in the transactional batch', () => {
    const applySection = mergeSource.slice(mergeSource.indexOf('export async function applyMerge'));
    const logInsert = applySection.indexOf('INSERT INTO patient_merge_log');
    const mapInsert = applySection.indexOf('INSERT INTO patient_merge_record_map');
    const referenceLoop = applySection.indexOf('for (const entry of counts)');
    expect(logInsert).toBeGreaterThan(0);
    expect(referenceLoop).toBeGreaterThan(logInsert);
    expect(mapInsert).toBeGreaterThan(referenceLoop);
  });

  it('captures exact row identities before updating each reviewed reference', () => {
    expect(mergeSource).toContain('SELECT id FROM ${table}');
    expect(mergeSource).toContain('INSERT INTO patient_merge_record_map');
    expect(mergeSource).toContain('column_name, record_id');
    expect(mergeSource).toContain('original_patient_id, target_patient_id');
  });

  it('binds mapped rows to the persisted merge log through tenant and request hash', () => {
    expect(mergeSource).toContain('(SELECT id FROM patient_merge_log');
    expect(mergeSource).toContain('WHERE tenant_id = ? AND request_hash = ?');
    expect(mergeSource).toContain('confirmation.request_hash');
  });

  it('updates the final merge summary after reference movement statements', () => {
    const mapInsert = mergeSource.indexOf('INSERT INTO patient_merge_record_map');
    const logUpdate = mergeSource.indexOf('UPDATE patient_merge_log', mapInsert);
    expect(mapInsert).toBeGreaterThan(0);
    expect(logUpdate).toBeGreaterThan(mapInsert);
    expect(mergeSource.slice(logUpdate)).toContain('rows_moved_json');
  });

  it('uses the standalone reviewed reference registry', () => {
    expect(PATIENT_REFERENCE_REGISTRY.length).toBeGreaterThanOrEqual(150);
    const keys = new Set(PATIENT_REFERENCE_REGISTRY.map((entry) => `${entry.table}.${entry.column}`));
    for (const key of [
      'visits.patient_id',
      'admissions.patient_id',
      'prescriptions.patient_id',
      'lab_orders.patient_id',
      'bills.patient_id',
      'appointments.patient_id',
      'clinical_vitals.patient_id',
      'patient_allergies.patient_id',
      'patient_active_medications.patient_id',
      'discharge_summaries.patient_id',
    ]) {
      expect(keys).toContain(key);
    }
  });
});

describe('Merge Map — Unmerge Safety', () => {
  let mergeSource: string;
  let routeSource: string;

  beforeAll(() => {
    mergeSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/mpi-merge.ts'), 'utf-8');
    routeSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/tenant/patientDuplicates.ts'), 'utf-8');
  });

  it('requires an administrative role and rejects repeated rollback', () => {
    expect(routeSource).toContain("requireRole('hospital_admin', 'md', 'super_admin')");
    expect(routeSource).toContain("duplicates.post('/unmerge'");
    expect(mergeSource).toContain('is_unmerged === 1 || priorRollback');
    expect(mergeSource).toContain('Merge has already been reversed');
  });

  it('restores the complete saved patient identity snapshot', () => {
    expect(mergeSource).toContain('(snapshot.name as string | null | undefined)');
    expect(mergeSource).toContain('(snapshot.mobile as string | null | undefined)');
    expect(mergeSource).toContain('duplicate_of_patient_id = ?, global_identity_id = ?');
  });

  it('prefers the precise column-aware record map and supports the legacy map', () => {
    expect(mergeSource).toContain('FROM patient_merge_record_map');
    expect(mergeSource).toContain('SELECT table_name, column_name, record_id, original_patient_id, target_patient_id');
    expect(mergeSource).toContain('FROM patient_merge_map');
  });

  it('keeps the timestamp-constrained best-effort path only for legacy merges', () => {
    expect(mergeSource).toContain('Legacy best-effort fallback');
    expect(mergeSource).toContain('AND created_at < ?');
  });

  it('blocks active admissions and marks the secondary patient inactive without erasing identity evidence', () => {
    expect(mergeSource).toContain("status = 'admitted'");
    expect(mergeSource).toContain('Discharge first');
    expect(mergeSource).toContain("ELSE name || ' [MERGED→' || ? || ']'");
    expect(mergeSource).toContain("ELSE 'MERGED-' || COALESCE(mobile, '')");
    expect(mergeSource).toContain('is_active = 0');
    expect(mergeSource).toContain('duplicate_of_patient_id = ?');
  });
});

describe('Lab LOINC Migration', () => {
  let migrationSql: string;

  beforeAll(() => {
    migrationSql = fs.readFileSync(path.resolve(__dirname, '../migrations/0102_lab_loinc.sql'), 'utf-8');
  });

  it('adds and indexes the LOINC code', () => {
    expect(migrationSql).toContain('ALTER TABLE lab_test_catalog ADD COLUMN loinc_code TEXT');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_lab_test_loinc ON lab_test_catalog(loinc_code)');
  });
});
