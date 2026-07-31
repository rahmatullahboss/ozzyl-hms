import { useState, useEffect, useMemo} from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Download, Filter, Search, RefreshCw, Info } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  entity: string;
  entity_id: string | number | null;
  details?: string;
  created_at: string;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  insert: 'bg-emerald-100 text-emerald-700',
  upsert: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  login:  'bg-gray-100 text-gray-600',
  logout: 'bg-gray-100 text-gray-600',
};

const ENTITY_OPTIONS = ['All', 'patient', 'billing', 'prescription', 'admission', 'lab_order', 'pharmacy', 'staff', 'discharge_summary', 'doctor_schedule', 'settings'];
const ACTION_OPTIONS = ['All', 'create', 'update', 'delete', 'upsert', 'login', 'logout'];

function fmtTime(d: string): string {
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SystemAuditLog({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('common');

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');

  useEffect(() => {
    // Load from existing audit_log table
    setLoading(true);
    axios.get('/api/audit/logs', { headers: authHeaders() })
      .then(r => setLogs(r.data.logs ?? []))
      .catch(() => {
        // Demo data fallback
        setLogs([
          { id: 1, user_id: 1, user_name: 'Dr. Aminur Rahman', action: 'update', entity: 'prescription', entity_id: 'RX-00023', details: 'Changed dose for Amoxicillin 500mg', created_at: new Date(Date.now() - 300000).toISOString() },
          { id: 2, user_id: 2, user_name: 'Nurse Ayesha', action: 'create', entity: 'patient_vitals', entity_id: 'V-1004', details: 'BP: 120/80, Temp: 98.6°F', created_at: new Date(Date.now() - 900000).toISOString() },
          { id: 3, user_id: 3, user_name: 'Admin Karim', action: 'delete', entity: 'billing', entity_id: 'INV-5522', details: 'Cancelled bill ৳2,500', created_at: new Date(Date.now() - 1800000).toISOString() },
          { id: 4, user_id: 4, user_name: 'Reception Fatima', action: 'create', entity: 'patient', entity_id: 'P-00045', details: 'New patient: Rafiqul Islam', created_at: new Date(Date.now() - 2700000).toISOString() },
          { id: 5, user_id: 1, user_name: 'Dr. Nasreen', action: 'update', entity: 'admission', entity_id: 'ADM-0012', details: 'Discharge processed — status changed to discharged', created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: 6, user_id: null, user_name: 'System', action: 'create', entity: 'notification', entity_id: null, details: 'Scheduled backup complete', created_at: new Date(Date.now() - 5400000).toISOString() },
          { id: 7, user_id: 2, user_name: 'Dr. Rahman', action: 'create', entity: 'prescription', entity_id: 'RX-00024', details: 'New prescription for Mohammad Karim', created_at: new Date(Date.now() - 7200000).toISOString() },
          { id: 8, user_id: 3, user_name: 'Pharmacist Jubayer', action: 'update', entity: 'pharmacy', entity_id: 'DSP-0019', details: 'Dispensed 3 items', created_at: new Date(Date.now() - 9000000).toISOString() },
          { id: 9, user_id: 4, user_name: 'Lab Tech Ripon', action: 'update', entity: 'lab_order', entity_id: 'LAB-00045', details: 'Results entered: CBC complete', created_at: new Date(Date.now() - 10800000).toISOString() },
          { id: 10, user_id: 1, user_name: 'Admin Karim', action: 'upsert', entity: 'discharge_summary', entity_id: 'ADM-0012', details: 'status=final', created_at: new Date(Date.now() - 12600000).toISOString() },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let data = logs;
    if (actionFilter !== 'All') data = data.filter(l => l.action === actionFilter);
    if (entityFilter !== 'All') data = data.filter(l => l.entity === entityFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter(l =>
        (l.user_name ?? '').toLowerCase().includes(q) ||
        (l.details ?? '').toLowerCase().includes(q) ||
        (l.entity_id?.toString() ?? '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [logs, actionFilter, entityFilter, searchQuery]);

  // Stats
  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach(l => { counts[l.action] = (counts[l.action] || 0) + 1; });
    return counts;
  }, [logs]);

  const totalToday = logs.filter(l => {
    const d = new Date(l.created_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">Audit Log</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('auditLog', { defaultValue: 'System Audit Log' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Track all system changes and user activity</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters(f => !f)} className="btn-secondary flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filters
            </button>
            <button className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>{totalToday}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Actions Today</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>{logs.length}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Total Records</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{actionCounts['create'] || actionCounts['upsert'] || 0}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Creates</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{actionCounts['delete'] || 0}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Deletes</p>
          </div>
        </div>

        {/* Filter Bar */}
        {showFilters && (
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Action</label>
              <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ACTION_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'All Actions' : o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Entity</label>
              <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ENTITY_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'All Entities' : o.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder={t("common.search_by_user_detail_or_entity_id")}
                className="w-full pl-9 pr-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
            </div>
            <button onClick={() => { setActionFilter('All'); setEntityFilter('All'); setSearchQuery(''); }}
              className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
          </div>
        )}

        {/* Audit Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="animate-pulse h-64 bg-gray-50" />
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No audit records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                    <th className="text-left px-4 py-3">Timestamp</th>
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Action</th>
                    <th className="text-left px-4 py-3">Entity</th>
                    <th className="text-left px-4 py-3">Entity ID</th>
                    <th className="text-left px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry, i) => (
                    <tr key={entry.id} className={`border-b border-[var(--color-border)] hover:bg-[var(--color-bg)] transition ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtTime(entry.created_at)}</td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{entry.user_name ?? `User #${entry.user_id}`}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700'}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 capitalize text-[var(--color-text-muted)]">{entry.entity.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 font-mono text-xs">{entry.entity_id ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] max-w-[300px] truncate">{entry.details ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
            Showing {filtered.length} of {logs.length} records
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
