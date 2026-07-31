import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Plus, X, User, CheckCircle2, Clock, PlayCircle, AlertCircle, Search, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

interface PatientResult { id: number; name: string; patient_code: string; }

function authHeaders() {
  const { t } = useTranslation('clinical');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface Dictation {
  DictationId: number;
  PatientId: number;
  DictationText: string;
  AdditionalNotes: string;
  Priority: 'normal' | 'urgent' | 'stat';
  Status: string;
  CreatedAt: string;
}

export default function DictationPage({ role }: { role?: string }) {
  const [dictations, setDictations] = useState<Dictation[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const [showNewModal, setShowNewModal] = useState(false);
  const [showTranscribeModal, setShowTranscribeModal] = useState<number | null>(null);

  // New Dictation State
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [newPriority, setNewPriority] = useState<'normal' | 'urgent' | 'stat'>('normal');
  const [newText, setNewText] = useState(''); // Text replacement for audio in MVP
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Transcription State
  const [transcriptionText, setTranscriptionText] = useState('');
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const [listRes, statsRes] = await Promise.all([
        axios.get(`/api/dictation${qs}`, { headers: authHeaders() }),
        axios.get('/api/dictation/stats', { headers: authHeaders() })
      ]);
      setDictations(listRes.data?.Results || []);
      setStats(statsRes.data?.Results || {});
    } catch {
      toast.error(t('clinical.failed_to_load_dictations'));
    } finally {
      setLoading(false);
    }
  };

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return toast.error(t('clinical.select_a_patient'));
    setSaving(true);
    try {
      await axios.post('/api/dictation', {
        PatientId: selectedPatient.id,
        Priority: newPriority,
        DictationText: newText,
        AdditionalNotes: newNotes,
        IsSpeechToTextEnabled: false,
      }, { headers: authHeaders() });
      toast.success(t('clinical.dictation_created'));
      setShowNewModal(false);
      resetForm();
      loadData();
    } catch {
      toast.error(t('clinical.failed_to_create_dictation'));
    } finally {
      setSaving(false);
    }
  };

  const handleTranscribeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showTranscribeModal || !transcriptionText) return;
    setTranscribing(true);
    try {
      await axios.put(`/api/dictation/${showTranscribeModal}/transcription`, {
        TranscriptionText: transcriptionText,
      }, { headers: authHeaders() });
      toast.success(t('clinical.transcription_saved'));
      setShowTranscribeModal(null);
      setTranscriptionText('');
      loadData();
    } catch {
      toast.error(t('clinical.failed_to_save_transcription'));
    } finally {
      setTranscribing(false);
    }
  };

  const resetForm = () => {
    setSearch('');
    setSelectedPatient(null);
    setNewPriority('normal');
    setNewText('');
    setNewNotes('');
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mic className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="page-title">Dictations</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Manage medical recordings & transcriptions</p>
            </div>
          </div>
          <button onClick={() => setShowNewModal(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Dictation
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="card p-4 flex flex-col cursor-pointer hover:border-indigo-500 transition-colors" onClick={() => setStatusFilter('')}>
            <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">All</span>
            <span className="text-2xl font-bold mt-1 text-[var(--color-text)]">
              {(stats.pending || 0) + (stats.inProgress || 0) + (stats.completed || 0)}
            </span>
          </div>
          <div className="card p-4 flex flex-col cursor-pointer hover:border-blue-500 transition-colors" onClick={() => setStatusFilter('pending')}>
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Pending</span>
            <span className="text-2xl font-bold mt-1 text-blue-700">{stats.pending || 0}</span>
          </div>
          <div className="card p-4 flex flex-col cursor-pointer hover:border-amber-500 transition-colors" onClick={() => setStatusFilter('in-progress')}>
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">In Progress</span>
            <span className="text-2xl font-bold mt-1 text-amber-700">{stats.inProgress || 0}</span>
          </div>
          <div className="card p-4 flex flex-col cursor-pointer hover:border-emerald-500 transition-colors" onClick={() => setStatusFilter('completed')}>
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Completed</span>
            <span className="text-2xl font-bold mt-1 text-emerald-700">{stats.completed || 0}</span>
          </div>
          <div className="card p-4 flex flex-col cursor-pointer hover:border-red-500 transition-colors" onClick={() => setStatusFilter('cancelled')}>
            <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">Cancelled</span>
            <span className="text-2xl font-bold mt-1 text-red-700">{stats.cancelled || 0}</span>
          </div>
        </div>

        {/* List */}
        <div className="card overflow-hidden">
          {loading ? (
             <div className="p-12 text-center text-[var(--color-text-muted)]">Loading...</div>
          ) : dictations.length === 0 ? (
             <div className="p-12 text-center flex flex-col items-center">
               <FileText className="w-12 h-12 text-[var(--color-text-muted)] opacity-20 mb-3" />
               <p className="text-[var(--color-text-muted)]">No dictations found.</p>
             </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Patient ID</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dictations.map(doc => (
                    <tr key={doc.DictationId}>
                      <td className="font-data text-xs whitespace-nowrap">DICT-{doc.DictationId.toString().padStart(4, '0')}</td>
                      <td className="font-data text-sm">{new Date(doc.CreatedAt).toLocaleDateString()}</td>
                      <td className="font-data text-sm">PT-{doc.PatientId}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                          doc.Priority === 'stat' ? 'bg-red-100 text-red-700' :
                          doc.Priority === 'urgent' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {doc.Priority.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          doc.Status === 'completed' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' :
                          doc.Status === 'pending' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                          'border-amber-200 text-amber-700 bg-amber-50'
                        }`}>
                          {doc.Status.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-right">
                        {doc.Status !== 'completed' && (
                           <button 
                             onClick={() => setShowTranscribeModal(doc.DictationId)}
                             className="text-indigo-600 hover:text-indigo-700 text-xs font-bold"
                           >
                             TRANSCRIBE
                           </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-[var(--color-bg-primary)] rounded-2xl shadow-xl w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-bold text-[var(--color-text)]">Record Dictation</h3>
              <button onClick={() => setShowNewModal(false)} className="btn btn-secondary p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-5">
              
              <div>
                <label className="label">{t('common.patient')}</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    required
                    placeholder={t("common.search_patient")}
                    value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSelectedPatient(null);
                    }}
                    className="input w-full pl-9"
                  />
                  {patients.length > 0 && !selectedPatient && (
                    <div className="absolute z-10 left-0 right-0 top-full bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {patients.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setSelectedPatient(p); setSearch(''); setPatients([]); }}
                          className="w-full text-left px-4 py-2 hover:bg-[var(--color-bg-secondary)]"
                        >
                          <span className="font-medium text-sm">{p.name}</span>
                          <span className="text-xs text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="label">{t('common.priority')}</label>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)} className="input w-full">
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>

              <div>
                <label className="label">{t('common.audiotext_input')}</label>
                <textarea 
                  required 
                  rows={4} 
                  placeholder={t("common.in_this_mvp_enter_the_text_draft_or_notes_the_physician_woul")}
                  value={newText} 
                  onChange={e => setNewText(e.target.value)} 
                  className="input w-full"
                />
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving || !selectedPatient} className="btn btn-primary min-w-[100px]">
                  {saving ? 'Saving...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transcribe Modal */}
      {showTranscribeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-[var(--color-bg-primary)] rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-gray-50/50 dark:bg-gray-900/50">
              <h3 className="font-bold text-[var(--color-text)]">Transcribe Dictation</h3>
              <button onClick={() => setShowTranscribeModal(null)} className="btn btn-secondary p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleTranscribeSubmit} className="p-6 space-y-5">
              
              <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg border border-[var(--color-border)]">
                <h4 className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider mb-2">Original Dictation Text/Notes</h4>
                <p className="text-sm font-medium">
                  {dictations.find(d => d.DictationId === showTranscribeModal)?.DictationText || 'No text provided.'}
                </p>
              </div>

              <div>
                <label className="label">{t('common.final_transcription_text')}</label>
                <textarea 
                  required 
                  rows={8} 
                  placeholder={t("common.type_full_clinical_transcription_here")}
                  value={transcriptionText} 
                  onChange={e => setTranscriptionText(e.target.value)} 
                  className="input w-full font-mono text-sm leading-relaxed"
                />
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowTranscribeModal(null)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={transcribing} className="btn bg-indigo-600 text-white hover:bg-indigo-700 min-w-[120px]">
                  {transcribing ? 'Completing...' : 'Complete Transcription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </DashboardLayout>
  );
}
