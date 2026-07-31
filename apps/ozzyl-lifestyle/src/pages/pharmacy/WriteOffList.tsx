import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface WriteOff { id: number; writeoff_no: string; writeoff_date: string; reason: string; total_amount: number; approved_by?: string; is_active: number; }

export default function WriteOffList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [records, setRecords] = useState<WriteOff[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/write-offs', { headers: { Authorization: `Bearer ${token}` } });
      setRecords(data.writeOffs ?? []);
    } catch { setRecords([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('writeOffs', { defaultValue: 'Stock Write-Offs' })}</h1><p className="section-subtitle mt-1">Expired/damaged stock disposal records</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Write-Off #</th><th>Date</th><th>Reason</th><th className="text-right">Amount ৳</th><th>Approved By</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No write-offs</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.writeoff_no}</td>
                    <td>{new Date(r.writeoff_date).toLocaleDateString()}</td>
                    <td>{r.reason}</td>
                    <td className="text-right font-data">৳{((r.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td>{r.approved_by || '—'}</td>
                    <td><span className={`badge ${r.is_active ? 'badge-info' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Void'}</span></td>
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
