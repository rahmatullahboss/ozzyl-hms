import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Plus, X, User, Activity, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('common');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface Patient { id: number; name: string; patient_code: string; }
interface Config { ConfigurationId: number; TrackName: string; DataType: string; Units?: string; }
interface TrackData { DataId: number; TrackValue: string; TrackDate: string; Notes?: string; TrackName?: string; Units?: string; DataType?: string; }

export default function TrackAnythingDashboard({ role }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [configs, setConfigs] = useState<Config[]>([]);
  const [patientData, setPatientData] = useState<TrackData[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newData, setNewData] = useState({
    ConfigurationId: '',
    TrackValue: '',
    Notes: ''
  });

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

  useEffect(() => {
    // Load configurations globally
    axios.get('/api/track-anything/configs', { headers: authHeaders() })
      .then(res => setConfigs(res.data?.Results ?? []))
      .catch(() => toast.error(t('common.failed_to_load_tracking_configurations')));
  }, []);

  const loadPatientData = async (patientId: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/track-anything/patient/${patientId}/data`, { headers: authHeaders() });
      setPatientData(res.data?.Results ?? []);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to load patient data');
      } else {
        toast.error(t('common.failed_to_load_patient_data'));
      }
    } finally {
      setLoading(false);
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
    if (!newData.ConfigurationId || !newData.TrackValue) return toast.error(t('common.please_fill_required_fields'));
    
    setSaving(true);
    try {
      await axios.post('/api/track-anything/data', {
        PatientId: selectedPatient.id,
        ConfigurationId: Number(newData.ConfigurationId),
        TrackValue: newData.TrackValue,
        Notes: newData.Notes,
      }, { headers: authHeaders() });
      
      toast.success(t('common.data_tracked_successfully'));
      setShowModal(false);
      setNewData({ ConfigurationId: '', TrackValue: '', Notes: '' });
      loadPatientData(selectedPatient.id);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to track data');
      } else {
        toast.error(t('common.failed_to_track_data'));
      }
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
              <h1 className="page-title">Track Anything</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Record and monitor custom patient metrics</p>
            </div>
          </div>
        </div>

        <div className="card p-4 relative border-t-4 border-t-purple-500">
          <label className="label">{t('dashboard.patient_search')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("dashboard.search_by_name_or_code")}
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
              <h3 className="section-title">Tracked Data</h3>
              <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Record
              </button>
            </div>
            {loading ? (
               <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
            ) : patientData.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium mb-4">No custom tracked data.</p>
                <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Add First Record
                </button>
              </div>
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Parameter</th>
                    <th>Value</th>
                    <th>Notes</th>
                    <th>Action</th>
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
                        <button className="text-purple-600 hover:text-purple-700 text-xs font-semibold">Edit</button>
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
                  <h3 className="font-bold text-[var(--color-text)]">New Tracking Record</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient?.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveData} className="p-6 space-y-4">
              <div>
                <label className="label">{t('dashboard.parameter_to_track')}</label>
                <select 
                  required
                  className="input w-full"
                  value={newData.ConfigurationId}
                  onChange={e => setNewData(p => ({...p, ConfigurationId: e.target.value}))}
                >
                  <option value="">-- Select --</option>
                  {configs.map(c => (
                    <option key={c.ConfigurationId} value={c.ConfigurationId}>
                      {c.TrackName} {c.Units ? `(${c.Units})` : ''} - {c.DataType}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="label">{t('dashboard.value')}</label>
                <input
                  required
                  type={configs.find(c => c.ConfigurationId.toString() === newData.ConfigurationId)?.DataType === 'number' ? 'number' : 'text'}
                  step="any"
                  className="input w-full font-mono text-lg"
                  placeholder={t("dashboard.enter_value")}
                  value={newData.TrackValue}
                  onChange={e => setNewData(p => ({...p, TrackValue: e.target.value}))}
                />
              </div>

              <div>
                <label className="label">{t('dashboard.notes_optional')}</label>
                <textarea
                  className="input w-full"
                  rows={2}
                  placeholder={t("dashboard.additional_context")}
                  value={newData.Notes}
                  onChange={e => setNewData(p => ({...p, Notes: e.target.value}))}
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn bg-purple-600 hover:bg-purple-700 text-white min-w-[120px]">
                  {saving ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
