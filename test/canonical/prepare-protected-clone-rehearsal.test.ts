import { describe, expect, it } from 'vitest';
import { buildProtectedCloneScopeRecords } from '../../scripts/canonical/prepare-protected-clone-rehearsal';

const source = {
  invoice: 'INV-EXACT',
  payment: 'RCPT-EXACT',
  deposit: 'DEP-EXACT',
  patient: '11',
  practitioner: '12',
  appointment: '13',
  encounter: '14',
  admission: '15',
  compensation: '16',
};

describe('CDB-V1-050 protected-clone authorization preparation', () => {
  it('builds 24 exact tenant-bound provider/consumer/source scopes', () => {
    const records = buildProtectedCloneScopeRecords('100', source);

    expect(records).toHaveLength(24);
    expect(new Set(records.map((record) => JSON.stringify(record))).size).toBe(24);
    expect(records.filter((record) => record.consumerId.startsWith('cdb040b.'))).toHaveLength(18);
    expect(records.filter((record) => record.consumerId.startsWith('cdb040c.'))).toHaveLength(6);
    expect(records.every((record) => record.tenantId === '100')).toBe(true);
    expect(records).toContainEqual({
      tenantId: '100',
      providerKey: 'canonical_invoice_provider_v1',
      consumerId: 'cdb040b.billing-detail',
      sourceTable: 'bills',
      sourceRowKey: 'bills:INV-EXACT',
    });
    expect(records).toContainEqual({
      tenantId: '100',
      providerKey: 'canonical_compensation_accrual_provider_v1',
      consumerId: 'cdb040c.commission-accrual-admin',
      sourceTable: 'doctor_commission_accruals',
      sourceRowKey: 'doctor_commission_accruals:16',
    });
  });
});
