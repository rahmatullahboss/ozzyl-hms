import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, Eye } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDisplayDate } from '../../lib/date-utils';

interface ROSAssessment {
  ROSId: number;
  PatientId: number;
  Activity: number;
  WeightChange?: string;
  Weakness?: string;
  Fatigue?: string;
  Anorexia?: string;
  Fever?: string;
  Chills?: string;
  NightSweats?: string;
  Insomnia?: string;
  Irritability?: string;
  Headache?: string;
  Dizziness?: string;
  Syncope?: string;
  Seizures?: string;
  Numbness?: string;
  Tremor?: string;
  MemoryLoss?: string;
  ChestPain?: string;
  Palpitations?: string;
  ShortOfBreath?: string;
  Edema?: string;
  Cough?: string;
  Sputum?: string;
  Hemoptysis?: string;
  Wheezing?: string;
  NauseaVomiting?: string;
  Diarrhea?: string;
  Constipation?: string;
  Heartburn?: string;
  AbdominalPain?: string;
  Frequency?: string;
  Urgency?: string;
  Dysuria?: string;
  Hematuria?: string;
  JointPain?: string;
  Swelling?: string;
  BackPain?: string;
  Rash?: string;
  Itching?: string;
  Lumps?: string;
  Bruising?: string;
  EyePain?: string;
  Blindness?: string;
  Blurring?: string;
  EarDeafness?: string;
  EarPain?: string;
  EarDischarge?: string;
  NoseBleedingNose?: string;
  ThroatSoreThroat?: string;
  CreatedAt: string;
}

const ROS_SECTIONS = [
  {
    title: 'Constitutional',
    fields: ['WeightChange', 'Weakness', 'Fatigue', 'Anorexia', 'Fever', 'Chills', 'NightSweats', 'Insomnia', 'Irritability'] as const,
  },
  {
    title: 'Neurological',
    fields: ['Headache', 'Dizziness', 'Syncope', 'Seizures', 'Numbness', 'Tremor', 'MemoryLoss'] as const,
  },
  {
    title: 'Cardiovascular',
    fields: ['ChestPain', 'Palpitations', 'ShortOfBreath', 'Edema'] as const,
  },
  {
    title: 'Respiratory',
    fields: ['Cough', 'Sputum', 'Hemoptysis', 'Wheezing'] as const,
  },
  {
    title: 'Gastrointestinal',
    fields: ['NauseaVomiting', 'Diarrhea', 'Constipation', 'Heartburn', 'AbdominalPain'] as const,
  },
  {
    title: 'Genitourinary',
    fields: ['Frequency', 'Urgency', 'Dysuria', 'Hematuria'] as const,
  },
  {
    title: 'Musculoskeletal',
    fields: ['JointPain', 'Swelling', 'BackPain'] as const,
  },
  {
    title: 'Integumentary',
    fields: ['Rash', 'Itching', 'Lumps', 'Bruising'] as const,
  },
  {
    title: 'Eyes & ENT',
    fields: ['EyePain', 'Blindness', 'Blurring', 'EarDeafness', 'EarPain', 'EarDischarge', 'NoseBleedingNose', 'ThroatSoreThroat'] as const,
  },
];

const STATUS_OPTIONS = ['N/A', 'Normal', 'Abnormal', 'Not Examined'];

export default function ROSTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [assessments, setAssessments] = useState<ROSAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<ROSAssessment | null>(null);

  const [form, setForm] = useState<Record<string, string>>({});

  const fetchAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ Results: ROSAssessment[] }>(`/api/clinical/ros?patientId=${patientId}`);
      setAssessments(data.Results || []);
    } catch {
      toast.error(t('toast.rosLoadFailed', 'Failed to load ROS'));
    } finally {
      setLoading(false);
    }
  }, [patientId, t]);

  useEffect(() => {
    if (patientId) fetchAssessments();
  }, [fetchAssessments, patientId]);

  const initForm = () => {
    const f: Record<string, string> = {};
    ROS_SECTIONS.forEach(section => {
      section.fields.forEach(field => {
        f[field] = 'N/A';
      });
    });
    setForm(f);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/clinical/ros', {
        method: 'POST',
        body: { PatientId: patientId, Activity: 1, ...form },
      });
      toast.success(t('toast.rosAdded', 'ROS saved'));
      setShowAdd(false);
      fetchAssessments();
    } catch (err: any) {
      toast.error(err?.message || t('toast.rosAddFailed', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const parseROSValues = (record: ROSAssessment) => {
    const abnormal: string[] = [];
    const normal: string[] = [];
    ROS_SECTIONS.forEach(section => {
      section.fields.forEach(field => {
        const val = record[field] as string | undefined;
        if (val === 'Abnormal') abnormal.push(field);
        else if (val === 'Normal') normal.push(field);
      });
    });
    return { abnormal, normal };
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('ros.title', 'Review of Systems')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchAssessments} className="btn-ghost" title={t('common.refresh')} aria-label={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => { initForm(); setViewing(null); setShowAdd(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('ros.add', 'New ROS')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-4">{t('ros.new', 'New Review of Systems')}</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            {ROS_SECTIONS.map(section => (
              <fieldset key={section.title} className="border border-gray-200 dark:border-gray-700 rounded p-3">
                <legend className="text-xs font-semibold text-gray-600 dark:text-gray-400 px-1">{section.title}</legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
                  {section.fields.map(field => (
                    <div key={field} className="flex items-center justify-between gap-2">
                      <label className="text-xs text-gray-600 dark:text-gray-400 w-24 truncate">{field}</label>
                      <select
                        value={form[field] || 'N/A'}
                        onChange={e => {
                          const val = e.target.value;
                          setForm(prev => {
                            const copy = { ...prev };
                            copy[field] = val;
                            if (val === 'Abnormal') {
                              copy[field] = 'Abnormal';
                            }
                            return copy;
                          });
                        }}
                        className="input py-1 px-2 text-xs w-28"
                      >
                        {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common.saving') : t('ros.save', 'Save ROS')}</button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
        <div className="card p-4 border border-gray-200 dark:border-gray-800 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">{t('ros.detail', 'ROS Detail')}</h3>
            <button onClick={() => setViewing(null)} className="btn-ghost text-sm">{t('common.cancel')}</button>
          </div>
          <div className="text-sm text-gray-500 mb-2">Abnormal: {parseROSValues(viewing).abnormal.length === 0 ? <span className="text-green-600">None</span> : <span className="text-red-600">{parseROSValues(viewing).abnormal.join(', ')}</span>}</div>
          <div className="space-y-2">
            {ROS_SECTIONS.map(section => (
              <div key={section.title} className="grid grid-cols-4 gap-1 text-xs">
                <div className="font-medium col-span-4 text-gray-500 mb-1">{section.title}</div>
                {section.fields.map(field => {
                  const val = (viewing as any)[field];
                  return (
                    <div key={field} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${val === 'Abnormal' ? 'bg-red-500' : val === 'Normal' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="text-gray-600">{field}</span>
                      <span className={val === 'Abnormal' ? 'text-red-600 font-medium' : 'text-gray-400'}>{val || 'N/A'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('ros.abnormal', 'Abnormal')}</th>
              <th>{t('ros.normal', 'Normal')}</th>
              <th>Date</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : assessments.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-gray-500">{t('ros.none', 'No ROS assessments')}</td></tr>
            ) : (
              assessments.map(a => {
                const parsed = parseROSValues(a);
                return (
                  <tr key={a.ROSId}>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {parsed.abnormal.length === 0 ? (
                          <span className="badge bg-green-100 text-green-700 text-xs">None</span>
                        ) : (
                          parsed.abnormal.map(f => <span key={f} className="badge bg-red-100 text-red-700 text-xs">{f}</span>)
                        )}
                      </div>
                    </td>
                    <td className="text-xs text-gray-500">{parsed.normal.length} systems normal</td>
                    <td className="text-xs text-gray-500">{formatDisplayDate(a.CreatedAt)}</td>
                    <td className="text-right">
                      <button onClick={() => setViewing(a)} className="text-indigo-600 hover:bg-indigo-50 p-1.5 rounded" title={t('common.view', 'View')}>
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
