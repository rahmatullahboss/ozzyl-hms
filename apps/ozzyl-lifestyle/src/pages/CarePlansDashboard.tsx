import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus, X, User, Activity, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('nursing');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
}

interface CarePlan {
  CarePlanId: number;
  PatientId: number;
  CarePlanType: string;
  Description: string;
  PlanStatus: string;
  CreatedDate: string;
  GoalCount?: number;
}

export default function CarePlansDashboard({ role }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [carePlans, setCarePlans] = useState<CarePlan[]>([]);
  const [loading, setLoading] = useState(false);

  // New Care Plan Form State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [newPlan, setNewPlan] = useState({
    CarePlanType: 'General',
    Description: '',
    PlanStatus: 'draft'
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

  const loadCarePlans = async (patientId: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/clinical/care-plans?patientId=${patientId}`, { headers: authHeaders() });
      setCarePlans(res.data?.Results ?? []);
    } catch {
      toast.error(t('nursing.failed_to_load_care_plans'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    loadCarePlans(p.id);
  };

  const handleSaveCarePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!newPlan.Description) return toast.error(t('nursing.description_is_required'));
    
    setSaving(true);
    try {
      await axios.post('/api/clinical/care-plans', {
        PatientId: selectedPatient.id,
        CarePlanType: newPlan.CarePlanType,
        Description: newPlan.Description,
        PlanStatus: newPlan.PlanStatus,
      }, { headers: authHeaders() });
      
      toast.success(t('nursing.care_plan_saved_successfully'));
      setShowModal(false);
      setNewPlan({ CarePlanType: 'General', Description: '', PlanStatus: 'draft' });
      loadCarePlans(selectedPatient.id);
    } catch (err) {
      toast.error(t('nursing.failed_to_save_care_plan'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <ClipboardList className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Care Plans</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Manage patient goals and interventions</p>
            </div>
          </div>
        </div>

        <div className="card p-4 relative border-t-4 border-t-blue-500">
          <label className="label">{t('nursing.patient_search')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("nursing.search_by_name_or_code")}
              value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedPatient(null);
                setCarePlans([]);
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
              <h3 className="section-title">Care Plans</h3>
              <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Plan
              </button>
            </div>
            {loading ? (
               <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
            ) : carePlans.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No care plans recorded for this patient.</p>
              </div>
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Goals</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {carePlans.map(cp => (
                    <tr key={cp.CarePlanId}>
                      <td className="font-data">{new Date(cp.CreatedDate).toLocaleDateString()}</td>
                      <td>{cp.CarePlanType}</td>
                      <td className="max-w-[200px] truncate">{cp.Description}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          cp.PlanStatus === 'active' ? 'bg-emerald-100 text-emerald-700' :
                          cp.PlanStatus === 'draft' ? 'bg-gray-100 text-gray-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {cp.PlanStatus.toUpperCase()}
                        </span>
                      </td>
                      <td>{cp.GoalCount || 0}</td>
                      <td>
                        <button className="text-blue-600 hover:text-blue-700 text-xs font-semibold">View Details</button>
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
                <div className="bg-blue-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">New Care Plan</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient?.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveCarePlan} className="p-6 space-y-4">
              <div>
                <label className="label">{t('nursing.care_plan_type')}</label>
                <select 
                  className="input w-full"
                  value={newPlan.CarePlanType}
                  onChange={e => setNewPlan(p => ({...p, CarePlanType: e.target.value}))}
                >
                  <option value="General">General</option>
                  <option value="Chronic Condition">Chronic Condition</option>
                  <option value="Post-Op">Post-Op</option>
                  <option value="Mental Health">Mental Health</option>
                  <option value="Preventative">Preventative</option>
                </select>
              </div>
              
              <div>
                <label className="label">{t('nursing.description_summary')}</label>
                <textarea
                  required
                  className="input w-full"
                  rows={3}
                  placeholder={t("nursing.describe_the_overall_strategy")}
                  value={newPlan.Description}
                  onChange={e => setNewPlan(p => ({...p, Description: e.target.value}))}
                />
              </div>

              <div>
                <label className="label">{t('nursing.status')}</label>
                <select 
                  className="input w-full"
                  value={newPlan.PlanStatus}
                  onChange={e => setNewPlan(p => ({...p, PlanStatus: e.target.value}))}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="on-hold">On Hold</option>
                  <option value="completed">Completed</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? 'Saving...' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
