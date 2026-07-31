import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

const UPPER_TEETH = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
const LOWER_TEETH = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];

const CONDITION_COLORS: Record<string, string> = {
  decay:     'bg-red-400 text-white',
  missing:   'bg-gray-400 text-white',
  crown:     'bg-yellow-400 text-gray-900',
  filling:   'bg-blue-400 text-white',
  extraction:'bg-red-600 text-white',
  bridge:    'bg-purple-400 text-white',
  implant:   'bg-teal-400 text-white',
};

interface ToothEntry { ToothNumber: string; ToothCondition?: string; ClinicalNotes?: string; }
interface Treatment { TreatmentId: number; ToothNumber?: string; ProcedureName: string; CdtCode: string; PerformedDate: string; Fee?: number; }
interface PatientResult { id: number; name: string; patient_code: string; }

export default function Dental({ role }: { role?: string }) {
  const { t } = useTranslation('dental');
  const [search,           setSearch]           = useState('');
  const [patients,         setPatients]         = useState<PatientResult[]>([]);
  const [selectedPatient,  setSelectedPatient]  = useState<PatientResult | null>(null);
  const [chart,            setChart]            = useState<ToothEntry[]>([]);
  const [treatments,       setTreatments]       = useState<Treatment[]>([]);
  const [activeTooth,      setActiveTooth]      = useState<string | null>(null);
  const [toothForm,        setToothForm]        = useState({ ToothCondition: '', ClinicalNotes: '', ToothStatus: 'present' });
  const [treatForm,        setTreatForm]        = useState({ CdtCode: '', ProcedureName: '', ToothNumber: '', PerformedDate: new Date().toISOString().slice(0,10), Fee: '' });
  const [savingTooth,      setSavingTooth]      = useState(false);
  const [savingTreat,      setSavingTreat]      = useState(false);
  const [tab,              setTab]              = useState<'chart' | 'treatments'>('chart');

  const searchPatients = useCallback(async () => {
    if (search.length < 2) return;
    try {
      const res = await axios.get(`/api/patients?search=${encodeURIComponent(search)}&limit=10`, { headers: authHeaders() });
      setPatients(res.data?.patients ?? res.data?.Results ?? []);
    } catch { /* silent */ }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(searchPatients, 300);
    return () => clearTimeout(t);
  }, [searchPatients]);

  const loadPatient = async (p: PatientResult) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    try {
      const [chartRes, treatRes] = await Promise.all([
        axios.get(`/api/dental/chart/${p.id}`, { headers: authHeaders() }).catch(() => ({ data: { Results: [] } })),
        axios.get(`/api/dental/treatments/${p.id}`, { headers: authHeaders() }).catch(() => ({ data: { Results: [] } })),
      ]);
      setChart(chartRes.data?.Results ?? []);
      setTreatments(treatRes.data?.Results ?? []);
    } catch { toast.error(t('failedToLoad')); }
  };

  const getToothEntry = (num: number) => chart.find((t) => t.ToothNumber === String(num));

  const saveTooth = async () => {
    if (!selectedPatient || !activeTooth) return;
    setSavingTooth(true);
    try {
      await axios.post('/api/dental/chart', {
        PatientId: selectedPatient.id,
        ToothNumber: activeTooth,
        ToothStatus: toothForm.ToothStatus,
        ToothCondition: toothForm.ToothCondition || undefined,
        ClinicalNotes: toothForm.ClinicalNotes || undefined,
      }, { headers: authHeaders() });
      toast.success(t('toothUpdated', { tooth: activeTooth }));
      setActiveTooth(null);
      const res = await axios.get(`/api/dental/chart/${selectedPatient.id}`, { headers: authHeaders() });
      setChart(res.data?.Results ?? []);
    } catch { toast.error(t('failedToSave')); }
    finally { setSavingTooth(false); }
  };

  const saveTreatment = async () => {
    if (!selectedPatient || !treatForm.CdtCode || !treatForm.ProcedureName) {
      toast.error(t('cdtAndNameRequired')); return;
    }
    setSavingTreat(true);
    try {
      await axios.post('/api/dental/treatments', {
        PatientId: selectedPatient.id,
        CdtCode: treatForm.CdtCode,
        ProcedureName: treatForm.ProcedureName,
        ToothNumber: treatForm.ToothNumber || undefined,
        PerformedDate: treatForm.PerformedDate,
        Fee: treatForm.Fee ? Number(treatForm.Fee) : undefined,
      }, { headers: authHeaders() });
      toast.success(t('treatmentRecorded'));
      setTreatForm({ CdtCode: '', ProcedureName: '', ToothNumber: '', PerformedDate: new Date().toISOString().slice(0,10), Fee: '' });
      const res = await axios.get(`/api/dental/treatments/${selectedPatient.id}`, { headers: authHeaders() });
      setTreatments(res.data?.Results ?? []);
    } catch { toast.error(t('failedToSaveTreatment')); }
    finally { setSavingTreat(false); }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <h1 className="page-title">{t('title')}</h1>
        </div>

        {/* Patient Search */}
        <div className="card p-4 relative">
          <label className="label">{t('patient')}</label>
          <input
            placeholder={t('searchPlaceholder')}
            value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
            onChange={(e) => { setSearch(e.target.value); setSelectedPatient(null); }}
            className="input w-full"
          />
          {patients.length > 0 && (
            <div className="absolute z-10 top-full left-4 right-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {patients.map((p) => (
                <button key={p.id} onClick={() => loadPatient(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPatient && (
          <>
            <div className="flex gap-1 border-b border-[var(--color-border)]">
              {(['chart', 'treatments'] as const).map((tKey) => (
                <button key={tKey} onClick={() => setTab(tKey)}
                  className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === tKey ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                  {t(tKey)}
                </button>
              ))}
            </div>

            {tab === 'chart' && (
              <div className="card p-5">
                <h3 className="section-title mb-4">{t('dentalChartTitle', { name: selectedPatient.name })}</h3>

                <p className="text-xs text-[var(--color-text-muted)] text-center mb-1">{t('upper')}</p>
                <div className="flex justify-center gap-1 mb-3">
                  {UPPER_TEETH.map((n) => {
                    const entry = getToothEntry(n);
                    const condColor = entry?.ToothCondition ? (CONDITION_COLORS[entry.ToothCondition] ?? 'bg-teal-400 text-white') : 'bg-slate-200 dark:bg-slate-700 text-[var(--color-text)]';
                    return (
                      <button key={n} onClick={() => { setActiveTooth(String(n)); setToothForm({ ToothCondition: entry?.ToothCondition ?? '', ClinicalNotes: entry?.ClinicalNotes ?? '', ToothStatus: 'present' }); }}
                        className={`w-8 h-8 rounded text-xs font-bold border-2 transition-all hover:scale-110 ${condColor} ${activeTooth === String(n) ? 'border-[var(--color-primary)] scale-110' : 'border-transparent'}`}
                        title={`Tooth ${n}${entry?.ToothCondition ? ` — ${entry.ToothCondition}` : ''}`}>
                        {n}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-center gap-1 mb-1">
                  {LOWER_TEETH.map((n) => {
                    const entry = getToothEntry(n);
                    const condColor = entry?.ToothCondition ? (CONDITION_COLORS[entry.ToothCondition] ?? 'bg-teal-400 text-white') : 'bg-slate-200 dark:bg-slate-700 text-[var(--color-text)]';
                    return (
                      <button key={n} onClick={() => { setActiveTooth(String(n)); setToothForm({ ToothCondition: entry?.ToothCondition ?? '', ClinicalNotes: entry?.ClinicalNotes ?? '', ToothStatus: 'present' }); }}
                        className={`w-8 h-8 rounded text-xs font-bold border-2 transition-all hover:scale-110 ${condColor} ${activeTooth === String(n) ? 'border-[var(--color-primary)] scale-110' : 'border-transparent'}`}
                        title={`Tooth ${n}${entry?.ToothCondition ? ` — ${entry.ToothCondition}` : ''}`}>
                        {n}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] text-center mb-4">{t('lower')}</p>

                {/* Legend */}
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                  {Object.entries(CONDITION_COLORS).map(([c, col]) => (
                    <span key={c} className={`px-2 py-0.5 rounded text-xs font-medium ${col}`}>{t(c)}</span>
                  ))}
                </div>

                {activeTooth && (
                  <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-secondary)]">
                    <p className="text-sm font-semibold mb-3">{t('tooth', { })} {activeTooth}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">{t('condition')}</label>
                        <select value={toothForm.ToothCondition} onChange={(e) => setToothForm((f) => ({ ...f, ToothCondition: e.target.value }))} className="input w-full text-sm">
                          <option value="">{t('healthy')}</option>
                          {Object.keys(CONDITION_COLORS).map((c) => <option key={c} value={c}>{t(c)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">{t('status')}</label>
                        <select value={toothForm.ToothStatus} onChange={(e) => setToothForm((f) => ({ ...f, ToothStatus: e.target.value }))} className="input w-full text-sm">
                          <option value="present">{t('present')}</option>
                          <option value="missing">{t('missing')}</option>
                          <option value="unerupted">{t('unerupted')}</option>
                        </select>
                      </div>
                    </div>
                    <textarea placeholder={t('notesPlaceholder')} value={toothForm.ClinicalNotes} onChange={(e) => setToothForm((f) => ({ ...f, ClinicalNotes: e.target.value }))} rows={2} className="input w-full text-sm mt-3" />
                    <div className="flex gap-2 justify-end mt-3">
                      <button onClick={() => setActiveTooth(null)} className="btn btn-secondary text-sm">{t('cancel')}</button>
                      <button onClick={saveTooth} disabled={savingTooth} className="btn btn-primary text-sm">{savingTooth ? t('saving') : t('save')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'treatments' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('addTreatment')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <input placeholder={t('cdtCodePlaceholder')} value={treatForm.CdtCode} onChange={(e) => setTreatForm((f) => ({ ...f, CdtCode: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('procedureNamePlaceholder')} value={treatForm.ProcedureName} onChange={(e) => setTreatForm((f) => ({ ...f, ProcedureName: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('toothNumberPlaceholder')} value={treatForm.ToothNumber} onChange={(e) => setTreatForm((f) => ({ ...f, ToothNumber: e.target.value }))} className="input text-sm" />
                    <input type="date" value={treatForm.PerformedDate} onChange={(e) => setTreatForm((f) => ({ ...f, PerformedDate: e.target.value }))} className="input text-sm" />
                    <input type="number" placeholder={t('feePlaceholder')} value={treatForm.Fee} onChange={(e) => setTreatForm((f) => ({ ...f, Fee: e.target.value }))} className="input text-sm" />
                  </div>
                  <div className="flex justify-end mt-3">
                    <button onClick={saveTreatment} disabled={savingTreat} className="btn btn-primary text-sm">{savingTreat ? t('saving') : t('addTreatmentBtn')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('treatmentHistory')}</h3>
                  {treatments.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noTreatments')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base w-full text-sm">
                        <thead><tr><th>{t('date')}</th><th>CDT</th><th>{t('procedure')}</th><th>{t('tooth')}</th><th>{t('fee')}</th></tr></thead>
                        <tbody>
                          {treatments.map((tr) => (
                            <tr key={tr.TreatmentId}>
                              <td>{String(tr.PerformedDate).slice(0,10)}</td>
                              <td className="font-mono text-xs">{tr.CdtCode}</td>
                              <td>{tr.ProcedureName}</td>
                              <td>{tr.ToothNumber ?? '—'}</td>
                              <td>{tr.Fee != null ? `৳${tr.Fee}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
