import { describe, expect, it } from 'vitest';
import { assertPatientSnapshotIdentitySafe } from '../src/lib/local-sync-patient-safety';
import { createMockDB } from './integration/helpers/mock-db';

function databaseWithRows(rows: Array<Record<string, unknown>>) {
  return createMockDB({
    queryOverride(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalized.includes('from patients')) return null;
      if (normalized.includes(' id in ')) {
        const requested = new Set(params.map(String));
        return { results: rows.filter((row) => requested.has(String(row.id))) };
      }
      const tenantId = String(params[0]);
      const requested = new Set(params.slice(1).map(String));
      if (normalized.includes(' uhid in ')) {
        return { results: rows.filter((row) => String(row.tenant_id) === tenantId && row.uhid && requested.has(String(row.uhid))) };
      }
      if (normalized.includes(' patient_code in ')) {
        return { results: rows.filter((row) => String(row.tenant_id) === tenantId && row.patient_code && requested.has(String(row.patient_code))) };
      }
      return null;
    },
  }).db;
}

const incoming = {
  id: 41,
  tenant_id: 'tenant-1',
  uhid: 'OZ-000041',
  patient_code: 'P-000041',
};

describe('local-server patient snapshot identity safety', () => {
  it('allows a cloud patient when the same local ID and natural identity match', async () => {
    const db = databaseWithRows([incoming]);
    await expect(assertPatientSnapshotIdentitySafe(db, 'tenant-1', [incoming])).resolves.toBeUndefined();
  });

  it('allows a new cloud patient when no local ID or natural identity exists', async () => {
    const db = databaseWithRows([]);
    await expect(assertPatientSnapshotIdentitySafe(db, 'tenant-1', [incoming])).resolves.toBeUndefined();
  });

  it('blocks a cloud patient numeric ID that belongs to another local tenant', async () => {
    const db = databaseWithRows([{ ...incoming, tenant_id: 'tenant-2' }]);
    await expect(assertPatientSnapshotIdentitySafe(db, 'tenant-1', [incoming]))
      .rejects.toThrow(/belongs to another local tenant/i);
  });

  it('blocks a cloud patient ID that belongs to a different local UHID', async () => {
    const db = databaseWithRows([{ ...incoming, uhid: 'OZ-OTHER' }]);
    await expect(assertPatientSnapshotIdentitySafe(db, 'tenant-1', [incoming]))
      .rejects.toThrow(/uhid conflicts/i);
  });

  it('blocks a cloud numeric ID when the natural identity belongs to another local patient ID', async () => {
    const db = databaseWithRows([{ ...incoming, id: 99 }]);
    await expect(assertPatientSnapshotIdentitySafe(db, 'tenant-1', [incoming]))
      .rejects.toThrow(/identity already belongs to local patient 99/i);
  });
});
