import { describe, expect, test } from 'vitest';
import {
  applyMerge,
  countReferenceRows,
  countRetainedReferenceRows,
  previewMerge,
  rollbackMerge,
  sha256Hex,
} from '../src/lib/mpi-merge';
import { createMockDB } from './integration/helpers/mock-db';

function patient(id: number, name: string) {
  return {
    id,
    tenant_id: 'tenant-1',
    patient_code: `P-${id}`,
    name,
    mobile: '01712345678',
    is_active: 1,
    is_duplicate: 0,
    duplicate_of_patient_id: null,
    global_identity_id: id + 100,
  };
}

describe('patient merge hardening', () => {
  test('preview stores the hash of the confirmation value it returns on request-hash conflict', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select * from patients')) {
          const id = Number(params[0]);
          return { first: patient(id, id === 1 ? 'Primary' : 'Secondary') };
        }
        if (normalized.startsWith('pragma table_info')) return { results: [] };
        return null;
      },
    });

    const result = await previewMerge(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 7,
      primaryPatientId: 1,
      secondaryPatientId: 2,
      mergeReason: 'Exact duplicate',
    });

    const confirmationInsert = mockDB.queries.find((query) =>
      query.sql.includes('INSERT INTO patient_merge_confirmation'),
    );
    expect(confirmationInsert?.sql).toContain('confirmation_token_hash = excluded.confirmation_token_hash');
    expect(confirmationInsert?.params[1]).toBe(await sha256Hex(result.confirmation_token));
  });

  test('apply maps secondary-owned rows before updating references in one batch', async () => {
    const confirmationValue = 'test-merge-confirmation';
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
        if (normalized.startsWith('pragma table_info("visits")')) {
          return { results: [{ name: 'id' }, { name: 'tenant_id' }, { name: 'patient_id' }] };
        }
        if (normalized.startsWith('pragma table_info')) return { results: [] };
        if (normalized.includes('select count(*) as cnt from visits')) {
          return { first: { cnt: 2 } };
        }
        if (normalized.includes('select id from "visits"')) {
          return { results: [{ id: 10 }, { id: 11 }] };
        }
        if (normalized.includes('from admissions') && normalized.includes("status = 'admitted'")) {
          return { first: null };
        }
        if (normalized.includes('select * from patients')) {
          return { first: patient(Number(params[0]), 'Secondary') };
        }
        if (normalized.includes('select id from patient_merge_log')) {
          return { first: { id: 99 } };
        }
        return null;
      },
    });

    const result = await applyMerge(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 7,
      confirmationToken: confirmationValue,
    });

    expect(result.total_rows_moved).toBe(2);
    expect(mockDB.batchCalls).toHaveLength(1);
    const statements = mockDB.batchCalls[0];
    const mapIndex = statements.findIndex((sql) => sql.includes('INSERT INTO patient_merge_record_map'));
    const visitUpdateIndex = statements.findIndex((sql) => /UPDATE\s+"?visits"?/i.test(sql));
    const confirmationIndex = statements.findIndex((sql) => /UPDATE\s+patient_merge_confirmation/i.test(sql));
    expect(mapIndex).toBeGreaterThanOrEqual(0);
    expect(mapIndex).toBeLessThan(visitUpdateIndex);
    expect(statements[mapIndex]).toContain('record_id');
    expect(statements[mapIndex]).toContain('original_patient_id');
    expect(confirmationIndex).toBeGreaterThan(visitUpdateIndex);
    expect(statements.some((sql) =>
      /UPDATE\s+patients/i.test(sql)
      && sql.includes('is_active = 0')
      && sql.includes('duplicate_of_patient_id'),
    )).toBe(true);
  });

  test('idempotent replay reports the original moved-row total', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select * from patient_merge_confirmation')) {
          return {
            first: {
              id: 55,
              request_hash: 'merge-request-hash',
              primary_patient_id: 1,
              secondary_patient_id: 2,
              status: 'applied',
              applied_at: '2026-07-26T00:00:00.000Z',
              applied_merge_log_id: 99,
              expires_at: '2026-07-26T00:00:00.000Z',
            },
          };
        }
        if (normalized.includes('select * from patient_merge_log')) {
          return {
            first: {
              id: 99,
              tables_updated: '[{"table":"visits","column":"patient_id","count":2}]',
              rows_moved_json: '[{"table":"visits","column":"patient_id","count":2}]',
            },
          };
        }
        return null;
      },
    });

    const replay = await applyMerge(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 7,
      confirmationToken: 'test-merge-confirmation',
    });

    expect(replay.outcome).toBe('replay');
    expect(replay.total_rows_moved).toBe(2);
  });


  test('rollback restores the exact mapped column and full secondary patient state', async () => {
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
        if (normalized.startsWith('pragma table_info("patient_merge_log")')) {
          return { results: [{ name: 'id' }] };
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
        if (normalized.startsWith('update')) return { meta: { changes: 1 } };
        return null;
      },
    });

    const result = await rollbackMerge(
      mockDB.db,
      'tenant-1',
      99,
      7,
      'Incorrect merge',
    );

    expect(result.tables_reverted.patient_family_links).toBe(1);
    const familyUpdate = mockDB.queries.find((query) =>
      query.sql.includes('UPDATE "patient_family_links"')
      && query.sql.includes('SET "child_patient_id" = ?'),
    );
    expect(familyUpdate?.params).toEqual([2, 44, 'tenant-1', 1]);

    const patientRestore = mockDB.queries.find((query) =>
      query.sql.includes('UPDATE patients') && query.sql.includes('is_duplicate = ?'),
    );
    expect(patientRestore?.params).toEqual([
      'Secondary',
      '01712345678',
      1,
      0,
      null,
      202,
      2,
      'tenant-1',
    ]);
    expect(mockDB.queries.some((query) => query.sql.includes('SET is_unmerged = 1'))).toBe(false);
  });


  test('moves only unverified accounting rows and reports verified rows as retained', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalized.includes('select id from "accounting_journal_lines"')
          && normalized.includes('not exists')) {
          return { results: [{ id: 10 }] };
        }
        if (normalized.includes('select count(*) as count from "accounting_journal_lines"')
          && normalized.includes('exists')
          && !normalized.includes('not exists')) {
          return { first: { count: 2 } };
        }
        return null;
      },
    });

    const moved = await countReferenceRows(mockDB.db, 'tenant-1', 2);
    const retained = await countRetainedReferenceRows(mockDB.db, 'tenant-1', 2);

    expect(moved).toContainEqual({
      table: 'accounting_journal_lines',
      column: 'patient_id',
      tenant_column: 'tenant_id',
      count: 1,
      row_ids: [10],
    });
    expect(retained).toContainEqual(expect.objectContaining({
      table: 'accounting_journal_lines',
      column: 'patient_id',
      count: 2,
    }));
  });


  test('preview refuses an already inactive merged patient alias', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select * from patients')) {
          const id = Number(params[0]);
          return {
            first: id === 1
              ? patient(1, 'Primary')
              : { ...patient(2, 'Secondary [MERGED→1]'), is_active: 0 },
          };
        }
        return null;
      },
    });

    await expect(previewMerge(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 7,
      primaryPatientId: 1,
      secondaryPatientId: 2,
      mergeReason: 'Retry after another merge',
    })).rejects.toThrow('Secondary patient is already inactive or merged');
  });
});
