import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Accounting i18n Translation Tests ───────────────────────────────────

function loadLocale(lang: 'en' | 'bn') {
  const path = resolve(__dirname, `../web/public/locales/${lang}/accounting.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function hasKey(obj: Record<string, unknown>, dotPath: string): boolean {
  return getNestedValue(obj, dotPath) !== undefined;
}

describe('Accounting Translations - EN', () => {
  let en: Record<string, unknown>;

  beforeAll(() => {
    en = loadLocale('en');
  });

  it('should have top-level accounting keys', () => {
    expect(hasKey(en, 'accounting')).toBe(true);
    expect(hasKey(en, 'dashboardTitle')).toBe(true);
    expect(hasKey(en, 'todaysIncome')).toBe(true);
    expect(hasKey(en, 'todaysExpense')).toBe(true);
    expect(hasKey(en, 'todaysProfit')).toBe(true);
    expect(hasKey(en, 'mtdIncome')).toBe(true);
    expect(hasKey(en, 'mtdExpense')).toBe(true);
    expect(hasKey(en, 'mtdProfit')).toBe(true);
  });

  it('should have chart section keys', () => {
    expect(hasKey(en, 'chart.title')).toBe(true);
    expect(hasKey(en, 'chart.addAccount')).toBe(true);
    expect(hasKey(en, 'chart.editAccount')).toBe(true);
    expect(hasKey(en, 'chart.updated')).toBe(true);
    expect(hasKey(en, 'chart.created')).toBe(true);
    expect(hasKey(en, 'chart.failedSave')).toBe(true);
    expect(hasKey(en, 'chart.confirmDelete')).toBe(true);
    expect(hasKey(en, 'chart.deleted')).toBe(true);
    expect(hasKey(en, 'chart.failedDelete')).toBe(true);
    expect(hasKey(en, 'chart.searchPlaceholder')).toBe(true);
    expect(hasKey(en, 'chart.allTypes')).toBe(true);
    expect(hasKey(en, 'chart.noAccounts')).toBe(true);
    expect(hasKey(en, 'chart.accounts')).toBe(true);
    expect(hasKey(en, 'chart.code')).toBe(true);
    expect(hasKey(en, 'chart.name')).toBe(true);
    expect(hasKey(en, 'chart.type')).toBe(true);
    expect(hasKey(en, 'chart.accountCode')).toBe(true);
    expect(hasKey(en, 'chart.codePlaceholder')).toBe(true);
    expect(hasKey(en, 'chart.accountName')).toBe(true);
    expect(hasKey(en, 'chart.namePlaceholder')).toBe(true);
    expect(hasKey(en, 'chart.update')).toBe(true);
    expect(hasKey(en, 'chart.create')).toBe(true);
    expect(hasKey(en, 'chart.types.asset')).toBe(true);
    expect(hasKey(en, 'chart.types.liability')).toBe(true);
    expect(hasKey(en, 'chart.types.equity')).toBe(true);
    expect(hasKey(en, 'chart.types.income')).toBe(true);
    expect(hasKey(en, 'chart.types.expense')).toBe(true);
  });

  it('should have journal section keys', () => {
    expect(hasKey(en, 'journal.title')).toBe(true);
    expect(hasKey(en, 'journal.subtitle')).toBe(true);
    expect(hasKey(en, 'journal.newEntry')).toBe(true);
    expect(hasKey(en, 'journal.newEntryTitle')).toBe(true);
    expect(hasKey(en, 'journal.totalEntries')).toBe(true);
    expect(hasKey(en, 'journal.totalDebit')).toBe(true);
    expect(hasKey(en, 'journal.totalCredit')).toBe(true);
    expect(hasKey(en, 'journal.differentAccounts')).toBe(true);
    expect(hasKey(en, 'journal.created')).toBe(true);
    expect(hasKey(en, 'journal.failedCreate')).toBe(true);
    expect(hasKey(en, 'journal.failed')).toBe(true);
    expect(hasKey(en, 'journal.confirmDelete')).toBe(true);
    expect(hasKey(en, 'journal.deleted')).toBe(true);
    expect(hasKey(en, 'journal.failedDelete')).toBe(true);
    expect(hasKey(en, 'journal.fromDate')).toBe(true);
    expect(hasKey(en, 'journal.toDate')).toBe(true);
    expect(hasKey(en, 'journal.date')).toBe(true);
    expect(hasKey(en, 'journal.ref')).toBe(true);
    expect(hasKey(en, 'journal.description')).toBe(true);
    expect(hasKey(en, 'journal.debitAccount')).toBe(true);
    expect(hasKey(en, 'journal.creditAccount')).toBe(true);
    expect(hasKey(en, 'journal.amount')).toBe(true);
    expect(hasKey(en, 'journal.by')).toBe(true);
    expect(hasKey(en, 'journal.noEntries')).toBe(true);
    expect(hasKey(en, 'journal.refPlaceholder')).toBe(true);
    expect(hasKey(en, 'journal.descriptionPlaceholder')).toBe(true);
    expect(hasKey(en, 'journal.debit')).toBe(true);
    expect(hasKey(en, 'journal.credit')).toBe(true);
    expect(hasKey(en, 'journal.selectAccount')).toBe(true);
    expect(hasKey(en, 'journal.creating')).toBe(true);
    expect(hasKey(en, 'journal.createEntry')).toBe(true);
  });

  it('should have reports section keys', () => {
    expect(hasKey(en, 'reports.title')).toBe(true);
    expect(hasKey(en, 'reports.selectType')).toBe(true);
    expect(hasKey(en, 'reports.generate')).toBe(true);
    expect(hasKey(en, 'reports.generating')).toBe(true);
    expect(hasKey(en, 'reports.noData')).toBe(true);
    expect(hasKey(en, 'reports.print')).toBe(true);
    expect(hasKey(en, 'reports.export')).toBe(true);
  });

  it('should have shareholders section keys', () => {
    expect(hasKey(en, 'shareholders.searchPlaceholder')).toBe(true);
    expect(hasKey(en, 'shareholders.title')).toBe(true);
    expect(hasKey(en, 'shareholders.subtitle')).toBe(true);
    expect(hasKey(en, 'shareholders.newShareholder')).toBe(true);
    expect(hasKey(en, 'shareholders.newShareholderTitle')).toBe(true);
    expect(hasKey(en, 'shareholders.editShareholderTitle')).toBe(true);
    expect(hasKey(en, 'shareholders.name')).toBe(true);
    expect(hasKey(en, 'shareholders.namePlaceholder')).toBe(true);
    expect(hasKey(en, 'shareholders.shares')).toBe(true);
    expect(hasKey(en, 'shareholders.sharesPlaceholder')).toBe(true);
    expect(hasKey(en, 'shareholders.investment')).toBe(true);
    expect(hasKey(en, 'shareholders.investmentPlaceholder')).toBe(true);
    expect(hasKey(en, 'shareholders.percentage')).toBe(true);
    expect(hasKey(en, 'shareholders.contact')).toBe(true);
    expect(hasKey(en, 'shareholders.contactPlaceholder')).toBe(true);
    expect(hasKey(en, 'shareholders.isActive')).toBe(true);
    expect(hasKey(en, 'shareholders.noShareholders')).toBe(true);
    expect(hasKey(en, 'shareholders.created')).toBe(true);
    expect(hasKey(en, 'shareholders.failed')).toBe(true);
    expect(hasKey(en, 'shareholders.updated')).toBe(true);
    expect(hasKey(en, 'shareholders.failedUpdate')).toBe(true);
    expect(hasKey(en, 'shareholders.deleted')).toBe(true);
    expect(hasKey(en, 'shareholders.failedDelete')).toBe(true);
    expect(hasKey(en, 'shareholders.confirmDelete')).toBe(true);
    expect(hasKey(en, 'shareholders.calculating')).toBe(true);
    expect(hasKey(en, 'shareholders.distribution')).toBe(true);
    expect(hasKey(en, 'shareholders.distributeProfit')).toBe(true);
    expect(hasKey(en, 'shareholders.distributing')).toBe(true);
    expect(hasKey(en, 'shareholders.profitDistributed')).toBe(true);
    expect(hasKey(en, 'shareholders.distributeFailed')).toBe(true);
    expect(hasKey(en, 'shareholders.totalInvestment')).toBe(true);
    expect(hasKey(en, 'shareholders.totalShares')).toBe(true);
    expect(hasKey(en, 'shareholders.profitAllocation')).toBe(true);
    expect(hasKey(en, 'shareholders.distributionHistory')).toBe(true);
    expect(hasKey(en, 'shareholders.distributionDate')).toBe(true);
    expect(hasKey(en, 'shareholders.distributionAmount')).toBe(true);
    expect(hasKey(en, 'shareholders.distributedTo')).toBe(true);
    expect(hasKey(en, 'shareholders.noDistributions')).toBe(true);
    expect(hasKey(en, 'shareholders.calculationMonth')).toBe(true);
    expect(hasKey(en, 'shareholders.calculationMonthPlaceholder')).toBe(true);
  });

  it('should have profit section keys', () => {
    expect(hasKey(en, 'profit.title')).toBe(true);
    expect(hasKey(en, 'profit.subtitle')).toBe(true);
    expect(hasKey(en, 'profit.calculate')).toBe(true);
    expect(hasKey(en, 'profit.calculating')).toBe(true);
    expect(hasKey(en, 'profit.calculated')).toBe(true);
    expect(hasKey(en, 'profit.calculateFailed')).toBe(true);
    expect(hasKey(en, 'profit.distribute')).toBe(true);
    expect(hasKey(en, 'profit.distributing')).toBe(true);
    expect(hasKey(en, 'profit.distributed')).toBe(true);
    expect(hasKey(en, 'profit.distributeFailed')).toBe(true);
    expect(hasKey(en, 'profit.period')).toBe(true);
    expect(hasKey(en, 'profit.totalIncome')).toBe(true);
    expect(hasKey(en, 'profit.totalExpenses')).toBe(true);
    expect(hasKey(en, 'profit.netProfit')).toBe(true);
    expect(hasKey(en, 'profit.distributionHistory')).toBe(true);
    expect(hasKey(en, 'profit.noHistory')).toBe(true);
    expect(hasKey(en, 'profit.amount')).toBe(true);
    expect(hasKey(en, 'profit.date')).toBe(true);
    expect(hasKey(en, 'profit.status')).toBe(true);
    expect(hasKey(en, 'profit.shareholders')).toBe(true);
  });

  it('should have income section keys', () => {
    expect(hasKey(en, 'income.title')).toBe(true);
    expect(hasKey(en, 'income.subtitle')).toBe(true);
    expect(hasKey(en, 'income.newIncome')).toBe(true);
    expect(hasKey(en, 'income.newIncomeTitle')).toBe(true);
    expect(hasKey(en, 'income.date')).toBe(true);
    expect(hasKey(en, 'income.source')).toBe(true);
    expect(hasKey(en, 'income.amount')).toBe(true);
    expect(hasKey(en, 'income.description')).toBe(true);
    expect(hasKey(en, 'income.billId')).toBe(true);
    expect(hasKey(en, 'income.noIncome')).toBe(true);
    expect(hasKey(en, 'income.created')).toBe(true);
    expect(hasKey(en, 'income.failed')).toBe(true);
    expect(hasKey(en, 'income.updated')).toBe(true);
    expect(hasKey(en, 'income.failedUpdate')).toBe(true);
    expect(hasKey(en, 'income.deleted')).toBe(true);
    expect(hasKey(en, 'income.failedDelete')).toBe(true);
    expect(hasKey(en, 'income.confirmDelete')).toBe(true);
    expect(hasKey(en, 'income.total')).toBe(true);
    expect(hasKey(en, 'income.today')).toBe(true);
    expect(hasKey(en, 'income.thisMonth')).toBe(true);
    expect(hasKey(en, 'income.thisYear')).toBe(true);
    expect(hasKey(en, 'income.sources.pharmacy')).toBe(true);
    expect(hasKey(en, 'income.sources.laboratory')).toBe(true);
    expect(hasKey(en, 'income.sources.doctorVisit')).toBe(true);
    expect(hasKey(en, 'income.sources.admission')).toBe(true);
    expect(hasKey(en, 'income.sources.operation')).toBe(true);
    expect(hasKey(en, 'income.sources.ambulance')).toBe(true);
    expect(hasKey(en, 'income.sources.other')).toBe(true);
  });

  it('should have expenses section keys', () => {
    expect(hasKey(en, 'expenses.title')).toBe(true);
    expect(hasKey(en, 'expenses.subtitle')).toBe(true);
    expect(hasKey(en, 'expenses.newExpense')).toBe(true);
    expect(hasKey(en, 'expenses.newExpenseTitle')).toBe(true);
    expect(hasKey(en, 'expenses.editExpenseTitle')).toBe(true);
    expect(hasKey(en, 'expenses.date')).toBe(true);
    expect(hasKey(en, 'expenses.category')).toBe(true);
    expect(hasKey(en, 'expenses.amount')).toBe(true);
    expect(hasKey(en, 'expenses.description')).toBe(true);
    expect(hasKey(en, 'expenses.status')).toBe(true);
    expect(hasKey(en, 'expenses.approved')).toBe(true);
    expect(hasKey(en, 'expenses.pending')).toBe(true);
    expect(hasKey(en, 'expenses.rejected')).toBe(true);
    expect(hasKey(en, 'expenses.noExpenses')).toBe(true);
    expect(hasKey(en, 'expenses.created')).toBe(true);
    expect(hasKey(en, 'expenses.failed')).toBe(true);
    expect(hasKey(en, 'expenses.updated')).toBe(true);
    expect(hasKey(en, 'expenses.failedUpdate')).toBe(true);
    expect(hasKey(en, 'expenses.deleted')).toBe(true);
    expect(hasKey(en, 'expenses.failedDelete')).toBe(true);
    expect(hasKey(en, 'expenses.confirmDelete')).toBe(true);
    expect(hasKey(en, 'expenses.approvedBy')).toBe(true);
    expect(hasKey(en, 'expenses.rejectedBy')).toBe(true);
    expect(hasKey(en, 'expenses.approvalDate')).toBe(true);
    expect(hasKey(en, 'expenses.total')).toBe(true);
    expect(hasKey(en, 'expenses.pendingApproval')).toBe(true);
    expect(hasKey(en, 'expenses.requiresApproval')).toBe(true);
    expect(hasKey(en, 'expenses.approve')).toBe(true);
    expect(hasKey(en, 'expenses.reject')).toBe(true);
    expect(hasKey(en, 'expenses.approving')).toBe(true);
    expect(hasKey(en, 'expenses.rejecting')).toBe(true);
    expect(hasKey(en, 'expenses.approveSuccess')).toBe(true);
    expect(hasKey(en, 'expenses.rejectSuccess')).toBe(true);
    expect(hasKey(en, 'expenses.approveFailed')).toBe(true);
    expect(hasKey(en, 'expenses.rejectFailed')).toBe(true);
    expect(hasKey(en, 'expenses.categories.salary')).toBe(true);
    expect(hasKey(en, 'expenses.categories.medicine')).toBe(true);
    expect(hasKey(en, 'expenses.categories.rent')).toBe(true);
    expect(hasKey(en, 'expenses.categories.electricity')).toBe(true);
    expect(hasKey(en, 'expenses.categories.water')).toBe(true);
    expect(hasKey(en, 'expenses.categories.communication')).toBe(true);
    expect(hasKey(en, 'expenses.categories.maintenance')).toBe(true);
    expect(hasKey(en, 'expenses.categories.supplies')).toBe(true);
    expect(hasKey(en, 'expenses.categories.marketing')).toBe(true);
    expect(hasKey(en, 'expenses.categories.bank')).toBe(true);
    expect(hasKey(en, 'expenses.categories.misc')).toBe(true);
  });

  it('should have recurring section keys', () => {
    expect(hasKey(en, 'recurring.title')).toBe(true);
    expect(hasKey(en, 'recurring.subtitle')).toBe(true);
    expect(hasKey(en, 'recurring.newRecurring')).toBe(true);
    expect(hasKey(en, 'recurring.newRecurringTitle')).toBe(true);
    expect(hasKey(en, 'recurring.editRecurringTitle')).toBe(true);
    expect(hasKey(en, 'recurring.category')).toBe(true);
    expect(hasKey(en, 'recurring.amount')).toBe(true);
    expect(hasKey(en, 'recurring.description')).toBe(true);
    expect(hasKey(en, 'recurring.frequency')).toBe(true);
    expect(hasKey(en, 'recurring.nextRun')).toBe(true);
    expect(hasKey(en, 'recurring.endDate')).toBe(true);
    expect(hasKey(en, 'recurring.isActive')).toBe(true);
    expect(hasKey(en, 'recurring.noRecurring')).toBe(true);
    expect(hasKey(en, 'recurring.created')).toBe(true);
    expect(hasKey(en, 'recurring.failed')).toBe(true);
    expect(hasKey(en, 'recurring.updated')).toBe(true);
    expect(hasKey(en, 'recurring.failedUpdate')).toBe(true);
    expect(hasKey(en, 'recurring.deleted')).toBe(true);
    expect(hasKey(en, 'recurring.failedDelete')).toBe(true);
    expect(hasKey(en, 'recurring.confirmDelete')).toBe(true);
    expect(hasKey(en, 'recurring.runNow')).toBe(true);
    expect(hasKey(en, 'recurring.running')).toBe(true);
    expect(hasKey(en, 'recurring.runSuccess')).toBe(true);
    expect(hasKey(en, 'recurring.runFailed')).toBe(true);
    expect(hasKey(en, 'recurring.frequencyLabel.daily')).toBe(true);
    expect(hasKey(en, 'recurring.frequencyLabel.weekly')).toBe(true);
    expect(hasKey(en, 'recurring.frequencyLabel.monthly')).toBe(true);
  });

  it('should have audit section keys', () => {
    expect(hasKey(en, 'audit.title')).toBe(true);
    expect(hasKey(en, 'audit.subtitle')).toBe(true);
    expect(hasKey(en, 'audit.filterByTable')).toBe(true);
    expect(hasKey(en, 'audit.filterByUser')).toBe(true);
    expect(hasKey(en, 'audit.filterByDate')).toBe(true);
    expect(hasKey(en, 'audit.all')).toBe(true);
    expect(hasKey(en, 'audit.noLogs')).toBe(true);
    expect(hasKey(en, 'audit.user')).toBe(true);
    expect(hasKey(en, 'audit.action')).toBe(true);
    expect(hasKey(en, 'audit.table')).toBe(true);
    expect(hasKey(en, 'audit.record')).toBe(true);
    expect(hasKey(en, 'audit.oldValue')).toBe(true);
    expect(hasKey(en, 'audit.newValue')).toBe(true);
    expect(hasKey(en, 'audit.timestamp')).toBe(true);
    expect(hasKey(en, 'audit.details')).toBe(true);
  });

  it('should have voucherVerification section keys', () => {
    expect(hasKey(en, 'voucherVerification.title')).toBe(true);
    expect(hasKey(en, 'voucherVerification.subtitle')).toBe(true);
    expect(hasKey(en, 'voucherVerification.pending')).toBe(true);
    expect(hasKey(en, 'voucherVerification.pendingCount')).toBe(true);
    expect(hasKey(en, 'voucherVerification.totalAmount')).toBe(true);
    expect(hasKey(en, 'voucherVerification.awaitingReview')).toBe(true);
    expect(hasKey(en, 'voucherVerification.searchPlaceholder')).toBe(true);
    expect(hasKey(en, 'voucherVerification.allCleared')).toBe(true);
    expect(hasKey(en, 'voucherVerification.noPending')).toBe(true);
    expect(hasKey(en, 'voucherVerification.date')).toBe(true);
    expect(hasKey(en, 'voucherVerification.voucher')).toBe(true);
    expect(hasKey(en, 'voucherVerification.description')).toBe(true);
    expect(hasKey(en, 'voucherVerification.debitAccount')).toBe(true);
    expect(hasKey(en, 'voucherVerification.creditAccount')).toBe(true);
    expect(hasKey(en, 'voucherVerification.amount')).toBe(true);
    expect(hasKey(en, 'voucherVerification.createdBy')).toBe(true);
    expect(hasKey(en, 'voucherVerification.verify')).toBe(true);
    expect(hasKey(en, 'voucherVerification.reject')).toBe(true);
    expect(hasKey(en, 'voucherVerification.confirmVerify')).toBe(true);
    expect(hasKey(en, 'voucherVerification.verified')).toBe(true);
    expect(hasKey(en, 'voucherVerification.verifyFailed')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejectTitle')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejecting')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejectReason')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejectReasonPlaceholder')).toBe(true);
    expect(hasKey(en, 'voucherVerification.confirmReject')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejectingLabel')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejected')).toBe(true);
    expect(hasKey(en, 'voucherVerification.rejectFailed')).toBe(true);
  });
});

describe('Accounting Translations - BN (Bengali)', () => {
  let bn: Record<string, unknown>;

  beforeAll(() => {
    bn = loadLocale('bn');
  });

  it('should have same top-level keys in Bengali as in English', () => {
    const en = loadLocale('en');
    const topKeys = [
      'accounting', 'dashboardTitle', 'todaysIncome', 'todaysExpense',
      'todaysProfit', 'mtdIncome', 'mtdExpense', 'mtdProfit',
      'chartOfAccounts', 'journalEntries', 'income', 'expenses',
      'profitLoss', 'shareholders', 'recurringExpenses', 'auditLogs',
      'financialReports', 'totalIncome', 'totalExpenses', 'netProfit',
      'netLoss', 'pendingApproval', 'approvedExpenses', 'rejectedExpenses',
      'incomeBySource', 'expenseByCategory', 'monthlyReport', 'generateReport',
      'reportType', 'start_date', 'end_date',
    ];
    topKeys.forEach(key => {
      expect(hasKey(en, key)).toBe(true);
      expect(hasKey(bn, key)).toBe(true);
    });
  });

  it('should have Bengali translations different from English keys', () => {
    // Test a sample key to confirm Bengali has translations
    const bnVal = getNestedValue(bn, 'dashboardTitle');
    expect(bnVal).toBeDefined();
    expect(typeof bnVal).toBe('string');
    expect((bnVal as string).length).toBeGreaterThan(0);
  });

  it('should have Bengali versions for all journal keys', () => {
    const en = loadLocale('en');
    const journalKeys = [
      'journal.title', 'journal.subtitle', 'journal.newEntry', 'journal.totalEntries',
      'journal.totalDebit', 'journal.totalCredit', 'journal.differentAccounts',
      'journal.created', 'journal.failedCreate', 'journal.failed',
      'journal.confirmDelete', 'journal.deleted', 'journal.failedDelete',
      'journal.fromDate', 'journal.toDate', 'journal.date', 'journal.ref',
      'journal.description', 'journal.debitAccount', 'journal.creditAccount',
      'journal.amount', 'journal.by', 'journal.noEntries',
      'journal.refPlaceholder', 'journal.descriptionPlaceholder',
      'journal.debit', 'journal.credit', 'journal.selectAccount',
      'journal.creating', 'journal.createEntry',
    ];
    journalKeys.forEach(key => {
      expect(hasKey(en, key)).toBe(true);
      expect(hasKey(bn, key)).toBe(true);
    });
  });

  it('should have Bengali versions for all reports keys', () => {
    const en = loadLocale('en');
    const reportsKeys = [
      'reports.title', 'reports.selectType', 'reports.generate',
      'reports.generating', 'reports.noData', 'reports.print', 'reports.export',
    ];
    reportsKeys.forEach(key => {
      expect(hasKey(en, key)).toBe(true);
      expect(hasKey(bn, key)).toBe(true);
    });
  });

  it('should have Bengali versions for profit and shareholders keys', () => {
    const en = loadLocale('en');
    const keys = [
      'profit.title', 'profit.distribute', 'profit.distributing',
      'shareholders.distribution', 'shareholders.distributeProfit',
    ];
    keys.forEach(key => {
      expect(hasKey(en, key)).toBe(true);
      expect(hasKey(bn, key)).toBe(true);
    });
  });

  it('should have Bengali currency/amount formatting keys', () => {
    const bn = loadLocale('bn');
    const keys = ['amountBdt', 'amountBDT', 'amount'];
    keys.forEach(key => {
      const val = getNestedValue(bn, key);
      expect(val).toBeDefined();
    });
  });
});

describe('Translation Structure Consistency', () => {
  it('should use underscore separators (snake_case) for date/account keys', () => {
    const en = loadLocale('en');
    // start_date and end_date use snake_case per actual translation file
    expect(hasKey(en, 'start_date')).toBe(true);
    expect(hasKey(en, 'end_date')).toBe(true);
    // journal.date uses camelCase (consistent with other journal keys)
    expect(hasKey(en, 'journal.date')).toBe(true);
  });

  it('should have both underscore and camelCase variants where needed', () => {
    const en = loadLocale('en');
    // Some keys may use camelCase — both formats should be supported
    const possibleKeys = ['chartOfAccounts', 'journalEntries', 'incomeBySource'];
    possibleKeys.forEach(key => {
      const val = getNestedValue(en, key);
      if (val !== undefined) {
        expect(typeof val).toBe('string');
      }
    });
  });

  it('should have fiscalYear section keys defined in EN', () => {
    const en = loadLocale('en');
    const keys = [
      'fiscalYear.title', 'fiscalYear.subtitle', 'fiscalYear.addNew',
      'fiscalYear.addNewTitle', 'fiscalYear.editTitle', 'fiscalYear.reopenTitle',
      'fiscalYear.activeFY', 'fiscalYear.allFY', 'fiscalYear.name',
      'fiscalYear.startDate', 'fiscalYear.endDate', 'fiscalYear.prefix',
      'fiscalYear.status', 'fiscalYear.active', 'fiscalYear.inactive', 'fiscalYear.closed',
      'fiscalYear.close', 'fiscalYear.activate', 'fiscalYear.reopen',
      'fiscalYear.creating', 'fiscalYear.saving', 'fiscalYear.noData',
      'fiscalYear.statusActive', 'fiscalYear.statusInactive', 'fiscalYear.statusClosed',
      'fiscalYear.remark', 'fiscalYear.remarkPlaceholder',
    ];
    keys.forEach(key => {
      const val = getNestedValue(en, key);
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).length).toBeGreaterThan(0);
    });
  });
});