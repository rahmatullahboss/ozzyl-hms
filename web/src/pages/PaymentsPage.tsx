import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Search, DollarSign, CheckCircle, Clock, AlertTriangle, TrendingUp, Filter, X, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { api } from '../lib/apiClient';

interface Payment {
  id: number; payment_ref: string; patient_name: string; patient_code: string;
  amount: number; payment_method: string; payment_type: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  gateway_ref?: string; paid_at?: string; created_at: string;
}
interface PaymentMethodTotal { payment_method: string; total: number; transaction_count: number; }
interface PaymentStats {
  total_today: number;
  completed_today: number;
  pending_count: number;
  failed_count: number;
  cash_total: number;
  card_total: number;
  bkash_total?: number;
  nagad_total?: number;
  rocket_total?: number;
  bank_total?: number;
  bank_transfer_total?: number;
  cheque_total?: number;
  other_total?: number;
  method_totals?: PaymentMethodTotal[];
}
interface PaymentDetail extends Payment { collected_by?: string; notes?: string; bill_id?: number; }

const STATUS_TABS = ['all','pending','completed','failed','refunded'];
const PAYMENT_METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other'];

function fmtTaka(n: number, lang: string) { 
  return `৳${(n||0).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-BD')}`; 
}
function fmtDT(d: string | null | undefined, lang: string) { 
  if(!d) return '—'; 
  return new Date(d).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }); 
}

export default function PaymentsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['billing', 'sidebar']);
  
  const METHOD_LABELS: Record<string, string> = {
    cash: t('billing:paymentsPage.methods.cash', { defaultValue: 'Cash' }),
    card: t('billing:paymentsPage.methods.card', { defaultValue: 'Card' }),
    bkash: t('billing:paymentsPage.methods.bkash', { defaultValue: 'bKash' }),
    nagad: t('billing:paymentsPage.methods.nagad', { defaultValue: 'Nagad' }),
    rocket: t('billing:paymentsPage.methods.rocket', { defaultValue: 'Rocket' }),
    bank: t('billing:paymentsPage.methods.bank', { defaultValue: 'Bank' }),
    bank_transfer: t('billing:paymentsPage.methods.bank_transfer', { defaultValue: 'Bank transfer' }),
    cheque: t('billing:paymentsPage.methods.cheque', { defaultValue: 'Cheque' }),
    other: t('billing:paymentsPage.methods.other', { defaultValue: 'Other' }),
  };
  const METHOD_BADGE: Record<string, string> = {
    cash: 'badge-success',
    card: 'bg-indigo-100 text-indigo-700',
    bkash: 'bg-pink-100 text-pink-700',
    nagad: 'bg-orange-100 text-orange-700',
    rocket: 'bg-purple-100 text-purple-700',
    bank: 'bg-sky-100 text-sky-700',
    bank_transfer: 'bg-blue-100 text-blue-700',
    cheque: 'bg-amber-100 text-amber-700',
    other: 'badge-info',
  };
  const STATUS_BADGE: Record<string, string> = { pending: 'badge-warning', completed: 'badge-success', failed: 'badge-error', refunded: 'badge-info' };

  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<PaymentStats|null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentDetail|null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (methodFilter !== 'all') params.set('payment_method', methodFilter);
      if (search) params.set('search', search);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const q = params.toString();
      const data = await api.get<{ data: Payment[] }>(`/api/payments${q ? `?${q}` : ''}`);
      setPayments(data.data ?? []);
    } catch { toast.error(t('billing.failed_to_load_payments')); setPayments([]); }
    finally { setLoading(false); }
  }, [statusFilter, methodFilter, search, dateFrom, dateTo]);

  const fetchStats = useCallback(async () => {
    try { const data = await api.get<PaymentStats>('/api/payments/stats'); setStats(data); }
    catch { setStats(null); }
  }, []);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try { const data = await api.get<{ data: PaymentDetail }>(`/api/payments/${id}`); setSelectedPayment(data.data); }
    catch { toast.error(t('billing:failed_to_load_detail')); }
    finally { setDetailLoading(false); }
  };
  const methodTotal = (method: string) =>
    stats?.method_totals?.find((row) => row.payment_method === method)?.total ?? (
      method === 'cash' ? stats?.cash_total
        : method === 'card' ? stats?.card_total
          : method === 'bkash' ? stats?.bkash_total
            : method === 'nagad' ? stats?.nagad_total
              : method === 'bank' ? stats?.bank_total
                : method === 'bank_transfer' ? stats?.bank_transfer_total
                  : method === 'cheque' ? stats?.cheque_total
                    : method === 'rocket' ? stats?.rocket_total
                      : stats?.other_total
    ) ?? 0;

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <CreditCard className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('sidebar:payments')}</h1>
              <p className="section-subtitle">{t('billing:paymentsPage.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-4">
          <KPICard title={t('billing:paymentsPage.todayTotal')}  value={fmtTaka(stats?.total_today??0, i18n.language)}     loading={!stats} icon={<TrendingUp className="w-5 h-5"/>}   iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0}/>
          <KPICard title={t('billing:paymentsPage.completed')}      value={fmtTaka(stats?.completed_today??0, i18n.language)} loading={!stats} icon={<CheckCircle className="w-5 h-5"/>}   iconBg="bg-emerald-50 text-emerald-600" index={1}/>
          <KPICard title={t('billing:paymentsPage.pending')}        value={stats?.pending_count !== undefined ? (i18n.language === 'bn' ? stats.pending_count.toLocaleString('bn-BD') : String(stats.pending_count)) : '—'}  loading={!stats} icon={<Clock className="w-5 h-5"/>}         iconBg="bg-amber-50 text-amber-600"    index={2}/>
          <KPICard title={t('billing:paymentsPage.failed')}         value={stats?.failed_count !== undefined ? (i18n.language === 'bn' ? stats.failed_count.toLocaleString('bn-BD') : String(stats.failed_count)) : '—'}   loading={!stats} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600"        index={3}/>
          <KPICard title={METHOD_LABELS.cash}           value={fmtTaka(methodTotal('cash'), i18n.language)}      loading={!stats} icon={<DollarSign className="w-5 h-5"/>}    iconBg="bg-green-50 text-green-600"    index={4}/>
          <KPICard title={METHOD_LABELS.card}           value={fmtTaka(methodTotal('card'), i18n.language)}      loading={!stats} icon={<CreditCard className="w-5 h-5"/>}    iconBg="bg-indigo-50 text-indigo-600"  index={5}/>
          <KPICard title={METHOD_LABELS.bkash}          value={fmtTaka(methodTotal('bkash'), i18n.language)}     loading={!stats} icon={<CreditCard className="w-5 h-5"/>}    iconBg="bg-pink-50 text-pink-600"      index={6}/>
          <KPICard title={METHOD_LABELS.nagad}          value={fmtTaka(methodTotal('nagad'), i18n.language)}     loading={!stats} icon={<CreditCard className="w-5 h-5"/>}    iconBg="bg-orange-50 text-orange-600"  index={7}/>
          <KPICard title={METHOD_LABELS.bank_transfer}  value={fmtTaka(methodTotal('bank_transfer') + methodTotal('bank') + methodTotal('cheque'), i18n.language)} loading={!stats} icon={<CreditCard className="w-5 h-5"/>} iconBg="bg-sky-50 text-sky-600" index={8}/>
        </div>

        <div className="card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 flex-wrap">
              {STATUS_TABS.map(tab => (
                <button key={tab} onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${statusFilter===tab ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]"/>
              <input type="text" placeholder={t("billing:paymentsPage.searchPlaceholder")} value={searchInput}
                onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter') setSearch(searchInput); }} className="input pl-9"/>
            </div>
            <button onClick={() => setSearch(searchInput)} className="btn-secondary">{t('billing:common.search')}</button>
            <button onClick={() => setShowFilters(!showFilters)} className={`btn-ghost gap-1 ${showFilters?'text-[var(--color-primary)]':''}`}>
              <Filter className="w-4 h-4"/> {t('billing:paymentsPage.filters')}
            </button>
            {search && <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">{t('billing:common.clear')}</button>}
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--color-border)]">
              <div>
                <label className="label text-xs">{t('billing:paymentsPage.method')}</label>
                <select className="input text-sm" value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
                  <option value="all">{t('billing:paymentsPage.allMethods')}</option>
              {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{METHOD_LABELS[method]}</option>)}
                </select>
              </div>
              <div><label className="label text-xs">{t('billing:paymentsPage.dateFrom')}</label><input className="input text-sm" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}/></div>
              <div><label className="label text-xs">{t('billing:paymentsPage.dateTo')}</label><input className="input text-sm" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}/></div>
              {(methodFilter!=='all'||dateFrom||dateTo) && (
                <div className="flex items-end"><button onClick={() => { setMethodFilter('all'); setDateFrom(''); setDateTo(''); }} className="btn-ghost text-sm">{t('billing:paymentsPage.reset')}</button></div>
              )}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>{t('billing:paymentsPage.refNo')}</th><th>{t('billing:paymentsPage.patient')}</th><th>{t('billing:paymentsPage.type')}</th><th>{t('billing:paymentsPage.method')}</th>
                <th className="text-right">{t('billing:paymentsPage.amount')}</th><th>{t('billing:paymentsPage.status')}</th><th>{t('billing:paymentsPage.dateTime')}</th><th>{t('billing:paymentsPage.actions')}</th>
              </tr></thead>
              <tbody>
                {loading
                  ? [...Array(6)].map((_,i) => <tr key={i}>{[...Array(8)].map((_,j) => <td key={j}><div className="skeleton h-4 w-full rounded"/></td>)}</tr>)
                  : payments.length===0
                  ? <tr><td colSpan={8}><EmptyState icon={<CreditCard className="w-8 h-8 text-[var(--color-text-muted)]"/>} title={t('billing:paymentsPage.noPayments')} description={t('billing:paymentsPage.noPaymentsDesc')}/></td></tr>
                  : payments.map(p => (
                      <tr key={p.id}>
                        <td className="font-data font-medium">{p.payment_ref}</td>
                        <td><div className="font-medium">{p.patient_name}</div><div className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</div></td>
                        <td className="text-sm capitalize">{p.payment_type.replace('_',' ')}</td>
                        <td><span className={`badge ${METHOD_BADGE[p.payment_method]??'badge-info'}`}>{METHOD_LABELS[p.payment_method]??p.payment_method}</span></td>
                        <td className="text-right font-semibold">{fmtTaka(p.amount, i18n.language)}</td>
                        <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{t(`billing:${p.status}`)}</span></td>
                        <td className="font-data text-sm">{fmtDT(p.paid_at??p.created_at, i18n.language)}</td>
                        <td><button onClick={() => openDetail(p.id)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Eye className="w-4 h-4"/></button></td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(selectedPayment||detailLoading) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('billing:paymentsPage.paymentDetail')}</h3>
              <button onClick={() => setSelectedPayment(null)} className="btn-ghost p-1.5"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-5">
              {detailLoading
                ? <div className="space-y-3">{[...Array(5)].map((_,i) => <div key={i} className="skeleton h-8 rounded-lg"/>)}</div>
                : selectedPayment && (
                    <dl className="space-y-3">
                      {[
                        {label: t('billing:paymentsPage.reference'),    value: selectedPayment.payment_ref},
                        {label: t('billing:paymentsPage.patient'),      value: `${selectedPayment.patient_name} (${selectedPayment.patient_code})`},
                        {label: t('billing:paymentsPage.amount'),       value: <span className="font-bold text-lg">{fmtTaka(selectedPayment.amount, i18n.language)}</span>},
                        {label: t('billing:paymentsPage.method'),       value: <span className={`badge ${METHOD_BADGE[selectedPayment.payment_method] ?? 'badge-info'}`}>{METHOD_LABELS[selectedPayment.payment_method] ?? selectedPayment.payment_method}</span>},
                        {label: t('billing:paymentsPage.status'),       value: <span className={`badge ${STATUS_BADGE[selectedPayment.status]}`}>{t(`billing:${selectedPayment.status}`)}</span>},
                        {label: t('billing:paymentsPage.gatewayRef'),  value: selectedPayment.gateway_ref??'—'},
                        {label: t('billing:paymentsPage.collectedBy'), value: selectedPayment.collected_by??'—'},
                        {label: t('billing:paymentsPage.dateTime'),    value: fmtDT(selectedPayment.paid_at??selectedPayment.created_at, i18n.language)},
                        {label: t('billing:paymentsPage.notes'),        value: selectedPayment.notes??'—'},
                      ].map(row => (
                        <div key={row.label} className="flex justify-between items-start">
                          <dt className="text-sm text-[var(--color-text-secondary)] shrink-0 w-28">{row.label}</dt>
                          <dd className="text-sm font-medium text-right flex-1">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )
              }
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
