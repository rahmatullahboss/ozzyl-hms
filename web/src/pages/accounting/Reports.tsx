import { useState } from 'react';
import { FileText, Printer, RefreshCw, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';

const fmt = (n: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat('en-BD').format(n);

type ReportType =
  | 'pl' | 'income' | 'expense' | 'monthly'
  | 'balance-sheet' | 'ledger' | 'trial-balance' | 'cash-flow'
  | 'day-book' | 'cash-book' | 'bank-reconciliation' | 'group-statement';

interface LedgerOption { id: number; code: string; name: string; }

export default function Reports({ role = 'md' }: { role?: string }) {
  const today = new Date().toISOString().split('T')[0];
  const [reportType, setReportType] = useState<ReportType>('pl');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [ledgerId, setLedgerId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [ledgers, setLedgers] = useState<LedgerOption[]>([]);
  const { t } = useTranslation(['accounting', 'common', 'tenantBilling']);

  // Load ledgers when ledger report is selected
  const loadLedgers = async () => {
    if (ledgers.length > 0) return;
    try {
      const res = await api.get<{ accounts: LedgerOption[] }>('/api/accounts');
      setLedgers(res?.accounts?.map((a: any) => ({ id: a.id, code: a.code, name: a.name })) ?? []);
    } catch { /* silently fail */ }
  };

  const handleReportTypeChange = (type: ReportType) => {
    setReportType(type);
    setData(null);
    if (type === 'ledger') loadLedgers();
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      let res: any = null;
      switch (reportType) {
        case 'pl':
          res = await api.get<Record<string, unknown>>(`/api/reports/pl?startDate=${startDate}&endDate=${endDate}`);
          break;
        case 'income':
          res = await api.get<Record<string, unknown>>(`/api/reports/income-by-source?startDate=${startDate}&endDate=${endDate}`);
          break;
        case 'expense':
          res = await api.get<Record<string, unknown>>(`/api/reports/expense-by-category?startDate=${startDate}&endDate=${endDate}`);
          break;
        case 'monthly':
          res = await api.get<Record<string, unknown>>(`/api/reports/monthly?year=${new Date().getFullYear()}`);
          break;
        case 'balance-sheet':
          res = fiscalYearId
            ? await api.get<Record<string, unknown>>(`/api/reports/balance-sheet?fiscalYearId=${fiscalYearId}`)
            : await api.get<Record<string, unknown>>(`/api/reports/balance-sheet`);
          break;
        case 'ledger':
          if (!ledgerId) { toast.error(t('accounting.selectLedger')); setLoading(false); return; }
          res = await api.get<Record<string, unknown>>(
            `/api/reports/ledger?ledgerId=${ledgerId}&startDate=${startDate}&endDate=${endDate}`
          );
          break;
        case 'trial-balance':
          res = fiscalYearId
            ? await api.get<Record<string, unknown>>(`/api/reports/trial-balance?fiscalYearId=${fiscalYearId}`)
            : await api.get<Record<string, unknown>>(`/api/reports/trial-balance`);
          break;
        case 'cash-flow':
          res = fiscalYearId
            ? await api.get<Record<string, unknown>>(`/api/reports/cash-flow?fiscalYearId=${fiscalYearId}`)
            : await api.get<Record<string, unknown>>(`/api/reports/cash-flow`);
          break;
        case 'day-book':
          res = await api.get<Record<string, unknown>>(`/api/reports/day-book?startDate=${startDate}&endDate=${endDate}`);
          break;
        case 'cash-book':
          res = await api.get<Record<string, unknown>>(`/api/reports/cash-book?startDate=${startDate}&endDate=${endDate}`);
          break;
        case 'bank-reconciliation':
          if (!bankAccountId) { toast.error(t('accounting.selectBankAccount')); setLoading(false); return; }
          res = fiscalYearId
            ? await api.get<Record<string, unknown>>(`/api/reports/bank-reconciliation?fiscalYearId=${fiscalYearId}&bankAccountId=${bankAccountId}`)
            : await api.get<Record<string, unknown>>(`/api/reports/bank-reconciliation?bankAccountId=${bankAccountId}`);
          break;
        case 'group-statement':
          if (!ledgerId) { toast.error(t('accounting.selectLedgerGroup')); setLoading(false); return; }
          res = fiscalYearId
            ? await api.get<Record<string, unknown>>(`/api/reports/group-statement?ledgerGroupId=${ledgerId}&fiscalYearId=${fiscalYearId}`)
            : await api.get<Record<string, unknown>>(`/api/reports/group-statement?ledgerGroupId=${ledgerId}`);
          break;
      }
      setData(res ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? t('accounting.reportGenerationError'));
    } finally {
      setLoading(false);
    }
  };

  const needsDateRange = !['balance-sheet', 'trial-balance', 'cash-flow'].includes(reportType) && !['monthly'].includes(reportType);
  const needsFiscalYear = ['balance-sheet', 'trial-balance', 'cash-flow', 'bank-reconciliation', 'group-statement'].includes(reportType);
  const needsLedger = ['ledger', 'group-statement'].includes(reportType);
  const needsBankAccount = reportType === 'bank-reconciliation';

  const reportOptions: { value: ReportType; label: string }[] = [
    { value: 'pl', label: t('accounting.profitLoss', 'Profit & Loss') },
    { value: 'income', label: t('accounting.incomeBySource', 'Income by Source') },
    { value: 'expense', label: t('accounting.expenseByCategory', 'Expense by Category') },
    { value: 'monthly', label: t('accounting.monthlySummary', 'Monthly Summary') },
    { value: 'balance-sheet', label: t('accounting.balanceSheet', 'Balance Sheet') },
    { value: 'ledger', label: t('accounting.ledgerReport', 'Ledger Report') },
    { value: 'trial-balance', label: t('accounting.trialBalance', 'Trial Balance') },
    { value: 'cash-flow', label: t('accounting.cashFlow', 'Cash Flow Statement') },
    { value: 'day-book', label: t('accounting.dayBook', 'Day Book') },
    { value: 'cash-book', label: t('accounting.cashBook', 'Cash Book') },
    { value: 'bank-reconciliation', label: t('accounting.bankReconciliation', 'Bank Reconciliation') },
    { value: 'group-statement', label: t('accounting.groupStatement', 'Group Statement') },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <h1 className="page-title">
            <FileText className="inline w-6 h-6 mr-2 mb-0.5 text-[var(--color-primary)]" />
            {t('accounting.financialReports', 'Financial Reports')}
          </h1>
          <button onClick={() => window.print()} className="btn-secondary">
            <Printer className="w-4 h-4" /> {t('print', { ns: 'common', defaultValue: 'Print' })}
          </button>
        </div>

        {/* Filters */}
        <div className="card p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {/* Report Type */}
            <div>
              <label className="label">{t('accounting.report_type', 'Report Type')}</label>
              <select
                className="input"
                value={reportType}
                onChange={e => handleReportTypeChange(e.target.value as ReportType)}
              >
                {reportOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Ledger selector (conditional) */}
            {needsLedger && (
              <div>
                <label className="label">
                  {reportType === 'group-statement'
                    ? t('accounting.ledgerGroup', 'Ledger Group')
                    : t('accounting.selectLedger', 'Select Ledger')}
                </label>
                <select className="input" value={ledgerId} onChange={e => setLedgerId(e.target.value)}>
                  <option value="">{t('accounting.selectOption', 'Select...')}</option>
                  {ledgers.map(l => (
                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Bank Account selector (conditional) */}
            {needsBankAccount && (
              <div>
                <label className="label">{t('accounting.bankAccount', 'Bank Account')}</label>
                <select className="input" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                  <option value="">{t('accounting.selectOption', 'Select...')}</option>
                  {ledgers.filter(l => l.code.startsWith('1100') || l.code.startsWith('1200')).map(l => (
                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Fiscal Year ID (conditional) */}
            {needsFiscalYear && (
              <div>
                <label className="label">{t('accounting.fiscalYear', 'Fiscal Year')}</label>
                <input
                  type="number"
                  className="input"
                  placeholder={t('accounting.fiscalYearId', 'Fiscal Year ID')}
                  value={fiscalYearId}
                  onChange={e => setFiscalYearId(e.target.value)}
                />
              </div>
            )}

            {/* Start Date */}
            {needsDateRange && (
              <div>
                <label className="label">{t('accounting.start_date', 'Start Date')}</label>
                <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
            )}

            {/* End Date */}
            {needsDateRange && (
              <div>
                <label className="label">{t('accounting.end_date', 'End Date')}</label>
                <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            )}

            {/* Generate button */}
            <div>
              <button
                onClick={generateReport}
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                {loading ? t('accounting.generating', 'Generating...') : t('accounting.generateReport', 'Generate Report')}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {data && (
          <div className="card p-6 print:shadow-none space-y-6">
            {/* Profit & Loss */}
            {reportType === 'pl' && (() => {
              const d = data as {
                income: { items: { source: string; total: number }[]; total: number };
                expenses: { items: { category: string; total: number }[]; total: number };
                netProfit: number;
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.profitLossStatement', 'Profit & Loss Statement')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{startDate} — {endDate}</p>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">{t('accounting.income', 'Income')}</h3>
                      <table className="table-base">
                        <tbody>
                          {d.income.items.map((item, i) => (
                            <tr key={i}>
                              <td className="capitalize">{item.source}</td>
                              <td className="text-right font-data">{fmt(item.total)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold">
                            <td>{t('accounting.totalIncome', 'Total Income')}</td>
                            <td className="text-right text-emerald-600 font-data">{fmt(d.income.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">{t('accounting.expenses', 'Expenses')}</h3>
                      <table className="table-base">
                        <tbody>
                          {d.expenses.items.map((item, i) => (
                            <tr key={i}>
                              <td className="capitalize">{item.category}</td>
                              <td className="text-right font-data">{fmt(item.total)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold">
                            <td>{t('accounting.totalExpenses', 'Total Expenses')}</td>
                            <td className="text-right text-red-600 font-data">{fmt(d.expenses.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="border-t-2 border-[var(--color-border)] pt-4 mt-4">
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span>{t('accounting.netProfit', 'Net Profit')}</span>
                      <span className={`font-data ${d.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(d.netProfit)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Income by Source */}
            {reportType === 'income' && (() => {
              const d = data as { breakdown: { source: string; amount: number; percentage: string }[]; total: number };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.incomeBySource', 'Income by Source')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{startDate} — {endDate}</p>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.source', 'Source')}</th>
                        <th className="text-right">{t('accounting.amount', 'Amount')}</th>
                        <th className="text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.breakdown.map((item, i) => (
                        <tr key={i}>
                          <td className="capitalize">{item.source}</td>
                          <td className="text-right font-data">{fmt(item.amount)}</td>
                          <td className="text-right font-data">{item.percentage}%</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>{t('accounting.total', 'Total')}</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.total)}</td>
                        <td className="text-right font-data">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Expense by Category */}
            {reportType === 'expense' && (() => {
              const d = data as { breakdown: { category: string; amount: number; percentage: string }[]; total: number };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.expenseByCategory', 'Expense by Category')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{startDate} — {endDate}</p>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.category', 'Category')}</th>
                        <th className="text-right">{t('accounting.amount', 'Amount')}</th>
                        <th className="text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.breakdown.map((item, i) => (
                        <tr key={i}>
                          <td>{item.category}</td>
                          <td className="text-right font-data">{fmt(item.amount)}</td>
                          <td className="text-right font-data">{item.percentage}%</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>{t('accounting.total', 'Total')}</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.total)}</td>
                        <td className="text-right font-data">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Monthly Summary */}
            {reportType === 'monthly' && (() => {
              const d = data as {
                year: number;
                monthly: { month: string; income: number; expense: number; profit: number }[];
                summary: { totalIncome: number; totalExpense: number; netProfit: number };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.monthlySummaryReport', 'Monthly Summary')} — {d.year}</h2>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.month', 'Month')}</th>
                        <th className="text-right">{t('accounting.income', 'Income')}</th>
                        <th className="text-right">{t('accounting.expenses', 'Expenses')}</th>
                        <th className="text-right">{t('accounting.profit', 'Profit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.monthly.map((item, i) => (
                        <tr key={i}>
                          <td className="capitalize">{item.month}</td>
                          <td className="text-right text-emerald-600 font-data">{fmt(item.income)}</td>
                          <td className="text-right text-red-600 font-data">{fmt(item.expense)}</td>
                          <td className={`text-right font-data font-medium ${item.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmt(item.profit)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>{t('accounting.total', 'Total')}</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.summary.totalIncome)}</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.summary.totalExpense)}</td>
                        <td className={`text-right font-data ${d.summary.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.summary.netProfit)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Balance Sheet */}
            {reportType === 'balance-sheet' && (() => {
              const d = data as {
                fiscalYear: string; asOfDate: string;
                assets: { items: { name: string; amount: number }[]; total: number };
                liabilities: { items: { name: string; amount: number }[]; total: number };
                equity: { items: { name: string; amount: number }[]; total: number };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.balanceSheet', 'Balance Sheet')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.fiscalYear} — {d.asOfDate}</p>
                  </div>
                  <div className="grid md:grid-cols-3 gap-6">
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">{t('accounting.assets', 'Assets')}</h3>
                      <table className="table-base">
                        <tbody>
                          {d.assets.items.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-right font-data">{fmt(item.amount)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold">
                            <td>{t('accounting.total', 'Total')}</td>
                            <td className="text-right font-data">{fmt(d.assets.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">{t('accounting.liabilities', 'Liabilities')}</h3>
                      <table className="table-base">
                        <tbody>
                          {d.liabilities.items.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-right font-data">{fmt(item.amount)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold">
                            <td>{t('accounting.total', 'Total')}</td>
                            <td className="text-right font-data">{fmt(d.liabilities.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">{t('accounting.equity', 'Equity')}</h3>
                      <table className="table-base">
                        <tbody>
                          {d.equity.items.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-right font-data">{fmt(item.amount)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold">
                            <td>{t('accounting.total', 'Total')}</td>
                            <td className="text-right font-data">{fmt(d.equity.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Ledger Report */}
            {reportType === 'ledger' && (() => {
              const d = data as {
                ledgerName: string; ledgerCode: string;
                startDate: string; endDate: string;
                opening: number;
                transactions: { date: string; voucherNumber: string; description: string; debit: number; credit: number; balance: number }[];
                closing: number;
                summary?: { totalDebit: number; totalCredit: number; transactionCount: number };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.ledgerReport', 'Ledger Report')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {d.ledgerCode} — {d.ledgerName} | {d.startDate} — {d.endDate}
                    </p>
                  </div>
                  <div className="mb-3 flex gap-4 text-sm">
                    <span>{t('accounting.openingBalance', 'Opening')}: <span className="font-data font-medium">{fmt(d.opening)}</span></span>
                    <span>{t('accounting.debit', 'Debit')}: <span className="font-data font-medium">{fmt(d.summary?.totalDebit ?? 0)}</span></span>
                    <span>{t('accounting.credit', 'Credit')}: <span className="font-data font-medium">{fmt(d.summary?.totalCredit ?? 0)}</span></span>
                    <span>{t('accounting.closingBalance', 'Closing')}: <span className="font-data font-medium">{fmt(d.closing)}</span></span>
                    <span>{t('common:entries', 'Entries')}: <span className="font-data font-medium">{fmtNum(d.summary?.transactionCount ?? d.transactions.length)}</span></span>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.date', 'Date')}</th>
                        <th>{t('accounting.voucher', 'Voucher')}</th>
                        <th>{t('accounting.description', 'Description')}</th>
                        <th className="text-right">{t('accounting.debit', 'Debit')}</th>
                        <th className="text-right">{t('accounting.credit', 'Credit')}</th>
                        <th className="text-right">{t('accounting.balance', 'Balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.transactions.map((t, i) => (
                        <tr key={i}>
                          <td className="font-data">{t.date}</td>
                          <td className="font-data text-[var(--color-text-muted)]">{t.voucherNumber}</td>
                          <td>{t.description}</td>
                          <td className="text-right font-data">{t.debit > 0 ? fmt(t.debit) : '—'}</td>
                          <td className="text-right font-data">{t.credit > 0 ? fmt(t.credit) : '—'}</td>
                          <td className={`text-right font-data font-medium ${t.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmt(t.balance)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td colSpan={3}>{t('accounting.closingBalance', 'Closing Balance')}</td>
                        <td></td><td></td>
                        <td className={`text-right font-data ${d.closing >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.closing)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Trial Balance */}
            {reportType === 'trial-balance' && (() => {
              const d = data as {
                fiscalYear: string; asOfDate: string;
                accounts: { code: string; name: string; type: string; debit: number; credit: number }[];
                totals: { totalDebit: number; totalCredit: number; difference?: number; isBalanced?: boolean };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.trialBalance', 'Trial Balance')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.fiscalYear} — {d.asOfDate}</p>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.accountCode', 'Code')}</th>
                        <th>{t('accounting.accountName', 'Account')}</th>
                        <th className="text-right">{t('accounting.debit', 'Debit')}</th>
                        <th className="text-right">{t('accounting.credit', 'Credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.accounts.map((a, i) => (
                        <tr key={i}>
                          <td className="font-data">{a.code}</td>
                          <td>{a.name}</td>
                          <td className="text-right font-data">{a.debit > 0 ? fmt(a.debit) : '—'}</td>
                          <td className="text-right font-data">{a.credit > 0 ? fmt(a.credit) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td colSpan={2}>{t('accounting.total', 'Total')}</td>
                        <td className="text-right font-data text-emerald-600">{fmt(d.totals.totalDebit)}</td>
                        <td className="text-right font-data text-emerald-600">{fmt(d.totals.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Cash Flow */}
            {reportType === 'cash-flow' && (() => {
              const d = data as {
                fiscalYear: string;
                openingBalance: number; closingBalance: number;
                operating: { inflows: number; outflows: number };
                investing: { inflows: number; outflows: number };
                financing: { inflows: number; outflows: number };
              };
              const netCash = d.operating.inflows - d.operating.outflows + d.investing.outflows + d.financing.inflows;
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.cashFlowStatement', 'Cash Flow Statement')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.fiscalYear}</p>
                  </div>
                  <table className="table-base max-w-lg mx-auto">
                    <tbody>
                      <tr className="font-bold border-b">
                        <td>{t('accounting.openingCash', 'Opening Cash')}</td>
                        <td className="text-right font-data">{fmt(d.openingBalance)}</td>
                      </tr>
                      <tr>
                        <td className="pl-4">{t('accounting.operatingInflows', 'Operating Inflows')}</td>
                        <td className="text-right font-data text-emerald-600">+{fmt(d.operating.inflows)}</td>
                      </tr>
                      <tr>
                        <td className="pl-4">{t('accounting.operatingOutflows', 'Operating Outflows')}</td>
                        <td className="text-right font-data text-red-600">-{fmt(d.operating.outflows)}</td>
                      </tr>
                      <tr>
                        <td className="pl-4">{t('accounting.netOperating', 'Net from Operations')}</td>
                        <td className={`text-right font-data font-medium ${d.operating.inflows - d.operating.outflows >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.operating.inflows - d.operating.outflows)}
                        </td>
                      </tr>
                      <tr>
                        <td className="pl-4">{t('accounting.investingOutflows', 'Investing (Outflows)')}</td>
                        <td className="text-right font-data text-red-600">-{fmt(d.investing.outflows)}</td>
                      </tr>
                      <tr>
                        <td className="pl-4">{t('accounting.financingInflows', 'Financing Inflows')}</td>
                        <td className="text-right font-data text-emerald-600">+{fmt(d.financing.inflows)}</td>
                      </tr>
                      <tr className="font-bold border-t-2">
                        <td>{t('accounting.closingCash', 'Closing Cash')}</td>
                        <td className={`text-right font-data ${d.closingBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.closingBalance)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Day Book */}
            {reportType === 'day-book' && (() => {
              const d = data as {
                date: string;
                vouchers: { voucherNumber: string; voucherType: string; description: string; debit: number; credit: number }[];
                totalDebit: number; totalCredit: number;
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.dayBook', 'Day Book')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.date}</p>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.voucher', 'Voucher')}</th>
                        <th>{t('accounting.type', 'Type')}</th>
                        <th>{t('accounting.description', 'Description')}</th>
                        <th className="text-right">{t('accounting.debit', 'Debit')}</th>
                        <th className="text-right">{t('accounting.credit', 'Credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.vouchers.map((v, i) => (
                        <tr key={i}>
                          <td className="font-data">{v.voucherNumber}</td>
                          <td>{v.voucherType}</td>
                          <td>{v.description}</td>
                          <td className="text-right font-data">{fmt(v.debit)}</td>
                          <td className="text-right font-data">{fmt(v.credit)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td colSpan={3}>{t('accounting.total', 'Total')}</td>
                        <td className="text-right font-data">{fmt(d.totalDebit)}</td>
                        <td className="text-right font-data">{fmt(d.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Cash Book */}
            {reportType === 'cash-book' && (() => {
              const d = data as {
                startDate: string; endDate: string;
                cash: {
                  opening: number; receipts: number; payments: number; closing: number;
                  transactions: { date: string; description: string; reference: string; receipt: number; payment: number; balance: number }[];
                };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.cashBook', 'Cash Book')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.startDate} — {d.endDate}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.opening', 'Opening')}</p>
                      <p className="font-data font-bold text-lg">{fmt(d.cash.opening)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.receipts', 'Receipts')}</p>
                      <p className="font-data font-bold text-lg text-emerald-600">{fmt(d.cash.receipts)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.payments', 'Payments')}</p>
                      <p className="font-data font-bold text-lg text-red-600">{fmt(d.cash.payments)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.closing', 'Closing')}</p>
                      <p className="font-data font-bold text-lg text-[var(--color-primary)]">{fmt(d.cash.closing)}</p>
                    </div>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.date', 'Date')}</th>
                        <th>{t('accounting.description', 'Description')}</th>
                        <th>{t('accounting.reference', 'Reference')}</th>
                        <th className="text-right">{t('accounting.receipt', 'Receipt')}</th>
                        <th className="text-right">{t('accounting.payment', 'Payment')}</th>
                        <th className="text-right">{t('accounting.balance', 'Balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.cash.transactions.map((t, i) => (
                        <tr key={i}>
                          <td className="font-data">{t.date}</td>
                          <td>{t.description}</td>
                          <td className="font-data text-[var(--color-text-muted)]">{t.reference}</td>
                          <td className="text-right font-data text-emerald-600">{t.receipt > 0 ? fmt(t.receipt) : '—'}</td>
                          <td className="text-right font-data text-red-600">{t.payment > 0 ? fmt(t.payment) : '—'}</td>
                          <td className="text-right font-data font-medium">{fmt(t.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Bank Reconciliation */}
            {reportType === 'bank-reconciliation' && (() => {
              const d = data as {
                fiscalYear: string; accountId: number; bookBalance: number;
                transactions: { date: string; voucher_number: string; description: string; deposits: number; withdrawals: number; balance: number }[];
                summary: { openingBalance: number; totalDeposits: number; totalWithdrawals: number; closingBalance: number };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.bankReconciliation', 'Bank Reconciliation')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.fiscalYear} | Account #{d.accountId}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.opening', 'Opening')}</p>
                      <p className="font-data font-bold text-lg">{fmt(d.summary.openingBalance)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.deposits', 'Deposits')}</p>
                      <p className="font-data font-bold text-lg text-emerald-600">{fmt(d.summary.totalDeposits)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.withdrawals', 'Withdrawals')}</p>
                      <p className="font-data font-bold text-lg text-red-600">{fmt(d.summary.totalWithdrawals)}</p>
                    </div>
                    <div className="card p-3 text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('accounting.closingBalance', 'Closing Balance')}</p>
                      <p className="font-data font-bold text-lg text-[var(--color-primary)]">{fmt(d.summary.closingBalance)}</p>
                    </div>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.date', 'Date')}</th>
                        <th>{t('accounting.voucher', 'Voucher')}</th>
                        <th>{t('accounting.description', 'Description')}</th>
                        <th className="text-right">{t('accounting.deposits', 'Deposits')}</th>
                        <th className="text-right">{t('accounting.withdrawals', 'Withdrawals')}</th>
                        <th className="text-right">{t('accounting.balance', 'Balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.transactions.map((t, i) => (
                        <tr key={i}>
                          <td className="font-data">{t.date}</td>
                          <td className="font-data text-[var(--color-text-muted)]">{t.voucher_number}</td>
                          <td>{t.description}</td>
                          <td className="text-right font-data text-emerald-600">{t.deposits > 0 ? fmt(t.deposits) : '—'}</td>
                          <td className="text-right font-data text-red-600">{t.withdrawals > 0 ? fmt(t.withdrawals) : '—'}</td>
                          <td className="text-right font-data font-medium">{fmt(t.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Group Statement */}
            {reportType === 'group-statement' && (() => {
              const d = data as {
                fiscalYear: string; groupId: number;
                accounts: { id: number; code: string; name: string; type: string; total_debit: number; total_credit: number; netBalance: number }[];
                totals: { totalDebit: number; totalCredit: number; totalNet: number };
              };
              return (
                <div>
                  <div className="text-center mb-4">
                    <h2 className="text-xl font-bold">{t('accounting.groupStatement', 'Group Statement')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{d.fiscalYear} | Group #{d.groupId}</p>
                  </div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('accounting.accountCode', 'Code')}</th>
                        <th>{t('accounting.accountName', 'Account')}</th>
                        <th>{t('accounting.type', 'Type')}</th>
                        <th className="text-right">{t('accounting.debit', 'Debit')}</th>
                        <th className="text-right">{t('accounting.credit', 'Credit')}</th>
                        <th className="text-right">{t('accounting.netBalance', 'Net Balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.accounts.map((a, i) => (
                        <tr key={i}>
                          <td className="font-data">{a.code}</td>
                          <td>{a.name}</td>
                          <td><span className="badge">{a.type}</span></td>
                          <td className="text-right font-data">{a.total_debit > 0 ? fmt(a.total_debit) : '—'}</td>
                          <td className="text-right font-data">{a.total_credit > 0 ? fmt(a.total_credit) : '—'}</td>
                          <td className={`text-right font-data font-medium ${a.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmt(a.netBalance)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td colSpan={3}>{t('accounting.total', 'Total')}</td>
                        <td className="text-right font-data">{fmt(d.totals.totalDebit)}</td>
                        <td className="text-right font-data">{fmt(d.totals.totalCredit)}</td>
                        <td className={`text-right font-data ${d.totals.totalNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.totals.totalNet)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            <p className="text-center text-xs text-[var(--color-text-muted)]">
              {t('accounting.generatedOn', 'Generated')}: {new Date().toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
