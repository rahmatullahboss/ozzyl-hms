import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import {
  Search, Package, CheckCircle2, Clock, AlertCircle,
  Eye, Pill, X, ChevronRight
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrescriptionRow {
  id: number;
  rx_no: string;
  patient_name: string;
  patient_code: string;
  doctor_name?: string;
  status: string;
  dispense_status: string; // 'pending' | 'dispensed' | 'partial'
  created_at: string;
  item_count: number;
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

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MedicineDispensing() {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { slug } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [filter,  setFilter]  = useState<string>('all');
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  // Modal
  const [selectedRx,  setSelectedRx]  = useState<PrescriptionRow | null>(null);
  const [rxItems,     setRxItems]     = useState<RxItem[]>([]);
  const [dispenseQtys, setDispenseQtys] = useState<Record<number, number>>({});
  const [dispensing,   setDispensing]   = useState(false);

  // Load prescriptions with final status (ones ready for dispensing)
  const loadPrescriptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/prescriptions?status=final', { headers: authHeaders() });
      const rows: PrescriptionRow[] = (res.data.prescriptions ?? []).map((rx: Record<string, unknown>) => ({
        id: rx.id,
        rx_no: rx.rx_no,
        patient_name: rx.patient_name ?? 'Unknown',
        patient_code: rx.patient_code ?? '',
        doctor_name: rx.doctor_name ?? '',
        status: rx.status,
        dispense_status: rx.dispense_status ?? 'pending',
        created_at: rx.created_at as string,
        item_count: Number(rx.item_count ?? 0),
      }));
      setPrescriptions(rows);
    } catch {
      toast.error(t('pharmacy.failed_to_load_prescriptions'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPrescriptions(); }, [loadPrescriptions]);

  // Filter
  const filtered = prescriptions.filter(rx => {
    if (filter !== 'all' && rx.dispense_status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return rx.rx_no.toLowerCase().includes(q) ||
             rx.patient_name.toLowerCase().includes(q) ||
             rx.patient_code.toLowerCase().includes(q);
    }
    return true;
  });

  // KPIs
  const kpi = {
    total:     prescriptions.length,
    pending:   prescriptions.filter(r => r.dispense_status === 'pending').length,
    dispensed: prescriptions.filter(r => r.dispense_status === 'dispensed').length,
    partial:   prescriptions.filter(r => r.dispense_status === 'partial').length,
  };

  // Open detail modal
  const openRx = async (rx: PrescriptionRow) => {
    setSelectedRx(rx);
    try {
      const res = await axios.get(`/api/prescriptions/${rx.id}`, { headers: authHeaders() });
      const items: RxItem[] = (res.data.items ?? []).map((i: Record<string, unknown>) => ({
        id: i.id,
        medicine_name: i.medicine_name,
        dosage: i.dosage ?? '',
        duration: i.duration ?? '',
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
      // Build sale items from dispense quantities
      const saleItems: { medicineId: number; quantity: number; unitPrice: number }[] = [];
      for (const item of rxItems) {
        const qty = dispenseQtys[item.id] ?? 0;
        if (!item.medicine_id || qty <= 0) continue;

        // Fetch actual sale price from pharmacy catalog
        try {
          const medRes = await axios.get(`/api/pharmacy/medicines`, { headers: authHeaders() });
          const med = (medRes.data.medicines ?? []).find((m: { id: number; price: number }) => m.id === item.medicine_id);
          saleItems.push({
            medicineId: item.medicine_id,
            quantity: qty,
            unitPrice: med?.price ?? 0,
          });
        } catch {
          saleItems.push({
            medicineId: item.medicine_id,
            quantity: qty,
            unitPrice: 0,
          });
        }
      }

      if (saleItems.length === 0) {
        toast.error(t('pharmacy.no_items_to_dispense'));
        setDispensing(false);
        return;
      }

      // Record sale (deducts stock via FEFO)
      await axios.post('/api/pharmacy/sales', { items: saleItems }, { headers: authHeaders() });

      // Update prescription dispense status
      await axios.put(`/api/prescriptions/${selectedRx.id}`, {
        dispense_status: saleItems.length === rxItems.length ? 'dispensed' : 'partial',
      }, { headers: authHeaders() });

      toast.success(t('pharmacy.medicines_dispensed_successfully'));
      setSelectedRx(null);
      loadPrescriptions();
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
                      <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 font-medium ${STATUS_BADGE[rx.dispense_status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_ICON[rx.dispense_status]}
                        {rx.dispense_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => openRx(rx)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-[var(--color-text-muted)]"
                          title="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                        {rx.dispense_status !== 'dispensed' && (
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
                            {remaining > 0 ? (
                              <input
                                type="number" min={0} max={remaining}
                                value={dispenseQtys[item.id] ?? 0}
                                onChange={e => setDispenseQtys(prev => ({
                                  ...prev,
                                  [item.id]: Math.min(remaining, Math.max(0, Number(e.target.value))),
                                }))}
                                className="input text-center text-sm py-1 w-20 mx-auto"
                              />
                            ) : (
                              <span className="text-xs text-green-600 font-medium">✓ Done</span>
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
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-border)]">
              <button onClick={() => setSelectedRx(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleDispense}
                disabled={dispensing || Object.values(dispenseQtys).every(q => q === 0)}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" />
                {dispensing ? 'Dispensing...' : 'Mark as Dispensed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
