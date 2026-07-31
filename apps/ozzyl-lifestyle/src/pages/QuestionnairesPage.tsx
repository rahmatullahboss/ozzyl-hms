import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus, X, Activity, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('clinical');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface Questionnaire {
  QuestionnaireId: number;
  QuestionnaireCode: string;
  Title: string;
  Description: string;
  Category: string;
  Specialty: string;
  ScoringMethod: string;
}

interface QuestionnaireResponse {
  ResponseId: number;
  ResponseDate: string;
  PatientId: number;
  QuestionnaireTitle: string;
  TotalScore: number;
  ScoreInterpretation: string;
  RiskLevel: string;
}

export default function QuestionnairesPage({ role }: { role?: string }) {
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newResponse, setNewResponse] = useState({
    PatientId: '',
    EncounterId: '1',
    QuestionnaireId: '',
    LFormsResponse: {} as Record<string, any>,
  });

  const loadQuestionnaires = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/questionnaires`, { headers: authHeaders() });
      setQuestionnaires(res.data?.Results ?? []);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to load questionnaires');
      } else {
        toast.error(t('clinical.failed_to_load_questionnaires'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuestionnaires();
  }, [loadQuestionnaires]);

  const handleSaveResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResponse.PatientId || !newResponse.QuestionnaireId) return toast.error(t('clinical.please_fill_required_fields'));
    
    setSaving(true);
    try {
      await axios.post('/api/questionnaires/responses', {
        QuestionnaireId: Number(newResponse.QuestionnaireId),
        PatientId: Number(newResponse.PatientId),
        EncounterId: Number(newResponse.EncounterId),
        LFormsResponse: newResponse.LFormsResponse
      }, { headers: authHeaders() });
      
      toast.success(t('clinical.questionnaire_response_submitted_successfully'));
      setShowModal(false);
      setNewResponse({ ...newResponse, QuestionnaireId: '', PatientId: '', LFormsResponse: {} });
      setSelectedItems([]);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to submit response');
      } else {
        toast.error(t('clinical.failed_to_submit_response'));
      }
    } finally {
      setSaving(false);
    }
  };

  const getRiskBadge = (risk: string) => {
    switch(risk?.toLowerCase()) {
      case 'high': return 'bg-red-100 text-red-700';
      case 'medium': return 'bg-yellow-100 text-yellow-700';
      case 'low': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ClipboardList className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Questionnaires</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Manage PHQ-9, GAD-7, and clinical assessments</p>
            </div>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Log Response
          </button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
             <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
          ) : questionnaires.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium mb-4">No questionnaires found.</p>
              <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Log First Response
              </button>
            </div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Specialty</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {questionnaires.map(q => (
                  <tr key={q.QuestionnaireId}>
                    <td className="font-mono text-xs font-semibold text-indigo-600">{q.QuestionnaireCode}</td>
                    <td className="font-semibold">{q.Title}</td>
                    <td><span className="bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded-full text-xs font-medium">{q.Category || 'General'}</span></td>
                    <td className="text-[var(--color-text-muted)]">{q.Specialty || 'All'}</td>
                    <td>
                      <button className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold">Administer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">Administer Questionnaire</h3>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveResponse} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('common.patient_id')}</label>
                  <input
                    required
                    type="number"
                    className="input w-full"
                    placeholder={t("common.eg_1")}
                    value={newResponse.PatientId}
                    onChange={e => setNewResponse(p => ({...p, PatientId: e.target.value}))}
                  />
                </div>
                <div>
                  <label className="label">{t('common.questionnaire')}</label>
                  <select 
                    required
                    className="input w-full"
                    value={newResponse.QuestionnaireId}
                    onChange={async (e) => {
                      const id = e.target.value;
                      setNewResponse(p => ({...p, QuestionnaireId: id, LFormsResponse: {}}));
                      if (id) {
                        setLoadingItems(true);
                        try {
                          const res = await axios.get(`/api/questionnaires/${id}`, { headers: authHeaders() });
                          setSelectedItems(res.data?.Results?.items ?? []);
                        } catch {
                          toast.error(t('clinical.failed_to_load_questionnaire_items'));
                          setSelectedItems([]);
                        } finally {
                          setLoadingItems(false);
                        }
                      } else {
                        setSelectedItems([]);
                      }
                    }}
                  >
                    <option value="">Select...</option>
                    {questionnaires.map(q => (
                      <option key={q.QuestionnaireId} value={q.QuestionnaireId}>
                        {q.Title} ({q.QuestionnaireCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              {loadingItems ? (
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Loading items...</div>
              ) : selectedItems.length > 0 ? (
                <div className="space-y-4 max-h-64 overflow-y-auto pr-2 border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg-secondary)]/[0.3]">
                  {selectedItems.map(item => {
                    let options: Record<string, string> = {};
                    try { if (item.OptionsJson) options = JSON.parse(item.OptionsJson); } catch { /* */ }
                    return (
                      <div key={item.ItemId}>
                        <label className="label">{item.QuestionText} {item.IsRequired && <span className="text-red-500">*</span>}</label>
                        {item.InputType === 'choice' || item.InputType === 'dropdown' ? (
                          <select
                            required={item.IsRequired}
                            className="input w-full"
                            value={newResponse.LFormsResponse[item.ItemCode] ?? ''}
                            onChange={(e) => setNewResponse(p => ({
                              ...p, LFormsResponse: { ...p.LFormsResponse, [item.ItemCode]: e.target.value }
                            }))}
                          >
                            <option value="">-- Select --</option>
                            {Object.entries(options).map(([val, label]) => (
                               <option key={val} value={val}>{label as string}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={item.InputType === 'number' ? 'number' : 'text'}
                            required={item.IsRequired}
                            className="input w-full"
                            value={newResponse.LFormsResponse[item.ItemCode] ?? ''}
                            onChange={(e) => setNewResponse(p => ({
                              ...p, LFormsResponse: { ...p.LFormsResponse, [item.ItemCode]: e.target.value }
                            }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : newResponse.QuestionnaireId && (
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">No items available for this questionnaire.</div>
              )}

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? 'Submitting...' : 'Submit Answers'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
