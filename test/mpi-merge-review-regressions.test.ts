import { describe, expect, test } from 'vitest';
import { applyMerge, rollbackMerge } from '../src/lib/mpi-merge';
import { createMockDB } from './integration/helpers/mock-db';

function patient(id: number) {
  return {
    id,
    tenant_id: 'tenant-1',
    patient_code: `P-${id}`,
    name: id === 1 ? 'Primary' : 'Secondary',
    mobile: '01712345678',
    is_active: 1,
    is_duplicate: 0,
    duplicate_of_patient_id: null,
    global_identity_id: id + 100,
  };
}

describe('patient merge review regressions', () => {
  test('apply maps and updates references without an unbounded row-id bind list', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('select * from patient_merge_confirmation')) {
          return {
            first: {
              id: 55,
              request_hash: 'merge-request-hash',
              primary_patient_id: 1,
              secondary_patient_id: 2,
              status: 'pending',
              applied_at: null,
              applied_merge_log_id: null,
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          };
        }
        if (normalized.includes('select id from "visits"')) {
          return { results: Array.from({ length: 1200 }, (_, index) => ({ id: index + 1 })) };
        }
        if (normalized.includes('from admissions') && normalized.includes("status = 'admitted'")) {
          return { first: null };
        }
        if (normalized.includes('select * from patients')) {
          return { first: patient(Number(params[0])) };
        }
        if (normalized.includes('select id from patient_merge_log')) {
          return { first: { id: 99 } };
        }
        return null;
      },
    });

    await applyMerge(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 7,
      confirmationToken: '[REDACTED_SECRET]',
    });

    const statements = mockDB.batchCalls[0];
    const mergeLogInsert = statements.find((sql) => sql.includes('INSERT INTO patient_merge_log'));
    const mapStatement = statements.find((sql) => sql.includes('INSERT INTO patient_merge_record_map'));
    const visitUpdate = statements.find((sql) => /UPDATE\s+"?visits"?/i.test(sql));
    const patientUpdate = statements.find((sql) => /UPDATE\s+patients/i.test(sql));
    const confirmationUpdate = statements.find((sql) => /UPDATE\s+patient_merge_confirmation/i.test(sql));
    expect(mergeLogInsert).toMatch(/COALESCE\(is_active,\s*1\)\s*=\s*1/i);
    expect(mapStatement).toBeDefined();
    expect(visitUpdate).toBeDefined();
    expect(mapStatement).not.toMatch(/\bid\s+IN\s*\(/i);
    expect(visitUpdate).not.toMatch(/\bid\s+IN\s*\(/i);
    expect(mapStatement).toMatch(/AND\s+EXISTS\s*\(/i);
    expect(visitUpdate).toMatch(/AND\s+EXISTS\s*\(/i);
    expect(patientUpdate).toMatch(/AND\s+EXISTS\s*\(/i);
    expect(confirmationUpdate).toMatch(/AND\s+EXISTS\s*\(/i);
  });

  test('rollback restores a mapped row only while it still points at the merge target', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalized.includes('select * from patient_merge_log')) {
          return {
            first: {
              id: 99,
              primary_patient_id: 1,
              merged_patient_id: 2,
              merged_data: JSON.stringify({
                name: 'Secondary',
                mobile: '01712345678',
                is_active: 1,
                is_duplicate: 0,
                duplicate_of_patient_id: null,
                global_identity_id: 202,
              }),
              tables_updated: '[{"table":"patient_family_links","column":"child_patient_id","count":1}]',
              merged_at: '2026-07-26T00:00:00.000Z',
              is_unmerged: null,
            },
          };
        }
        if (normalized.includes('from patient_merge_audit') && normalized.includes("action = 'rollback'")) {
          return { first: null };
        }
        if (normalized.includes('from patient_merge_record_map')) {
          return {
            results: [{
              table_name: 'patient_family_links',
              column_name: 'child_patient_id',
              record_id: 44,
              original_patient_id: 2,
              target_patient_id: 1,
            }],
          };
        }
        if (normalized.startsWith('pragma table_info("patient_merge_log")')) {
          return { results: [{ name: 'id' }] };
        }
        if (normalized.startsWith('update')) return { meta: { changes: 1 } };
        return null;
      },
    });

    await rollbackMerge(mockDB.db, 'tenant-1', 99, 7, 'Incorrect merge');

    const familyUpdate = mockDB.queries.find((query) =>
      query.sql.includes('UPDATE "patient_family_links"')
      && query.sql.includes('SET "child_patient_id" = ?'),
    );
    expect(familyUpdate?.sql).toMatch(/AND\s+"child_patient_id"\s*=\s*\?/i);
    expect(familyUpdate?.params).toEqual([2, 44, 'tenant-1', 1]);
  });

  test('rollback fails closed and does not reactivate the alias when a mapped reference cannot be restored', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalized.includes('select * from patient_merge_log')) {
          return {
            first: {
              id: 99,
              primary_patient_id: 1,
              merged_patient_id: 2,
              merged_data: JSON.stringify({ name: 'Secondary', mobile: '01712345678' }),
              tables_updated: '[{"table":"patient_family_links","column":"child_patient_id","count":1}]',
              merged_at: '2026-07-26T00:00:00.000Z',
              is_unmerged: null,
            },
          };
        }
        if (normalized.includes('from patient_merge_audit') && normalized.includes("action = 'rollback'")) {
          return { first: null };
        }
        if (normalized.includes('from patient_merge_record_map')) {
          return {
            results: [{
              table_name: 'patient_family_links',
              column_name: 'child_patient_id',
              record_id: 44,
              original_patient_id: 2,
              target_patient_id: 1,
            }],
          };
        }
        if (normalized.startsWith('update "patient_family_links"')) {
          throw new Error('simulated reference restore failure');
        }
        return null;
      },
    });

    await expect(
      rollbackMerge(mockDB.db, 'tenant-1', 99, 7, 'Incorrect merge'),
    ).rejects.toThrow('simulated reference restore failure');

    expect(mockDB.queries.some((query) =>
      query.sql.includes('UPDATE patients') && query.sql.includes('is_active = ?'),
    )).toBe(false);
  });
});
