import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Prescription { id: number; prescription_no: string; prescription_date: string; patient_name?: string; doctor_name?: string; status: string; is_active: number; }

function statusBadge(s: string) {
  const m: Record<string, string> = { pending: 'badge-warning', dispensed: 'badge-success', cancelled: 'badge-danger', partial: 'badge-info' };
  return m[s] ?? 'badge-secondary';
}

export default function PrescriptionList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [items, setItems] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/prescriptions', { headers: { Authorization: `Bearer ${token}` } });
      setItems(data.prescriptions ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const dispense = async (id: number) => {
    try {
      const token = localStorage.getItem('hms_token');
      await axios.put(`/api/pharmacy/prescriptions/${id}/dispense`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('pharmacy.prescription_marked_as_dispensed')); fetch();
    } catch { toast.error(t('pharmacy.failed_to_dispense')); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('prescriptions', { defaultValue: 'Prescriptions' })}</h1></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Rx #</th><th>Date</th><th>Patient</th><th>Doctor</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? ([...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : items.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No prescriptions</td></tr>)
                : items.map(p => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm font-medium">{p.prescription_no}</td>
                    <td>{new Date(p.prescription_date).toLocaleDateString()}</td>
                    <td>{p.patient_name || '—'}</td>
                    <td>{p.doctor_name || '—'}</td>
                    <td><span className={`badge ${statusBadge(p.status)}`}>{p.status}</span></td>
                    <td>{p.status === 'pending' && (
                      <button onClick={() => dispense(p.id)} className="btn-secondary text-xs py-1 px-2">Dispense</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
