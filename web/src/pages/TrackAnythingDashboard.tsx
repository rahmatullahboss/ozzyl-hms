import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Plus, X, User, Activity, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

interface Patient { id: number; name: string; patient_code: string; }
interface Config { ConfigurationId: number; TrackName: string; DataType: string; Units?: string; }
interface TrackData { DataId: number; TrackValue: string; TrackDate: string; Notes?: string; TrackName?: string; Units?: string; DataType?: string; }

export default function TrackAnythingDashboard({ role }: { role?: string }) {
  const { t } = useTranslation(['track-anything', 'common']);
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientData, setPatientData] = useState<TrackData[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newData, setNewData] = useState({
    ConfigurationId: '',
    TrackValue: '',
    Notes: ''
  });

  const queryClient = useQueryClient();

  // Load configurations via React Query
  const { data: configsData } = useApiQuery<{ Results: Config[] }>(
    queryKeys.trackAnything.configs(),
    '/api/track-anything/configs',
  );
  const configs = configsData?.Results ?? [];

  // Debounced patient search
  const searchPatients = useCallback(async () => {
    if (search.length < 2) { setPatients([]); return; }
    try {
      const res = await api.get<{ patients?: Patient[]; Results?: Patient[] }>(
        `/api/patients?search=${encodeURIComponent(search)}&limit=10`
      );
      setPatients(res?.patients ?? res?.Results ?? []);
    } catch { /* */ }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(searchPatients, 300);
    return () => clearTimeout(timer);
  }, [searchPatients]);

  const loadPatientData = async (patientId: number) => {
    setDataLoading(true);
    try {
      const res = await api.get<{ Results: TrackData[] }>(`/api/track-anything/patient/${patientId}/data`);
      setPatientData(res?.Results ?? []);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || t('track-anything:notifications.loadFailed');
      toast.error(msg);
    } finally {
      setDataLoading(false);
    }
  };

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    loadPatientData(p.id);
  };

  const handleSaveData = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!newData.ConfigurationId || !newData.TrackValue) return toast.error(t('common:please_fill_required_fields'));

    setSaving(true);
    try {
      await api.post('/api/track-anything/data', {
        PatientId: selectedPatient.id,
        ConfigurationId: Number(newData.ConfigurationId),
        TrackValue: newData.TrackValue,
        Notes: newData.Notes,
      });

      toast.success(t('track-anything:notifications.saveSuccess'));
      setShowModal(false);
      setNewData({ ConfigurationId: '', TrackValue: '', Notes: '' });
      loadPatientData(selectedPatient.id);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || t('track-anything:notifications.saveFailed');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('track-anything:title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('track-anything:subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="card p-4 relative border-t-4 border-t-purple-500">
          <label className="label">{t('track-anything:patientSearch')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("track-anything:searchPlaceholder")}
              value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedPatient(null);
                setPatientData([]);
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
              <h3 className="section-title">{t('track-anything:trackedData')}</h3>
              <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> {t('track-anything:addRecord')}
              </button>
            </div>
            {dataLoading ? (
               <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">{t('track-anything:loading')}</div>
            ) : patientData.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium mb-4">{t('track-anything:noData')}</p>
                <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                  <Plus className="w-4 h-4" /> {t('track-anything:addFirstRecord')}
                </button>
              </div>
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('track-anything:table.date')}</th>
                    <th>{t('track-anything:table.parameter')}</th>
                    <th>{t('track-anything:table.value')}</th>
                    <th>{t('track-anything:table.notes')}</th>
                    <th>{t('track-anything:table.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {patientData.map(d => (
                    <tr key={d.DataId}>
                      <td className="font-data">{new Date(d.TrackDate).toLocaleString()}</td>
                      <td className="font-semibold">{d.TrackName}</td>
                      <td>
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold tracking-wide">
                          {d.TrackValue} {d.Units}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate text-xs">{d.Notes || '—'}</td>
                      <td>
                        <button className="text-purple-600 hover:text-purple-700 text-xs font-semibold">{t('track-anything:table.edit')}</button>
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
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="bg-purple-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">{t('track-anything:modal.title')}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient?.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSaveData} className="p-6 space-y-4">
              <div>
                <label className="label">{t('track-anything:modal.parameter')}</label>
                <select
                  required
                  className="input w-full"
                  value={newData.ConfigurationId}
                  onChange={e => setNewData(p => ({...p, ConfigurationId: e.target.value}))}
                >
                  <option value="">{t('track-anything:modal.select')}</option>
                  {configs.map(c => (
                    <option key={c.ConfigurationId} value={c.ConfigurationId}>
                      {c.TrackName} {c.Units ? `(${c.Units})` : ''} - {c.DataType}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('track-anything:modal.value')}</label>
                <input
                  required
                  type={configs.find(c => c.ConfigurationId.toString() === newData.ConfigurationId)?.DataType === 'number' ? 'number' : 'text'}
                  step="any"
                  className="input w-full font-mono text-lg"
                  placeholder={t("track-anything:modal.placeholderValue")}
                  value={newData.TrackValue}
                  onChange={e => setNewData(p => ({...p, TrackValue: e.target.value}))}
                />
              </div>

              <div>
                <label className="label">{t('track-anything:modal.notes')}</label>
                <textarea
                  className="input w-full"
                  rows={2}
                  placeholder={t("track-anything:modal.placeholderNotes")}
                  value={newData.Notes}
                  onChange={e => setNewData(p => ({...p, Notes: e.target.value}))}
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">{t('track-anything:modal.cancel')}</button>
                <button type="submit" disabled={saving} className="btn bg-purple-600 hover:bg-purple-700 text-white min-w-[120px]">
                  {saving ? t('track-anything:modal.saving') : t('track-anything:modal.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
