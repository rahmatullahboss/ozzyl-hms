import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus, X, Activity, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

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
  const { t } = useTranslation(['clinical', 'common']);
  const queryClient = useQueryClient();

  // Load questionnaires via React Query
  const { data: questionnairesData, isLoading: loading } = useApiQuery<{ Results?: Questionnaire[] }>(
    queryKeys.questionnaires.list(),
    '/api/questionnaires',
  );
  const questionnaires: Questionnaire[] = (questionnairesData as any)?.Results ?? [];

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

  const handleSaveResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResponse.PatientId || !newResponse.QuestionnaireId) return toast.error(t('clinical:questionnaires.please_fill_required_fields'));

    setSaving(true);
    try {
      await api.post('/api/questionnaires/responses', {
        QuestionnaireId: Number(newResponse.QuestionnaireId),
        PatientId: Number(newResponse.PatientId),
        EncounterId: Number(newResponse.EncounterId),
        LFormsResponse: newResponse.LFormsResponse
      });

      toast.success(t('clinical:questionnaires.questionnaire_response_submitted_successfully'));
      setShowModal(false);
      setNewResponse({ ...newResponse, QuestionnaireId: '', PatientId: '', LFormsResponse: {} });
      setSelectedItems([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('clinical:questionnaires.failed_to_submit_response');
      toast.error(message);
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
              <h1 className="page-title">{t('clinical:questionnaires.title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('clinical:questionnaires.subtitle')}</p>
            </div>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('clinical:questionnaires.logResponse')}
          </button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
             <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">{t('common:loading')}</div>
          ) : questionnaires.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium mb-4">{t('clinical:questionnaires.noQuestionnaires')}</p>
              <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                <Plus className="w-4 h-4" /> {t('clinical:questionnaires.logFirstResponse')}
              </button>
            </div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>{t('clinical:questionnaires.code')}</th>
                  <th>{t('clinical:questionnaires.qTitle')}</th>
                  <th>{t('clinical:questionnaires.category')}</th>
                  <th>{t('clinical:questionnaires.specialty')}</th>
                  <th>{t('clinical:questionnaires.action')}</th>
                </tr>
              </thead>
              <tbody>
                {questionnaires.map(q => (
                  <tr key={q.QuestionnaireId}>
                    <td className="font-mono text-xs font-semibold text-indigo-600">{q.QuestionnaireCode}</td>
                    <td className="font-semibold">{q.Title}</td>
                    <td><span className="bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded-full text-xs font-medium">{q.Category || t('common:status.general')}</span></td>
                    <td className="text-[var(--color-text-muted)]">{q.Specialty || t('common:status.all')}</td>
                    <td>
                      <button className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold">{t('clinical:questionnaires.administer')}</button>
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
                  <h3 className="font-bold text-[var(--color-text)]">{t('clinical:questionnaires.administerQuestionnaire')}</h3>
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
                          const res = await api.get<{ Results?: { items?: any[] } }>(`/api/questionnaires/${id}`);
                          setSelectedItems((res as any)?.Results?.items ?? []);
                        } catch {
                          } finally {
                          setLoadingItems(false);
                        }
                      } else {
                        setSelectedItems([]);
                      }
                    }}
                  >
                    <option value="">{t('clinical:questionnaires.select')}</option>
                    {questionnaires.map(q => (
                      <option key={q.QuestionnaireId} value={q.QuestionnaireId}>
                        {q.Title} ({q.QuestionnaireCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {loadingItems ? (
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{t('clinical:questionnaires.loadingItems')}</div>
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
                            <option value="">-- {t('clinical:questionnaires.select')} --</option>
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
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{t('clinical:questionnaires.noItemsAvailable')}</div>
              )}

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">{t('common:cancel')}</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? t('clinical:questionnaires.submitting') : t('clinical:questionnaires.submitAnswers')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
