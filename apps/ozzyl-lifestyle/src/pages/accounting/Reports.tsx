import { useState, useEffect } from 'react';
import { FileText, Printer, RefreshCw } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

type ReportType =
  | 'pl' | 'income' | 'expense' | 'monthly'
  | 'balancesheet' | 'cashflow' | 'trailbalance'
  | 'daybook' | 'cashbook' | 'ledger'
  | 'bankrecon' | 'groupstatement';

interface FiscalYear {
  id: number;
  year: string;
  is_active: boolean;
}

const FISCAL_YEAR_KEY = 'hms_fiscal_year_id';
const DEMO_FISCAL_YEAR_ID = 1;

export default function Reports({ role = 'md' }: { role?: string }) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const [reportType, setReportType] = useState<ReportType>('pl');
  const [fiscalYearId, setFiscalYearId] = useState<number>(() => {
    const saved = localStorage.getItem(FISCAL_YEAR_KEY);
    return saved ? parseInt(saved) : DEMO_FISCAL_YEAR_ID;
  });
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([
    { id: 1, year: `${currentYear}-${currentYear + 1}`, is_active: true },
    { id: 2, year: `${currentYear - 1}-${currentYear}`, is_active: false },
    { id: 3, year: `${currentYear - 2}-${currentYear - 1}`, is_active: false },
  ]);
  const [startDate,  setStartDate]  = useState(today);
  const [endDate,    setEndDate]    = useState(today);
  const [ledgerId,   setLedgerId]   = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [ledgerGroupId, setLedgerGroupId] = useState('');
  const [bankStatementBalance, setBankStatementBalance] = useState<number>(0);
  const [data,       setData]       = useState<Record<string, unknown> | null>(null);
  const [loading,    setLoading]    = useState(false);
  const { t } = useTranslation(['accounting', 'common']);

  useEffect(() => {
    const saved = localStorage.getItem(FISCAL_YEAR_KEY);
    if (!saved) {
      localStorage.setItem(FISCAL_YEAR_KEY, String(DEMO_FISCAL_YEAR_ID));
    }
  }, []);

  const handleFiscalYearChange = (id: number) => {
    setFiscalYearId(id);
    localStorage.setItem(FISCAL_YEAR_KEY, String(id));
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const fyParams = `fiscalYearId=${fiscalYearId}`;
      let res;
      if      (reportType === 'pl')         res = await axios.get(`/api/reports/pl?startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'income')     res = await axios.get(`/api/reports/income-by-source?startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'expense')    res = await axios.get(`/api/reports/expense-by-category?startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'monthly')    res = await axios.get(`/api/reports/monthly?year=${currentYear}`, { headers });
      else if (reportType === 'balancesheet') res = await axios.get(`/api/reports/balance-sheet?fiscalYearId=${fiscalYearId}`, { headers });
      else if (reportType === 'cashflow')   res = await axios.get(`/api/reports/cash-flow?fiscalYearId=${fiscalYearId}`, { headers });
      else if (reportType === 'trailbalance') res = await axios.get(`/api/reports/trail-balance?fiscalYearId=${fiscalYearId}`, { headers });
      else if (reportType === 'daybook')    res = await axios.get(`/api/reports/day-book?startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'cashbook')   res = await axios.get(`/api/reports/cash-book?startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'ledger')     res = await axios.get(`/api/reports/ledger?ledgerId=${ledgerId}&startDate=${startDate}&endDate=${endDate}`, { headers });
      else if (reportType === 'bankrecon')    res = await axios.get(`/api/reports/bank-reconciliation?fiscalYearId=${fiscalYearId}&bankAccountId=${bankAccountId}`, { headers });
      else if (reportType === 'groupstatement') res = await axios.get(`/api/reports/group-statement?fiscalYearId=${fiscalYearId}&ledgerGroupId=${ledgerGroupId}`, { headers });
      setData(res?.data ?? null);
    } catch { toast.error(t('accounting.reportGenerationError')); }
    finally { setLoading(false); }
  };

  const isDateRangeNeeded = ['pl', 'income', 'expense', 'daybook', 'cashbook', 'ledger'].includes(reportType);
  const isLedgerNeeded = reportType === 'ledger';
  const isBankAccountNeeded = reportType === 'bankrecon';
  const isLedgerGroupNeeded = reportType === 'groupstatement';
  const isFiscalYearNeeded = !['pl', 'income', 'expense', 'daybook', 'cashbook', 'ledger', 'bankrecon', 'groupstatement'].includes(reportType);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title"><FileText className="inline w-6 h-6 mr-2 mb-0.5 text-[var(--color-primary)]" />Financial Reports</h1>
          <button onClick={() => window.print()} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>

{/* ── Controls ── */}
        <div className="card p-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="label">{t('accounting.report_type')}</label>
              <select value={reportType} onChange={e => setReportType(e.target.value as ReportType)} className="input">
                <option value="pl">Profit & Loss</option>
                <option value="income">Income by Source</option>
                <option value="expense">Expense by Category</option>
                <option value="monthly">Monthly Summary</option>
                <option value="balancesheet">Balance Sheet</option>
                <option value="cashflow">Cash Flow Statement</option>
                <option value="trailbalance">Trial Balance</option>
                <option value="daybook">Day Book</option>
                <option value="cashbook">Cash & Bank Book</option>
                <option value="ledger">Ledger Report</option>
                <option value="bankrecon">Bank Reconciliation</option>
                <option value="groupstatement">Group Statement</option>
              </select>
            </div>

            {/* Fiscal Year */}
            {isFiscalYearNeeded && (
              <div>
                <label className="label">Fiscal Year</label>
                <select
                  value={fiscalYearId}
                  onChange={e => handleFiscalYearChange(parseInt(e.target.value))}
                  className="input"
                >
                  {fiscalYears.map(fy => (
                    <option key={fy.id} value={fy.id}>
                      {fy.year} {fy.is_active ? '(Active)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Date Range */}
            {isDateRangeNeeded && (
              <>
                <div>
                  <label className="label">{t('accounting.start_date')}</label>
                  <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('accounting.end_date')}</label>
                  <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            {/* Ledger Selection */}
            {isLedgerNeeded && (
              <>
                <div>
                  <label className="label">Account</label>
                  <input type="text" className="input" placeholder="Ledger ID" value={ledgerId} onChange={e => setLedgerId(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('accounting.start_date')}</label>
                  <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('accounting.end_date')}</label>
                  <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            {/* Bank Account Selection for Bank Reconciliation */}
            {isBankAccountNeeded && (
              <>
                <div>
                  <label className="label">Bank Account ID</label>
                  <input type="text" className="input" placeholder="Bank Account ID" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} />
                </div>
                <div>
                  <label className="label">Bank Statement Balance (Manual Entry)</label>
                  <input type="number" className="input" placeholder="Enter bank statement balance" value={bankStatementBalance || ''} onChange={e => setBankStatementBalance(parseFloat(e.target.value) || 0)} />
                </div>
              </>
            )}

            {/* Ledger Group Selection for Group Statement */}
            {isLedgerGroupNeeded && (
              <>
                <div>
                  <label className="label">Ledger Group ID</label>
                  <input type="text" className="input" placeholder="Ledger Group ID" value={ledgerGroupId} onChange={e => setLedgerGroupId(e.target.value)} />
                </div>
              </>
            )}

            {!isDateRangeNeeded && !isFiscalYearNeeded && !isLedgerNeeded && (
              <div />
            )}

            <button onClick={generateReport} disabled={loading} className="btn-primary w-full">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Generating…' : 'Generate Report'}
            </button>
          </div>
        </div>

        {/* ── Report Output ── */}
        {data && (
          <div className="card p-6 print:shadow-none space-y-6">

            {/* P&L */}
            {reportType === 'pl' && (() => {
              const d = data as { income: { items: { source: string; total: number }[]; total: number }; expenses: { items: { category: string; total: number }[]; total: number }; netProfit: number };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Profit &amp; Loss Statement</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Period: {startDate} to {endDate}</p>
                  </div>
                  <div>
                    <h3 className="section-title mb-3 pb-2 border-b border-[var(--color-border)]">Income</h3>
                    <table className="table-base">
                      <tbody>
                        {d.income.items.map((item, i) => (
                          <tr key={i}><td className="capitalize">{item.source}</td><td className="text-right font-data">{fmt(item.total)}</td></tr>
                        ))}
                        <tr className="font-bold">
                          <td>Total Income</td>
                          <td className="text-right text-emerald-600 font-data">{fmt(d.income.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3 className="section-title mb-3 pb-2 border-b border-[var(--color-border)]">Expenses</h3>
                    <table className="table-base">
                      <tbody>
                        {d.expenses.items.map((item, i) => (
                          <tr key={i}><td className="capitalize">{item.category}</td><td className="text-right font-data">{fmt(item.total)}</td></tr>
                        ))}
                        <tr className="font-bold">
                          <td>Total Expenses</td>
                          <td className="text-right text-red-600 font-data">{fmt(d.expenses.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t-2 border-[var(--color-border)] pt-4">
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span>Net Profit</span>
                      <span className={`font-data ${d.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(d.netProfit)}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Income by Source */}
            {reportType === 'income' && (() => {
              const d = data as { breakdown: { source: string; amount: number; percentage: string }[]; total: number };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Income by Source</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Period: {startDate} to {endDate}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th>Source</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
                    <tbody>
                      {d.breakdown.map((item, i) => (
                        <tr key={i}>
                          <td className="capitalize">{item.source}</td>
                          <td className="text-right font-data">{fmt(item.amount)}</td>
                          <td className="text-right font-data">{item.percentage}%</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>Total</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.total)}</td>
                        <td className="text-right font-data">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            {/* Expense by Category */}
            {reportType === 'expense' && (() => {
              const d = data as { breakdown: { category: string; amount: number; percentage: string }[]; total: number };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Expense by Category</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Period: {startDate} to {endDate}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th>Category</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
                    <tbody>
                      {d.breakdown.map((item, i) => (
                        <tr key={i}>
                          <td>{item.category}</td>
                          <td className="text-right font-data">{fmt(item.amount)}</td>
                          <td className="text-right font-data">{item.percentage}%</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>Total</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.total)}</td>
                        <td className="text-right font-data">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            {/* Monthly Summary */}
            {reportType === 'monthly' && (() => {
              const d = data as { year: number; monthly: { month: string; income: number; expense: number; profit: number }[]; summary: { totalIncome: number; totalExpense: number; netProfit: number } };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Monthly Summary — {d.year}</h2>
                  </div>
                  <table className="table-base">
                    <thead><tr><th>Month</th><th className="text-right">Income</th><th className="text-right">Expense</th><th className="text-right">Profit</th></tr></thead>
                    <tbody>
                      {d.monthly.map((item, i) => (
                        <tr key={i}>
                          <td className="capitalize">{item.month}</td>
                          <td className="text-right text-emerald-600 font-data">{fmt(item.income)}</td>
                          <td className="text-right text-red-600 font-data">{fmt(item.expense)}</td>
                          <td className={`text-right font-data font-medium ${item.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(item.profit)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td>Total</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.summary.totalIncome)}</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.summary.totalExpense)}</td>
                        <td className={`text-right font-data ${d.summary.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(d.summary.netProfit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            {/* Balance Sheet */}
            {reportType === 'balancesheet' && (() => {
              const d = data as {
                asOfDate: string; fiscalYear: string;
                assets: { items: { name: string; amount: number }[]; total: number };
                liabilities: { items: { name: string; amount: number }[]; total: number };
                equity: { items: { name: string; amount: number }[]; total: number };
              };
              const netAssets = d.assets.total - d.liabilities.total - d.equity.total;
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Balance Sheet</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">As of: {d.asOfDate} | FY: {d.fiscalYear}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">Assets</h3>
                      <table className="table-base">
                        <tbody>
                          {d.assets.items.map((item, i) => (
                            <tr key={i}><td>{item.name}</td><td className="text-right font-data">{fmt(item.amount)}</td></tr>
                          ))}
                          <tr className="font-bold"><td>Total Assets</td><td className="text-right text-blue-600 font-data">{fmt(d.assets.total)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">Liabilities</h3>
                      <table className="table-base">
                        <tbody>
                          {d.liabilities.items.map((item, i) => (
                            <tr key={i}><td>{item.name}</td><td className="text-right font-data">{fmt(item.amount)}</td></tr>
                          ))}
                          <tr className="font-bold"><td>Total Liabilities</td><td className="text-right text-red-600 font-data">{fmt(d.liabilities.total)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="section-title mb-3 pb-2 border-b">Equity</h3>
                      <table className="table-base">
                        <tbody>
                          {d.equity.items.map((item, i) => (
                            <tr key={i}><td>{item.name}</td><td className="text-right font-data">{fmt(item.amount)}</td></tr>
                          ))}
                          <tr className="font-bold"><td>Total Equity</td><td className="text-right text-purple-600 font-data">{fmt(d.equity.total)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="border-t-2 border-[var(--color-border)] pt-4 flex justify-between items-center">
                    <span className="font-bold">Balance Check (Assets - Liabilities - Equity)</span>
                    <span className={`font-data font-bold ${netAssets === 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(netAssets)} {netAssets === 0 ? '✓' : '⚠ MISMATCH'}</span>
                  </div>
                </>
              );
            })()}

            {/* Cash Flow Statement */}
            {reportType === 'cashflow' && (() => {
              const d = data as {
                fiscalYear: string;
                openingBalance: number;
                operating: { inflows: number; outflows: number };
                investing: { inflows: number; outflows: number };
                financing: { inflows: number; outflows: number };
                closingBalance: number;
              };
              const netOperating = d.operating.inflows - d.operating.outflows;
              const netInvesting = d.investing.inflows - d.investing.outflows;
              const netFinancing = d.financing.inflows - d.financing.outflows;
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Cash Flow Statement</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Fiscal Year: {d.fiscalYear}</p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="font-medium">Opening Cash Balance</span>
                      <span className="font-data font-bold text-blue-600">{fmt(d.openingBalance)}</span>
                    </div>
                    <table className="table-base">
                      <tbody>
                        <tr className="font-bold"><td>Operating Activities</td><td className="text-right text-emerald-600 font-data">+{fmt(d.operating.inflows)}</td><td className="text-right text-red-600 font-data">-{fmt(d.operating.outflows)}</td><td className="text-right font-data font-medium">{fmt(netOperating)}</td></tr>
                        <tr className="font-bold"><td>Investing Activities</td><td className="text-right text-emerald-600 font-data">+{fmt(d.investing.inflows)}</td><td className="text-right text-red-600 font-data">-{fmt(d.investing.outflows)}</td><td className="text-right font-data font-medium">{fmt(netInvesting)}</td></tr>
                        <tr className="font-bold"><td>Financing Activities</td><td className="text-right text-emerald-600 font-data">+{fmt(d.financing.inflows)}</td><td className="text-right text-red-600 font-data">-{fmt(d.financing.outflows)}</td><td className="text-right font-data font-medium">{fmt(netFinancing)}</td></tr>
                      </tbody>
                    </table>
                    <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg">
                      <span className="font-bold">Net Cash Flow</span>
                      <span className="font-data font-bold text-emerald-600">{fmt(netOperating + netInvesting + netFinancing)}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
                      <span className="font-bold">Closing Cash Balance</span>
                      <span className="font-data font-bold text-[var(--color-primary)]">{fmt(d.closingBalance)}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Trial Balance */}
            {reportType === 'trailbalance' && (() => {
              const d = data as {
                fiscalYear: string;
                asOfDate: string;
                accounts: { code: string; name: string; type: string; debit: number; credit: number }[];
                totals: { totalDebit: number; totalCredit: number };
              };
              const balanced = d.totals.totalDebit === d.totals.totalCredit;
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Trial Balance</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">As of: {d.asOfDate} | FY: {d.fiscalYear}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th className="w-24">Code</th><th>Account Name</th><th className="w-24">Type</th><th className="text-right">Debit (৳)</th><th className="text-right">Credit (৳)</th></tr></thead>
                    <tbody>
                      {d.accounts.map((acc, i) => (
                        <tr key={i}>
                          <td className="font-data font-medium text-[var(--color-primary)]">{acc.code}</td>
                          <td>{acc.name}</td>
                          <td><span className="badge badge-secondary">{acc.type}</span></td>
                          <td className={`text-right font-data ${acc.debit > 0 ? 'text-red-600' : ''}`}>{acc.debit > 0 ? fmt(acc.debit) : '—'}</td>
                          <td className={`text-right font-data ${acc.credit > 0 ? 'text-emerald-600' : ''}`}>{acc.credit > 0 ? fmt(acc.credit) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2 border-[var(--color-border)]">
                        <td colSpan={3}>Total</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.totals.totalDebit)}</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.totals.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className={`text-center p-3 rounded-lg ${balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {balanced ? '✓ Trial Balance is BALANCED' : '⚠ Trial Balance is NOT BALANCED - Check entries'}
                  </div>
                </>
              );
            })()}

            {/* Day Book */}
            {reportType === 'daybook' && (() => {
              const d = data as {
                date: string;
                vouchers: { voucherNumber: string; voucherType: string; description: string; debit: number; credit: number; createdBy: string }[];
                totalDebit: number; totalCredit: number;
              };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Day Book</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Date: {d.date}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th>Voucher #</th><th>Type</th><th>Description</th><th className="text-right">Debit (৳)</th><th className="text-right">Credit (৳)</th><th>Created By</th></tr></thead>
                    <tbody>
                      {d.vouchers.map((v, i) => (
                        <tr key={i}>
                          <td className="font-data">{v.voucherNumber}</td>
                          <td><span className="badge badge-secondary">{v.voucherType}</span></td>
                          <td>{v.description}</td>
                          <td className="text-right text-red-600 font-data">{fmt(v.debit)}</td>
                          <td className="text-right text-emerald-600 font-data">{fmt(v.credit)}</td>
                          <td className="text-[var(--color-text-muted)]">{v.createdBy}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td colSpan={3}>Total</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.totalDebit)}</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.totalCredit)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            {/* Cash & Bank Book */}
            {reportType === 'cashbook' && (() => {
              const d = data as {
                startDate: string; endDate: string;
                cash: { opening: number; receipts: number; payments: number; closing: number; transactions: { date: string; description: string; receipt: number; payment: number; balance: number }[] };
                bank: { accounts: { name: string; opening: number; receipts: number; payments: number; closing: number; transactions: { date: string; description: string; chequeNo: string; receipt: number; payment: number; balance: number }[] }[] };
              };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Cash & Bank Book</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">{d.startDate} to {d.endDate}</p>
                  </div>
                  {/* Cash Book */}
                  <div>
                    <h3 className="section-title mb-3">Cash Book</h3>
                    <table className="table-base">
                      <thead><tr><th>Date</th><th>Description</th><th className="text-right">Receipt (৳)</th><th className="text-right">Payment (৳)</th><th className="text-right">Balance (৳)</th></tr></thead>
                      <tbody>
                        <tr className="font-medium"><td>{d.startDate}</td><td>Opening Balance</td><td className="text-right text-emerald-600 font-data">{fmt(d.cash.opening)}</td><td className="text-right">—</td><td className="text-right font-data">{fmt(d.cash.opening)}</td></tr>
                        {d.cash.transactions.map((t, i) => (
                          <tr key={i}>
                            <td className="font-data">{t.date}</td><td>{t.description}</td>
                            <td className="text-right text-emerald-600 font-data">{t.receipt > 0 ? fmt(t.receipt) : ''}</td>
                            <td className="text-right text-red-600 font-data">{t.payment > 0 ? fmt(t.payment) : ''}</td>
                            <td className="text-right font-data">{fmt(t.balance)}</td>
                          </tr>
                        ))}
                        <tr className="font-bold border-t-2"><td colSpan={2}>Closing Balance</td><td className="text-right text-emerald-600 font-data">{fmt(d.cash.receipts)}</td><td className="text-right text-red-600 font-data">{fmt(d.cash.payments)}</td><td className="text-right font-data text-[var(--color-primary)]">{fmt(d.cash.closing)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {/* Bank Book */}
                  {d.bank.accounts.map((acct, idx) => (
                    <div key={idx} className="mt-6">
                      <h3 className="section-title mb-3">Bank Book — {acct.name}</h3>
                      <table className="table-base">
                        <thead><tr><th>Date</th><th>Description</th><th className="w-32">Cheque No.</th><th className="text-right">Receipt (৳)</th><th className="text-right">Payment (৳)</th><th className="text-right">Balance (৳)</th></tr></thead>
                        <tbody>
                          <tr className="font-medium"><td>{d.startDate}</td><td>Opening Balance</td><td /><td className="text-right text-emerald-600 font-data">{fmt(acct.opening)}</td><td className="text-right">—</td><td className="text-right font-data">{fmt(acct.opening)}</td></tr>
                          {acct.transactions.map((t, i) => (
                            <tr key={i}>
                              <td className="font-data">{t.date}</td><td>{t.description}</td>
                              <td className="font-data text-[var(--color-text-muted)]">{t.chequeNo || '—'}</td>
                              <td className="text-right text-emerald-600 font-data">{t.receipt > 0 ? fmt(t.receipt) : ''}</td>
                              <td className="text-right text-red-600 font-data">{t.payment > 0 ? fmt(t.payment) : ''}</td>
                              <td className="text-right font-data">{fmt(t.balance)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold border-t-2"><td colSpan={3}>Closing Balance</td><td className="text-right text-emerald-600 font-data">{fmt(acct.receipts)}</td><td className="text-right text-red-600 font-data">{fmt(acct.payments)}</td><td className="text-right font-data text-[var(--color-primary)]">{fmt(acct.closing)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
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
              };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Ledger Report</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">{d.ledgerName} ({d.ledgerCode}) | {d.startDate} to {d.endDate}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th>Date</th><th>Voucher #</th><th>Description</th><th className="text-right">Debit (৳)</th><th className="text-right">Credit (৳)</th><th className="text-right">Balance (৳)</th></tr></thead>
                    <tbody>
                      <tr className="font-medium"><td>{d.startDate}</td><td>—</td><td>Opening Balance</td><td /><td /><td className="text-right font-data">{fmt(d.opening)}</td></tr>
                      {d.transactions.map((t, i) => (
                        <tr key={i}>
                          <td className="font-data">{t.date}</td>
                          <td className="font-data text-[var(--color-text-muted)]">{t.voucherNumber}</td>
                          <td>{t.description}</td>
                          <td className="text-right text-red-600 font-data">{t.debit > 0 ? fmt(t.debit) : ''}</td>
                          <td className="text-right text-emerald-600 font-data">{t.credit > 0 ? fmt(t.credit) : ''}</td>
                          <td className="text-right font-data">{fmt(t.balance)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2"><td colSpan={3}>Closing Balance</td><td /><td /><td className="text-right font-data text-[var(--color-primary)]">{fmt(d.closing)}</td></tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            {/* Bank Reconciliation */}
            {reportType === 'bankrecon' && (() => {
              const d = data as {
                fiscalYear: string;
                accountId: number;
                bookBalance: number;
                transactions: { date: string; voucher_number: string; description: string; deposits: number; withdrawals: number; balance: number }[];
                summary: { openingBalance: number; totalDeposits: number; totalWithdrawals: number; closingBalance: number };
              };
              const difference = bankStatementBalance - d.bookBalance;
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Bank Reconciliation Statement</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Fiscal Year: {d.fiscalYear} | Account ID: {d.accountId}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="text-sm text-[var(--color-text-muted)]">Book Balance (Our Records)</div>
                      <div className="text-2xl font-bold text-blue-600 font-data">{fmt(d.bookBalance)}</div>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-lg">
                      <div className="text-sm text-[var(--color-text-muted)]">Bank Statement Balance (Manual Entry)</div>
                      <div className="text-2xl font-bold text-emerald-600 font-data">{fmt(bankStatementBalance)}</div>
                    </div>
                  </div>
                  <div className={`text-center p-3 rounded-lg mb-6 ${Math.abs(difference) < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    Difference: {fmt(difference)} {Math.abs(difference) < 0.01 ? '✓ RECONCILED' : '⚠ ADJUSTMENT NEEDED'}
                  </div>
                  <div>
                    <h3 className="section-title mb-3">Summary</h3>
                    <table className="table-base">
                      <tbody>
                        <tr><td>Opening Balance</td><td className="text-right font-data">{fmt(d.summary.openingBalance)}</td></tr>
                        <tr><td>Total Deposits</td><td className="text-right text-emerald-600 font-data">+{fmt(d.summary.totalDeposits)}</td></tr>
                        <tr><td>Total Withdrawals</td><td className="text-right text-red-600 font-data">-{fmt(d.summary.totalWithdrawals)}</td></tr>
                        <tr className="font-bold border-t-2"><td>Closing Balance (Book)</td><td className="text-right font-data text-[var(--color-primary)]">{fmt(d.summary.closingBalance)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-6">
                    <h3 className="section-title mb-3">Transactions</h3>
                    <table className="table-base">
                      <thead><tr><th>Date</th><th>Voucher #</th><th>Description</th><th className="text-right">Deposits (৳)</th><th className="text-right">Withdrawals (৳)</th><th className="text-right">Balance (৳)</th></tr></thead>
                      <tbody>
                        {d.transactions.map((t, i) => (
                          <tr key={i}>
                            <td className="font-data">{t.date}</td>
                            <td className="font-data text-[var(--color-text-muted)]">{t.voucher_number}</td>
                            <td>{t.description}</td>
                            <td className="text-right text-emerald-600 font-data">{t.deposits > 0 ? fmt(t.deposits) : ''}</td>
                            <td className="text-right text-red-600 font-data">{t.withdrawals > 0 ? fmt(t.withdrawals) : ''}</td>
                            <td className="text-right font-data">{fmt(t.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

            {/* Group Statement */}
            {reportType === 'groupstatement' && (() => {
              const d = data as {
                fiscalYear: string;
                groupId: string;
                accounts: { id: number; code: string; name: string; type: string; total_debit: number; total_credit: number; netBalance: number }[];
                totals: { totalDebit: number; totalCredit: number; totalNet: number };
              };
              return (
                <>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Group Statement</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Fiscal Year: {d.fiscalYear} | Group ID: {d.groupId}</p>
                  </div>
                  <table className="table-base">
                    <thead><tr><th className="w-24">Code</th><th>Account Name</th><th className="w-24">Type</th><th className="text-right">Debit (৳)</th><th className="text-right">Credit (৳)</th><th className="text-right">Net Balance (৳)</th></tr></thead>
                    <tbody>
                      {d.accounts.map((acc, i) => (
                        <tr key={i}>
                          <td className="font-data font-medium text-[var(--color-primary)]">{acc.code}</td>
                          <td>{acc.name}</td>
                          <td><span className="badge badge-secondary">{acc.type}</span></td>
                          <td className="text-right font-data">{acc.total_debit > 0 ? fmt(acc.total_debit) : '—'}</td>
                          <td className="text-right font-data">{acc.total_credit > 0 ? fmt(acc.total_credit) : '—'}</td>
                          <td className={`text-right font-data font-medium ${acc.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(acc.netBalance)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2 border-[var(--color-border)]">
                        <td colSpan={3}>Total</td>
                        <td className="text-right text-red-600 font-data">{fmt(d.totals.totalDebit)}</td>
                        <td className="text-right text-emerald-600 font-data">{fmt(d.totals.totalCredit)}</td>
                        <td className={`text-right font-data ${d.totals.totalNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(d.totals.totalNet)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}

            <p className="text-center text-xs text-[var(--color-text-muted)]">Generated: {new Date().toLocaleString()}</p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
