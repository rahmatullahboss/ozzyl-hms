import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Percent, TrendingUp, Users, AlertTriangle, Filter, X, Calendar } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';

type TabKey = 'overview' | 'pending' | 'approved' | 'rejected' | 'high' | 'reference' | 'staff';

const TABS: { key: TabKey }[] = [
  { key: 'overview' },
  { key: 'pending' },
  { key: 'approved' },
  { key: 'rejected' },
  { key: 'high' },
  { key: 'reference' },
  { key: 'staff' },
];

type DiscountBill = {
    id: number;
    invoiceNo: string;
    total: number;
    totalAmount?: number;
    paidAmount?: number;
    discount: number;
    discountPct: number;
    subtotal?: number;
    discountByName: string | null;
    createdBy: string;
    createdAt: string;
};

interface SecurityAlerts {
  highDiscountBills: DiscountBill[];
  discountBills?: DiscountBill[];
  summary: {
    highDiscountCount: number;
    totalDiscountCount?: number;
  };
}

interface DiscountBillDetailResponse {
  bill: {
    id: number;
    invoice_no: string;
    patient_name?: string | null;
    patient_code?: string | null;
    mobile?: string | null;
    subtotal?: number | null;
    discount?: number | null;
    discount_reason?: string | null;
    discount_by_name?: string | null;
    total?: number | null;
    total_amount?: number | null;
    paid?: number | null;
    paid_amount?: number | null;
    due?: number | null;
    outstanding?: number | null;
    tax_total?: number | null;
    status?: string | null;
    created_at?: string | null;
    approved_by_name?: string | null;
  };
  items: Array<{
    id: number;
    item_category?: string | null;
    description?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    line_total?: number | null;
    tax_amount?: number | null;
  }>;
  payments: Array<{
    id: number;
    amount?: number | null;
    receipt_no?: string | null;
    payment_method?: string | null;
    received_by_name?: string | null;
    created_at?: string | null;
  }>;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function getDefaultReviewDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return getDefaultReviewDate();
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateRange(from: string, to: string) {
  return from <= to ? { from, to } : { from: to, to: from };
}

function getBillTotalAmount(bill: DiscountBill) {
  const paidAmount = Number(bill.paidAmount ?? bill.total ?? 0);
  const discount = Number(bill.discount ?? 0);
  return Number(bill.totalAmount ?? bill.subtotal ?? 0) || (paidAmount + discount);
}

function getBillPaidAmount(bill: DiscountBill) {
  return Number(bill.paidAmount ?? bill.total ?? 0);
}

function getBillDiscountPct(bill: DiscountBill) {
  const totalAmount = getBillTotalAmount(bill);
  return totalAmount > 0 ? Number(((Number(bill.discount ?? 0) * 100) / totalAmount).toFixed(1)) : 0;
}


export default function DiscountReview({ role = 'hospital_admin' }: { role?: string } = {}) {
  const { t } = useTranslation('adminDiscount');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const isValidTab = (val: string | null): val is TabKey =>
    val !== null && TABS.some(tab => tab.key === val);
  const [activeTab, setActiveTabRaw] = useState<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'overview';
    }
    return isValidTab(tabParam) ? tabParam : 'overview';
  });

  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(getDefaultReviewDate);
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [rangeFrom, setRangeFrom] = useState(getDefaultReviewDate);
  const [rangeTo, setRangeTo] = useState(getDefaultReviewDate);
  const selectedRange = normalizeDateRange(rangeFrom, rangeTo);
  const reportFrom = dateMode === 'range' ? selectedRange.from : selectedDate;
  const reportTo = dateMode === 'range' ? selectedRange.to : selectedDate;
  const reportQuery = dateMode === 'range' ? `from=${reportFrom}&to=${reportTo}` : `date=${selectedDate}`;
  const periodKey = dateMode === 'range' ? `range:${reportFrom}:${reportTo}` : selectedDate;

  const shiftPeriod = (days: number) => {
    if (dateMode === 'range') {
      setRangeFrom((current) => addDays(current, days));
      setRangeTo((current) => addDays(current, days));
      return;
    }
    setSelectedDate((current) => addDays(current, days));
  };

  const jumpToToday = () => {
    const today = getDefaultReviewDate();
    setSelectedDate(today);
    setRangeFrom(today);
    setRangeTo(today);
  };

  const setSingleMode = () => {
    setDateMode('single');
    setSelectedDate(reportTo || getDefaultReviewDate());
  };

  const setRangeModeFromCurrent = () => {
    setDateMode('range');
    setRangeFrom(reportFrom || selectedDate);
    setRangeTo(reportTo || selectedDate);
  };

  const setActiveTab = (tab: TabKey) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data: securityAlerts, isLoading } = useApiQuery<SecurityAlerts>(
    queryKeys.admin.securityAlerts(periodKey),
    `/api/dashboard/security-alerts?${reportQuery}`,
    { refetchInterval: 60000 },
  );

  const { data: selectedBillData, isLoading: isBillDetailLoading } = useApiQuery<DiscountBillDetailResponse>(
    selectedBillId ? queryKeys.billPrint.detail(String(selectedBillId)) : ['billPrint', 'detail', 'none'],
    selectedBillId ? `/api/billing/${selectedBillId}` : '/api/billing/0',
    { enabled: selectedBillId !== null },
  );

  const highDiscountBills = securityAlerts?.highDiscountBills ?? [];
  const discountBills = securityAlerts?.discountBills ?? highDiscountBills;
  const selectedBill = selectedBillData?.bill ?? null;
  const selectedItems = selectedBillData?.items ?? [];
  const selectedPayments = selectedBillData?.payments ?? [];
  const selectedItemsSubtotal = selectedItems.reduce((sum, item) => sum + Number(item.quantity ?? 1) * Number(item.unit_price ?? 0), 0);
  const selectedSubtotal = Number(selectedBill?.subtotal ?? 0)
    || selectedItemsSubtotal
    || (Number(selectedBill?.total_amount ?? selectedBill?.total ?? 0) + Number(selectedBill?.discount ?? 0) - Number(selectedBill?.tax_total ?? 0));
  const selectedDiscount = Number(selectedBill?.discount ?? 0);
  const selectedPaidAmount = Number(selectedBill?.paid_amount ?? selectedBill?.paid ?? selectedBill?.total_amount ?? selectedBill?.total ?? 0);
  const selectedDiscountPct = selectedSubtotal > 0 ? (selectedDiscount * 100) / selectedSubtotal : 0;

  const riskBadge = (level: 'high' | 'medium' | 'low') =>
    level === 'high' ? 'badge-error' : level === 'medium' ? 'badge-warning' : 'badge-success';

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Percent className="h-6 w-6" />
              {t('discountReview.title')}
            </h1>
            <p className="page-subtitle">{t('discountReview.subtitle')}</p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text-primary)]">
            <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <Calendar className="h-3.5 w-3.5" />
              {t('discountReview.date')}
            </span>
            <input
              aria-label={t('discountReview.date')}
              type="date"
              className="input h-10 min-w-[160px]"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value || getDefaultReviewDate())}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('discountReview.totalDiscounts')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : securityAlerts?.summary?.totalDiscountCount ?? discountBills.length}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('discountReview.needsReview')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : highDiscountBills.length}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('discountReview.missingRef')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-red-600">
              {isLoading ? '-' : discountBills.filter(b => getBillDiscountPct(b) > 20 && !b.discountByName).length}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('discountReview.totalDiscountAmount')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : `৳${discountBills.reduce((sum, b) => sum + (b.discount ?? 0), 0).toLocaleString()}`}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('discountReview.uniqueReferences')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : new Set(discountBills.map(b => b.discountByName).filter(Boolean)).size}
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--color-border)]">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t(`discountReview.tabs.${tab.key}`)}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'overview' && (
          <div className="card p-5">
            <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">{t('discountReview.discountBillsToday', { defaultValue: 'Today’s Discount Bills' })}</h3>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
              </div>
            ) : discountBills.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('discountReview.noData')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('discountReview.invoice')}</th>
                      <th>{t('discountReview.totalAmount', { defaultValue: 'Total Amount' })}</th>
                      <th>{t('discountReview.paidAmount', { defaultValue: 'Paid Amount' })}</th>
                      <th>{t('discountReview.discount')}</th>
                      <th>{t('discountReview.discountPct')}</th>
                      <th>{t('discountReview.referredBy')}</th>
                      <th>{t('discountReview.createdBy')}</th>
                      <th>{t('discountReview.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discountBills.map(bill => (
                      <tr key={bill.id} onClick={() => setSelectedBillId(bill.id)} className={`${(bill.discountPct ?? 0) > 20 && !bill.discountByName ? 'bg-red-50' : ''} cursor-pointer`}>
                        <td><span className="font-medium text-[var(--color-primary)]">{bill.invoiceNo}</span></td>
                        <td className="font-data">{formatCurrency(getBillTotalAmount(bill))}</td>
                        <td className="font-data">{formatCurrency(getBillPaidAmount(bill))}</td>
                        <td className="font-data text-red-600">{formatCurrency(bill.discount)}</td>
                        <td>
                          <span className={`badge ${getBillDiscountPct(bill) > 20 ? 'badge-error' : 'badge-warning'}`}>
                            {getBillDiscountPct(bill).toFixed(1)}%
                          </span>
                        </td>
                        <td>
                          {bill.discountByName ? (
                            bill.discountByName
                          ) : getBillDiscountPct(bill) > 20 ? (
                            <span className="text-red-600 font-medium text-xs">{t('discountReview.missing')}</span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">-</span>
                          )}
                        </td>
                        <td>{bill.createdBy}</td>
                        <td className="text-xs text-[var(--color-text-muted)]">
                          {new Date(bill.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'reference' && (
          <div className="card p-5">
            <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">{t('discountReview.referenceAnalysis')}</h3>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
              </div>
            ) : (() => {
              const refMap = new Map<string, { count: number; totalDiscount: number; avgPct: number }>();
              discountBills.forEach(b => {
                const ref = b.discountByName || t('discountReview.unknown');
                const existing = refMap.get(ref) || { count: 0, totalDiscount: 0, avgPct: 0 };
                existing.count++;
                existing.totalDiscount += b.discount;
                existing.avgPct = (existing.avgPct * (existing.count - 1) + getBillDiscountPct(b)) / existing.count;
                refMap.set(ref, existing);
              });
              const refs = Array.from(refMap.entries()).sort((a, b) => b[1].totalDiscount - a[1].totalDiscount);

              return refs.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('discountReview.noReferenceData')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('discountReview.referredByCol')}</th>
                        <th>{t('discountReview.totalDiscounts')}</th>
                        <th>{t('discountReview.totalAmount')}</th>
                        <th>{t('discountReview.avgDiscountPct')}</th>
                        <th>{t('discountReview.risk')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refs.map(([name, data]) => (
                        <tr key={name}>
                          <td className="font-medium">{name}</td>
                          <td className="font-data">{data.count}</td>
                          <td className="font-data">{formatCurrency(data.totalDiscount)}</td>
                          <td className="font-data">{Number(data.avgPct ?? 0).toFixed(1)}%</td>
                          <td>
                            {(data.avgPct ?? 0) > 15 || data.count > 3 ? (
                              <span className={`badge ${riskBadge('high')}`}>{t('discountReview.riskHigh')}</span>
                            ) : (data.avgPct ?? 0) > 10 ? (
                              <span className={`badge ${riskBadge('medium')}`}>{t('discountReview.riskMedium')}</span>
                            ) : (
                              <span className={`badge ${riskBadge('low')}`}>{t('discountReview.riskLow')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'staff' && (
          <div className="card p-5">
            <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">{t('discountReview.staffAnalysis')}</h3>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
              </div>
            ) : (() => {
              const staffMap = new Map<string, { count: number; totalDiscount: number }>();
              discountBills.forEach(b => {
                const staff = b.createdBy || t('discountReview.unknown');
                const existing = staffMap.get(staff) || { count: 0, totalDiscount: 0 };
                existing.count++;
                existing.totalDiscount += b.discount ?? 0;
                staffMap.set(staff, existing);
              });
              const staffList = Array.from(staffMap.entries()).sort((a, b) => b[1].totalDiscount - a[1].totalDiscount);

              return staffList.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('discountReview.noStaffData')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('discountReview.staff')}</th>
                        <th>{t('discountReview.discountCount')}</th>
                        <th>{t('discountReview.totalDiscountAmount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffList.map(([name, data]) => (
                        <tr key={name}>
                          <td className="font-medium">{name}</td>
                          <td className="font-data">{data.count}</td>
                          <td className="font-data">{formatCurrency(data.totalDiscount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'high' && (
          <div className="card p-5">
            <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">{t('discountReview.highDiscountBills')}</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              {t('discountReview.highDiscountRequired')}
            </p>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
              </div>
            ) : (() => {
              const highBills = highDiscountBills.filter(b => getBillDiscountPct(b) > 20);
              return highBills.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('discountReview.noData')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('discountReview.invoice')}</th>
                        <th>{t('discountReview.totalAmount', { defaultValue: 'Total Amount' })}</th>
                        <th>{t('discountReview.paidAmount', { defaultValue: 'Paid Amount' })}</th>
                        <th>{t('discountReview.discount')}</th>
                        <th>{t('discountReview.discountPct')}</th>
                        <th>{t('discountReview.referredBy')}</th>
                        <th>{t('discountReview.createdBy')}</th>
                        <th>{t('discountReview.time')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {highBills.map(bill => (
                        <tr key={bill.id} onClick={() => setSelectedBillId(bill.id)} className="cursor-pointer">
                          <td><span className="font-medium text-[var(--color-primary)]">{bill.invoiceNo}</span></td>
                          <td className="font-data">{formatCurrency(getBillTotalAmount(bill))}</td>
                          <td className="font-data">{formatCurrency(getBillPaidAmount(bill))}</td>
                          <td className="font-data text-red-600">{formatCurrency(bill.discount)}</td>
                          <td><span className="badge badge-error">{getBillDiscountPct(bill).toFixed(1)}%</span></td>
                          <td>
                            {bill.discountByName ? (
                              bill.discountByName
                            ) : (
                              <span className="text-red-600 font-medium text-xs">{t('discountReview.missingRefRow')}</span>
                            )}
                          </td>
                          <td>{bill.createdBy}</td>
                          <td className="text-xs text-[var(--color-text-muted)]">{new Date(bill.createdAt).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {(activeTab === 'pending' || activeTab === 'approved' || activeTab === 'rejected') && (
          <div className="card p-5">
            <div className="text-center py-8">
              <Filter className="w-10 h-10 mx-auto text-[var(--color-text-muted)] opacity-30 mb-2" />
              <p className="text-sm text-[var(--color-text-muted)]">
                {activeTab === 'pending' && t('discountReview.pendingHint')}
                {activeTab === 'approved' && t('discountReview.approvedHint')}
                {activeTab === 'rejected' && t('discountReview.rejectedHint')}
              </p>
            </div>
          </div>
        )}
      </div>
      {selectedBillId !== null && (
        <div className="fixed inset-0 z-50 bg-white p-6 overflow-y-auto">
          <button type="button" onClick={() => setSelectedBillId(null)} className="btn-ghost float-right"><X className="h-5 w-5" /></button>
          <h2 className="text-lg font-semibold">Bill Details: {selectedBill?.invoice_no ?? selectedBillId}</h2>
          {isBillDetailLoading ? <p>Loading...</p> : selectedBill && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>Patient: <strong>{selectedBill.patient_name ?? '-'}</strong></div>
                <div>Reference: <strong>{selectedBill.discount_by_name || 'Missing'}</strong></div>
                <div>Total Amount: <strong>{formatCurrency(selectedSubtotal)}</strong></div>
                <div>Paid Amount: <strong>{formatCurrency(selectedPaidAmount)}</strong></div>
                <div>Discount: <strong>{formatCurrency(selectedDiscount)} ({Number(selectedDiscountPct).toFixed(1)}%)</strong></div>
                <div>Reason: <strong>{selectedBill.discount_reason || '-'}</strong></div>
              </div>
              <table className="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>{selectedItems.map(item => <tr key={item.id}><td>{item.description ?? item.item_category ?? '-'}</td><td>{Number(item.quantity ?? 1)}</td><td>{formatCurrency(Number(item.unit_price ?? 0))}</td><td>{formatCurrency(Number(item.line_total ?? 0))}</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
