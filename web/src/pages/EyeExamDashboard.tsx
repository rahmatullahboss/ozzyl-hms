import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Plus, X, User, Activity, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import { formatDisplayDate } from '../lib/date-utils';

interface PatientResult {
  id: number;
  name: string;
  patient_code: string;
}

export default function EyeExamDashboard({ role }: { role?: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'acuity' | 'refraction' | 'antseg' | 'fundus' | 'assessment'>('general');

  const [form, setForm] = useState({
    ChiefComplaint: '',
    HPI: '',
    ReviewOfSystems: '',

    // Acuity
    SCODVA: '', SCOSVA: '',
    PHODVA: '', PHOSVA: '',

    // Refraction
    MRODSPH: '', MRODCYL: '', MRODAXIS: '',
    MROSSPH: '', MROSCYL: '', MROSAXIS: '',

    // AntSeg
    ODCORNEA: '', OSCORNEA: '',
    ODLENS: '', OSLENS: '',
    ODIOPNCT: '', OSIOPNCT: '',

    // Fundus
    ODMACULA: '', OSMACULA: '',
    ODDISC: '', OSDISC: '',

    // Assessment
    DiagnosisOD: '', DiagnosisOS: '',
    Assessment: '', Plan: '',
  });

  /* Escape key closes modal */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const searchPatients = useCallback(async () => {
    if (search.length < 2) { setPatients([]); return; }
    try {
      const res = await api.get<{ patients?: PatientResult[]; Results?: PatientResult[] }>(`/api/patients?search=${encodeURIComponent(search)}&limit=10`);
      setPatients(res?.patients ?? res?.Results ?? []);
    } catch { /* */ }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(searchPatients, 300);
    return () => clearTimeout(timer);
  }, [searchPatients]);

  const loadExams = async (patientId: number) => {
    setLoading(true);
    try {
      const res = await api.get<{ Results?: any[] }>(`/api/clinical/eye-exam?patientId=${patientId}`);
      setExams(res?.Results ?? []);
    } catch {
      toast.error(t('failed_to_load_eye_exams'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPatient = (p: PatientResult) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    loadExams(p.id);
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    try {
      // 1. Create base exam
      const resBase = await api.post<{ Results?: { id?: number } }>('/api/clinical/eye-exam', {
        PatientId: selectedPatient.id,
        ExamDate: new Date().toISOString(),
        ChiefComplaint: form.ChiefComplaint,
        HPI: form.HPI,
        ReviewOfSystems: form.ReviewOfSystems,
      });

      const eyeExamId = resBase.Results?.id;
      if (!eyeExamId) throw new Error("Failed to create base exam");

      // 2. Save Acuity
      if (form.SCODVA || form.SCOSVA || form.PHODVA || form.PHOSVA) {
        await api.post('/api/clinical/eye-exam/acuity', {
          EyeExamId: eyeExamId, PatientId: selectedPatient.id,
          SCODVA: form.SCODVA, SCOSVA: form.SCOSVA,
          PHODVA: form.PHODVA, PHOSVA: form.PHOSVA
        });
      }

      // 3. Save Refraction
      if (form.MRODSPH || form.MROSSPH || form.MRODCYL || form.MROSCYL) {
        await api.post('/api/clinical/eye-exam/refraction', {
          EyeExamId: eyeExamId, PatientId: selectedPatient.id,
          MRODSPH: form.MRODSPH, MRODCYL: form.MRODCYL, MRODAXIS: form.MRODAXIS,
          MROSSPH: form.MROSSPH, MROSCYL: form.MROSCYL, MROSAXIS: form.MROSAXIS
        });
      }

      // 4. Save AntSeg
      if (form.ODCORNEA || form.OSCORNEA || form.ODLENS || form.OSLENS || form.ODIOPNCT || form.OSIOPNCT) {
         await api.post('/api/clinical/eye-exam/anterior-segment', {
          EyeExamId: eyeExamId, PatientId: selectedPatient.id,
          ODCORNEA: form.ODCORNEA, OSCORNEA: form.OSCORNEA,
          ODLENS: form.ODLENS, OSLENS: form.OSLENS,
          ODIOPNCT: form.ODIOPNCT, OSIOPNCT: form.OSIOPNCT
        });
      }

      // 5. Save Fundus
      if (form.ODMACULA || form.OSMACULA || form.ODDISC || form.OSDISC) {
        await api.post('/api/clinical/eye-exam/fundus', {
          EyeExamId: eyeExamId, PatientId: selectedPatient.id,
          ODMACULA: form.ODMACULA, OSMACULA: form.OSMACULA,
          ODDISC: form.ODDISC, OSDISC: form.OSDISC
        });
      }

      // 6. Save Assessment
      if (form.DiagnosisOD || form.DiagnosisOS || form.Assessment || form.Plan) {
        await api.post('/api/clinical/eye-exam/assessment', {
          EyeExamId: eyeExamId, PatientId: selectedPatient.id,
          DiagnosisOD: form.DiagnosisOD, DiagnosisOS: form.DiagnosisOS,
          Assessment: form.Assessment, Plan: form.Plan
        });
      }

      toast.success(t('eye_exam_saved_successfully'));
      setShowModal(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.eyeExam.list(selectedPatient.id) });
      loadExams(selectedPatient.id);
    } catch {
      toast.error(t('failed_to_save_comprehensive_eye_exam'));
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: string, value: string) => setForm(p => ({ ...p, [key]: value }));

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Eye className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('eyeExam.title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('eyeExam.subtitle', 'Visual acuity, IOP, refraction, and assessment')}</p>
            </div>
          </div>
          {selectedPatient && (
            <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t('eyeExam.newExam', 'New Exam')}
            </button>
          )}
        </div>

        <div className="card p-4 relative">
          <label className="label">{t('patient', { ns: 'common' })}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t('searchPlaceholder', { ns: 'common', defaultValue: 'Search by name or patient code' })}
              value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedPatient(null);
                setExams([]);
              }}
              className="input w-full pl-9"
            />
          </div>
          {patients.length > 0 && (
            <div className="absolute z-10 left-4 right-4 top-full bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
              {patients.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPatient(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPatient && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="section-title">{t('eyeExam.examHistory')}</h3>
            </div>
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
            ) : exams.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('eyeExam.noHistory')}</p>
                <button onClick={() => setShowModal(true)} className="btn btn-primary mt-4 flex items-center gap-2 text-sm">
                  <Plus className="w-4 h-4" /> {t('eyeExam.newExam', 'New Exam')}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>{t('common.date', 'Date')}</th>
                      <th>{t('eyeExam.chiefComplaint', { defaultValue: 'Chief Complaint' })}</th>
                      <th>{t('common.createdBy', 'Created By')}</th>
                      <th>{t('common.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((exam) => (
                      <tr key={exam.EyeExamId}>
                        <td className="font-data">{formatDisplayDate(exam.ExamDate)}</td>
                        <td className="text-[var(--color-text-muted)]">{exam.ChiefComplaint || '—'}</td>
                        <td>{exam.CreatedById}</td>
                        <td>
                          <button className="text-blue-600 hover:text-blue-700 text-xs font-semibold">{t('common.viewDetails', 'View Details')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!selectedPatient && (
          <div className="card p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)] min-h-64">
            <Eye className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-base font-medium text-[var(--color-text)]">{t('clinical.noPatientSelected', 'No patient selected')}</p>
            <p className="text-sm mt-1">{t('clinical.searchSelectPatientPrompt', 'Search and select a patient to record eye exams.')}</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                <h3 className="font-semibold text-[var(--color-text)]">Comprehensive Eye Exam</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-[var(--color-border)] px-4 flex-shrink-0 overflow-x-auto">
              {[
                { id: 'general', label: t('eyeExam.history', 'History') },
                { id: 'acuity', label: t('eyeExam.visionAcuity') },
                { id: 'refraction', label: t('eyeExam.refraction') },
                { id: 'antseg', label: t('eyeExam.anteriorSegment', 'Ant. Segment / IOP') },
                { id: 'fundus', label: t('eyeExam.fundus', 'Fundus') },
                { id: 'assessment', label: t('eyeExam.assessment', 'A/P') },
              ].map(tabItem => (
                <button
                  key={tabItem.id} type="button"
                  onClick={() => setActiveTab(tabItem.id as any)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === tabItem.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveExam} className="flex-1 overflow-y-auto p-6">

              {activeTab === 'general' && (
                <div className="space-y-4">
                  <div>
                    <label className="label">{t('eyeExam.chiefComplaint', { defaultValue: 'Chief Complaint' })}</label>
                    <input className="input w-full" value={form.ChiefComplaint} onChange={e => setField('ChiefComplaint', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('eyeExam.hpi', { defaultValue: 'History of Present Illness' })}</label>
                    <textarea className="input w-full" rows={3} value={form.HPI} onChange={e => setField('HPI', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('eyeExam.reviewOfSystems', { defaultValue: 'Review of Systems' })}</label>
                    <textarea className="input w-full" rows={2} value={form.ReviewOfSystems} onChange={e => setField('ReviewOfSystems', e.target.value)} />
                  </div>
                </div>
              )}

              {activeTab === 'acuity' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h4 className="font-semibold text-red-600 bg-red-50 p-2 rounded text-center border border-red-100">{t('eyeExam.od')}</h4>
                      <div>
                        <label className="label text-xs">{t('eyeExam.distanceSC', 'Distance (SC)')}</label>
                        <input className="input w-full" placeholder={t("eyeExam.eg2020", { defaultValue: "e.g., 20/20" })} value={form.SCODVA} onChange={e => setField('SCODVA', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs">{t('eyeExam.pinholePH', 'Pinhole (PH)')}</label>
                        <input className="input w-full" placeholder={t("eyeExam.eg2020", { defaultValue: "e.g., 20/20" })} value={form.PHODVA} onChange={e => setField('PHODVA', e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <h4 className="font-semibold text-emerald-600 bg-emerald-50 p-2 rounded text-center border border-emerald-100">{t('eyeExam.os')}</h4>
                      <div>
                        <label className="label text-xs">{t('eyeExam.distanceSC', 'Distance (SC)')}</label>
                        <input className="input w-full" placeholder={t("eyeExam.eg2020", { defaultValue: "e.g., 20/20" })} value={form.SCOSVA} onChange={e => setField('SCOSVA', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs">{t('eyeExam.pinholePH', 'Pinhole (PH)')}</label>
                        <input className="input w-full" placeholder={t("eyeExam.eg2020", { defaultValue: "e.g., 20/20" })} value={form.PHOSVA} onChange={e => setField('PHOSVA', e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'refraction' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3 p-4 border rounded-xl bg-red-50/30">
                      <h4 className="font-semibold text-red-600 text-sm">{t('eyeExam.od')}</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="label text-xs">{t('eyeExam.sphere')}</label>
                          <input className="input w-full" value={form.MRODSPH} onChange={e => setField('MRODSPH', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">{t('eyeExam.cylinder')}</label>
                          <input className="input w-full" value={form.MRODCYL} onChange={e => setField('MRODCYL', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">{t('eyeExam.axis')}</label>
                          <input className="input w-full" value={form.MRODAXIS} onChange={e => setField('MRODAXIS', e.target.value)} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 p-4 border rounded-xl bg-emerald-50/30">
                      <h4 className="font-semibold text-emerald-600 text-sm">{t('eyeExam.os')}</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="label text-xs">{t('eyeExam.sphere')}</label>
                          <input className="input w-full" value={form.MROSSPH} onChange={e => setField('MROSSPH', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">{t('eyeExam.cylinder')}</label>
                          <input className="input w-full" value={form.MROSCYL} onChange={e => setField('MROSCYL', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">{t('eyeExam.axis')}</label>
                          <input className="input w-full" value={form.MROSAXIS} onChange={e => setField('MROSAXIS', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'antseg' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                       <h4 className="font-semibold text-red-600 text-sm">{t('eyeExam.od')}</h4>
                       <div><label className="label text-xs">{t('eyeExam.cornea', 'Cornea')}</label><input className="input w-full" value={form.ODCORNEA} onChange={e=>setField('ODCORNEA', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.lens', 'Lens')}</label><input className="input w-full" value={form.ODLENS} onChange={e=>setField('ODLENS', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.iop')}</label><input className="input w-full" value={form.ODIOPNCT} onChange={e=>setField('ODIOPNCT', e.target.value)} /></div>
                    </div>
                    <div className="space-y-3">
                       <h4 className="font-semibold text-emerald-600 text-sm">{t('eyeExam.os')}</h4>
                       <div><label className="label text-xs">{t('eyeExam.cornea', 'Cornea')}</label><input className="input w-full" value={form.OSCORNEA} onChange={e=>setField('OSCORNEA', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.lens', 'Lens')}</label><input className="input w-full" value={form.OSLENS} onChange={e=>setField('OSLENS', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.iop')}</label><input className="input w-full" value={form.OSIOPNCT} onChange={e=>setField('OSIOPNCT', e.target.value)} /></div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'fundus' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                       <h4 className="font-semibold text-red-600 text-sm">{t('eyeExam.od')}</h4>
                       <div><label className="label text-xs">{t('eyeExam.macula', 'Macula')}</label><input className="input w-full" value={form.ODMACULA} onChange={e=>setField('ODMACULA', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.discCDR', 'Disc / CDR')}</label><input className="input w-full" value={form.ODDISC} onChange={e=>setField('ODDISC', e.target.value)} /></div>
                    </div>
                    <div className="space-y-3">
                       <h4 className="font-semibold text-emerald-600 text-sm">{t('eyeExam.os')}</h4>
                       <div><label className="label text-xs">{t('eyeExam.macula', 'Macula')}</label><input className="input w-full" value={form.OSMACULA} onChange={e=>setField('OSMACULA', e.target.value)} /></div>
                       <div><label className="label text-xs">{t('eyeExam.discCDR', 'Disc / CDR')}</label><input className="input w-full" value={form.OSDISC} onChange={e=>setField('OSDISC', e.target.value)} /></div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'assessment' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="label text-xs">Diagnosis (OD)</label>
                      <input className="input w-full" value={form.DiagnosisOD} onChange={e=>setField('DiagnosisOD', e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Diagnosis (OS)</label>
                      <input className="input w-full" value={form.DiagnosisOS} onChange={e=>setField('DiagnosisOS', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="label">{t('eyeExam.assessmentSummary', { defaultValue: 'Assessment Summary' })}</label>
                    <textarea className="input w-full" rows={3} value={form.Assessment} onChange={e=>setField('Assessment', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('eyeExam.plan', { defaultValue: 'Plan' })}</label>
                    <textarea className="input w-full" rows={3} value={form.Plan} onChange={e=>setField('Plan', e.target.value)} />
                  </div>
                </div>
              )}

            </form>

            <div className="p-4 border-t border-[var(--color-border)] flex justify-between shrink-0 bg-[var(--color-bg-secondary)]">
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('eyeExam.savePrompt', 'Make sure all relevant sections are filled before saving.')}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">{t('common.cancel')}</button>
                <button onClick={handleSaveExam} disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? t('common.saving', 'Saving...') : t('eyeExam.saveExam', 'Save Exam')}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
