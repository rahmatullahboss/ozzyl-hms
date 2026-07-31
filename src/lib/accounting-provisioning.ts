import type { D1Database } from '@cloudflare/workers-types';
import { seedInventoryVendorDefaults } from './inventory-vendor-defaults';

type DefaultAccount = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'revenue' | 'expense' | 'equity';
};

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { code: '1003', name: 'Admin / Main Cash', type: 'asset' },
  { code: '1004', name: 'Card Settlement Clearing', type: 'asset' },
  { code: '1005', name: 'bKash Wallet Clearing', type: 'asset' },
  { code: '1006', name: 'Nagad Wallet Clearing', type: 'asset' },
  { code: '1007', name: 'Rocket Wallet Clearing', type: 'asset' },
  { code: '1008', name: 'Bank Transfer Clearing', type: 'asset' },
  { code: '1009', name: 'Cheque Clearing', type: 'asset' },
  { code: '1010', name: 'Other Payment Clearing', type: 'asset' },
  { code: '1300', name: 'Pharmacy Inventory', type: 'asset' },
  { code: '1350', name: 'General Inventory', type: 'asset' },
  { code: '4000', name: 'Pharmacy Sales', type: 'revenue' },
  { code: '4100', name: 'Laboratory Income', type: 'revenue' },
  { code: '4200', name: 'Doctor Visit Fees', type: 'revenue' },
  { code: '4300', name: 'Admission Fees', type: 'revenue' },
  { code: '4400', name: 'Operation/OT Income', type: 'revenue' },
  { code: '4600', name: 'Other Income', type: 'revenue' },
  { code: '5000', name: 'Medicine Cost', type: 'expense' },
  { code: '5700', name: 'Medical Supplies', type: 'expense' },
  { code: '5850', name: 'Doctor Commission Expense', type: 'expense' },
  { code: '5855', name: 'Doctor Settlement Adjustment', type: 'expense' },
  { code: '5860', name: 'Agent / Referral Commission Expense', type: 'expense' },
  { code: '5950', name: 'Discount Allowed', type: 'expense' },
  { code: '5990', name: 'General Operating Expense', type: 'expense' },
  { code: '5992', name: 'Rounding Adjustment', type: 'expense' },
  { code: '5100', name: 'Salary Expense', type: 'expense' },
  { code: '5200', name: 'Rent Expense', type: 'expense' },
  { code: '5310', name: 'Electricity Expense', type: 'expense' },
  { code: '5320', name: 'Water Expense', type: 'expense' },
  { code: '5330', name: 'Communication Expense', type: 'expense' },
  { code: '5400', name: 'Maintenance Expense', type: 'expense' },
  { code: '5800', name: 'Marketing Expense', type: 'expense' },
  { code: '5900', name: 'Bank Charges', type: 'expense' },
  { code: '5991', name: 'Other Expense', type: 'expense' },
  { code: '7000', name: 'Cash', type: 'asset' },
  { code: '7100', name: 'Bank', type: 'asset' },
  { code: '7200', name: 'Accounts Receivable', type: 'asset' },
  { code: '7210', name: 'Employee / Requester Cash Dispute Receivable', type: 'asset' },
  { code: '8000', name: 'Accounts Payable', type: 'liability' },
  { code: '8250', name: 'Patient Deposit Liability', type: 'liability' },
  { code: '8300', name: 'Doctor Commission Payable', type: 'liability' },
  { code: '8310', name: 'Agent / Referral Commission Payable', type: 'liability' },
  { code: '8350', name: 'Shareholder Dividend Payable', type: 'liability' },
  { code: '9000', name: 'Retained Earnings', type: 'equity' },
];

const DEFAULT_MAPPINGS: Record<string, string> = {
  admin_cash: '1003',
  card_clearing: '1004',
  bkash_wallet: '1005',
  nagad_wallet: '1006',
  rocket_wallet: '1007',
  bank_transfer_clearing: '1008',
  cheque_clearing: '1009',
  other_payment_clearing: '1010',
  pharmacy_inventory: '1300',
  general_inventory: '1350',
  pharmacy_revenue: '4000',
  lab_revenue: '4100',
  doctor_visit_revenue: '4200',
  admission_revenue: '4300',
  operation_revenue: '4400',
  other_revenue: '4600',
  pharmacy_cogs: '5000',
  inventory_expense: '5700',
  doctor_commission_expense: '5850',
  agent_commission_expense: '5860',
  discount_allowed: '5950',
  expense_salary: '5100',
  expense_medicine: '5000',
  expense_rent: '5200',
  expense_electricity: '5310',
  expense_water: '5320',
  expense_communication: '5330',
  expense_maintenance: '5400',
  expense_supplies: '5700',
  expense_marketing: '5800',
  expense_bank_charges: '5900',
  general_expense: '5990',
  cash: '7000',
  bank: '7100',
  accounts_receivable: '7200',
  employee_dispute_receivable: '7210',
  doctor_advance_receivable: '7210',
  doctor_settlement_adjustment: '5855',
  rounding_adjustment: '5992',
  accounts_payable: '8000',
  patient_deposit_liability: '8250',
  doctor_commission_payable: '8300',
  agent_commission_payable: '8310',
  shareholder_payable: '8350',
  retained_earnings: '9000',
};

const VOUCHER_TYPES = [
  ['JV', 'Journal Voucher'],
  ['RCPT', 'Receipt Voucher'],
  ['PMTV', 'Payment Voucher'],
] as const;

function tenantScopedCode(code: string, tenantId: string): string {
  return `${code}-T${tenantId}`;
}

function isUniqueCodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed') && message.includes('chart_of_accounts.code');
}

async function insertAccount(db: D1Database, tenantId: string, account: DefaultAccount): Promise<void> {
  const existing = await db.prepare(`
    SELECT id
    FROM chart_of_accounts
    WHERE tenant_id = ?
      AND (code = ? OR code = ?)
    LIMIT 1
  `).bind(tenantId, account.code, tenantScopedCode(account.code, tenantId)).first<{ id: number }>();
  if (existing) return;

  try {
    await db.prepare(`
      INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).bind(account.code, account.name, account.type, tenantId).run();
  } catch (error) {
    if (!isUniqueCodeError(error)) throw error;
    await db.prepare(`
      INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).bind(tenantScopedCode(account.code, tenantId), account.name, account.type, tenantId).run();
  }
}

async function resolveAccountId(db: D1Database, tenantId: string, code: string): Promise<number> {
  const account = await db.prepare(`
    SELECT id
    FROM chart_of_accounts
    WHERE tenant_id = ?
      AND (code = ? OR code = ?)
      AND COALESCE(is_active, 1) = 1
    ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(tenantId, code, tenantScopedCode(code, tenantId), code).first<{ id: number }>();

  if (!account) {
    throw new Error(`Missing chart of account ${code} for tenant ${tenantId}`);
  }
  return account.id;
}

export async function seedAccountingDefaults(db: D1Database, tenantId: string | number): Promise<void> {
  const tenant = String(tenantId);
  const currentYear = new Date().getFullYear();

  // Wrap in a try so any seeding error is logged but doesn't block the
  // overall provisioning flow. Accounting defaults are convenience seeds;
  // a failure here shouldn't leave a half-provisioned tenant.
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO fiscal_years
        (tenant_id, fiscal_year_name, start_date, end_date, is_active, is_closed, created_at)
      VALUES (?, ?, ?, ?, 1, 0, datetime('now', '+6 hours'))
    `).bind(tenant, `FY${currentYear}`, `${currentYear}-01-01`, `${currentYear}-12-31`).run();

    for (const [code, name] of VOUCHER_TYPES) {
      await db.prepare(`
        INSERT OR IGNORE INTO voucher_types (tenant_id, code, name, allow_verification, is_active)
        VALUES (?, ?, ?, 1, 1)
      `).bind(tenant, code, name).run();
    }

    for (const account of DEFAULT_ACCOUNTS) {
      await insertAccount(db, tenant, account);
    }

    for (const [mappingKey, accountCode] of Object.entries(DEFAULT_MAPPINGS)) {
      const accountId = await resolveAccountId(db, tenant, accountCode);
      await db.prepare(`
        INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
        account_id = excluded.account_id,
        is_active = 1,
        updated_at = datetime('now', '+6 hours')
    `).bind(tenant, mappingKey, accountId).run();
    }
  } catch (err) {
    // Don't block provisioning on accounting-seed failure; just log it.
    console.error('seedAccountingDefaults failed:', err);
  }

  try {
    await seedInventoryVendorDefaults(db, tenant);
  } catch (err) {
    // Keep hospital provisioning recoverable even if starter vendor defaults fail.
    console.error('seedInventoryVendorDefaults failed:', err);
  }
}
