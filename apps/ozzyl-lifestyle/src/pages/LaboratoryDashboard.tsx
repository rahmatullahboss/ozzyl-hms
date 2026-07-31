import { useState, useEffect } from 'react';
import { FlaskConical, Search, Plus, Printer, ClipboardList, RefreshCw, X } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import HelpButton from '../components/HelpButton';
import HelpPanel from '../components/HelpPanel';
import { useTranslation } from 'react-i18next';

interface Test {
  id: number;
  patient_id: number;
  patient_name: string;
  test_name: string;
  result: string;
  date: string;
  status: 'pending' | 'completed' | 'in_progress';
}

export default function LaboratoryDashboard({ role = 'laboratory' }: { role?: string }) {
  const [tests,        setTests]        = useState<Test[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filter,       setFilter]       = useState<'all' | 'pending' | 'completed'>('all');
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [result,       setResult]       = useState('');
  const [saving,       setSaving]       = useState(false);
  const [helpOpen,     setHelpOpen]     = useState(false);
  const { t } = useTranslation(['laboratory', 'common']);

  useEffect(() => { fetchTests(); }, []);

  const fetchTests = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/tests', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTests(data.tests ?? []);
    } catch (err) {
      console.error('[Lab] Fetch failed:', err);
      setTests([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResultSubmit = async (testId: number) => {
    if (!result.trim()) { toast.error(t('resultRequired', { defaultValue: 'Result cannot be empty' })); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.put(`/api/tests/${testId}/result`, { result }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(t('laboratory.result_saved_successfully'));
      setSelectedTest(null);
      setResult('');
      fetchTests();
    } catch (err) {
      console.error('[Lab] Result submit failed:', err);
      toast.error(t('saveFailed', { defaultValue: 'Failed to save result' }));
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (test: Test) => {
    const w = window.open('', '_blank', 'width=700,height=600');
    if (w) {
      w.document.write(`
        <!DOCTYPE html><html><head>
          <title>Test Report — ${test.test_name}</title>
          <style>body{font-family:sans-serif;padding:2rem;max-width:600px;margin:0 auto}
          h1{color:#0891b2;border-bottom:2px solid #0891b2;padding-bottom:.5rem}
          .field{margin:.75rem 0}.label{font-weight:600;color:#475569}
          .value{margin-top:.25rem;color:#164e63}</style>
        </head><body>
          <h1>Ozzyl Health — Lab Report</h1>
          <div class="field"><div class="label">Patient ID</div><div class="value">#${test.patient_id}</div></div>
          <div class="field"><div class="label">Patient Name</div><div class="value">${test.patient_name}</div></div>
          <div class="field"><div class="label">Test</div><div class="value">${test.test_name}</div></div>
          <div class="field"><div class="label">Date</div><div class="value">${new Date(test.date).toLocaleDateString('en-GB')}</div></div>
          <div class="field"><div class="label">Result</div><div class="value">${test.result || 'Pending'}</div></div>
          <div class="field"><div class="label">Status</div><div class="value">${test.status}</div></div>
          <script>window.print();window.close();</script>
        </body></html>`);
      w.document.close();
    }
  };

  const pending   = tests.filter(t => t.status === 'pending').length;
  const completed = tests.filter(t => t.status === 'completed').length;

  const displayed = tests.filter(t => {
    const matchSearch = !search || t.patient_name.toLowerCase().includes(search.toLowerCase()) || t.test_name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || t.status === filter;
    return matchSearch && matchFilter;
  });

  const statusBadge = (status: string) => {
    if (status === 'completed') return <span className="badge badge-success">{t('completed')}</span>;
    if (status === 'in_progress') return <span className="badge badge-info">{t('inProgress', { defaultValue: 'In Progress' })}</span>;
    return <span className="badge badge-warning">{t('pending')}</span>;
  };

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="lab" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('manageTests', { defaultValue: 'Manage test requests and results' })}</p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <button onClick={fetchTests} className="btn-ghost" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('pending')}   value={pending}   loading={loading} icon={<FlaskConical className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title={t('completed')} value={completed} loading={loading} icon={<ClipboardList className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('tests')}     value={tests.length} loading={loading} icon={<FlaskConical className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
        </div>

        {/* ── Search + Filter tabs ── */}
        <div className="card p-3 sm:p-4">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchPlaceholder', { defaultValue: 'Search patient or test name…' })}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden shrink-0">
              {(['all', 'pending', 'completed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    filter === f
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                  }`}
                >
                  {f === 'all' ? t('all', { ns: 'notifications', defaultValue: 'All' }) : f === 'pending' ? t('pending') : t('completed')}
                  {f === 'pending' && pending > 0 && <span className="ml-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5">{pending}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── List ── */}
        <div className="card overflow-hidden">

          {/* Mobile card list */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="flex-1 space-y-2"><div className="skeleton h-4 w-36" /><div className="skeleton h-3 w-24" /></div>
                    <div className="skeleton h-5 w-14 rounded-full" />
                  </div>
                ))
              : displayed.length === 0
                ? (<div className="py-12 flex flex-col items-center gap-2 text-[var(--color-text-muted)]"><FlaskConical className="w-8 h-8 opacity-30" /><p>{t('noTests')}</p></div>)
                : displayed.map(test => (
                    <div key={test.id} className="p-4 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{test.patient_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{test.test_name}</p>
                        </div>
                        {statusBadge(test.status)}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--color-text-muted)]">{new Date(test.date).toLocaleDateString('en-GB')}</span>
                        {test.status === 'pending'
                          ? <button onClick={() => { setSelectedTest(test); setResult(test.result || ''); }} className="btn-primary text-xs py-1 px-2.5"><Plus className="w-3.5 h-3.5" /></button>
                          : <button onClick={() => handlePrint(test)} className="btn-secondary text-xs py-1 px-2.5"><Printer className="w-3.5 h-3.5" /></button>
                        }
                      </div>
                    </div>
                  ))
            }
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('patientId', { defaultValue: 'Patient ID' })}</th>
                  <th>{t('patientName', { defaultValue: 'Patient Name' })}</th>
                  <th>{t('testName')}</th>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('status', { ns: 'common' })}</th>
                  <th>{t('result')}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  ))
                ) : displayed.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                        <FlaskConical className="w-10 h-10 opacity-30" />
                        <p>{t('noTests')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayed.map(test => (
                    <tr key={test.id}>
                      <td className="font-data">#{test.patient_id}</td>
                      <td className="font-medium">{test.patient_name}</td>
                      <td>{test.test_name}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">{new Date(test.date).toLocaleDateString('en-GB')}</td>
                      <td>{statusBadge(test.status)}</td>
                      <td className="max-w-[200px] truncate text-sm text-[var(--color-text-secondary)]">
                        {test.result || <span className="text-[var(--color-text-muted)]">—</span>}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          {test.status === 'pending' ? (
                            <button
                              onClick={() => { setSelectedTest(test); setResult(test.result || ''); }}
                              className="btn-primary text-xs py-1 px-2.5"
                            >
                              <Plus className="w-3.5 h-3.5" /> {t('enterResult', { defaultValue: 'Enter Result' })}
                            </button>
                          ) : (
                            <button onClick={() => handlePrint(test)} className="btn-secondary text-xs py-1 px-2.5">
                              <Printer className="w-3.5 h-3.5" /> {t('print', { ns: 'common' })}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Enter Result Modal ── */}
        {selectedTest && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('enterResult', { defaultValue: 'Enter Test Result' })}</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{selectedTest.test_name} — {selectedTest.patient_name}</p>
                </div>
                <button onClick={() => { setSelectedTest(null); setResult(''); }} className="btn-ghost p-1.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="label">{t('result')} *</label>
                  <textarea
                    value={result}
                    onChange={e => setResult(e.target.value)}
                    className="input h-32 resize-none"
                    placeholder={t("laboratory.testResultDetailsPlaceholder")}
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 pb-5">
                <button onClick={() => { setSelectedTest(null); setResult(''); }} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button onClick={() => handleResultSubmit(selectedTest.id)} disabled={saving} className="btn-primary">
                  {saving ? t('loading', { ns: 'common' }) : t('save', { ns: 'common' })}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
