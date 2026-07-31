import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  table_name: string;
  record_id: number;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  created_at: string;
  user_name: string;
}

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'badge-success', UPDATE: 'badge-info', DELETE: 'badge-danger',
  APPROVE: 'badge-primary', REJECT: 'badge-warning',
};

export default function AuditLogs({ role = 'md' }: { role?: string }) {
  const [logs, setLogs]             = useState<AuditLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filters, setFilters]       = useState({ userId: '', tableName: '', startDate: '', endDate: '' });
  const [selectedLog, setSelected]  = useState<AuditLog | null>(null);
  const { t } = useTranslation(['accounting', 'common']);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params = new URLSearchParams();
      if (filters.userId)     params.append('userId',     filters.userId);
      if (filters.tableName)  params.append('tableName',  filters.tableName);
      if (filters.startDate)  params.append('startDate',  filters.startDate);
      if (filters.endDate)    params.append('endDate',    filters.endDate);
      const res = await axios.get(`/api/audit?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setLogs(res.data.auditLogs || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, [filters]); // eslint-disable-line

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">{t('auditLogs', { ns: 'accounting' })}</h1>
        </div>

        {/* ── Filters ── */}
        <div className="card p-4 flex flex-wrap gap-3">
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="input w-40 text-sm" />
          <input type="date" value={filters.endDate}   onChange={e => setFilters({...filters, endDate:   e.target.value})} className="input w-40 text-sm" />
          <select value={filters.tableName} onChange={e => setFilters({...filters, tableName: e.target.value})} className="input w-44 text-sm">
            <option value="">{t('all', { ns: 'common' })}</option>
            <option value="income">Income</option>
            <option value="expenses">Expenses</option>
            <option value="chart_of_accounts">Chart of Accounts</option>
            <option value="journal_entries">Journal Entries</option>
            <option value="profit_distributions">Profit Distributions</option>
          </select>
          <button onClick={fetchLogs} className="btn-secondary text-sm">{t('filter', { ns: 'common' })}</button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date', { ns: 'accounting' })}</th><th>{t('user', { ns: 'accounting' })}</th><th>{t('action', { ns: 'accounting' })}</th><th>{t('tableName', { ns: 'accounting' })}</th><th>{t('recordId', { ns: 'accounting' })}</th><th>{t('view', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : logs.length === 0 ? (
                  <tr><td colSpan={6} className="py-14 text-center text-[var(--color-text-muted)]">{t('noData', { ns: 'common' })}</td></tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="cursor-pointer" onClick={() => setSelected(log)}>
                      <td className="font-data text-xs">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="font-medium text-sm">{log.user_name || `User #${log.user_id}`}</td>
                      <td><span className={`badge ${ACTION_BADGE[log.action] ?? 'badge-secondary'}`}>{log.action}</span></td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{log.table_name}</td>
                      <td className="font-data text-sm text-[var(--color-text-muted)]">#{log.record_id}</td>
                      <td className="text-sm text-[var(--color-primary)] hover:underline cursor-pointer">{t('view', { ns: 'common' })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Detail Modal ── */}
        {selectedLog && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('auditLogs', { ns: 'accounting' })} - {t('details', { ns: 'common' })}</h3>
                <button onClick={() => setSelected(null)} className="btn-ghost p-1.5"><X className="w-5 h-5"/></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Date',      new Date(selectedLog.created_at).toLocaleString()],
                    ['User',      selectedLog.user_name || `User #${selectedLog.user_id}`],
                    ['Table',     selectedLog.table_name],
                    ['Record ID', `#${selectedLog.record_id}`],
                    ['IP',        selectedLog.ip_address || 'N/A'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[var(--color-text-muted)] text-xs mb-0.5">{label}</p>
                      <p className="font-medium">{value}</p>
                    </div>
                  ))}
                  <div>
                    <p className="text-[var(--color-text-muted)] text-xs mb-0.5">Action</p>
                    <span className={`badge ${ACTION_BADGE[selectedLog.action] ?? 'badge-secondary'}`}>{selectedLog.action}</span>
                  </div>
                </div>
                {selectedLog.old_value && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">Old Value</p>
                    <pre className="bg-[var(--color-surface)] p-3 rounded-lg text-xs overflow-x-auto text-[var(--color-text-secondary)]">
                      {JSON.stringify(JSON.parse(selectedLog.old_value), null, 2)}
                    </pre>
                  </div>
                )}
                {selectedLog.new_value && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">New Value</p>
                    <pre className="bg-[var(--color-surface)] p-3 rounded-lg text-xs overflow-x-auto text-[var(--color-text-secondary)]">
                      {JSON.stringify(JSON.parse(selectedLog.new_value), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
