import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { Download, Printer } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface DeptRow {
  department: string;
  amount: number;
}

interface PaymentRow {
  method: string;
  amount: number;
  percentage: number;
}

interface ExpenseRow {
  expense_head: string;
  amount: number;
}

interface ExpenseDetailRow {
  id: string;
  date?: string | null;
  category: string;
  details: string;
  amount: number;
  payment_method: string;
  status: string;
}

interface CollectionData {
  summary?: {
    total_bill: number;
    total_collection: number;
    total_deposit: number;
    total_expense: number;
    total_due: number;
    net_income: number;
    net_cash: number;
  };
  collection_sources: DeptRow[];
  payment_methods: PaymentRow[];
  expenses: ExpenseRow[];
  expense_details?: ExpenseDetailRow[];
}

const REPORT_TABS = ['Cash Closing', 'Department-wise', 'Payment Method', 'Expenses'] as const;
type ReportTab = (typeof REPORT_TABS)[number];

export function dhakaDateInputValue(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export default function DailyCollectionReport() {
  const { t } = useTranslation('adminCash');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ReportTab | null;
  const isValidTab = (val: string | null): val is ReportTab =>
    val !== null && REPORT_TABS.includes(val as ReportTab);
  
  const [activeTab, setActiveTabRaw] = useState<ReportTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'Cash Closing';
    }
    return isValidTab(tabParam) ? tabParam : 'Cash Closing';
  });

  const setActiveTab = (tab: ReportTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };
  
  const [date] = useState(() => dhakaDateInputValue());

  const { data, isLoading } = useApiQuery<CollectionData>(
    queryKeys.admin.dailyCollection(date),
    `/api/reports/daily-collection?date=${date}`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">Loading report data...</div></DashboardLayout>;
  }

  const summary = data?.summary;
  const collectionSources = data?.collection_sources ?? [];
  const paymentMethods = data?.payment_methods ?? [];
  const expenses = data?.expenses ?? [];
  const expenseDetails = data?.expense_details;
  const expenseRows: ExpenseDetailRow[] = expenseDetails !== undefined
    ? expenseDetails
    : expenses.map((expense, index) => ({
        id: `summary-${index}`,
        date,
        category: expense.expense_head,
        details: expense.expense_head,
        amount: expense.amount,
        payment_method: '—',
        status: 'paid',
      }));

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Daily Cash Closing Report</h1>
            <p className="text-sm text-gray-500">{date}</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2">
              <Download className="w-4 h-4" /> Export
            </button>
            <button className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2">
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Billed Today</div>
              <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary.total_bill)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Collection Today</div>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(summary.total_collection)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Deposit Today</div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(summary.total_deposit)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Expense Today</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.total_expense)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Due Today</div>
              <div className="text-2xl font-bold text-gray-700">{formatCurrency(summary.total_due)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm bg-emerald-50/50 border-emerald-200">
              <div className="text-sm text-emerald-700 font-semibold">Net Income</div>
              <div className="text-2xl font-bold text-emerald-800">{formatCurrency(summary.net_income)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4 shadow-sm bg-blue-50/50 border-blue-200">
              <div className="text-sm text-blue-600 font-semibold">Physical Net Cash</div>
              <div className="text-2xl font-bold text-blue-700">{formatCurrency(summary.net_cash)}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 border-b pb-2">
          {REPORT_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Cash Closing' && (
          <div className="bg-white rounded-lg border overflow-hidden p-6 max-w-2xl shadow-sm">
            <h2 className="text-lg font-semibold mb-1 text-gray-800">Management &amp; Cash Reconciliation</h2>
            <p className="mb-4 text-sm text-gray-500">Patient deposits are included in Total Collection and Net Income. Physical cash is shown separately.</p>
            {summary ? (
              <div className="divide-y text-sm">
                <div className="flex justify-between py-3 text-green-700">
                  <span>Total Collection (Includes Deposits)</span>
                  <span className="font-semibold">+{formatCurrency(summary.total_collection)}</span>
                </div>
                <div className="flex justify-between py-3 text-red-600">
                  <span>Total Expense (Paid + Doctor Payouts)</span>
                  <span className="font-semibold">-{formatCurrency(summary.total_expense)}</span>
                </div>
                <div className="flex justify-between py-4 text-lg font-bold text-emerald-700 bg-emerald-50/50 px-4 rounded-lg mt-2">
                  <span>Net Income</span>
                  <span>{formatCurrency(summary.net_income)}</span>
                </div>
                <div className="flex justify-between py-3 text-blue-600">
                  <span>Deposit Included in Total Collection</span>
                  <span className="font-semibold">{formatCurrency(summary.total_deposit)}</span>
                </div>
                <div className="flex justify-between py-4 text-lg font-bold text-blue-700 bg-blue-50/50 px-4 rounded-lg mt-2">
                  <span>Physical Net Cash</span>
                  <span>{formatCurrency(summary.net_cash)}</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500">No collection summary data found.</div>
            )}
          </div>
        )}

        {activeTab === 'Department-wise' && (
          <div className="bg-white rounded-lg border overflow-hidden shadow-sm">
            {collectionSources.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No department revenue recorded today.</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Department</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Collected Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {collectionSources.map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{d.department}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-green-600">{formatCurrency(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'Payment Method' && (
          <div className="bg-white rounded-lg border overflow-hidden shadow-sm">
            {paymentMethods.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No payments recorded today.</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Payment Method</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Amount</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paymentMethods.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{p.method}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-gray-900">{formatCurrency(p.amount)}</td>
                      <td className="py-3 px-4 text-sm text-right text-gray-600">{p.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'Expenses' && (
          <div className="bg-white rounded-lg border overflow-x-auto shadow-sm">
            {expenseRows.length === 0 ? (
              <div className="text-center py-12 text-gray-500 font-medium">No drawer expenses logged today.</div>
            ) : (
              <table className="w-full min-w-[920px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Category</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Details</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Payment Method</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Paid Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenseRows.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap py-3 px-4 text-sm text-gray-600">{expense.date ? String(expense.date).slice(0, 10) : '—'}</td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{expense.category}</td>
                      <td className="py-3 px-4 text-sm text-gray-700">{expense.details}</td>
                      <td className="py-3 px-4 text-sm capitalize text-gray-700">{expense.payment_method.replace(/_/g, ' ')}</td>
                      <td className="py-3 px-4 text-sm capitalize text-gray-700">{expense.status.replace(/_/g, ' ')}</td>
                      <td className="py-3 px-4 text-sm text-right font-semibold text-red-600">{formatCurrency(expense.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
