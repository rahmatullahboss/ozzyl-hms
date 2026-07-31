import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { authHeader } from '../../utils/auth';

type AssessmentType = 'phq9' | 'gad7' | 'soap';

export default function AssessmentsTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [activeTab, setActiveTab] = useState<AssessmentType>('phq9');
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Forms
  const [phq9Answers, setPhq9Answers] = useState<number[]>(Array(9).fill(0));
  const [gad7Answers, setGad7Answers] = useState<number[]>(Array(7).fill(0));
  const [soapForm, setSoapForm] = useState({ subject: '', object: '', assessment: '', plan: '' });

  const fetchAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/clinical/assessments/${activeTab}?patientId=${patientId}`, { headers: authHeader() });
      setRecords(data.assessments || []);
    } catch {
      toast.error(t('toast.loadFailed', { type: t(`tabs.${activeTab}`) }));
    } finally {
      setLoading(false);
    }
  }, [patientId, activeTab]);

  useEffect(() => {
    if (patientId) fetchAssessments();
  }, [fetchAssessments, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let payload = {};

    if (activeTab === 'phq9') {
      const totalScore = phq9Answers.reduce((a, b) => a + b, 0);
      let severity = 'minimal';
      if (totalScore >= 5) severity = 'mild';
      if (totalScore >= 10) severity = 'moderate';
      if (totalScore >= 15) severity = 'moderately severe';
      if (totalScore >= 20) severity = 'severe';

      payload = {
        answers_json: JSON.stringify(phq9Answers),
        total_score: totalScore,
        severity,
        suicide_risk_score: phq9Answers[8]
      };
    } else if (activeTab === 'gad7') {
      const totalScore = gad7Answers.reduce((a, b) => a + b, 0);
      let severity = 'minimal';
      if (totalScore >= 5) severity = 'mild';
      if (totalScore >= 10) severity = 'moderate';
      if (totalScore >= 15) severity = 'severe';

      payload = {
        answers_json: JSON.stringify(gad7Answers),
        total_score: totalScore,
        severity
      };
    } else if (activeTab === 'soap') {
      payload = soapForm;
    }

    try {
      await axios.post(`/api/clinical/assessments/${activeTab}`, {
        patient_id: patientId,
        ...payload
      }, { headers: authHeader() });
      toast.success(t('toast.assessmentSaved'));
      setShowAdd(false);
      setPhq9Answers(Array(9).fill(0));
      setGad7Answers(Array(7).fill(0));
      setSoapForm({ subject: '', object: '', assessment: '', plan: '' });
      fetchAssessments();
    } catch (err) {
      toast.error(t('toast.assessmentSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const PHQ9_QUESTIONS = [
    t('assessments.phq9.q1'),
    t('assessments.phq9.q2'),
    t('assessments.phq9.q3'),
    t('assessments.phq9.q4'),
    t('assessments.phq9.q5'),
    t('assessments.phq9.q6'),
    t('assessments.phq9.q7'),
    t('assessments.phq9.q8'),
    t('assessments.phq9.q9')
  ];

  const GAD7_QUESTIONS = [
    t('assessments.gad7.q1'),
    t('assessments.gad7.q2'),
    t('assessments.gad7.q3'),
    t('assessments.gad7.q4'),
    t('assessments.gad7.q5'),
    t('assessments.gad7.q6'),
    t('assessments.gad7.q7')
  ];

  const getScoreColor = (score: number, type: 'phq9' | 'gad7') => {
    if (type === 'phq9') {
      if (score >= 20) return 'bg-red-100 text-red-700';
      if (score >= 15) return 'bg-orange-100 text-orange-700';
      if (score >= 10) return 'bg-amber-100 text-amber-700';
      if (score >= 5) return 'bg-yellow-100 text-yellow-700';
      return 'bg-green-100 text-green-700';
    } else {
      if (score >= 15) return 'bg-red-100 text-red-700';
      if (score >= 10) return 'bg-amber-100 text-amber-700';
      if (score >= 5) return 'bg-yellow-100 text-yellow-700';
      return 'bg-green-100 text-green-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          {['phq9', 'gad7', 'soap'].map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab as AssessmentType); setShowAdd(false); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md uppercase ${
                activeTab === tab ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAssessments} className="btn-ghost" title={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('assessments.new')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-5 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-4 uppercase">
            {t('assessments.newTyped', { type: activeTab })}
          </h3>
          <form onSubmit={handleAdd}>
            {activeTab === 'phq9' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 mb-2">{t('assessments.phq9.instruction')}</p>
                {PHQ9_QUESTIONS.map((q, i) => (
                  <div key={i} className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3 gap-2">
                    <span className="text-sm font-medium">{i + 1}. {q}</span>
                    <select
                      value={phq9Answers[i]}
                      onChange={e => {
                        const newAnswers = [...phq9Answers];
                        newAnswers[i] = Number(e.target.value);
                        setPhq9Answers(newAnswers);
                      }}
                      className="input w-full md:w-48 text-sm"
                    >
                      <option value={0}>{t('assessments.scale.notAtAll')}</option>
                      <option value={1}>{t('assessments.scale.severalDays')}</option>
                      <option value={2}>{t('assessments.scale.moreThanHalf')}</option>
                      <option value={3}>{t('assessments.scale.nearlyEveryDay')}</option>
                    </select>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 font-bold">
                  <span>{t('assessments.totalScore')}:</span>
                  <span className="text-lg text-indigo-600">{phq9Answers.reduce((a, b) => a + b, 0)}</span>
                </div>
              </div>
            )}

            {activeTab === 'gad7' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 mb-2">{t('assessments.gad7.instruction')}</p>
                {GAD7_QUESTIONS.map((q, i) => (
                  <div key={i} className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3 gap-2">
                    <span className="text-sm font-medium">{i + 1}. {q}</span>
                    <select
                      value={gad7Answers[i]}
                      onChange={e => {
                        const newAnswers = [...gad7Answers];
                        newAnswers[i] = Number(e.target.value);
                        setGad7Answers(newAnswers);
                      }}
                      className="input w-full md:w-48 text-sm"
                    >
                      <option value={0}>{t('assessments.scale.notAtAll')}</option>
                      <option value={1}>{t('assessments.scale.severalDays')}</option>
                      <option value={2}>{t('assessments.scale.moreThanHalf')}</option>
                      <option value={3}>{t('assessments.scale.nearlyEveryDay')}</option>
                    </select>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 font-bold">
                  <span>{t('assessments.totalScore')}:</span>
                  <span className="text-lg text-indigo-600">{gad7Answers.reduce((a, b) => a + b, 0)}</span>
                </div>
              </div>
            )}

            {activeTab === 'soap' && (
              <div className="space-y-4">
                <div>
                  <label className="label font-bold text-gray-700">{t('assessments.soap.subjective')} {t('common.required')}</label>
                  <textarea required value={soapForm.subject} onChange={e => setSoapForm({...soapForm, subject: e.target.value})} className="input min-h-[80px]" placeholder={t('assessments.soap.subjectivePlaceholder')} />
                </div>
                <div>
                  <label className="label font-bold text-gray-700">{t('assessments.soap.objective')} {t('common.required')}</label>
                  <textarea required value={soapForm.object} onChange={e => setSoapForm({...soapForm, object: e.target.value})} className="input min-h-[80px]" placeholder={t('assessments.soap.objectivePlaceholder')} />
                </div>
                <div>
                  <label className="label font-bold text-gray-700">{t('assessments.soap.assessment')} {t('common.required')}</label>
                  <textarea required value={soapForm.assessment} onChange={e => setSoapForm({...soapForm, assessment: e.target.value})} className="input min-h-[80px]" placeholder={t('assessments.soap.assessmentPlaceholder')} />
                </div>
                <div>
                  <label className="label font-bold text-gray-700">{t('assessments.soap.plan')} {t('common.required')}</label>
                  <textarea required value={soapForm.plan} onChange={e => setSoapForm({...soapForm, plan: e.target.value})} className="input min-h-[80px]" placeholder={t('assessments.soap.planPlaceholder')} />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('assessments.save')}</button>
            </div>
          </form>
        </div>
      )}

      {/* List View */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-500 border border-gray-200 dark:border-gray-800 rounded-lg">{t('assessments.none')}</div>
        ) : (
          records.map(r => (
            <div key={r.id} className="card p-4">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                {r.total_score !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{t('assessments.score')}: {r.total_score}</span>
                    <span className={`badge ${getScoreColor(r.total_score, activeTab as any)} capitalize`}>{r.severity}</span>
                  </div>
                )}
              </div>
              
              {activeTab === 'soap' && (
                <div className="space-y-2 mt-3">
                  <div><span className="font-bold text-gray-700 dark:text-gray-300">{t('assessments.soap.s')}:</span> <span className="text-gray-600 dark:text-gray-400">{r.subject}</span></div>
                  <div><span className="font-bold text-gray-700 dark:text-gray-300">{t('assessments.soap.o')}:</span> <span className="text-gray-600 dark:text-gray-400">{r.object}</span></div>
                  <div><span className="font-bold text-gray-700 dark:text-gray-300">{t('assessments.soap.a')}:</span> <span className="text-gray-600 dark:text-gray-400">{r.assessment}</span></div>
                  <div><span className="font-bold text-gray-700 dark:text-gray-300">{t('assessments.soap.p')}:</span> <span className="text-gray-600 dark:text-gray-400">{r.plan}</span></div>
                </div>
              )}
              
              {(activeTab === 'phq9' || activeTab === 'gad7') && (
                <div className="mt-2 text-sm text-gray-500">
                  {t('assessments.detailStored')}
                  {r.suicide_risk_score > 0 && <div className="mt-2 text-red-600 font-bold">⚠️ {t('assessments.suicideRisk')} ({t('assessments.score')}: {r.suicide_risk_score})</div>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
