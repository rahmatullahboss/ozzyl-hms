import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import expectedReferences from './fixtures/patient-reference-columns.json';
import {
  PATIENT_REFERENCE_REGISTRY,
  type PatientReferenceDefinition,
} from '../src/lib/patient-reference-registry';

function key(reference: Pick<PatientReferenceDefinition, 'table' | 'column' | 'tenantColumn'>): string {
  return `${reference.table}.${reference.column}@${reference.tenantColumn}`;
}

describe('patient reference registry', () => {
  test('covers every reviewed current-schema patient reference exactly once', () => {
    const expectedKeys = expectedReferences.map(key).sort();
    const actualKeys = PATIENT_REFERENCE_REGISTRY.map(key).sort();

    expect(new Set(actualKeys).size).toBe(actualKeys.length);
    expect(actualKeys).toEqual(expectedKeys);
    expect(actualKeys.length).toBeGreaterThan(160);
  });

  test('covers current Drizzle tenant patient references in addition to the live schema fixture', () => {
    const registered = new Set(PATIENT_REFERENCE_REGISTRY.map(key));
    const tablePattern = /sqliteTable\(\s*['"]([^'"]+)['"]\s*,\s*\{(.*?)\}\s*,/gs;
    const discovered: string[] = [];

    for (const fileName of readdirSync('src/db/schema').filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(`src/db/schema/${fileName}`, 'utf8');
      for (const match of source.matchAll(tablePattern)) {
        const body = match[2] ?? '';
        if (!/patientId\s*:\s*[^\n]*['"]patient_id['"]/.test(body)) continue;
        if (!/tenantId\s*:\s*[^\n]*['"]tenant_id['"]/.test(body)) continue;
        discovered.push(`${match[1]}.patient_id@tenant_id`);
      }
    }

    expect(discovered.length).toBeGreaterThan(60);
    expect(discovered.filter((reference) => !registered.has(reference))).toEqual([]);
  });

  test('assigns explicit safety policies to immutable and accounting evidence', () => {
    const byKey = new Map(PATIENT_REFERENCE_REGISTRY.map((reference) => [key(reference), reference]));

    expect(byKey.get('accounting_journal_lines.patient_id@tenant_id')?.policy)
      .toBe('retain_verified_accounting');
    expect(byKey.get('lis_analyzer_inbox.patient_id@tenant_id')?.policy)
      .toBe('retain_immutable');
    expect(byKey.get('patient_portal_notifications.patient_id@tenant_id')?.policy)
      .toBe('retain_immutable');
    expect(byKey.get('patient_bridge_audit.requested_patient_id@tenant_id')?.policy)
      .toBe('retain_immutable');
    expect(byKey.get('canonical_invoices.legacy_patient_id@tenant_id')?.policy)
      .toBe('move');
    expect(byKey.get('patients.duplicate_of_patient_id@tenant_id')?.policy)
      .toBe('move');
  });

  test('merge implementation consumes the reviewed registry rather than a local table list', () => {
    const source = readFileSync('src/lib/mpi-merge.ts', 'utf8');
    expect(source).toContain("from './patient-reference-registry'");
    expect(source).not.toContain('export const PATIENT_REFERENCE_REGISTRY:');
    expect(source).toContain('countRetainedReferenceRows');
  });

  test('creates the record-level merge map for environments missing the historical migration', () => {
    const migration = readFileSync('migrations/0547_patient_merge_map_hardening.sql', 'utf8');
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS patient_merge_record_map/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_map_unique_record/i);

    const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS patient_merge_record_map');

    const drizzleSchema = readFileSync('src/db/schema/mpi.ts', 'utf8');
    expect(drizzleSchema).toContain("patientMergeRecordMap = sqliteTable('patient_merge_record_map'");
  });
});
