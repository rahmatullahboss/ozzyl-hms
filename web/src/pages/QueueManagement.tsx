import { useState, useEffect, useRef } from 'react';
import {
  Ticket, Users, Clock, CheckCircle, XCircle, AlertTriangle,
  Plus, X, ArrowRight, Search, RefreshCw, Phone, ChevronRight,
  Play, Square, UserX, ArrowRightLeft, Printer,
  Settings, Trash2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useParams } from 'react-router';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { formatDoctorName } from '../lib/doctor-display';
import CustomSerialInput from '../components/reception/CustomSerialInput';

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
interface CounterData { id: string; name: string; description: string; active: boolean; }
interface Stats {
  total: number; waiting: number; called: number; serving: number;
  completed: number; no_show: number; cancelled: number;
  nowServing: { token_no: string; counter_no: string | null; patient_name: string; doctor_name: string | null }[];
}
interface PatientResult { id: number; name: string; patient_code: string; }

/* ─── API response wrappers ──────────────────────────────── */
interface TokensResponse { Results: TokenEntry[]; }
interface StatsResponse { Results: Stats; }
interface QueueOverviewResponse { tokens: TokenEntry[]; stats: Stats; delayedDoctors?: unknown; }
interface DeptResponse { Results: Dept[]; }
interface PatientSearchResponse { patients?: PatientResult[]; Results?: PatientResult[]; }
interface IssueTokenResponse { data?: { tokenNo: string }; }
interface CallNextResponse { data?: { tokenNo: string; patientName: string } | null; }
interface TransferResponse { data?: { newTokenNo: string }; }

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
  // Handle time-only strings like "16:48:45" by treating them as local time
  // (backend stores datetime('now') which is SQLite local time)
  if (/^\d{2}:\d{2}:\d{2}$/.test(iso)) {
    const [h, m] = iso.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return iso.slice(11, 16); }
}

function buildTokensPath(filterDept: string, filterStatus: string): string {
  const params = new URLSearchParams();
  if (filterDept) params.set('departmentId', filterDept);
  if (filterStatus) params.set('status', filterStatus);
  else params.set('status', 'all');
  const qs = params.toString();
  return `/api/queue/tokens${qs ? `?${qs}` : ''}`;
}

function printToken(tk: TokenEntry) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const container = document.createElement('div');
  container.id = 'print-token-overlay';
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '99999', background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  const style = document.createElement('style');
  style.textContent = `
    @media print { body>*:not(#print-token-overlay){display:none!important} #print-token-overlay{position:static!important} }
    .tk-card{border:2px dashed #333;border-radius:12px;padding:24px 16px;max-width:280px;text-align:center;font-family:Arial,sans-serif}
    .tk-hospital{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .tk-label{font-size:12px;color:#888;margin-top:12px}
    .tk-num{font-size:56px;font-weight:900;color:#0d9488;line-height:1.1}
    .tk-patient{font-size:16px;font-weight:600;margin-top:8px}
    .tk-meta{font-size:12px;color:#666;margin-top:4px}
    .tk-priority{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-top:8px}
    .tk-p-normal{background:#ccfbf1;color:#0d9488} .tk-p-urgent{background:#fef3c7;color:#d97706}
    .tk-p-emergency{background:#fee2e2;color:#dc2626} .tk-p-vip{background:#f3e8ff;color:#7c3aed}
    .tk-footer{margin-top:16px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
    .tk-close{margin-top:16px;padding:6px 20px;border:1px solid #ccc;border-radius:8px;background:#f3f4f6;cursor:pointer;font-size:13px}
    @media print{.tk-close{display:none}}
  `;
  container.appendChild(style);

  const card = document.createElement('div');
  card.className = 'tk-card';

  const lines: { cls: string; text: string }[] = [
    { cls: 'tk-hospital', text: 'OPD Token' },
    { cls: 'tk-label', text: 'Token No.' },
    { cls: 'tk-num', text: tk.token_no },
    { cls: 'tk-patient', text: tk.patient_name },
    { cls: 'tk-meta', text: tk.patient_code },
  ];
  if (tk.doctor_name) lines.push({ cls: 'tk-meta', text: formatDoctorName(tk.doctor_name) });
  if (tk.department_name) lines.push({ cls: 'tk-meta', text: tk.department_name });
  lines.push({ cls: `tk-priority tk-p-${tk.priority}`, text: tk.priority.toUpperCase() });
  lines.push({ cls: 'tk-footer', text: `${today} · ${fmtTime(tk.check_in_time)}` });

  for (const line of lines) {
    const div = document.createElement('div');
    div.className = line.cls;
    div.textContent = line.text;
    card.appendChild(div);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tk-close';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => container.remove();
  card.appendChild(closeBtn);

  container.appendChild(card);
  document.body.appendChild(container);
  window.print();
}

/* ─── Main ────────────────────────────────────────────────── */
export default function QueueManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['queue', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState<TokenEntry | null>(null);

  // Issue token form
  const [showIssue, setShowIssue] = useState(false);
  const [ptSearch, setPtSearch] = useState('');
  const [debouncedPtSearch, setDebouncedPtSearch] = useState('');
  const [issuePt, setIssuePt] = useState<PatientResult | null>(null);
  const [issueDept, setIssueDept] = useState('');
  const [issuePriority, setIssuePriority] = useState<'normal' | 'urgent' | 'emergency' | 'vip'>('normal');
  const [issueCounter, setIssueCounter] = useState('');
  const [issueCustomSerial, setIssueCustomSerial] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  // Transfer
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferDept, setTransferDept] = useState('');

  // Call next
  const [callCounter, setCallCounter] = useState('');
  const [lastCalled, setLastCalled] = useState<{ tokenNo: string; patientName: string } | null>(null);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counters, setCounters] = useState<CounterData[]>([]);
  const [newCounterName, setNewCounterName] = useState('');
  const [newCounterDesc, setNewCounterDesc] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const prevServingRef = useRef<string[]>([]);

  /* ─── Debounce patient search ──────────────────────────── */
  useEffect(() => {
    if (ptSearch.length < 2) { setDebouncedPtSearch(''); return; }
    const timer = setTimeout(() => setDebouncedPtSearch(ptSearch), 300);
    return () => clearTimeout(timer);
  }, [ptSearch]);

  useEffect(() => {
    const key = `hms.counters.${slug}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) { setCounters(parsed); return; }
      } catch { /* corrupt storage */ }
    }
    const defaults: CounterData[] = [
      { id: 'counter-a', name: 'Counter A', description: 'Room 101', active: true },
      { id: 'counter-b', name: 'Counter B', description: 'Room 102', active: true },
      { id: 'counter-c', name: 'Counter C', description: 'Room 103', active: true },
      { id: 'emergency', name: 'Emergency Counter', description: 'ER', active: true },
    ];
    setCounters(defaults);
  }, [slug]);

  useEffect(() => {
    localStorage.setItem(`hms.counters.${slug}`, JSON.stringify(counters));
  }, [counters, slug]);

  /* ─── Queries ──────────────────────────────────────────── */
  const tokenFilters = { departmentId: filterDept, status: filterStatus || 'all' };

  const tokensQuery = useApiQuery<TokensResponse>(
    queryKeys.queue.tokens(tokenFilters),
    buildTokensPath(filterDept, filterStatus),
    { enabled: false },
  );

  const overviewQuery = useApiQuery<QueueOverviewResponse>(
    queryKeys.queue.overview(tokenFilters),
    buildTokensPath(filterDept, filterStatus).replace('/api/queue/tokens', '/api/queue/tokens/overview'),
    { refetchInterval: 60_000, refetchIntervalInBackground: false },
  );

  const deptsQuery = useApiQuery<DeptResponse>(
    queryKeys.queue.departments(),
    '/api/queue/departments',
    { staleTime: 60 * 60_000, gcTime: 2 * 60 * 60_000 },
  );

  const patientSearchQuery = useApiQuery<PatientSearchResponse>(
    queryKeys.queue.patientSearch(debouncedPtSearch),
    `/api/patients?search=${encodeURIComponent(debouncedPtSearch)}&limit=8`,
    { enabled: debouncedPtSearch.length >= 2 },
  );

  /* ─── Derived data ─────────────────────────────────────── */
  const tokens = overviewQuery.data?.tokens ?? tokensQuery.data?.Results ?? [];
  const stats = overviewQuery.data?.stats ?? null;
  const depts = deptsQuery.data?.Results ?? [];
  const ptResults = issuePt
    ? []
    : (patientSearchQuery.data?.patients ?? patientSearchQuery.data?.Results ?? []);
  const loading = overviewQuery.isLoading;

  /* ─── Detect new calls (same logic as before) ──────────── */
  useEffect(() => {
    const nowIds = (stats?.nowServing ?? []).map((s) => s.token_no);
    const prevIds = prevServingRef.current;
    if (prevIds.length > 0 && nowIds.some((id) => !prevIds.includes(id))) {
      // New call detected
    }
    prevServingRef.current = nowIds;
  }, [stats]);

  /* ─── Mutations ────────────────────────────────────────── */
  const invalidateQueue = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.queue.all });

  const issueTokenMutation = useApiMutation<IssueTokenResponse, {
    patientId: number;
    departmentId?: number;
    priority: 'normal' | 'urgent' | 'emergency' | 'vip';
    counterNo?: string;
    tokenNumber?: number;
  }>('post', '/api/queue/token', {
    onSuccess: (data) => {
      const tk = data.data?.tokenNo ?? 'T???';
      setIssuedToken(tk);
      setIssueCustomSerial('');
      toast.success(t('tokenIssued', { ns: 'queue', defaultValue: `Token ${tk} issued` }));
      setIssuePt(null);
      setPtSearch('');
      setIssuePriority('normal');
      setIssueCounter('');
      invalidateQueue();
    },
    onError: (err: any) => {
      const msg = err?.message ?? '';
      const m = msg.match(/Serial (\d+)/);
      if (m) {
        toast.error(t('serialAlreadyIssued', { ns: 'queue', number: m[1], defaultValue: `Serial ${m[1]} is already issued today` }));
      } else {
        toast.error(msg || t('issueFailed', { ns: 'queue', defaultValue: 'Failed to issue token' }));
      }
    },
  });

  const callNextMutation = useApiMutation<CallNextResponse, {
    departmentId?: number;
    counterNo?: string;
  }>('post', '/api/queue/call-next', {
    onSuccess: (data) => {
      if (data.data) {
        setLastCalled({ tokenNo: data.data.tokenNo, patientName: data.data.patientName });
        toast.success(t('calledPatient', { ns: 'queue', defaultValue: `Called ${data.data.tokenNo} — ${data.data.patientName}` }));
      } else {
        toast(t('noPatientsWaiting', { ns: 'queue', defaultValue: 'No patients waiting' }));
      }
      invalidateQueue();
    },
    onError: () => {
      toast.error(t('callNextFailed', { ns: 'queue', defaultValue: 'Failed to call next' }));
    },
  });

  const updateStatusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/queue/tokens/${vars.id}/status`,
    {
      onSuccess: () => {
        toast.success(t('statusUpdated', { ns: 'queue', defaultValue: 'Status updated' }));
        setSelected(null);
        invalidateQueue();
      },
      onError: () => {
        toast.error(t('updateStatusFailed', { ns: 'queue', defaultValue: 'Failed' }));
      },
    },
  );

  const transferMutation = useApiMutation<TransferResponse, { id: number; toDepartmentId: number }>(
    'post',
    (vars) => `/api/queue/tokens/${vars.id}/transfer`,
    {
      onSuccess: (data) => {
        toast.success(t('transferred', { ns: 'queue', defaultValue: `Transferred → ${data.data?.newTokenNo}` }));
        setShowTransfer(false);
        setSelected(null);
        invalidateQueue();
      },
      onError: () => {
        toast.error(t('transferFailed', { ns: 'queue', defaultValue: 'Transfer failed' }));
      },
    },
  );

  /* ─── Handlers ─────────────────────────────────────────── */
  const handleRefresh = () => invalidateQueue();

  const handleIssueToken = () => {
    if (!issuePt) {
      toast.error(t('selectPatient', { ns: 'queue', defaultValue: 'Select a patient' }));
      return;
    }
    issueTokenMutation.mutate({
      patientId: issuePt.id,
      departmentId: issueDept ? Number(issueDept) : undefined,
      priority: issuePriority,
      counterNo: issueCounter || undefined,
      tokenNumber: issueCustomSerial ? Number(issueCustomSerial) : undefined,
    });
  };

  const handleCallNext = () => {
    callNextMutation.mutate({
      departmentId: filterDept ? Number(filterDept) : undefined,
      counterNo: callCounter || undefined,
    });
  };

  const handleUpdateStatus = (id: number, status: string) => {
    updateStatusMutation.mutate({ id, status });
  };

  const handleTransfer = () => {
    if (!selected || !transferDept) return;
    transferMutation.mutate({
      id: selected.id,
      toDepartmentId: Number(transferDept),
    });
  };

  const addCounter = () => {
    const name = newCounterName.trim();
    if (!name) { toast.error('Counter name is required'); return; }
    setCounters(prev => [...prev, {
      id: `counter-${Date.now()}`,
      name,
      description: newCounterDesc.trim(),
      active: true,
    }]);
    setNewCounterName('');
    setNewCounterDesc('');
  };

  const toggleCounter = (id: string) => {
    setCounters(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  };

  const deleteCounter = (id: string) => {
    setCounters(prev => prev.filter(c => c.id !== id));
    setDeleteConfirm(null);
  };

  const activeCounters = counters.filter(c => c.active);

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
              <h1 className="page-title">{t('opdQueue', { ns: 'sidebar', defaultValue: 'OPD Queue' })}</h1>
              <p className="section-subtitle">{t('queueSubtitle', { ns: 'queue', defaultValue: 'Token management, patient flow & queue control' })}</p>
            </div>
          </div>
          <button onClick={handleRefresh} className="btn-ghost"><RefreshCw className="w-4 h-4" /> {t('refresh', { ns: 'common' })}</button>
          <button onClick={() => setShowCounterModal(true)} className="btn-ghost"><Settings className="w-4 h-4" /> Manage Counters</button>
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
            <label className="label">{t('status', { ns: 'common' })}</label>
            <select className="input w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">{t('active')}</option>
              <option value="all">{t('all')}</option>
              <option value="waiting">{t('waiting')}</option>
              <option value="called">{t('called')}</option>
              <option value="serving">{t('serving')}</option>
              <option value="completed">{t('completed')}</option>
            </select>
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            {activeCounters.length > 0 ? (
              <select className="input w-36" value={callCounter} onChange={e => setCallCounter(e.target.value)}>
                <option value="">{t('counterRoom', { ns: 'queue', defaultValue: 'Counter/Room' })}</option>
                {activeCounters.map(c => <option key={c.id} value={c.name}>{c.name} {c.description ? `(${c.description})` : ''}</option>)}
              </select>
            ) : (
              <input className="input w-28" placeholder={t('counterRoom', { ns: 'queue', defaultValue: 'Counter/Room' })} value={callCounter} onChange={e => setCallCounter(e.target.value)} />
            )}
            <button onClick={handleCallNext} disabled={callNextMutation.isPending} className="btn-primary">
              {callNextMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
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
            <h3 className="section-title">{t('queueList')} ({tokens.length})</h3>
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
                        <button onClick={() => handleUpdateStatus(tk.id, 'serving')} className="btn-primary text-sm flex-1">
                          <Play className="w-3.5 h-3.5" /> {t('startServing')}
                        </button>
                      )}
                      {(tk.status === 'called' || tk.status === 'serving') && (
                        <>
                          <button onClick={() => handleUpdateStatus(tk.id, 'completed')} className="btn-secondary text-sm flex-1">
                            <CheckCircle className="w-3.5 h-3.5" /> {t('complete')}
                          </button>
                          <button onClick={() => handleUpdateStatus(tk.id, 'no_show')} className="btn-ghost text-sm text-red-500">
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
                  {t('lastCalled')}: <span className="font-bold">{lastCalled.tokenNo}</span> — {lastCalled.patientName}
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
                    <button onClick={() => handleUpdateStatus(selected.id, 'called')} className="btn-primary text-sm">
                      <Phone className="w-3.5 h-3.5" /> Call
                    </button>
                  )}
                  {(selected.status === 'waiting' || selected.status === 'called') && (
                    <button onClick={() => setShowTransfer(true)} className="btn-secondary text-sm">
                      <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
                    </button>
                  )}
                  {selected.status !== 'completed' && selected.status !== 'cancelled' && (
                    <button onClick={() => handleUpdateStatus(selected.id, 'cancelled')} className="btn-ghost text-sm text-red-500">
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </button>
                  )}
                  <button onClick={() => printToken(selected)} className="btn-secondary text-sm">
                    <Printer className="w-3.5 h-3.5" /> Print Token
                  </button>
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
              <h4 className="text-sm font-semibold mb-2">{t('waitingCount', { count: waiting.length })}</h4>
              {waiting.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">{t('noPatientsWaiting')}</p>
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
                    <p className="text-sm text-emerald-600 font-medium">{t('tokenIssuedLabel')}</p>
                    <p className="text-4xl font-black text-emerald-700 mt-1">{issuedToken}</p>
                  </div>
                )}
                <div className="relative">
                  <label className="label">{t('patient', { ns: 'common' })}</label>
                  <input
                    className="input w-full"
                    placeholder={t('searchPatientPlaceholder')}
                    value={issuePt ? `${issuePt.name} (${issuePt.patient_code})` : ptSearch}
                    onChange={e => { setPtSearch(e.target.value); setIssuePt(null); }}
                  />
                  {ptResults.length > 0 && !issuePt && (
                    <div className="absolute z-10 top-full left-0 right-0 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {ptResults.map(p => (
                        <button key={p.id} onClick={() => { setIssuePt(p); setPtSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">{t('department', { ns: 'common' })}</label>
                  <select className="input w-full" value={issueDept} onChange={e => setIssueDept(e.target.value)}>
                    <option value="">{t('general')}</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('priority', { ns: 'common' })}</label>
                    <select className="input w-full" value={issuePriority} onChange={e => setIssuePriority(e.target.value as typeof issuePriority)}>
                      <option value="normal">{t('priority.normal', { ns: 'queue', defaultValue: 'Normal' })}</option>
                      <option value="urgent">{t('priority.urgent', { ns: 'queue', defaultValue: 'Urgent' })}</option>
                      <option value="emergency">{t('priority.emergency', { ns: 'queue', defaultValue: 'Emergency' })}</option>
                      <option value="vip">{t('priority.vip', { ns: 'queue', defaultValue: 'VIP' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('counterRoom', { ns: 'common' })}</label>
                    {activeCounters.length > 0 ? (
                      <select className="input w-full" value={issueCounter} onChange={e => setIssueCounter(e.target.value)}>
                        <option value="">{t('counterRoomPlaceholder')}</option>
                        {activeCounters.map(c => <option key={c.id} value={c.name}>{c.name} {c.description ? `(${c.description})` : ''}</option>)}
                      </select>
                    ) : (
                      <input className="input w-full" value={issueCounter} onChange={e => setIssueCounter(e.target.value)} placeholder={t('counterRoomPlaceholder')} />
                    )}
                  </div>
                </div>
                <CustomSerialInput value={issueCustomSerial} onChange={setIssueCustomSerial} />
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowIssue(false)} className="btn-secondary">{t('close', { ns: 'common' })}</button>
                  <button onClick={handleIssueToken} disabled={issueTokenMutation.isPending || !issuePt} className="btn-primary">
                    {issueTokenMutation.isPending ? t('issuing', { ns: 'queue', defaultValue: 'Issuing...' }) : t('issueTokenBtn', { ns: 'queue', defaultValue: 'Issue Token' })}
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
                <h3 className="font-semibold">{t('transferTitle')} — {selected.token_no}</h3>
                <button onClick={() => setShowTransfer(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-[var(--color-text-muted)]">{t('transferTo', { patient: selected.patient_name })}</p>
                <div>
                  <label className="label">{t('department', { ns: 'common' })}</label>
                  <select className="input w-full" value={transferDept} onChange={e => setTransferDept(e.target.value)}>
                    <option value="">{t('select')}</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowTransfer(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button onClick={handleTransfer} disabled={transferMutation.isPending || !transferDept} className="btn-primary">
                    {transferMutation.isPending ? t('transferring', { ns: 'queue', defaultValue: 'Transferring...' }) : t('transfer', { ns: 'common', defaultValue: 'Transfer' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manage Counters Modal */}
        {showCounterModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">Manage Counters</h3>
                <button onClick={() => { setShowCounterModal(false); setDeleteConfirm(null); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {counters.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No counters configured.</p>
                  ) : (
                    counters.map(c => (
                      <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border ${c.active ? 'border-[var(--color-border)]' : 'border-gray-200 dark:border-gray-700 opacity-60'}`}>
                        <button onClick={() => toggleCounter(c.id)} className="shrink-0">
                          {c.active ? <ToggleRight className="w-5 h-5 text-teal-500" /> : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${!c.active ? 'line-through' : ''}`}>{c.name}</p>
                          {c.description && <p className="text-xs text-[var(--color-text-muted)] truncate">{c.description}</p>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                          {c.active ? 'Active' : 'Inactive'}
                        </span>
                        {deleteConfirm === c.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deleteCounter(c.id)} className="text-xs px-2 py-1 bg-red-500 text-white rounded">Delete</button>
                            <button onClick={() => setDeleteConfirm(null)} className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(c.id)} className="btn-ghost p-1 text-red-400 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
                  <p className="text-sm font-medium">Add New Counter</p>
                  <input className="input w-full" placeholder="Counter name" value={newCounterName} onChange={e => setNewCounterName(e.target.value)} />
                  <input className="input w-full" placeholder="Location / description" value={newCounterDesc} onChange={e => setNewCounterDesc(e.target.value)} />
                  <button onClick={addCounter} className="btn-primary w-full flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Add Counter
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
