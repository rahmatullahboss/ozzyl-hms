import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBillCreatedLines,
  buildDepositAdjustedLines,
  buildDepositReceivedLines,
  buildPaymentReceivedLines,
  validateJournalLines,
  type ResolvedAccountMappings,
} from '../../src/lib/accounting-posting';
import { buildMigrationEntry, classifyMigration } from '../../scripts/build-migration-manifest';

const migrationFilename = '0299_ipd_accounting_hardening.sql';
const migrationSql = readFileSync(join(process.cwd(), 'migrations', migrationFilename), 'utf8');

const mappings: ResolvedAccountMappings = {
  cash: 101,
  accounts_receivable: 201,
  lab_revenue: 301,
  doctor_visit_revenue: 302,
  admission_revenue: 303,
  operation_revenue: 304,
  pharmacy_revenue: 305,
  other_revenue: 306,
  discount_allowed: 401,
  doctor_commission_payable: 501,
  patient_deposit_liability: 601,
};

function totals(lines: Array<{ debit: number; credit: number }>) {
  return {
    debit: lines.reduce((sum, line) => sum + line.debit, 0),
    credit: lines.reduce((sum, line) => sum + line.credit, 0),
  };
}

describe('IPD accounting hardening', () => {
  it('uses the next safe sequential migration filename', () => {
    expect(classifyMigration(migrationFilename)).toBe('safe');
    const entry = buildMigrationEntry(migrationFilename, migrationSql);
    expect(entry.filename).toBe(migrationFilename);
    expect(entry.order).toBe(299);
    expect(entry.safety).toBe('safe');
    expect(entry.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('keeps professional fee, doctor payable, discount and receivable entries balanced', () => {
    const lines = buildBillCreatedLines({
      total: 800,
      discount: 100,
      testBill: 0,
      doctorVisitBill: 900,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
      appointmentDoctorPayable: 200,
      appointmentDoctorDiscount: 0,
    }, mappings);

    expect(totals(lines)).toEqual({ debit: 900, credit: 900 });
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: mappings.accounts_receivable,
      debit: 800,
      credit: 0,
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: mappings.discount_allowed,
      debit: 100,
      credit: 0,
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: mappings.doctor_commission_payable,
      debit: 0,
      credit: 200,
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: mappings.doctor_visit_revenue,
      debit: 0,
      credit: 700,
    }));
  });

  it('posts payment and deposit adjustment against receivable without overstating revenue', () => {
    const paymentLines = buildPaymentReceivedLines({ amount: 500, paymentMethod: 'cash' }, mappings);
    expect(paymentLines).toEqual([
      expect.objectContaining({ accountId: mappings.cash, debit: 500, credit: 0 }),
      expect.objectContaining({ accountId: mappings.accounts_receivable, debit: 0, credit: 500 }),
    ]);

    const depositReceivedLines = buildDepositReceivedLines({ amount: 300, paymentMethod: 'cash' }, mappings);
    expect(depositReceivedLines).toEqual([
      expect.objectContaining({ accountId: mappings.cash, debit: 300, credit: 0 }),
      expect.objectContaining({ accountId: mappings.patient_deposit_liability, debit: 0, credit: 300 }),
    ]);

    const depositAdjustedLines = buildDepositAdjustedLines({ amount: 300 }, mappings);
    expect(depositAdjustedLines).toEqual([
      expect.objectContaining({ accountId: mappings.patient_deposit_liability, debit: 300, credit: 0 }),
      expect.objectContaining({ accountId: mappings.accounts_receivable, debit: 0, credit: 300 }),
    ]);
  });

  it('rejects unbalanced or double-sided journal lines before they reach accounting', () => {
    expect(() => validateJournalLines([
      { accountId: 1, debit: 100, credit: 0, memo: 'debit' },
      { accountId: 2, debit: 0, credit: 90, memo: 'credit' },
    ])).toThrow('unbalanced');

    expect(() => validateJournalLines([
      { accountId: 1, debit: 100, credit: 10, memo: 'bad line' },
      { accountId: 2, debit: 0, credit: 90, memo: 'credit' },
    ])).toThrow('exactly one debit or credit');
  });

  it('ships idempotency and voucher-number database guards', () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_accounting_posting_events_tenant_source_event_key[\s\S]+ON accounting_posting_events\(tenant_id, source_event_key\)[\s\S]+WHERE source_event_key IS NOT NULL;/);
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_accounting_vouchers_tenant_source_event_key[\s\S]+ON accounting_vouchers\(tenant_id, source_event_key\)[\s\S]+WHERE source_event_key IS NOT NULL;/);
    expect(migrationSql).toContain('ux_accounting_vouchers_tenant_fiscal_voucher_number');
    expect(migrationSql).toContain('ON accounting_vouchers(tenant_id, COALESCE(fiscal_year_id, 0), voucher_number)');
    expect(migrationSql).toContain('ux_voucher_numbering_tenant_type_fiscal');
  });

  it('ships complete manual IPD charge guards, not only category string checks', () => {
    expect(migrationSql).toContain('trg_billing_provisional_manual_category_insert');
    expect(migrationSql).toContain('trg_billing_provisional_manual_category_update');
    expect(migrationSql).toContain("LENGTH(TRIM(COALESCE(NEW.item_name, ''))) < 3");
    expect(migrationSql).toContain("LOWER(TRIM(COALESCE(NEW.item_category, ''))) NOT IN");
    expect(migrationSql).toContain('COALESCE(NEW.unit_price, 0) <= 0');
    expect(migrationSql).toContain('COALESCE(NEW.quantity, 0) <= 0');
    expect(migrationSql).toContain('NEW.created_by IS NULL');
    expect(migrationSql).toContain("'doctor_fee'");
    expect(migrationSql).toContain("'operation'");
    expect(migrationSql).toContain("'service'");
  });

  it('ships journal-line guards at the database boundary', () => {
    expect(migrationSql).toContain('trg_accounting_journal_lines_amount_insert');
    expect(migrationSql).toContain('trg_accounting_journal_lines_amount_update');
    expect(migrationSql).toContain('(COALESCE(NEW.debit_amount, 0) > 0 AND COALESCE(NEW.credit_amount, 0) = 0)');
    expect(migrationSql).toContain('(COALESCE(NEW.credit_amount, 0) > 0 AND COALESCE(NEW.debit_amount, 0) = 0)');
  });
});
