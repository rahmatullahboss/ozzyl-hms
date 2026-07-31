import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { authHeader } from '../../utils/auth';

type HistoryType = 'family' | 'social' | 'surgical';

export default function HistoryTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [activeSubTab, setActiveSubTab] = useState<HistoryType>('family');
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states based on sub-tab
  const [familyForm, setFamilyForm] = useState({ icd10_code: '', relationship: '', note: '' });
  const [socialForm, setSocialForm] = useState({ smoking_history: '', alcohol_history: '', drug_history: '', occupation: '', note: '' });
  const [surgicalForm, setSurgicalForm] = useState({ surgery_type: '', surgery_date: '', icd10_code: '', note: '' });

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/clinical/history/${activeSubTab}?patientId=${patientId}`, { headers: authHeader() });
      setRecords(data.history || []);
    } catch {
      toast.error(t('toast.historyLoadFailed', { type: t(`history.${activeSubTab}`) }));
    } finally {
      setLoading(false);
    }
  }, [patientId, activeSubTab]);

  useEffect(() => {
    if (patientId) fetchHistory();
  }, [fetchHistory, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let payload = {};
    if (activeSubTab === 'family') payload = familyForm;
    else if (activeSubTab === 'social') payload = socialForm;
    else if (activeSubTab === 'surgical') payload = surgicalForm;

    try {
      await axios.post(`/api/clinical/history/${activeSubTab}`, {
        patient_id: patientId,
        ...payload
      }, { headers: authHeader() });
      toast.success(t('toast.historyAdded'));
      setShowAdd(false);
      // Reset forms
      setFamilyForm({ icd10_code: '', relationship: '', note: '' });
      setSocialForm({ smoking_history: '', alcohol_history: '', drug_history: '', occupation: '', note: '' });
      setSurgicalForm({ surgery_type: '', surgery_date: '', icd10_code: '', note: '' });
      fetchHistory();
    } catch (err) {
      toast.error(t('toast.historyAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('history.confirmDelete'))) return;
    try {
      await axios.delete(`/api/clinical/history/${activeSubTab}/${id}`, { headers: authHeader() });
      toast.success(t('toast.historyDeleted'));
      fetchHistory();
    } catch {
      toast.error(t('toast.historyDeleteFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          {['family', 'social', 'surgical'].map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveSubTab(tab as HistoryType); setShowAdd(false); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize ${
                activeSubTab === tab ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {t(`history.${tab}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchHistory} className="btn-ghost" title={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('history.add')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3 capitalize">
            {t('history.new', { type: t(`history.${activeSubTab}`) })}
          </h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {activeSubTab === 'family' && (
              <>
                <div><label className="label">{t('history.relationship')} {t('common.required')}</label><input type="text" required value={familyForm.relationship} onChange={e => setFamilyForm({...familyForm, relationship: e.target.value})} className="input" placeholder={t('placeholders.relationship')} /></div>
                <div><label className="label">{t('problems.icd10')}</label><input type="text" value={familyForm.icd10_code} onChange={e => setFamilyForm({...familyForm, icd10_code: e.target.value})} className="input" /></div>
                <div className="md:col-span-2"><label className="label">{t('history.notes')}</label><textarea value={familyForm.note} onChange={e => setFamilyForm({...familyForm, note: e.target.value})} className="input min-h-[80px]" /></div>
              </>
            )}

            {activeSubTab === 'social' && (
              <>
                <div><label className="label">{t('history.smoking')}</label><input type="text" value={socialForm.smoking_history} onChange={e => setSocialForm({...socialForm, smoking_history: e.target.value})} className="input" placeholder={t('placeholders.smokingHistory')} /></div>
                <div><label className="label">{t('history.alcohol')}</label><input type="text" value={socialForm.alcohol_history} onChange={e => setSocialForm({...socialForm, alcohol_history: e.target.value})} className="input" placeholder={t('placeholders.alcoholHistory')} /></div>
                <div><label className="label">{t('history.drug')}</label><input type="text" value={socialForm.drug_history} onChange={e => setSocialForm({...socialForm, drug_history: e.target.value})} className="input" /></div>
                <div><label className="label">{t('history.occupation')}</label><input type="text" value={socialForm.occupation} onChange={e => setSocialForm({...socialForm, occupation: e.target.value})} className="input" /></div>
                <div className="md:col-span-2"><label className="label">{t('history.notes')}</label><textarea value={socialForm.note} onChange={e => setSocialForm({...socialForm, note: e.target.value})} className="input min-h-[80px]" /></div>
              </>
            )}

            {activeSubTab === 'surgical' && (
              <>
                <div><label className="label">{t('history.surgeryType')} {t('common.required')}</label><input type="text" required value={surgicalForm.surgery_type} onChange={e => setSurgicalForm({...surgicalForm, surgery_type: e.target.value})} className="input" placeholder={t('placeholders.surgeryType')} /></div>
                <div><label className="label">{t('history.surgeryDate')}</label><input type="date" value={surgicalForm.surgery_date} onChange={e => setSurgicalForm({...surgicalForm, surgery_date: e.target.value})} className="input" /></div>
                <div><label className="label">{t('problems.icd10')}</label><input type="text" value={surgicalForm.icd10_code} onChange={e => setSurgicalForm({...surgicalForm, icd10_code: e.target.value})} className="input" /></div>
                <div className="md:col-span-2"><label className="label">{t('history.notes')}</label><textarea value={surgicalForm.note} onChange={e => setSurgicalForm({...surgicalForm, note: e.target.value})} className="input min-h-[80px]" /></div>
              </>
            )}

            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('history.save')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            {activeSubTab === 'family' && <tr><th>{t('history.relationship')}</th><th>{t('problems.icd10')}</th><th>{t('history.notes')}</th><th className="text-right">{t('common.actions')}</th></tr>}
            {activeSubTab === 'social' && <tr><th>{t('history.smoking')}</th><th>{t('history.alcohol')}</th><th>{t('history.drug')}</th><th>{t('history.occupation')}</th><th>{t('history.notes')}</th><th className="text-right">{t('common.actions')}</th></tr>}
            {activeSubTab === 'surgical' && <tr><th>{t('history.surgeryType')}</th><th>{t('history.surgeryDate')}</th><th>{t('problems.icd10')}</th><th>{t('history.notes')}</th><th className="text-right">{t('common.actions')}</th></tr>}
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">{t('history.none')}</td></tr>
            ) : (
              records.map(r => (
                <tr key={r.id}>
                  {activeSubTab === 'family' && <>
                    <td className="font-medium">{r.relationship}</td><td>{r.icd10_code || '-'}</td><td>{r.note || '-'}</td>
                  </>}
                  {activeSubTab === 'social' && <>
                    <td>{r.smoking_history || '-'}</td><td>{r.alcohol_history || '-'}</td><td>{r.drug_history || '-'}</td><td>{r.occupation || '-'}</td><td>{r.note || '-'}</td>
                  </>}
                  {activeSubTab === 'surgical' && <>
                    <td className="font-medium">{r.surgery_type}</td><td>{r.surgery_date ? new Date(r.surgery_date).toLocaleDateString() : '-'}</td><td>{r.icd10_code || '-'}</td><td>{r.note || '-'}</td>
                  </>}
                  <td className="text-right">
                    <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title={t('common.delete')}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
