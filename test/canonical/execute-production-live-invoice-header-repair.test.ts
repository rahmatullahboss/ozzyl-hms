import { describe, expect, it } from 'vitest';
import {
  executeLiveInvoiceHeaderRepair,
  LIVE_INVOICE_HEADER_REPAIR_APPROVAL,
  type LiveInvoiceHeaderRepairGateway,
  type LiveInvoiceHeaderRepairRow,
} from '../../scripts/canonical/execute-production-live-invoice-header-repair';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

function candidate(): LiveInvoiceHeaderRepairRow {
  return {
    invoice_public_id: 'inv_767GGT86WNGGH58CEQ1KFGNH40',
    subtotal_minor: 0,
    adjustment_total_minor: 2_000_000,
    total_minor: 2_000_000,
    paid_minor: 0,
    due_minor: 2_000_000,
    legacy_bill_count: 1,
    expected_gross_minor: 2_000_000,
    expected_adjustment_minor: 0,
    expected_total_minor: 2_000_000,
  };
}

describe('production live invoice header repair', () => {
  it('repairs exactly one compatible row and verifies the post-state', async () => {
    let row = candidate();
    const writes: string[] = [];
    const gateway: LiveInvoiceHeaderRepairGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readCandidates() { return [row]; },
      async writeRepair(sql) {
        writes.push(sql);
        row = { ...row, subtotal_minor: 2_000_000, adjustment_total_minor: 0 };
        return { changes: 1, rowsWritten: 1 };
      },
    };

    const result = await executeLiveInvoiceHeaderRepair({
      approval: LIVE_INVOICE_HEADER_REPAIR_APPROVAL,
      execute: true,
    }, gateway);

    expect(result).toMatchObject({ repaired: true, currentSubtotalMinor: 2_000_000, currentAdjustmentMinor: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("invoice_public_id='inv_767GGT86WNGGH58CEQ1KFGNH40'");
    expect(writes[0]).toContain('AND subtotal_minor=0');
    expect(writes[0]).toContain('AND adjustment_total_minor=2000000');
  });

  it('fails closed before write when approval or candidate cardinality is wrong', async () => {
    let writes = 0;
    const gateway: LiveInvoiceHeaderRepairGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readCandidates() { return []; },
      async writeRepair() { writes += 1; return { changes: 1, rowsWritten: 1 }; },
    };

    await expect(executeLiveInvoiceHeaderRepair({ approval: 'wrong', execute: true }, gateway)).rejects.toThrow(/approval/i);
    await expect(executeLiveInvoiceHeaderRepair({ approval: LIVE_INVOICE_HEADER_REPAIR_APPROVAL, execute: true }, gateway)).rejects.toThrow(/exactly one/i);
    expect(writes).toBe(0);
  });
});
