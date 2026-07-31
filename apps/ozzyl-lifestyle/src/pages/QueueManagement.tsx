import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Ticket, Users, Clock, CheckCircle, XCircle, AlertTriangle,
  Plus, X, ArrowRight, Search, RefreshCw, Phone, ChevronRight,
  Play, Square, UserX, ArrowRightLeft,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

/* ─── Types ───────────────────────────────────────────────── */
interface Dept { id: number; name: string; }
interface TokenEntry {
  id: number; token_no: string; token_number: number;
  priority: 'normal' | 'urgent' | 'emergency' | 'vip';
  status: string; check_in_time: string; called_at: string | null;
  serve_start_time: string | null; serve_end_time: string | null;
  counter_no: string | null; estimated_wait_minutes: number | null;
  patient_id: number; patient_name: string; patient_code: string;
  gender: string | null; phone: string | null;
  department_name: string | null; doctor_name: string | null;
}
interface Stats {
  total: number; waiting: number; called: number; serving: number;
  completed: number; no_show: number; cancelled: number;
  nowServing: { token_no: string; counter_no: string | null; patient_name: string; doctor_name: string | null }[];
}
interface PatientResult { id: number; name: string; patient_code: string; }

/* ─── Constants ───────────────────────────────────────────── */
const PRIORITY_COLOR: Record<string, string> = {
  normal: 'bg-teal-100 text-teal-700 border-teal-200',
  urgent: 'bg-amber-100 text-amber-700 border-amber-200',
  emergency: 'bg-red-100 text-red-700 border-red-200',
  vip: 'bg-purple-100 text-purple-700 border-purple-200',
};
const STATUS_COLOR: Record<string, string> = {
  waiting: 'bg-gray-100 text-gray-600',
  called: 'bg-blue-100 text-blue-700',
  serving: 'bg-green-100 text-green-700',
  completed: 'bg-emerald-100 text-emerald-700',
  no_show: 'bg-red-100 text-red-600',
  cancelled: 'bg-gray-200 text-gray-500',
  transferred: 'bg-indigo-100 text-indigo-700',
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return iso.slice(11, 16); }
}

/* ─── Main ────────────────────────────────────────────────── */
export default function QueueManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['queue', 'common']);
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TokenEntry | null>(null);

  // Issue token form
  const [showIssue, setShowIssue] = useState(false);
  const [ptSearch, setPtSearch] = useState('');
  const [ptResults, setPtResults] = useState<PatientResult[]>([]);
  const [issuePt, setIssuePt] = useState<PatientResult | null>(null);
  const [issueDept, setIssueDept] = useState('');
  const [issuePriority, setIssuePriority] = useState<'normal' | 'urgent' | 'emergency' | 'vip'>('normal');
  const [issueCounter, setIssueCounter] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  // Transfer
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferDept, setTransferDept] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Call next
  const [callCounter, setCallCounter] = useState('');
  const [calling, setCalling] = useState(false);
  const [lastCalled, setLastCalled] = useState<{ tokenNo: string; patientName: string } | null>(null);

  const prevServingRef = useRef<string[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (filterDept) params.departmentId = filterDept;
      if (filterStatus) params.status = filterStatus;
      else params.status = 'all';

      const [tokRes, statRes] = await Promise.all([
        axios.get('/api/queue/tokens', { params, headers: authHeader() }),
        axios.get('/api/queue/tokens/stats', { headers: authHeader() }),
      ]);
      setTokens(tokRes.data?.Results ?? []);
      const newStats = statRes.data?.Results;
      setStats(newStats);

      // Flash/beep if new call
      const nowIds = (newStats?.nowServing ?? []).map((s: { token_no: string }) => s.token_no);
      const prevIds = prevServingRef.current;
      if (prevIds.length > 0 && nowIds.some((id: string) => !prevIds.includes(id))) {
        // New call detected
      }
      prevServingRef.current = nowIds;
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filterDept, filterStatus]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const iv = setInterval(fetchAll, 15000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    axios.get('/api/queue/departments', { headers: authHeader() })
      .then(({ data }) => setDepts(data.Results ?? []))
      .catch(() => {});
  }, []);

  // Patient search
  useEffect(() => {
    if (ptSearch.length < 2) { setPtResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(`/api/patients?search=${encodeURIComponent(ptSearch)}&limit=8`, { headers: authHeader() });
        setPtResults(data.patients ?? data.Results ?? []);
      } catch { /* silent */ }
    }, 300);
    return () => clearTimeout(t);
  }, [ptSearch]);

  const issueToken = async () => {
    if (!issuePt) { toast.error(t('selectPatient', { ns: 'queue', defaultValue: 'Select a patient' })); return; }
    setIssuing(true);
    try {
      const { data } = await axios.post('/api/queue/token', {
        patientId: issuePt.id,
        departmentId: issueDept ? Number(issueDept) : undefined,
        priority: issuePriority,
        counterNo: issueCounter || undefined,
      }, { headers: authHeader() });
      const tk = data.data?.tokenNo ?? 'T???';
      setIssuedToken(tk);
      toast.success(t('tokenIssued', { ns: 'queue', defaultValue: `Token ${tk} issued` }));
      setIssuePt(null); setPtSearch(''); setIssuePriority('normal'); setIssueCounter('');
      fetchAll();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? (err.response?.data?.message ?? 'Failed') : 'Failed');
    } finally { setIssuing(false); }
  };

  const callNext = async () => {
    setCalling(true);
    try {
      const { data } = await axios.post('/api/queue/call-next', {
        departmentId: filterDept ? Number(filterDept) : undefined,
        counterNo: callCounter || undefined,
      }, { headers: authHeader() });
      if (data.data) {
        setLastCalled({ tokenNo: data.data.tokenNo, patientName: data.data.patientName });
        toast.success(t('calledPatient', { ns: 'queue', defaultValue: `Called ${data.data.tokenNo} — ${data.data.patientName}` }));
      } else {
        toast(t('noPatientsWaiting', { ns: 'queue', defaultValue: 'No patients waiting' }));
      }
      fetchAll();
    } catch { toast.error(t('callNextFailed', { ns: 'queue', defaultValue: 'Failed to call next' })); }
    finally { setCalling(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await axios.put(`/api/queue/tokens/${id}/status`, { status }, { headers: authHeader() });
      toast.success(t('statusUpdated', { ns: 'queue', defaultValue: `Status → ${status}` }));
      setSelected(null);
      fetchAll();
    } catch { toast.error(t('updateStatusFailed', { ns: 'queue', defaultValue: 'Failed' })); }
  };

  const transferPatient = async () => {
    if (!selected || !transferDept) return;
    setTransferring(true);
    try {
      const { data } = await axios.post(`/api/queue/tokens/${selected.id}/transfer`, {
        toDepartmentId: Number(transferDept),
      }, { headers: authHeader() });
      toast.success(t('transferred', { ns: 'queue', defaultValue: `Transferred → ${data.data?.newTokenNo}` }));
      setShowTransfer(false); setSelected(null);
      fetchAll();
    } catch { toast.error(t('transferFailed', { ns: 'queue', defaultValue: 'Transfer failed' })); }
    finally { setTransferring(false); }
  };

  const waiting = tokens.filter(t => t.status === 'waiting');
  const active = tokens.filter(t => t.status === 'called' || t.status === 'serving');

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Ticket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">OPD Queue</h1>
              <p className="section-subtitle">{t('queueSubtitle', { ns: 'queue', defaultValue: 'Token management, patient flow & queue control' })}</p>
            </div>
          </div>
          <button onClick={fetchAll} className="btn-ghost"><RefreshCw className="w-4 h-4" /> {t('common.refresh', { defaultValue: 'Refresh' })}</button>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: t('total', { ns: 'queue', defaultValue: 'Total' }), val: stats?.total ?? 0, color: 'text-[var(--color-text)]' },
            { label: t('waiting', { ns: 'queue', defaultValue: 'Waiting' }), val: stats?.waiting ?? 0, color: 'text-amber-600' },
            { label: t('called', { ns: 'queue', defaultValue: 'Called' }), val: stats?.called ?? 0, color: 'text-blue-600' },
            { label: t('serving', { ns: 'queue', defaultValue: 'Serving' }), val: stats?.serving ?? 0, color: 'text-green-600' },
            { label: t('completed', { ns: 'queue', defaultValue: 'Completed' }), val: stats?.completed ?? 0, color: 'text-emerald-600' },
            { label: t('noShow', { ns: 'queue', defaultValue: 'No-Show' }), val: stats?.no_show ?? 0, color: 'text-red-500' },
          ].map(k => (
            <div key={k.label} className="card p-3 text-center">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.val}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">{t('department', { ns: 'queue', defaultValue: 'Department' })}</label>
            <select className="input w-44" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="">{t('allDepartments', { ns: 'queue', defaultValue: 'All Departments' })}</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('common.status')}</label>
            <select className="input w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Active</option>
              <option value="all">All</option>
              <option value="waiting">Waiting</option>
              <option value="called">Called</option>
              <option value="serving">Serving</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <input className="input w-28" placeholder={t('counterRoom', { ns: 'queue', defaultValue: 'Counter/Room' })} value={callCounter} onChange={e => setCallCounter(e.target.value)} />
            <button onClick={callNext} disabled={calling} className="btn-primary">
              {calling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
              {t('callNext', { ns: 'queue', defaultValue: 'Call Next' })}
            </button>
            <button onClick={() => { setShowIssue(true); setIssuedToken(null); }} className="btn-secondary">
              <Plus className="w-4 h-4" /> {t('issueToken', { ns: 'queue', defaultValue: 'Issue Token' })}
            </button>
          </div>
        </div>

        {/* 3-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* Left: Queue List */}
          <div className="lg:col-span-5 space-y-2">
            <h3 className="section-title">{t('queueList', { ns: 'queue', defaultValue: `Queue (${tokens.length})` })}</h3>
            {loading ? (
              <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('common.loading', { defaultValue: 'Loading...' })}</div>
            ) : tokens.length === 0 ? (
              <div className="card p-8 text-center">
                <Ticket className="w-8 h-8 mx-auto text-[var(--color-text-muted)] mb-2 opacity-40" />
                <p className="text-sm text-[var(--color-text-muted)]">{t('noTokensToday', { ns: 'queue', defaultValue: 'No tokens issued today' })}</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                {tokens.map(tk => (
                  <button
                    key={tk.id}
                    onClick={() => setSelected(tk)}
                    className={`card p-3 w-full text-left flex items-center gap-3 transition-all hover:shadow-md cursor-pointer ${
                      selected?.id === tk.id ? 'ring-2 ring-[var(--color-primary)]' : ''
                    }`}
                  >
                    <span className={`px-2.5 py-1 rounded-lg text-sm font-bold border ${PRIORITY_COLOR[tk.priority]}`}>
                      {tk.token_no}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tk.patient_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {tk.department_name ?? 'General'} {tk.doctor_name ? `· ${tk.doctor_name}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[tk.status] ?? 'bg-gray-100'}`}>
                        {tk.status}
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{fmtTime(tk.check_in_time)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Center: Now Serving */}
          <div className="lg:col-span-4">
            <h3 className="section-title mb-2">{t('nowServing', { ns: 'queue', defaultValue: 'Now Serving' })}</h3>
            {active.length === 0 ? (
              <div className="card p-12 text-center">
                <Clock className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-2 opacity-30" />
                <p className="text-sm text-[var(--color-text-muted)]">{t('noPatientServed', { ns: 'queue', defaultValue: 'No patient being served' })}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {active.map(tk => (
                  <div key={tk.id} className={`card p-5 border-l-4 ${tk.status === 'called' ? 'border-l-blue-500 animate-pulse' : 'border-l-green-500'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-3xl font-black text-[var(--color-primary)]">{tk.token_no}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[tk.status]}`}>{tk.status}</span>
                    </div>
                    <p className="text-lg font-semibold">{tk.patient_name}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {tk.counter_no && `${tk.counter_no} · `}{tk.doctor_name ?? 'Doctor'} · {tk.department_name ?? 'General'}
                    </p>
                    <div className="flex gap-2 mt-4">
                      {tk.status === 'called' && (
                        <button onClick={() => updateStatus(tk.id, 'serving')} className="btn-primary text-sm flex-1">
                          <Play className="w-3.5 h-3.5" /> Start Serving
                        </button>
                      )}
                      {(tk.status === 'called' || tk.status === 'serving') && (
                        <>
                          <button onClick={() => updateStatus(tk.id, 'completed')} className="btn-secondary text-sm flex-1">
                            <CheckCircle className="w-3.5 h-3.5" /> Complete
                          </button>
                          <button onClick={() => updateStatus(tk.id, 'no_show')} className="btn-ghost text-sm text-red-500">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Last called notification */}
            {lastCalled && (
              <div className="card p-4 mt-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                  Last Called: <span className="font-bold">{lastCalled.tokenNo}</span> — {lastCalled.patientName}
                </p>
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div className="lg:col-span-3 space-y-4">
            {/* Selected token actions */}
            {selected && (
              <div className="card p-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-[var(--color-primary)]" />
                  {selected.token_no} — {selected.patient_name}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selected.status === 'waiting' && (
                    <button onClick={() => updateStatus(selected.id, 'called')} className="btn-primary text-sm">
                      <Phone className="w-3.5 h-3.5" /> Call
                    </button>
                  )}
                  {(selected.status === 'waiting' || selected.status === 'called') && (
                    <button onClick={() => setShowTransfer(true)} className="btn-secondary text-sm">
                      <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
                    </button>
                  )}
                  {selected.status !== 'completed' && selected.status !== 'cancelled' && (
                    <button onClick={() => updateStatus(selected.id, 'cancelled')} className="btn-ghost text-sm text-red-500">
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </button>
                  )}
                </div>
                <div className="mt-3 text-xs text-[var(--color-text-muted)] space-y-1">
                  <p>Check-in: {fmtTime(selected.check_in_time)}</p>
                  {selected.called_at && <p>Called: {fmtTime(selected.called_at)}</p>}
                  {selected.serve_start_time && <p>Serving since: {fmtTime(selected.serve_start_time)}</p>}
                  {selected.estimated_wait_minutes != null && <p>Est. wait: {selected.estimated_wait_minutes} min</p>}
                </div>
              </div>
            )}

            {/* Waiting summary */}
            <div className="card p-4">
              <h4 className="text-sm font-semibold mb-2">Waiting ({waiting.length})</h4>
              {waiting.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">No patients waiting</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {waiting.slice(0, 15).map((tk) => (
                    <div key={tk.id} className="flex items-center gap-2 text-xs py-1 border-b border-[var(--color-border)] last:border-0">
                      <span className="font-bold w-10">{tk.token_no}</span>
                      <span className="flex-1 truncate">{tk.patient_name}</span>
                      {tk.priority !== 'normal' && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_COLOR[tk.priority]}`}>
                          {tk.priority}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Issue Token Modal */}
        {showIssue && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('issueTokenTitle', { ns: 'queue', defaultValue: 'Issue Token' })}</h3>
                <button onClick={() => setShowIssue(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                {issuedToken && (
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 rounded-lg p-4 text-center">
                    <p className="text-sm text-emerald-600 font-medium">{t('tokenIssuedLabel', { ns: 'queue', defaultValue: 'Token Issued' })}</p>
                    <p className="text-4xl font-black text-emerald-700 mt-1">{issuedToken}</p>
                  </div>
                )}
                <div className="relative">
                  <label className="label">{t('common.patient_')}</label>
                  <input
                    className="input w-full"
                    placeholder={t('searchPatient', { ns: 'queue', defaultValue: 'Search patient...' })}
                    value={issuePt ? `${issuePt.name} (${issuePt.patient_code})` : ptSearch}
                    onChange={e => { setPtSearch(e.target.value); setIssuePt(null); }}
                  />
                  {ptResults.length > 0 && !issuePt && (
                    <div className="absolute z-10 top-full left-0 right-0 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {ptResults.map(p => (
                        <button key={p.id} onClick={() => { setIssuePt(p); setPtResults([]); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">{t('common.department')}</label>
                  <select className="input w-full" value={issueDept} onChange={e => setIssueDept(e.target.value)}>
                    <option value="">General</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('common.priority')}</label>
                    <select className="input w-full" value={issuePriority} onChange={e => setIssuePriority(e.target.value as typeof issuePriority)}>
                      <option value="normal">{t('priority.normal', { ns: 'queue', defaultValue: 'Normal' })}</option>
                      <option value="urgent">{t('priority.urgent', { ns: 'queue', defaultValue: 'Urgent' })}</option>
                      <option value="emergency">{t('priority.emergency', { ns: 'queue', defaultValue: 'Emergency' })}</option>
                      <option value="vip">{t('priority.vip', { ns: 'queue', defaultValue: 'VIP' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('common.counterroom')}</label>
                    <input className="input w-full" value={issueCounter} onChange={e => setIssueCounter(e.target.value)} placeholder={t('counterRoomPlaceholder', { ns: 'queue', defaultValue: 'e.g. Room 3' })} />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowIssue(false)} className="btn-secondary">{t('common.close', { defaultValue: 'Close' })}</button>
                  <button onClick={issueToken} disabled={issuing || !issuePt} className="btn-primary">
                    {issuing ? t('issuing', { ns: 'queue', defaultValue: 'Issuing...' }) : t('issueTokenBtn', { ns: 'queue', defaultValue: 'Issue Token' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransfer && selected && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('transferTitle', { ns: 'queue', defaultValue: `Transfer ${selected.token_no}` })}</h3>
                <button onClick={() => setShowTransfer(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-[var(--color-text-muted)]">Transfer <strong>{selected.patient_name}</strong> to another department</p>
                <div>
                  <label className="label">{t('common.to_department_')}</label>
                  <select className="input w-full" value={transferDept} onChange={e => setTransferDept(e.target.value)}>
                    <option value="">Select...</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowTransfer(false)} className="btn-secondary">{t('common.cancel', { defaultValue: 'Cancel' })}</button>
                  <button onClick={transferPatient} disabled={transferring || !transferDept} className="btn-primary">
                    {transferring ? t('transferring', { ns: 'queue', defaultValue: 'Transferring...' }) : t('transferBtn', { ns: 'queue', defaultValue: 'Transfer' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
