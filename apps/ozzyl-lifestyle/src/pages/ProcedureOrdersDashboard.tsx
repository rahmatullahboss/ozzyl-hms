import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Stethoscope, Plus, X, Search, Activity, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface ProcedureOrder {
  ProcedureOrderId: number;
  PatientId: number;
  EncounterId: number;
  ProviderId: number;
  DateOrdered: string;
  OrderPriority: string;
  OrderStatus: string;
  ProcedureOrderType: string;
  OrderDiagnosis: string;
}

export default function ProcedureOrdersDashboard({ role }: { role?: string }) {
  const { t } = useTranslation('ot');
  const [orders, setOrders] = useState<ProcedureOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOrder, setNewOrder] = useState({
    PatientId: '',
    EncounterId: '1',
    ProviderId: '1',
    ProcedureOrderType: 'laboratory_test',
    OrderPriority: 'routine',
    OrderDiagnosis: '',
    ProcedureCode: '',
    ProcedureName: '',
  });

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/procedure-orders?limit=100`, { headers: authHeaders() });
      setOrders(res.data?.Results ?? []);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to load procedure orders');
      } else {
        toast.error(t('ot.failed_to_load_procedure_orders'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.PatientId || !newOrder.ProcedureCode) return toast.error(t('ot.please_fill_required_fields'));
    
    setSaving(true);
    try {
      const postData = {
        PatientId: Number(newOrder.PatientId),
        EncounterId: Number(newOrder.EncounterId),
        ProviderId: Number(newOrder.ProviderId),
        DateOrdered: new Date().toISOString(),
        OrderPriority: newOrder.OrderPriority,
        ProcedureOrderType: newOrder.ProcedureOrderType,
        OrderDiagnosis: newOrder.OrderDiagnosis,
        ProcedureCodes: [{
          ProcedureCode: newOrder.ProcedureCode,
          ProcedureName: newOrder.ProcedureName,
        }]
      };

      await axios.post('/api/procedure-orders', postData, { headers: authHeaders() });
      
      toast.success(t('ot.procedure_order_created_successfully'));
      setShowModal(false);
      setNewOrder({ ...newOrder, ProcedureCode: '', ProcedureName: '', OrderDiagnosis: '' });
      loadOrders();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to create order');
      } else {
        toast.error(t('ot.failed_to_create_order'));
      }
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'complete': return 'bg-emerald-100 text-emerald-700';
      case 'canceled': return 'bg-red-100 text-red-700';
      case 'routed': return 'bg-blue-100 text-blue-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getTypeBadge = (type: string) => {
    switch(type) {
      case 'laboratory_test': return 'bg-indigo-100 text-indigo-700';
      case 'radiology': return 'bg-purple-100 text-purple-700';
      case 'cardiology': return 'bg-rose-100 text-rose-700';
      case 'referral': return 'bg-teal-100 text-teal-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Procedure Orders</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Manage lab, imaging, and external referrals</p>
            </div>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Order
          </button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
             <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
          ) : orders.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium mb-4">No procedure orders found.</p>
              <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create First Order
              </button>
            </div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Patient ID</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.ProcedureOrderId}>
                    <td className="font-mono text-xs text-[var(--color-text-muted)]">#{o.ProcedureOrderId}</td>
                    <td className="font-data">{new Date(o.DateOrdered).toLocaleDateString()}</td>
                    <td className="font-semibold">PT-{o.PatientId}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getTypeBadge(o.ProcedureOrderType)}`}>
                        {o.ProcedureOrderType.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`text-xs font-semibold ${o.OrderPriority === 'stat' || o.OrderPriority === 'urgent' ? 'text-red-600' : 'text-[var(--color-text-muted)]'}`}>
                        {o.OrderPriority.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusBadge(o.OrderStatus || 'pending')}`}>
                        {(o.OrderStatus || 'pending').toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <button className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-xl w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">Create Procedure Order</h3>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveOrder} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('ot.patient_id')}</label>
                  <input
                    required
                    type="number"
                    className="input w-full"
                    placeholder={t("ot.pageNumberExample")}
                    value={newOrder.PatientId}
                    onChange={e => setNewOrder(p => ({...p, PatientId: e.target.value}))}
                  />
                </div>
                <div>
                  <label className="label">{t('ot.provider_id')}</label>
                  <input
                    required
                    type="number"
                    className="input w-full"
                    value={newOrder.ProviderId}
                    onChange={e => setNewOrder(p => ({...p, ProviderId: e.target.value}))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('ot.order_type')}</label>
                  <select 
                    className="input w-full"
                    value={newOrder.ProcedureOrderType}
                    onChange={e => setNewOrder(p => ({...p, ProcedureOrderType: e.target.value}))}
                  >
                    <option value="laboratory_test">Laboratory Test</option>
                    <option value="radiology">Radiology</option>
                    <option value="cardiology">Cardiology</option>
                    <option value="referral">Referral</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('ot.priority')}</label>
                  <select 
                    className="input w-full"
                    value={newOrder.OrderPriority}
                    onChange={e => setNewOrder(p => ({...p, OrderPriority: e.target.value}))}
                  >
                    <option value="routine">Routine</option>
                    <option value="stat">STAT</option>
                    <option value="urgent">Urgent</option>
                    <option value="asap">ASAP</option>
                  </select>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="label">{t('ot.procedure_code')}</label>
                  <input
                    required
                    className="input w-full"
                    placeholder={t("ot.cptcode")}
                    value={newOrder.ProcedureCode}
                    onChange={e => setNewOrder(p => ({...p, ProcedureCode: e.target.value}))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">{t('ot.procedure_name')}</label>
                  <input
                    required
                    className="input w-full"
                    placeholder={t("ot.eg_complete_blood_count")}
                    value={newOrder.ProcedureName}
                    onChange={e => setNewOrder(p => ({...p, ProcedureName: e.target.value}))}
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('ot.clinical_diagnosis_indication')}</label>
                <input
                  className="input w-full"
                  placeholder={t("ot.reason_for_order")}
                  value={newOrder.OrderDiagnosis}
                  onChange={e => setNewOrder(p => ({...p, OrderDiagnosis: e.target.value}))}
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? 'Creating...' : 'Create Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
