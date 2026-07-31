import { useState, useEffect, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Deposit {
  id: number; deposit_no: string; created_at: string;
  patient_id: number; deposit_type: string; amount: number;
  payment_mode: string; remarks?: string; is_active: number;
}

export default function DepositList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    patientId: '', amount: '', paymentMode: 'cash', remarks: '',
  });

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/deposits', { headers: { Authorization: `Bearer ${token}` } });
      setDeposits(data.deposits ?? []);
    } catch { setDeposits([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDeposits(); }, [fetchDeposits]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientId) { toast.error(t('patientIdRequired', { defaultValue: 'Patient ID is required' })); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      // Schema expects patientId (required positive int), amount (positive int paisa)
      await axios.post('/api/pharmacy/deposits', {
        patientId: parseInt(form.patientId),
        amount: Math.round(parseFloat(form.amount) * 100),
        paymentMode: form.paymentMode as 'cash' | 'card' | 'mobile',
        remarks: form.remarks || undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('depositRecorded', { defaultValue: 'Deposit recorded' }));
      setShowModal(false); fetchDeposits();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to record deposit';
      toast.error(msg || t('pharmacy.operationFailed'));
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('deposits', { defaultValue: 'Patient Deposits' })}</h1></div>
          <button onClick={() => { setForm({ patientId: '', amount: '', paymentMode: 'cash', remarks: '' }); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('addDeposit', { defaultValue: 'Add Deposit' })}
          </button>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>{t('depositNo', { defaultValue: 'Deposit #' })}</th>
                <th>{t('date', { defaultValue: 'Date' })}</th>
                <th>{t('patientId', { defaultValue: 'Patient ID' })}</th>
                <th>{t('type', { defaultValue: 'Type' })}</th>
                <th className="text-right">{t('amount', { defaultValue: 'Amount ৳' })}</th>
                <th>{t('paymentMode', { defaultValue: 'Mode' })}</th>
              </tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : deposits.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">{t('noDeposits', { defaultValue: 'No deposits' })}</td></tr>)
                : deposits.map(d => (
                  <tr key={d.id}>
                    <td className="font-mono text-sm font-medium">{d.deposit_no}</td>
                    <td>{d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">#{d.patient_id}</td>
                    <td><span className={`badge ${d.deposit_type === 'deposit' ? 'badge-success' : 'badge-warning'}`}>{d.deposit_type}</span></td>
                    <td className="text-right font-data">
                      <span className={d.deposit_type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}>
                        {d.deposit_type === 'return' ? '-' : ''}৳{((d.amount ?? 0) / 100).toLocaleString()}
                      </span>
                    </td>
                    <td><span className="badge badge-info capitalize">{d.payment_mode}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('recordDeposit', { defaultValue: 'Record Deposit' })}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('patientId', { defaultValue: 'Patient ID' })} *</label><input className="input" type="number" required min="1" value={form.patientId} onChange={e => setForm({...form, patientId: e.target.value})} placeholder="e.g. 101" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('amount', { defaultValue: 'Amount ৳' })} *</label><input className="input" type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} /></div>
                  <div><label className="label">{t('paymentMode', { defaultValue: 'Payment Mode' })}</label><select className="input" value={form.paymentMode} onChange={e => setForm({...form, paymentMode: e.target.value})}>{['cash', 'card', 'mobile'].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                </div>
                <div><label className="label">{t('remarks', { defaultValue: 'Remarks' })}</label><input className="input" value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? '…' : t('record', { defaultValue: 'Record' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
