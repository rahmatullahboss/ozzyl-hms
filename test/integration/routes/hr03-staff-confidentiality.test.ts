import { describe, expect, it } from 'vitest';
import { maskStaffBankAccount, projectStaffDirectoryRow } from '../../../src/lib/hr-staff-confidentiality';

const staffRow = {
  id: 42, name: 'Amina', position: 'Nurse', status: 'active', tenant_id: '102',
  salary: 75000, bank_account: 'BD12345678901',
  bankAccount: 'BD-NESTED', basic_salary: 95000, nested: { account_number: 'BD-HIDDEN' },
  workforce_member: { memberPublicId: 'wfm-42', tenantId: '102', displayName: 'Amina',
    salary: 999999, bank_account: 'WRONG', extra: { token: 'SECRET' } },
  email: 'amina@example.test', mobile: '01700000000',
};

describe('HR-03 staff confidentiality projection', () => {
  it('does not expose salary or bank values in operational-only staff rows, including nested and unexpected fields', () => {
    const projection = projectStaffDirectoryRow(staffRow, { compensationRead: false, bankMetadataRead: false });
    const serialized = JSON.stringify(projection);
    expect(projection.name).toBe('Amina');
    expect(serialized).not.toMatch(/75000|95000|999999|BD12345678901|BD-NESTED|WRONG|BD-HIDDEN|SECRET/);
    expect(projection).not.toHaveProperty('salary');
    expect(projection).not.toHaveProperty('bank_account');
    expect(projection.workforce_member).not.toHaveProperty('salary');
  });

  it('shows compensation only with compensation read grant and masked banking only with bank read grant', () => {
    const payroll = projectStaffDirectoryRow(staffRow, { compensationRead: true, bankMetadataRead: false });
    expect(payroll.salary).toBe(75000);
    expect(payroll).not.toHaveProperty('bank_account');
    const bank = projectStaffDirectoryRow(staffRow, { compensationRead: false, bankMetadataRead: true });
    expect(bank).not.toHaveProperty('salary');
    expect(bank.bank_account_masked).toBe('••••8901');
    expect(JSON.stringify(bank)).not.toContain('BD12345678901');
  });

  it('never reveals short full values when masking', () => {
    expect(maskStaffBankAccount('12')).toBe('••••');
    expect(maskStaffBankAccount('12345')).toBe('••••2345');
    expect(maskStaffBankAccount('')).toBeNull();
  });
});
