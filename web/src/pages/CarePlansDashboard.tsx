import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus, X, User, Activity, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

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

interface PatientsResponse {
  patients?: Patient[];
  Results?: Patient[];
}

interface CarePlansResponse {
  Results: CarePlan[];
}

export default function CarePlansDashboard({ role }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // New Care Plan Form State
  const [showModal, setShowModal] = useState(false);

  const [newPlan, setNewPlan] = useState({
    CarePlanType: 'General',
    Description: '',
    PlanStatus: 'draft'
  });

  // ─── Debounce the search input ───────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ─── Patient search query ────────────────────────────────────────────────────
  const patientsQuery = useApiQuery<PatientsResponse>(
    queryKeys.patients.list({ search: debouncedSearch, limit: 10 }),
    `/api/patients?search=${encodeURIComponent(debouncedSearch)}&limit=10`,
    {
      enabled: !selectedPatient && debouncedSearch.length >= 2,
    },
  );

  const patients = patientsQuery.data?.patients ?? patientsQuery.data?.Results ?? [];

  // ─── Care plans query (enabled when a patient is selected) ───────────────────
  const carePlansQuery = useApiQuery<CarePlansResponse>(
    queryKeys.carePlans.list(selectedPatient?.id ?? 0),
    `/api/clinical/care-plans?patientId=${selectedPatient?.id}`,
    {
      enabled: !!selectedPatient,
    },
  );

  const carePlans = carePlansQuery.data?.Results ?? [];
  const loading = carePlansQuery.isLoading;

  // ─── Create care plan mutation ───────────────────────────────────────────────
  const createCarePlanMutation = useApiMutation<unknown, {
    PatientId: number;
    CarePlanType: string;
    Description: string;
    PlanStatus: string;
  }>(
    'post',
    '/api/clinical/care-plans',
    {
      onSuccess: () => {
        toast.success(t('carePlans.carePlanSaved'));
        setShowModal(false);
        setNewPlan({ CarePlanType: 'General', Description: '', PlanStatus: 'draft' });
        if (selectedPatient) {
          queryClient.invalidateQueries({ queryKey: queryKeys.carePlans.list(selectedPatient.id) });
        }
      },
      onError: () => {
        toast.error(t('carePlans.failedToSave'));
      },
    },
  );

  const saving = createCarePlanMutation.isPending;

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setSearch('');
    setDebouncedSearch('');
  };

  const handleSaveCarePlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!newPlan.Description) return toast.error(t('carePlans.descriptionRequired'));

    createCarePlanMutation.mutate({
      PatientId: selectedPatient.id,
      CarePlanType: newPlan.CarePlanType,
      Description: newPlan.Description,
      PlanStatus: newPlan.PlanStatus,
    });
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
              <h1 className="page-title">{t('carePlans.title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('carePlans.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="card p-4 relative border-t-4 border-t-blue-500 text-left">
          <label className="label">{t('patient_search')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("search_by_name_or_code")}
              value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedPatient(null);
              }}
              className="input w-full pl-9"
            />
          </div>
          {patients.length > 0 && !selectedPatient && (
            <div className="absolute z-10 left-4 right-4 top-full bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
              {patients.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPatient(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)]"
                >
                  <span className="font-medium text-[var(--color-text)]">{p.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPatient && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="section-title">{t('carePlans.title')}</h3>
              <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> {t('carePlans.newPlan')}
              </button>
            </div>
            {loading ? (
               <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">{t('common.loading')}</div>
            ) : carePlans.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('carePlans.noPlan')}</p>
              </div>
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('carePlans.created')}</th>
                    <th>{t('carePlans.type')}</th>
                    <th>{t('carePlans.description')}</th>
                    <th>{t('carePlans.status')}</th>
                    <th>{t('carePlans.goals')}</th>
                    <th>{t('carePlans.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {carePlans.map(cp => (
                    <tr key={cp.CarePlanId}>
                      <td className="font-data">{formatDisplayDate(cp.CreatedDate)}</td>
                      <td>{t(`carePlans.types.${cp.CarePlanType.toLowerCase().replace(/\s+/g, '')}`) || cp.CarePlanType}</td>
                      <td className="max-w-[200px] truncate">{cp.Description}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          cp.PlanStatus === 'active' ? 'bg-emerald-100 text-emerald-700' :
                          cp.PlanStatus === 'draft' ? 'bg-gray-100 text-gray-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {t(`carePlans.statuses.${cp.PlanStatus.replace('-', '')}`) || cp.PlanStatus.toUpperCase()}
                        </span>
                      </td>
                      <td>{cp.GoalCount || 0}</td>
                      <td>
                        <button className="text-blue-600 hover:text-blue-700 text-xs font-semibold">{t('carePlans.viewDetails')}</button>
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
                  <h3 className="font-bold text-[var(--color-text)]">{t('carePlans.newCarePlan')}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient?.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSaveCarePlan} className="p-6 space-y-4 text-left">
              <div>
                <label className="label">{t('carePlans.type')}</label>
                <select
                  className="input w-full"
                  value={newPlan.CarePlanType}
                  onChange={e => setNewPlan(p => ({...p, CarePlanType: e.target.value}))}
                >
                  <option value="General">{t('carePlans.types.general')}</option>
                  <option value="Chronic Condition">{t('carePlans.types.chronic')}</option>
                  <option value="Post-Op">{t('carePlans.types.postOp')}</option>
                  <option value="Mental Health">{t('carePlans.types.mental')}</option>
                  <option value="Preventative">{t('carePlans.types.preventative')}</option>
                </select>
              </div>

              <div>
                <label className="label">{t('carePlans.description')}</label>
                <textarea
                  required
                  className="input w-full"
                  rows={3}
                  placeholder={t("carePlans.describeStrategy")}
                  value={newPlan.Description}
                  onChange={e => setNewPlan(p => ({...p, Description: e.target.value}))}
                />
              </div>

              <div>
                <label className="label">{t('carePlans.status')}</label>
                <select
                  className="input w-full"
                  value={newPlan.PlanStatus}
                  onChange={e => setNewPlan(p => ({...p, PlanStatus: e.target.value}))}
                >
                  <option value="draft">{t('carePlans.statuses.draft')}</option>
                  <option value="active">{t('carePlans.statuses.active')}</option>
                  <option value="on-hold">{t('carePlans.statuses.onHold')}</option>
                  <option value="completed">{t('carePlans.statuses.completed')}</option>
                  <option value="revoked">{t('carePlans.statuses.revoked')}</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? t('carePlans.loading') : t('carePlans.newPlan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
