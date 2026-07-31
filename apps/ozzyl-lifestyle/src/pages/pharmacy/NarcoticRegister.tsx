import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Narcotic { id: number; record_no: string; record_date: string; item_name?: string; batch_no?: string; quantity: number; issued_to?: string; purpose?: string; authorized_by?: string; is_active: number; }

export default function NarcoticRegister({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [records, setRecords] = useState<Narcotic[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/narcotics', { headers: { Authorization: `Bearer ${token}` } });
      setRecords(data.narcotics ?? []);
    } catch { setRecords([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('narcoticRegister', { defaultValue: 'Narcotic Register' })}</h1><p className="section-subtitle mt-1">Controlled substance logs</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Record #</th><th>Date</th><th>Item</th><th>Batch</th><th className="text-right">Qty</th><th>Issued To</th><th>Purpose</th><th>Authorized By</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">No narcotic records</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.record_no}</td>
                    <td>{new Date(r.record_date).toLocaleDateString()}</td>
                    <td>{r.item_name || '—'}</td>
                    <td className="font-mono text-xs">{r.batch_no || '—'}</td>
                    <td className="text-right font-data">{r.quantity}</td>
                    <td>{r.issued_to || '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{r.purpose || '—'}</td>
                    <td>{r.authorized_by || '—'}</td>
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
