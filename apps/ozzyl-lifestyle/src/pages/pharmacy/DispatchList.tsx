import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Dispatch { id: number; dispatch_no: string; dispatch_date: string; source_store?: string; target_store?: string; received_by?: string; is_active: number; }

export default function DispatchList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [records, setRecords] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/dispatches', { headers: { Authorization: `Bearer ${token}` } });
      setRecords(data.dispatches ?? []);
    } catch { setRecords([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('dispatches', { defaultValue: 'Stock Dispatches' })}</h1><p className="section-subtitle mt-1">Inter-store dispatch records</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Dispatch #</th><th>Date</th><th>From</th><th>To</th><th>Received By</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No dispatches</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.dispatch_no}</td>
                    <td>{new Date(r.dispatch_date).toLocaleDateString()}</td>
                    <td>{r.source_store || '—'}</td>
                    <td>{r.target_store || '—'}</td>
                    <td>{r.received_by || '—'}</td>
                    <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Void'}</span></td>
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
