import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Stethoscope, Plus, X, User, Activity, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('clinical');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface PatientResult { id: number; name: string; patient_code: string; }
interface PELine { LineCode: string; Category: string; Title: string; WnlText: string; AbnText: string; }
interface Finding { lineCode: string; status: 'wnl' | 'abn'; notes: string; }

export default function PhysicalExamDashboard({ role }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [peLines, setPeLines] = useState<PELine[]>([]);
  
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // New Exam Form State
  const [generalNotes, setGeneralNotes] = useState('');
  const [findings, setFindings] = useState<Record<string, Finding>>({});

  useEffect(() => {
    // Load PE lines on mount
    axios.get('/api/physical-exam/lines', { headers: authHeaders() })
      .then(res => setPeLines(res.data?.Results || []))
      .catch(() => toast.error(t('clinical.failed_to_load_physical_exam_definition')));
  }, []);

  const searchPatients = useCallback(async () => {
    if (search.length < 2) { setPatients([]); return; }
    try {
      const res = await axios.get(`/api/patients?search=${encodeURIComponent(search)}&limit=10`, { headers: authHeaders() });
      setPatients(res.data?.patients ?? res.data?.Results ?? []);
    } catch { /* */ }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(searchPatients, 300);
    return () => clearTimeout(t);
  }, [searchPatients]);

  const loadExams = async (patientId: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/physical-exam/patient/${patientId}`, { headers: authHeaders() });
      setExams(res.data?.Results ?? []);
    } catch {
      toast.error(t('clinical.failed_to_load_previous_exams'));
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

  const handleToggleFinding = (lineCode: string, status: 'wnl' | 'abn') => {
    setFindings(prev => {
      const existing = prev[lineCode];
      if (existing?.status === status) {
        // Toggle off if clicking the same status
        const next = { ...prev };
        delete next[lineCode];
        return next;
      }
      return { ...prev, [lineCode]: { lineCode, status, notes: existing?.notes || '' } };
    });
  };

  const handleNoteChange = (lineCode: string, notes: string) => {
    setFindings(prev => {
      const existing = prev[lineCode] || { lineCode, status: 'abn', notes: '' };
      return { ...prev, [lineCode]: { ...existing, notes } };
    });
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    try {
      const findingsArray = Object.values(findings);
      await axios.post('/api/physical-exam', {
        PatientId: selectedPatient.id,
        ExamDate: new Date().toISOString(),
        Findings: findingsArray,
        GeneralNotes: generalNotes,
      }, { headers: authHeaders() });
      
      toast.success(t('clinical.physical_exam_saved_successfully'));
      setShowModal(false);
      setFindings({});
      setGeneralNotes('');
      loadExams(selectedPatient.id);
    } catch (err) {
      toast.error(t('clinical.failed_to_save_exam'));
    } finally {
      setSaving(false);
    }
  };

  // Group lines by Category
  const groupedLines = peLines.reduce((acc, line) => {
    if (!acc[line.Category]) acc[line.Category] = [];
    acc[line.Category].push(line);
    return acc;
  }, {} as Record<string, PELine[]>);

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Physical Exam</h1>
              <p className="text-sm text-[var(--color-text-muted)]">System-based clinical observations</p>
            </div>
          </div>
        </div>

        <div className="card p-4 relative border-t-4 border-t-emerald-500">
          <label className="label">{t('dashboard.patient_search')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("dashboard.search_by_name_or_code")}
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
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)]"
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
              <h3 className="section-title">Exam History</h3>
              <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Exam
              </button>
            </div>
            {loading ? (
               <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
            ) : exams.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No previous exams recorded</p>
              </div>
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>General Notes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map(ex => (
                    <tr key={ex.ExamId}>
                      <td className="font-data">{new Date(ex.ExamDate).toLocaleString()}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ex.OverallStatus === 'normal' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {ex.OverallStatus.toUpperCase()}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate">{ex.GeneralNotes || '—'}</td>
                      <td>
                        <button className="text-emerald-600 hover:text-emerald-700 text-xs font-semibold">View Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0 bg-gradient-to-r from-emerald-50 to-transparent dark:from-emerald-950/20">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">New Physical Exam</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient?.name}</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-[var(--color-bg-primary)]">
              {Object.entries(groupedLines).length > 0 ? (
                Object.entries(groupedLines).map(([category, lines]) => (
                  <div key={category} className="card p-4 border border-[var(--color-border)] shadow-sm">
                    <h4 className="text-[var(--color-primary)] font-bold mb-4 uppercase text-xs tracking-wider border-b border-[var(--color-border)] pb-2">{category}</h4>
                    <div className="space-y-4">
                      {lines.map(line => {
                        const f = findings[line.LineCode];
                        return (
                          <div key={line.LineCode} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                            <div className="md:col-span-4 mt-1">
                              <span className="font-medium text-sm text-[var(--color-text)]">{line.Title}</span>
                            </div>
                            <div className="md:col-span-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleToggleFinding(line.LineCode, 'wnl')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-colors border ${
                                  f?.status === 'wnl' 
                                    ? 'bg-emerald-100 border-emerald-300 text-emerald-800' 
                                    : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-emerald-50'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> WNL
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleFinding(line.LineCode, 'abn')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-colors border ${
                                  f?.status === 'abn' 
                                    ? 'bg-red-100 border-red-300 text-red-800' 
                                    : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-red-50'
                                }`}
                              >
                                <AlertCircle className="w-3.5 h-3.5" /> ABN
                              </button>
                            </div>
                            <div className="md:col-span-5">
                              {f?.status && (
                                <input
                                  placeholder={f.status === 'wnl' ? line.WnlText : (line.AbnText || 'Describe finding...')}
                                  value={f.notes}
                                  onChange={e => handleNoteChange(line.LineCode, e.target.value)}
                                  className={`input w-full text-sm py-1.5 ${f.status === 'abn' ? 'border-red-300 bg-red-50/30' : ''}`}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center p-8 text-[var(--color-text-muted)]">No exam template items configured. Administrator must define Physical Exam Lines.</div>
              )}

              <div className="card p-4 border border-[var(--color-border)] shadow-sm">
                <label className="label text-[var(--color-primary)] font-bold">General Notes / Summary</label>
                <textarea
                  className="input w-full mt-2"
                  rows={4}
                  placeholder={t("dashboard.additional_exam_notes")}
                  value={generalNotes}
                  onChange={e => setGeneralNotes(e.target.value)}
                />
              </div>

            </div>

            <div className="p-4 border-t border-[var(--color-border)] flex justify-end shrink-0 bg-[var(--color-bg-secondary)]">
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button onClick={handleSaveExam} disabled={saving} className="btn bg-emerald-600 text-white hover:bg-emerald-700 min-w-[120px]">
                  {saving ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
