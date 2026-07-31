import { describe, expect, it } from 'vitest';
import { AUDIT_GROUPS, getAuditGroup, toAuditEntry, type RawAuditEntry } from './auditGroups';

describe('auditGroups', () => {
  it('classifies cash-related tables into the cash group', () => {
    expect(getAuditGroup('bills')).toBe('cash');
    expect(getAuditGroup('billing_deposits')).toBe('cash');
    expect(getAuditGroup('cash_drawer_movements')).toBe('cash');
    expect(getAuditGroup('expenses')).toBe('cash');
    expect(getAuditGroup('billing_handovers')).toBe('cash');
    expect(getAuditGroup('payments')).toBe('cash');
    expect(getAuditGroup('emp_cash_transactions')).toBe('cash');
    expect(getAuditGroup('billing_counter_sessions')).toBe('cash');
    expect(getAuditGroup('billing_counter_cash_transfers')).toBe('cash');
    expect(getAuditGroup('billing')).toBe('cash');
  });

  it('classifies everything else as the other group', () => {
    expect(getAuditGroup('patients')).toBe('other');
    expect(getAuditGroup('settings')).toBe('other');
    expect(getAuditGroup('staff')).toBe('other');
    expect(getAuditGroup('prescriptions')).toBe('other');
    expect(getAuditGroup('pharmacy')).toBe('other');
    expect(getAuditGroup('token_reservations')).toBe('other');
    expect(getAuditGroup('admissions')).toBe('other');
    expect(getAuditGroup('')).toBe('other');
    expect(getAuditGroup('something_unknown')).toBe('other');
  });

  it('normalizes table names by lowercasing and trimming', () => {
    expect(getAuditGroup('  BILLS  ')).toBe('cash');
    expect(getAuditGroup('Billing_Handovers')).toBe('cash');
  });

  it('shapes a RawAuditEntry into an AuditEntry with cash grouping', () => {
    const row: RawAuditEntry = {
      id: 1,
      user_id: 5,
      user_name: 'Nusrat Jahan Sony',
      action: 'PAYMENT',
      table_name: 'bills',
      record_id: 5196,
      old_value: null,
      new_value: JSON.stringify({ amount: 5000, status: 'paid' }),
      ip_address: '127.0.0.1',
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.groupKey).toBe('cash');
    expect(entry.actionLabel).toBe('PAYMENT');
    expect(entry.entityLabel).toBe('Invoice/Bill');
    expect(entry.entity_id).toBe(5196);
    expect(entry.details).toContain('৳5,000');
    expect(entry.details).toContain('paid');
  });

  it('shapes a RawAuditEntry into an AuditEntry with other grouping for settings', () => {
    const row: RawAuditEntry = {
      id: 2,
      user_id: 1,
      user_name: 'Admin',
      action: 'UPDATE',
      table_name: 'settings',
      record_id: 3,
      old_value: JSON.stringify({ sms: false }),
      new_value: JSON.stringify({ sms: true }),
      ip_address: null,
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.groupKey).toBe('other');
    expect(entry.actionLabel).toBe('Updated');
    expect(entry.entityLabel).toBe('Settings');
  });

  it('classifies null and undefined as the other group', () => {
    expect(getAuditGroup(null)).toBe('other');
    expect(getAuditGroup(undefined)).toBe('other');
  });

  it('falls back to "No extra details" when no fields are parsable', () => {
    const row: RawAuditEntry = {
      id: 3,
      user_id: 1,
      user_name: 'Test',
      action: 'UPDATE',
      table_name: 'settings',
      record_id: 1,
      old_value: null,
      new_value: null,
      ip_address: null,
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.details).toBe('No extra details');
  });

  it('tolerates malformed JSON in new_value and old_value', () => {
    const row: RawAuditEntry = {
      id: 4,
      user_id: 1,
      user_name: 'Test',
      action: 'UPDATE',
      table_name: 'bills',
      record_id: 1,
      old_value: 'not-json{',
      new_value: 'also broken',
      ip_address: '10.0.0.1',
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.details).toBe('IP: 10.0.0.1');
  });

  it('does not render "NaN" for non-numeric amount values', () => {
    const row: RawAuditEntry = {
      id: 5,
      user_id: 1,
      user_name: 'Test',
      action: 'PAYMENT',
      table_name: 'bills',
      record_id: 1,
      old_value: null,
      new_value: JSON.stringify({ amount: 'free', status: 'paid' }),
      ip_address: null,
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.details).not.toContain('NaN');
    expect(entry.details).toContain('paid');
    expect(entry.amount).toBeUndefined();
    expect(entry.amountSign).toBeUndefined();
  });

  it('parses numeric amount from new_value for cash-in payment entries', () => {
    const row: RawAuditEntry = {
      id: 6,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'PAYMENT',
      table_name: 'bills',
      record_id: 5196,
      old_value: null,
      new_value: JSON.stringify({ amount: 5000, status: 'paid' }),
      ip_address: null,
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBe(5000);
    expect(entry.amountSign).toBe('in');
  });

  it('marks billing_deposits create as cash in', () => {
    const row: RawAuditEntry = {
      id: 7,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'billing_deposits',
      record_id: 152,
      old_value: null,
      new_value: JSON.stringify({ amount: 12000, transaction_type: 'deposit' }),
      ip_address: null,
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBe(12000);
    expect(entry.amountSign).toBe('in');
  });

  it('marks expenses create as cash out', () => {
    const row: RawAuditEntry = {
      id: 8,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'expenses',
      record_id: 88,
      old_value: null,
      new_value: JSON.stringify({ amount: 3500 }),
      ip_address: null,
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBe(3500);
    expect(entry.amountSign).toBe('out');
  });

  it('uses current expense state to complete sparse approval audit rows', () => {
    const row: RawAuditEntry = {
      id: 81,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'APPROVE',
      table_name: 'expenses',
      record_id: 88,
      old_value: JSON.stringify({ status: 'pending' }),
      new_value: JSON.stringify({ status: 'approved' }),
      ip_address: null,
      created_at: '2026-06-04T17:23:11Z',
      expenseStatus: 'approved',
      expenseAmount: 3500,
      expenseCategory: 'MAINTENANCE',
      expenseDescription: 'Generator repair',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBe(3500);
    expect(entry.amountSign).toBe('out');
    expect(entry.details).toContain('Status: approved');
    expect(entry.details).toContain('Amount: ৳3,500');
    expect(entry.details).toContain('Category: MAINTENANCE');
  });

  it('honours movementType for cash_drawer_movements', () => {
    const out: RawAuditEntry = {
      id: 9, user_id: 5, user_name: 'Nusrat', action: 'CREATE',
      table_name: 'cash_drawer_movements', record_id: 41,
      old_value: null, new_value: JSON.stringify({ movementType: 'cash_out', amount: 1500 }),
      ip_address: null, created_at: '2026-06-04T17:23:11Z',
    };
    const inn: RawAuditEntry = {
      ...out, id: 10, new_value: JSON.stringify({ movementType: 'cash_in', amount: 1500 }),
    };
    expect(toAuditEntry(out).amountSign).toBe('out');
    expect(toAuditEntry(inn).amountSign).toBe('in');
  });

  it('does not treat an old bill total as a cash amount', () => {
    const row: RawAuditEntry = {
      id: 11,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'UPDATE',
      table_name: 'bills',
      record_id: 5196,
      old_value: JSON.stringify({ total: 2500, status: 'open' }),
      new_value: JSON.stringify({ status: 'paid' }),
      ip_address: null,
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBeUndefined();
    expect(entry.amountSign).toBeUndefined();
  });

  it('does not set amount or sign for non-cash entries', () => {
    const row: RawAuditEntry = {
      id: 12,
      user_id: 1,
      user_name: 'Admin',
      action: 'UPDATE',
      table_name: 'settings',
      record_id: 3,
      old_value: null,
      new_value: JSON.stringify({ sms: true }),
      ip_address: null,
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.amount).toBeUndefined();
    expect(entry.amountSign).toBeUndefined();
  });

  it('exposes two groups with correct colors and icons', () => {
    expect(AUDIT_GROUPS).toHaveLength(2);
    expect(AUDIT_GROUPS[0].key).toBe('cash');
    expect(AUDIT_GROUPS[0].color).toBe('emerald');
    expect(AUDIT_GROUPS[1].key).toBe('other');
    expect(AUDIT_GROUPS[1].color).toBe('blue');
  });

  it('does not treat a bill total on CREATE as cash received', () => {
    const row: RawAuditEntry = {
      id: 13,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'bills',
      record_id: 5215,
      old_value: null,
      new_value: JSON.stringify({ invoiceNo: 'BL-000009', total: 8000 }),
      ip_address: null,
      created_at: '2026-06-10T09:35:00Z',
    };

    const entry = toAuditEntry(row);

    expect(entry.amount).toBeUndefined();
    expect(entry.amountSign).toBeUndefined();
  });

  it('does not infer unpaid status when a bill audit snapshot has no status', () => {
    const row: RawAuditEntry = {
      id: 14,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'bills',
      record_id: 5215,
      old_value: null,
      new_value: JSON.stringify({ invoiceNo: 'BL-000009', total: 8000 }),
      ip_address: null,
      created_at: '2026-06-10T09:35:00Z',
    };

    expect(toAuditEntry(row).paymentStatus).toBe('unknown');
  });

  it('uses the current joined bill state for paid, due, total, and status', () => {
    const row = {
      id: 15,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'bills',
      record_id: 5215,
      old_value: null,
      new_value: JSON.stringify({ invoiceNo: 'BL-000009', total: 8000 }),
      ip_address: null,
      created_at: '2026-06-10T09:35:00Z',
      billStatus: 'partially_paid',
      billTotal: 8000,
      billPaid: 5000,
      billDue: 3000,
    } satisfies RawAuditEntry & {
      billStatus: string;
      billTotal: number;
      billPaid: number;
      billDue: number;
    };

    const entry = toAuditEntry(row);

    expect(entry.paymentStatus).toBe('partially_paid');
    expect(entry.paymentPaid).toBe(5000);
    expect(entry.paymentDue).toBe(3000);
    expect(entry.paymentTotal).toBe(8000);
  });

  it('reconciles a stale zero paid value from total and due', () => {
    const row: RawAuditEntry = {
      id: 16,
      user_id: 5,
      user_name: 'Nusrat',
      action: 'CREATE',
      table_name: 'bills',
      record_id: 5215,
      old_value: null,
      new_value: JSON.stringify({ invoiceNo: 'BL-000009', total: 8000 }),
      ip_address: null,
      created_at: '2026-06-10T09:35:00Z',
      billStatus: 'partially_paid',
      billTotal: 8000,
      billPaid: 0,
      billDue: 3000,
    };

    expect(toAuditEntry(row).paymentPaid).toBe(5000);
  });

  it('shows cash custody transfer audit rows with sender, receiver, and pending due amount', () => {
    const row: RawAuditEntry = {
      id: 17,
      user_id: 119,
      user_name: 'Safaoat Ullah',
      action: 'CREATE',
      table_name: 'billing_counter_cash_transfers',
      record_id: 2,
      old_value: null,
      new_value: JSON.stringify({ amount: 18450, status: 'pending' }),
      ip_address: null,
      created_at: '2026-06-19T22:23:36Z',
      transferNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
      transferStatus: 'pending',
      transferAmount: 18450,
      transferReceivedAmount: 0,
      transferDueAmount: 18450,
      transferDestinationType: 'admin_custody',
      transferCustodyLabel: 'Dr. Nazmus Sakib (hospital_admin)',
      transferByName: 'Safaoat Ullah',
      transferToName: 'Dr. Nazmus Sakib',
    };

    const entry = toAuditEntry(row);

    expect(entry.groupKey).toBe('cash');
    expect(entry.entityLabel).toBe('Cash Custody Transfer');
    expect(entry.amount).toBe(18450);
    expect(entry.amountSign).toBe('out');
    expect(entry.details).toContain('Transfer: CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a');
    expect(entry.details).toContain('From: Safaoat Ullah');
    expect(entry.details).toContain('To: Dr. Nazmus Sakib');
    expect(entry.details).toContain('Status: pending');
    expect(entry.details).toContain('Due: ৳18,450');
  });
});
