import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, Eye, Shield, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDisplayDate } from '../../lib/date-utils';

interface SDOHAssessment {
  SDOHId: number;
  PatientId: number;
  EncounterId?: number;
  Education?: string;
  Housing?: string;
  HousingOtherInput?: string;
  WorkTemporary: number;
  WorkSeasonal: number;
  WorkLooking: number;
  WorkRetired: number;
  WorkDisabled: number;
  WorkHours?: number;
  HHSize?: number;
  HHIncome?: number;
  CareUnder5: number;
  CareOver65: number;
  CareChronicallyIll: number;
  CareDisabled: number;
  CareOther: number;
  CareOtherInput?: string;
  DebtMedical: number;
  DebtCreditCard: number;
  DebtStudentLoan: number;
  DebtMortgage: number;
  DebtRent: number;
  DebtUtilities: number;
  DebtOther: number;
  MoneyFood: number;
  MoneyHousing: number;
  MoneyUtilities: number;
  MoneyClothing: number;
  MoneyChildcare: number;
  MoneyMedical: number;
  MoneyOther: number;
  TransportMedical: number;
  TransportWork: number;
  TransportSchool: number;
  TransportFood: number;
  TransportOther: number;
  MedicalNoInsurance: number;
  MedicalCostMedication: number;
  MedicalCostVisit: number;
  MedicalNoProvider: number;
  MedicalLanguageBarrier: number;
  MedicalOther: number;
  Social?: string;
  Stress?: string;
  Safety?: string;
  PartnerSafety?: string;
  Addiction?: string;
  Score?: number;
  RiskLevel?: string;
  CreatedAt: string;
}

function computeLocalScore(data: Partial<SDOHAssessment>): { score: number; riskLevel: string } {
  let score = 0;
  const unstable = ['', 'own', 'rent_stable'];
  if (data.Housing && !unstable.includes(data.Housing)) score += 5;

  const workFlags = [data.WorkTemporary, data.WorkSeasonal, data.WorkLooking, data.WorkRetired, data.WorkDisabled];
  workFlags.forEach(f => { if (f) score += 3; });

  const debtFlags = [data.DebtMedical, data.DebtCreditCard, data.DebtStudentLoan, data.DebtMortgage, data.DebtRent, data.DebtUtilities, data.DebtOther];
  debtFlags.forEach(f => { if (f) score += 2; });

  const moneyFlags = [data.MoneyFood, data.MoneyHousing, data.MoneyUtilities, data.MoneyClothing, data.MoneyChildcare, data.MoneyMedical, data.MoneyOther];
  moneyFlags.forEach(f => { if (f) score += 2; });

  const transportFlags = [data.TransportMedical, data.TransportWork, data.TransportSchool, data.TransportFood, data.TransportOther];
  transportFlags.forEach(f => { if (f) score += 3; });

  const medicalFlags = [data.MedicalNoInsurance, data.MedicalCostMedication, data.MedicalCostVisit, data.MedicalNoProvider, data.MedicalLanguageBarrier, data.MedicalOther];
  medicalFlags.forEach(f => { if (f) score += 3; });

  const unsafe = ['yes', 'unsafe'];
  if (data.Safety && unsafe.includes(data.Safety)) score += 5;
  if (data.PartnerSafety && unsafe.includes(data.PartnerSafety)) score += 5;

  let riskLevel: string;
  if (score <= 5) riskLevel = 'Low';
  else if (score <= 15) riskLevel = 'Moderate';
  else if (score <= 30) riskLevel = 'High';
  else riskLevel = 'Critical';

  return { score, riskLevel };
}

const HOUSING_OPTIONS = ['', 'own', 'rent_stable', 'rent_unstable', 'shelter', 'homeless', 'other'];
const SOCIAL_OPTIONS = ['', 'good', 'fair', 'poor', 'isolated'];
const STRESS_OPTIONS = ['', 'low', 'moderate', 'high', 'severe'];

export default function SDOHTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [assessments, setAssessments] = useState<SDOHAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<SDOHAssessment | null>(null);

  const [form, setForm] = useState({
    Housing: '',
    HousingOtherInput: '',
    WorkTemporary: 0, WorkSeasonal: 0, WorkLooking: 0, WorkRetired: 0, WorkDisabled: 0,
    WorkHours: '',
    HHSize: '',
    HHIncome: '',
    CareUnder5: 0, CareOver65: 0, CareChronicallyIll: 0, CareDisabled: 0, CareOther: 0,
    DebtMedical: 0, DebtCreditCard: 0, DebtStudentLoan: 0, DebtMortgage: 0, DebtRent: 0, DebtUtilities: 0, DebtOther: 0,
    MoneyFood: 0, MoneyHousing: 0, MoneyUtilities: 0, MoneyClothing: 0, MoneyChildcare: 0, MoneyMedical: 0, MoneyOther: 0,
    TransportMedical: 0, TransportWork: 0, TransportSchool: 0, TransportFood: 0, TransportOther: 0,
    MedicalNoInsurance: 0, MedicalCostMedication: 0, MedicalCostVisit: 0, MedicalNoProvider: 0, MedicalLanguageBarrier: 0, MedicalOther: 0,
    Social: '',
    Stress: '',
    Safety: '',
    PartnerSafety: '',
    Addiction: '',
  });

  const fetchAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ Results: SDOHAssessment[] }>(`/api/clinical/sdoh?patientId=${patientId}`);
      setAssessments(data.Results || []);
    } catch {
      toast.error(t('toast.sdohLoadFailed', 'Failed to load SDOH data'));
    } finally {
      setLoading(false);
    }
  }, [patientId, t]);

  useEffect(() => {
    if (patientId) fetchAssessments();
  }, [fetchAssessments, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        PatientId: patientId,
        ...form,
        WorkHours: form.WorkHours ? Number(form.WorkHours) : undefined,
        HHSize: form.HHSize ? Number(form.HHSize) : undefined,
        HHIncome: form.HHIncome ? Number(form.HHIncome) : undefined,
      };
      await apiFetch('/api/clinical/sdoh', { method: 'POST', body: payload });
      toast.success(t('toast.sdohAdded', 'SDOH assessment saved'));
      setShowAdd(false);
      resetForm();
      fetchAssessments();
    } catch (err: any) {
      toast.error(err?.message || t('toast.sdohAddFailed', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setForm({
      Housing: '', HousingOtherInput: '',
      WorkTemporary: 0, WorkSeasonal: 0, WorkLooking: 0, WorkRetired: 0, WorkDisabled: 0,
      WorkHours: '', HHSize: '', HHIncome: '',
      CareUnder5: 0, CareOver65: 0, CareChronicallyIll: 0, CareDisabled: 0, CareOther: 0,
      DebtMedical: 0, DebtCreditCard: 0, DebtStudentLoan: 0, DebtMortgage: 0, DebtRent: 0, DebtUtilities: 0, DebtOther: 0,
      MoneyFood: 0, MoneyHousing: 0, MoneyUtilities: 0, MoneyClothing: 0, MoneyChildcare: 0, MoneyMedical: 0, MoneyOther: 0,
      TransportMedical: 0, TransportWork: 0, TransportSchool: 0, TransportFood: 0, TransportOther: 0,
      MedicalNoInsurance: 0, MedicalCostMedication: 0, MedicalCostVisit: 0, MedicalNoProvider: 0, MedicalLanguageBarrier: 0, MedicalOther: 0,
      Social: '', Stress: '', Safety: '', PartnerSafety: '', Addiction: '',
    });
  };

  const toggleFlag = (field: keyof typeof form) => {
    const current = form[field] as number;
    setForm({ ...form, [field]: current ? 0 : 1 });
  };

  const localScore = computeLocalScore(form as any);

  const activeFlags = (a: SDOHAssessment) => {
    const items: string[] = [];
    const labels: Record<string, string> = {
      WorkTemporary: 'Temp work', WorkSeasonal: 'Seasonal', WorkLooking: 'Unemployed', WorkRetired: 'Retired', WorkDisabled: 'Disabled',
      DebtMedical: 'Medical debt', DebtCreditCard: 'Credit debt', DebtStudentLoan: 'Student loan', DebtMortgage: 'Mortgage', DebtRent: 'Rent', DebtUtilities: 'Utilities', DebtOther: 'Other debt',
      MoneyFood: 'Food $', MoneyHousing: 'Housing $', MoneyUtilities: 'Utility $', MoneyClothing: 'Clothing $', MoneyChildcare: 'Childcare $', MoneyMedical: 'Medical $', MoneyOther: 'Money $',
      TransportMedical: 'Med transit', TransportWork: 'Work transit', TransportSchool: 'School transit', TransportFood: 'Food transit', TransportOther: 'Transit',
      MedicalNoInsurance: 'No insurance', MedicalCostMedication: 'Med $', MedicalCostVisit: 'Visit $', MedicalNoProvider: 'No provider', MedicalLanguageBarrier: 'Language', MedicalOther: 'Med other',
      CareUnder5: 'Child <5', CareOver65: 'Elder >65', CareChronicallyIll: 'Chronic ill', CareDisabled: 'Disabled care', CareOther: 'Other care',
    };
    Object.entries(labels).forEach(([key, label]) => {
      if (a[key as keyof SDOHAssessment] === 1) items.push(label);
    });
    if (a.Housing && a.Housing !== '' && a.Housing !== 'own' && a.Housing !== 'rent_stable') items.push(`Housing: ${a.Housing}`);
    if (a.Safety === 'yes' || a.Safety === 'unsafe') items.push('Safety concern');
    if (a.Stress === 'high' || a.Stress === 'severe') items.push('High stress');
    return items.slice(0, 6);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('sdoh.title', 'SDOH Assessments')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchAssessments} className="btn-ghost" title={t('common.refresh')} aria-label={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => { setViewing(null); setShowAdd(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('sdoh.add', 'New SDOH')}
          </button>
        </div>
      </div>

      {showAdd && !viewing && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('sdoh.new', 'New SDOH Assessment')}</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            {/* Housing */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label text-xs">{t('sdoh.housing', 'Housing')}</label>
                <select value={form.Housing} onChange={e => setForm({ ...form, Housing: e.target.value })} className="input text-sm">
                  {HOUSING_OPTIONS.map(o => <option key={o} value={o}>{o || 'Select...'}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('sdoh.social', 'Social')}</label>
                <select value={form.Social} onChange={e => setForm({ ...form, Social: e.target.value })} className="input text-sm">
                  {SOCIAL_OPTIONS.map(o => <option key={o} value={o}>{o || 'Select...'}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('sdoh.stress', 'Stress Level')}</label>
                <select value={form.Stress} onChange={e => setForm({ ...form, Stress: e.target.value })} className="input text-sm">
                  {STRESS_OPTIONS.map(o => <option key={o} value={o}>{o || 'Select...'}</option>)}
                </select>
              </div>
            </div>

            {/* Safety & Addiction */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label text-xs">{t('sdoh.safety', 'Safety Concerns')}</label>
                <select value={form.Safety} onChange={e => setForm({ ...form, Safety: e.target.value })} className="input text-sm">
                  <option value="">Select...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('sdoh.partnerSafety', 'Partner Safety')}</label>
                <select value={form.PartnerSafety} onChange={e => setForm({ ...form, PartnerSafety: e.target.value })} className="input text-sm">
                  <option value="">Select...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('sdoh.addiction', 'Addiction Concerns')}</label>
                <select value={form.Addiction} onChange={e => setForm({ ...form, Addiction: e.target.value })} className="input text-sm">
                  <option value="">Select...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            {/* Work Status Flags */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.workStatus', 'Work Status')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['WorkTemporary', 'WorkSeasonal', 'WorkLooking', 'WorkRetired', 'WorkDisabled'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Work', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Money Struggles */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.moneyStruggles', 'Money Struggles')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['MoneyFood', 'MoneyHousing', 'MoneyUtilities', 'MoneyClothing', 'MoneyChildcare', 'MoneyMedical', 'MoneyOther'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Money', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Debt */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.debt', 'Debt')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['DebtMedical', 'DebtCreditCard', 'DebtStudentLoan', 'DebtMortgage', 'DebtRent', 'DebtUtilities', 'DebtOther'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-purple-100 text-purple-700 border border-purple-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Debt', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Transport Barriers */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.transport', 'Transport Barriers')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['TransportMedical', 'TransportWork', 'TransportSchool', 'TransportFood', 'TransportOther'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Transport', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Medical Barriers */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.medicalBarriers', 'Medical Barriers')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['MedicalNoInsurance', 'MedicalCostMedication', 'MedicalCostVisit', 'MedicalNoProvider', 'MedicalLanguageBarrier', 'MedicalOther'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-teal-100 text-teal-700 border border-teal-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Medical', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Caregiving */}
            <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <legend className="text-xs font-medium text-gray-500 px-1">{t('sdoh.caregiving', 'Caregiving Burden')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['CareUnder5', 'CareOver65', 'CareChronicallyIll', 'CareDisabled', 'CareOther'] as const).map(f => (
                  <button key={f} type="button"
                    onClick={() => toggleFlag(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${form[f] ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'}`}
                  >
                    {f.replace('Care', '')}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Score Preview */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Shield className={`w-5 h-5 ${localScore.riskLevel === 'Critical' ? 'text-red-600' : localScore.riskLevel === 'High' ? 'text-orange-500' : localScore.riskLevel === 'Moderate' ? 'text-amber-500' : 'text-green-500'}`} />
              <span className="text-sm font-medium">{t('sdoh.riskScore', 'Risk Score')}: <strong>{localScore.score}</strong></span>
              <span className={`badge text-xs ${localScore.riskLevel === 'Critical' ? 'bg-red-100 text-red-700' : localScore.riskLevel === 'High' ? 'bg-orange-100 text-orange-700' : localScore.riskLevel === 'Moderate' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                {localScore.riskLevel}
              </span>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common.saving') : t('sdoh.save', 'Save Assessment')}</button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
        <div className="card p-4 border border-gray-200 dark:border-gray-800 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">{t('sdoh.detail', 'SDOH Detail')}</h3>
            <button onClick={() => setViewing(null)} className="btn-ghost text-sm">{t('common.cancel')}</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><span className="text-gray-500">{t('sdoh.housing', 'Housing')}:</span> {viewing.Housing || '-'}</div>
            <div><span className="text-gray-500">{t('sdoh.social', 'Social')}:</span> {viewing.Social || '-'}</div>
            <div><span className="text-gray-500">{t('sdoh.stress', 'Stress')}:</span> {viewing.Stress || '-'}</div>
            <div><span className="text-gray-500">{t('sdoh.safety', 'Safety')}:</span> {viewing.Safety || '-'}</div>
            <div><span className="text-gray-500">Score:</span> <strong>{viewing.Score ?? computeLocalScore(viewing).score}</strong></div>
            <div><span className="text-gray-500">Risk:</span> <span className={`badge text-xs ${viewing.RiskLevel === 'Critical' ? 'bg-red-100 text-red-700' : viewing.RiskLevel === 'High' ? 'bg-orange-100 text-orange-700' : viewing.RiskLevel === 'Moderate' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{viewing.RiskLevel || '-'}</span></div>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {activeFlags(viewing).map((f, i) => (
              <span key={i} className="badge bg-gray-100 text-gray-600 text-xs">{f}</span>
            ))}
          </div>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('sdoh.housing', 'Housing')}</th>
              <th>{t('sdoh.social', 'Social')}</th>
              <th>Score</th>
              <th>Risk</th>
              <th>Flags</th>
              <th>Date</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : assessments.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-500">{t('sdoh.none', 'No SDOH assessments')}</td></tr>
            ) : (
              assessments.map(a => {
                const flags = activeFlags(a);
                const score = a.Score ?? computeLocalScore(a).score;
                const risk = a.RiskLevel ?? computeLocalScore(a).riskLevel;
                return (
                  <tr key={a.SDOHId}>
                    <td>{a.Housing || '-'}</td>
                    <td>{a.Social || '-'}</td>
                    <td><strong>{score}</strong></td>
                    <td>
                      <span className={`badge text-xs ${risk === 'Critical' ? 'bg-red-100 text-red-700' : risk === 'High' ? 'bg-orange-100 text-orange-700' : risk === 'Moderate' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{risk}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {flags.map((f, i) => <span key={i} className="badge bg-gray-100 text-gray-600 text-xs">{f}</span>)}
                        {flags.length === 0 && <span className="text-gray-400">-</span>}
                      </div>
                    </td>
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
