import { useState, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router';
import {
  Search, Package, CheckCircle2, Clock, AlertCircle,
  Eye, Pill, X, ChevronRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrescriptionRow {
  id: number;
  rx_no: string;
  patient_name: string;
  patient_code: string;
  doctor_name?: string;
  status: string;
  fulfilment_status: string; // 'pending' | 'dispensed' | 'partial'
  created_at: string;
  item_count: number;
}

interface PrescriptionsResponse {
  prescriptions: Record<string, unknown>[];
}

interface PrescriptionDetailResponse {
  items: Record<string, unknown>[];
}

interface RxItem {
  id: number;
  medicine_name: string;
  dosage: string;
  duration: string;
  quantity: number;
  dispensed_qty: number;
  medicine_id?: number;
}

type CounterPaymentMethod = '' | 'cash' | 'card' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'bank_transfer' | 'cheque' | 'other';

const COUNTER_PAYMENT_METHODS: Array<{ value: Exclude<CounterPaymentMethod, ''>; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'bank', label: 'Bank' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function MedicineDispensing() {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { slug } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const queryClient = useQueryClient();

  const [filter,  setFilter]  = useState<string>('all');
  const [search,  setSearch]  = useState('');

  // Modal
  const [selectedRx,  setSelectedRx]  = useState<PrescriptionRow | null>(null);
  const [rxItems,     setRxItems]     = useState<RxItem[]>([]);
  const [dispenseQtys, setDispenseQtys] = useState<Record<number, number>>({});
  const [dispensing,   setDispensing]   = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<CounterPaymentMethod>('');
  const dispenseAttemptKeyRef = useRef<string | null>(null);

  // Load prescriptions with final status (ones ready for dispensing)
  const { data: prescriptions = [], isLoading: loading } = useApiQuery<PrescriptionRow[]>(
    queryKeys.prescriptions.list({ status: 'final' }),
    '/api/prescriptions?status=final',
    {
      select: (raw: unknown) => {
        const res = raw as PrescriptionsResponse;
        return (res.prescriptions ?? []).map((rx: Record<string, unknown>) => ({
          id: rx.id as number,
          rx_no: rx.rx_no as string,
          patient_name: (rx.patient_name as string) ?? 'Unknown',
          patient_code: (rx.patient_code as string) ?? '',
          doctor_name: (rx.doctor_name as string) ?? '',
          status: rx.status as string,
          fulfilment_status: (rx.fulfilment_status as string) ?? 'pending',
          created_at: rx.created_at as string,
          item_count: Number(rx.item_count ?? 0),
        }));
      },
    },
  );

  // Filter
  const filtered = useMemo(() => prescriptions.filter(rx => {
    if (filter !== 'all' && rx.fulfilment_status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return rx.rx_no.toLowerCase().includes(q) ||
             rx.patient_name.toLowerCase().includes(q) ||
             rx.patient_code.toLowerCase().includes(q);
    }
    return true;
  }), [prescriptions, filter, search]);

  // KPIs
  const kpi = useMemo(() => ({
    total:     prescriptions.length,
    pending:   prescriptions.filter(r => r.fulfilment_status === 'pending').length,
    dispensed: prescriptions.filter(r => r.fulfilment_status === 'dispensed').length,
    partial:   prescriptions.filter(r => r.fulfilment_status === 'partial').length,
  }), [prescriptions]);

  // Open detail modal
  const openRx = async (rx: PrescriptionRow) => {
    setSelectedRx(rx);
    setPaymentMethod('');
    dispenseAttemptKeyRef.current = null;
    try {
      const res = await api.get<PrescriptionDetailResponse>(`/api/prescriptions/${rx.id}`);
      const items: RxItem[] = (res.items ?? []).map((i: Record<string, unknown>) => ({
        id: i.id as number,
        medicine_name: i.medicine_name as string,
        dosage: (i.dosage as string) ?? '',
        duration: (i.duration as string) ?? '',
        quantity: Number(i.quantity ?? 0),
        dispensed_qty: Number(i.dispensed_qty ?? 0),
        medicine_id: i.medicine_id ? Number(i.medicine_id) : undefined,
      }));
      setRxItems(items);
      const qtys: Record<number, number> = {};
      items.forEach(i => {
        qtys[i.id] = Math.max(0, i.quantity - i.dispensed_qty);
      });
      setDispenseQtys(qtys);
    } catch {
      toast.error(t('pharmacy.failed_to_load_prescription_items'));
    }
  };

  // Dispense action
  const handleDispense = async () => {
    if (!selectedRx) return;
    setDispensing(true);
    try {
      if (!paymentMethod) {
        toast.error('Select how payment was received before dispensing.');
        return;
      }
      const selectedItems = rxItems.filter((item) => (dispenseQtys[item.id] ?? 0) > 0);
      if (selectedItems.some((item) => !item.medicine_id)) {
        toast.error('Only medicines linked to hospital stock can be dispensed here.');
        return;
      }

      const saleItems: { prescriptionItemId: number; medicineId: number; quantity: number }[] = [];
      for (const item of rxItems) {
        const qty = dispenseQtys[item.id] ?? 0;
        if (!item.medicine_id || qty <= 0) continue;
        saleItems.push({
          prescriptionItemId: item.id,
          medicineId: item.medicine_id,
          quantity: qty,
        });
      }

      if (saleItems.length === 0) {
        toast.error(t('pharmacy.no_items_to_dispense'));
        setDispensing(false);
        return;
      }

      const idempotencyKey = dispenseAttemptKeyRef.current ?? crypto.randomUUID();
      dispenseAttemptKeyRef.current = idempotencyKey;
      await api.post(`/api/prescriptions/${selectedRx.id}/hospital-dispense`, {
        idempotencyKey,
        paymentMethod,
        items: saleItems,
      });

      toast.success(t('pharmacy.medicines_dispensed_successfully'));
      dispenseAttemptKeyRef.current = null;
      setSelectedRx(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
    } catch {
      toast.error(t('pharmacy.failed_to_dispense_check_stock_availability'));
    } finally {
      setDispensing(false);
    }
  };

  const STATUS_BADGE: Record<string, string> = {
    pending:   'bg-amber-100 text-amber-700',
    dispensed: 'bg-green-100 text-green-700',
    partial:   'bg-blue-100 text-blue-700',
  };

  const STATUS_ICON: Record<string, React.ReactNode> = {
    pending:   <Clock className="w-3.5 h-3.5" />,
    dispensed: <CheckCircle2 className="w-3.5 h-3.5" />,
    partial:   <AlertCircle className="w-3.5 h-3.5" />,
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/pharmacy`} className="hover:underline">Pharmacy</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)]">Dispensing</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <Pill className="w-5 h-5 text-[var(--color-primary)]" />
              Medicine Dispensing
            </h1>
          </div>
          <div className="text-sm text-[var(--color-text-muted)]">
            {new Date().toLocaleDateString('en-BD', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Prescriptions', value: kpi.total, icon: Package, color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-primary)]/10' },
            { label: 'Pending', value: kpi.pending, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Dispensed', value: kpi.dispensed, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Partial', value: kpi.partial, icon: AlertCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
          ].map(k => (
            <div key={k.label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}>
                <k.icon className={`w-5 h-5 ${k.color}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--color-text)]">{k.value}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter + Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-[var(--color-bg-elevated)] rounded-lg p-0.5 border border-[var(--color-border)]">
            {['all', 'pending', 'dispensed', 'partial'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  filter === f
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}>
                {f}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text" placeholder={t("common.search_patient_rx")}
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-10 w-full text-sm"
            />
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">Loading prescriptions...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">
              <Pill className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No prescriptions found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg)]">
                <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-3 font-medium">Rx #</th>
                  <th className="text-left px-4 py-3 font-medium">Patient</th>
                  <th className="text-left px-4 py-3 font-medium">Doctor</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-center px-4 py-3 font-medium">Items</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map(rx => (
                  <tr key={rx.id} className="hover:bg-[var(--color-bg)] transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-[var(--color-primary)] font-medium">{rx.rx_no}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{rx.patient_name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{rx.patient_code}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{rx.doctor_name || '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">
                      {new Date(rx.created_at).toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                        {rx.item_count} item{rx.item_count !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 font-medium ${STATUS_BADGE[rx.fulfilment_status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_ICON[rx.fulfilment_status]}
                        {rx.fulfilment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => openRx(rx)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-[var(--color-text-muted)]"
                          title="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                        {rx.fulfilment_status !== 'dispensed' && (
                          <button onClick={() => openRx(rx)}
                            className="btn-primary text-xs">
                            Dispense
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* ── Dispense Modal ───────────────────────────────────── */}
      {selectedRx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4">

            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text)]">
                  Dispense — <span className="text-[var(--color-primary)]">{selectedRx.rx_no}</span>
                </h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {selectedRx.patient_name} · {selectedRx.patient_code}
                </p>
                <p className="mt-2 text-xs text-blue-700">
                  Hospital dispensing is optional. The patient may purchase prescribed medicines outside this hospital.
                </p>
              </div>
              <button onClick={() => setSelectedRx(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-[var(--color-text-muted)]" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-5">
              {rxItems.length === 0 ? (
                <p className="text-center text-[var(--color-text-muted)] py-6">No items in this prescription</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-bg)]">
                    <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                      <th className="text-left px-3 py-2 font-medium">{t('medicine', { defaultValue: 'Medicine' })}</th>
                      <th className="text-left px-3 py-2 font-medium">Dosage</th>
                      <th className="text-center px-3 py-2 font-medium">Qty Rx'd</th>
                      <th className="text-center px-3 py-2 font-medium">Already</th>
                      <th className="text-center px-3 py-2 font-medium w-28">Qty to Dispense</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {rxItems.map(item => {
                      const remaining = item.quantity - item.dispensed_qty;
                      return (
                        <tr key={item.id} className={remaining <= 0 ? 'opacity-50' : ''}>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-[var(--color-text)]">{item.medicine_name}</div>
                          </td>
                          <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{item.dosage} · {item.duration}</td>
                          <td className="px-3 py-2.5 text-center font-mono">{item.quantity}</td>
                          <td className="px-3 py-2.5 text-center font-mono text-green-600">{item.dispensed_qty}</td>
                          <td className="px-3 py-2.5 text-center">
                            {remaining > 0 && item.medicine_id ? (
                              <input
                                type="number" min={0} max={remaining}
                                value={dispenseQtys[item.id] ?? 0}
                                onChange={e => setDispenseQtys(prev => ({
                                  ...prev,
                                  [item.id]: Math.min(remaining, Math.max(0, Number(e.target.value))),
                                }))}
                                className="input text-center text-sm py-1 w-20 mx-auto"
                              />
                            ) : remaining <= 0 ? (
                              <span className="text-xs text-green-600 font-medium">✓ Done</span>
                            ) : (
                              <span className="text-xs text-amber-700 font-medium">Not mapped to stock</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-end justify-between gap-3 p-5 border-t border-[var(--color-border)]">
              <div>
                <label htmlFor="dispense-payment-method" className="block text-xs font-medium text-[var(--color-text)] mb-1">
                  Payment received by
                </label>
                <select
                  id="dispense-payment-method"
                  className="input min-w-44 text-sm"
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value as CounterPaymentMethod)}
                >
                  <option value="">Select payment method</option>
                  {COUNTER_PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Record dispensing only after receiving payment.</p>
              </div>
              <div className="flex items-center gap-3">
              <button onClick={() => setSelectedRx(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleDispense}
                disabled={dispensing || !paymentMethod || Object.values(dispenseQtys).every(q => q === 0)}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" />
                {dispensing ? 'Dispensing...' : 'Mark as Dispensed'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
