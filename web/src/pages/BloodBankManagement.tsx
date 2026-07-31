import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Droplets, Plus, X, Search, RefreshCw, AlertTriangle,
  Heart, Syringe, FlaskConical, Users, CheckCircle, Clock, Link as LinkIcon, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

/* ─── Types ───────────────────────────────────────────────── */
interface Donor { id: number; donor_name: string; blood_group: string; donor_type: string; gender?: string; age?: number; phone?: string; last_donation_date?: string; total_donations: number; is_eligible: number; patient_id?: number; patient_code?: string; }
interface Donation { id: number; bag_number: string; blood_group: string; component: string; volume_ml: number; collection_date: string; expiry_date: string; status: string; screening_status: string; donor_name?: string; }
interface CrossMatch { id: number; patient_name?: string; patient_code?: string; patient_blood_group: string; requested_component: string; units_requested: number; urgency: string; status: string; compatibility_result?: string; bag_number?: string; }
interface Transfusion { id: number; patient_name?: string; bag_number: string; blood_group: string; component: string; status: string; issued_at: string; reaction_type?: string; }
interface StockRow { blood_group: string; component: string; available: number; reserved: number; expired: number; pending_screening: number; }
interface Stats { total_donors: number; available_units: number; pending_cross_match: number; today_transfusions: number; expiring_soon: number; }

interface StockResponse { stock: StockRow[]; }
interface ListResponse<T> { data: T[]; }

interface LocalPatient { id: number; name: string; mobile: string; patient_code?: string; }
interface GlobalPatient { uhid: string; primary_name: string; primary_phone: string; primary_email?: string; date_of_birth?: string; gender?: string; }

/* ─── Constants ───────────────────────────────────────────── */
const BG_COLOR: Record<string, string> = { 'A+': 'bg-red-100 text-red-700', 'A-': 'bg-red-50 text-red-600', 'B+': 'bg-blue-100 text-blue-700', 'B-': 'bg-blue-50 text-blue-600', 'AB+': 'bg-purple-100 text-purple-700', 'AB-': 'bg-purple-50 text-purple-600', 'O+': 'bg-green-100 text-green-700', 'O-': 'bg-green-50 text-green-600' };
const STATUS_BADGE: Record<string, string> = { in_stock: 'badge-success', reserved: 'bg-blue-100 text-blue-700', cross_matched: 'bg-purple-100 text-purple-700', issued: 'bg-amber-100 text-amber-700', expired: 'bg-gray-200 text-gray-600', discarded: 'bg-red-100 text-red-600', quarantine: 'bg-orange-100 text-orange-700' };
const SCREEN_BADGE: Record<string, string> = { pending: 'bg-gray-100 text-gray-600', passed: 'badge-success', failed: 'bg-red-100 text-red-700' };
const URGENCY_BADGE: Record<string, string> = { routine: 'badge-neutral', urgent: 'badge-warning', emergency: 'bg-red-100 text-red-700' };
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const COMPONENTS = ['whole_blood','packed_rbc','ffp','platelets','cryoprecipitate','plasma'];
const TABS = ['stock', 'donors', 'donations', 'cross-match', 'transfusions'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation(['common', 'blood_bank']);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/* ─── Stock Tab ───────────────────────────────────────────── */
function StockTab() {
  const { t } = useTranslation(['blood_bank', 'common']);
  const { data: stockData, isLoading: loadingStock } = useApiQuery<StockResponse>(
    queryKeys.bloodBank.stock(),
    '/api/blood-bank/stock',
  );
  const { data: stats } = useApiQuery<Stats>(
    queryKeys.bloodBank.stats(),
    '/api/blood-bank/stats',
  );

  const rows = stockData?.stock ?? [];
  const loading = loadingStock;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: t('stats.totalDonors'), val: stats.total_donors, icon: <Users className="w-4 h-4 text-blue-500" /> },
            { label: t('stats.availableUnits'), val: stats.available_units, icon: <Droplets className="w-4 h-4 text-green-500" /> },
            { label: t('stats.pendingXMatch'), val: stats.pending_cross_match, icon: <FlaskConical className="w-4 h-4 text-purple-500" /> },
            { label: t('stats.todayTransfusions'), val: stats.today_transfusions, icon: <Syringe className="w-4 h-4 text-red-500" /> },
            { label: t('stats.expiringSoon'), val: stats.expiring_soon, icon: <AlertTriangle className="w-4 h-4 text-amber-500" /> },
          ].map(k => (
            <div key={k.label} className="card p-3">
              <div className="flex items-center gap-2 mb-1">{k.icon}<span className="text-xs text-[var(--color-text-muted)]">{k.label}</span></div>
              <p className="text-2xl font-bold">{k.val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">{t('table.bloodStockByGroup')}</h3></div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('table.bloodGroup')}</th><th>{t('table.component')}</th><th className="text-center">{t('table.available')}</th><th className="text-center">{t('table.reserved')}</th><th className="text-center">{t('table.expired')}</th><th className="text-center">{t('table.pendingScreen')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noStock')}</td></tr>
              : rows.map((r, i) => (
                <tr key={i}>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[r.blood_group] ?? 'badge-neutral'}`}>{r.blood_group}</span></td>
                  <td className="text-sm">{t(`components.${r.component}`)}</td>
                  <td className="text-center font-bold text-green-600">{r.available}</td>
                  <td className="text-center text-blue-600">{r.reserved}</td>
                  <td className="text-center text-red-500">{r.expired}</td>
                  <td className="text-center text-gray-500">{r.pending_screening}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Donors Tab ──────────────────────────────────────────── */
function DonorsTab() {
  const { t } = useTranslation(['blood_bank', 'common', 'inventory']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [bgFilter, setBgFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Patient search state for donor registration
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<LocalPatient | null>(null);

  const [linkLoading, setLinkLoading] = useState(false);

  // Form state
  const [form, setForm] = useState({
    donor_name: '', blood_group: 'O+', donor_type: 'voluntary', gender: 'male',
    phone: '', age: '', weight_kg: '', hemoglobin: '', patient_id: undefined as number | undefined
  });

  // Local patient search (this hospital)
  const { data: localPatientsData } = useApiQuery<{ patients: LocalPatient[] }>(
    ['blood-bank', 'local-patients', patientSearch],
    patientSearch.trim().length >= 3 ? `/api/patients?search=${encodeURIComponent(patientSearch)}&limit=5` : '/api/patients?limit=0',
    { enabled: patientSearch.trim().length >= 3 && !selectedPatient, staleTime: 5000 },
  );

  // Global patient search (across hospitals)
  const { data: globalPatientsData } = useApiQuery<{ results: GlobalPatient[] }>(
    ['blood-bank', 'global-patients', patientSearch],
    patientSearch.trim().length >= 3 ? `/api/patients/global-search?q=${encodeURIComponent(patientSearch)}` : '/api/patients/global-search?q=',
    { enabled: /^\d{11}$/.test(patientSearch.trim()) && !selectedPatient, staleTime: 5000 },
  );

  // Link global patient mutation
  const linkGlobalPatientMutation = useApiMutation<
    { patientId: number; alreadyLinked: boolean; patient?: LocalPatient },
    { uhid: string }
  >('post', '/api/patients/link-global', {
    onSuccess: (data) => {
      if (data.patient) {
        setSelectedPatient(data.patient);
        // Auto-fill form with patient data
        setForm(prev => ({
          ...prev,
          donor_name: data.patient!.name,
          phone: data.patient!.mobile || prev.phone,
          patient_id: data.patient!.id,
        }));
        if (data.alreadyLinked) {
          toast.success('Patient already linked to this hospital');
        } else {
          toast.success('Patient linked successfully');
        }
      }
      setPatientSearch('');
      setLinkLoading(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to link patient');
      setLinkLoading(false);
    },
  });

  const buildDonorsPath = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (bgFilter) params.set('blood_group', bgFilter);
    const qs = params.toString();
    return qs ? `/api/blood-bank/donors?${qs}` : '/api/blood-bank/donors';
  };

  const { data: donorsData, isLoading: loading } = useApiQuery<ListResponse<Donor>>(
    queryKeys.bloodBank.donors({ search, blood_group: bgFilter }),
    buildDonorsPath(),
    { placeholderData: (prev) => prev },
  );
  const items = donorsData?.data ?? [];

  const addDonorMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/blood-bank/donors',
    {
      onSuccess: () => {
        toast.success(t('common:added'));
        setShowForm(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.bloodBank.all });
      },
      onError: (error: Error) => {
        // Show the actual error message from the server
        const errorMessage = (error as any)?.payload?.message || error.message || t('common:operationFailed');
        toast.error(errorMessage);
      },
    },
  );

  const resetForm = () => {
    setForm({ donor_name: '', blood_group: 'O+', donor_type: 'voluntary', gender: 'male', phone: '', age: '', weight_kg: '', hemoglobin: '', patient_id: undefined });
    setSelectedPatient(null);
    setPatientSearch('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Normalize gender to capitalized format for backend validation
    const normalizedGender = form.gender ? form.gender.charAt(0).toUpperCase() + form.gender.slice(1).toLowerCase() : undefined;
    addDonorMutation.mutate({
      ...form,
      gender: normalizedGender,
      age: form.age ? Number(form.age) : undefined,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined,
      hemoglobin: form.hemoglobin ? Number(form.hemoglobin) : undefined,
    } as any);
  };

  const saving = addDonorMutation.isPending;
  const localPatients = localPatientsData?.patients ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <input className="input flex-1 min-w-48" placeholder={t("common:search_donors")} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-36 font-data" value={bgFilter} onChange={e => setBgFilter(e.target.value)}>
          <option value="">{t('allGroups')}</option>
          {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addDonor')}</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('table.name')}</th><th>{t('table.bloodGroup')}</th><th>{t('table.type')}</th><th>{t('table.genderAge')}</th><th>{t('table.phone')}</th><th>{t('table.lastDonation')}</th><th>{t('table.total')}</th><th>{t('table.eligible')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">{t('noDonors')}</td></tr>
              : items.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.donor_name}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[d.blood_group] ?? ''}`}>{d.blood_group}</span></td>
                  <td className="text-xs badge-neutral">{t(`donorTypes.${d.donor_type}`)}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{d.gender ? t(`genders.${d.gender}`) : '—'}{d.age ? `, ${d.age}y` : ''}</td>
                  <td className="text-sm">{d.phone ?? '—'}</td>
                  <td className="text-sm">{d.last_donation_date?.slice(0, 10) ?? t('never')}</td>
                  <td className="font-data text-center">{d.total_donations}</td>
                  <td>{d.is_eligible ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title={t('registerDonor')} onClose={() => { setShowForm(false); resetForm(); }}>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Patient Search Section */}
            {!selectedPatient ? (
              <div className="space-y-2">
                <label className="label">Search Patient (by phone or name)</label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input w-full pl-9"
                      value={patientSearch}
                      onChange={e => { setPatientSearch(e.target.value); setSelectedPatient(null); }}
                      placeholder="Enter phone number or name (min 3 chars)"
                    />
                  </div>

                  {/* Search Results Dropdown */}
                  {patientSearch.trim().length >= 3 && (
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {/* Local Hospital Results */}
                      {localPatients.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)]">
                            This Hospital ({localPatients.length})
                          </div>
                          {localPatients.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setSelectedPatient(p);
                                setForm(prev => ({ ...prev, donor_name: p.name, phone: p.mobile || prev.phone, patient_id: p.id }));
                                setPatientSearch('');
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-[var(--color-bg-secondary)] flex justify-between items-center"
                            >
                              <span>
                                <span className="font-medium">{p.name}</span>
                                <span className="text-xs text-[var(--color-text-muted)] ml-2">{p.patient_code ? `PID-${p.patient_code}` : ''}</span>
                              </span>
                              <span className="text-xs text-[var(--color-primary)]">Select</span>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Global Patient Results (Other Hospitals) — only when no local results */}
                      {localPatients.length === 0 && globalPatientsData?.results && globalPatientsData.results.length > 0 && (
                        <div className="border-t border-blue-200 bg-blue-50 dark:bg-blue-950">
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-blue-600">
                            Other Hospitals — Tap to Link ({globalPatientsData.results.length})
                          </div>
                          {globalPatientsData.results.map(gp => (
                            <button
                              key={gp.uhid}
                              type="button"
                              disabled={linkLoading}
                              onClick={() => {
                                setLinkLoading(true);
                                linkGlobalPatientMutation.mutate({ uhid: gp.uhid });
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-blue-100 dark:hover:bg-blue-900 flex justify-between items-center disabled:opacity-50"
                            >
                              <span>
                                <span className="font-medium text-blue-700 dark:text-blue-400">{gp.primary_name}</span>
                                <span className="text-xs text-blue-500 ml-2">{gp.uhid}</span>
                              </span>
                              <span className="flex items-center gap-1 text-xs text-blue-600">
                                <LinkIcon className="w-3 h-3" /> Link
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No Results */}
                      {localPatients.length === 0 && (!globalPatientsData?.results || globalPatientsData.results.length === 0) && (
                        <div className="px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                          <UserPlus className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          No patient found in this hospital or global network.
                          <br />
                          <span className="text-xs">Register as new donor below.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-emerald-800">{selectedPatient.name}</div>
                    <div className="text-xs text-emerald-600">
                      {selectedPatient.patient_code ? `PID-${selectedPatient.patient_code}` : `ID: ${selectedPatient.id}`}
                      {selectedPatient.mobile ? ` • ${selectedPatient.mobile}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPatient(null);
                    setForm(prev => ({ ...prev, donor_name: '', patient_id: undefined }));
                  }}
                  className="btn-ghost px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                >
                  Change
                </button>
              </div>
            )}

            {/* Donor Details */}
            <div><label className="label">Donor Name *</label><input className="input w-full" required value={form.donor_name} onChange={e => setForm({...form, donor_name: e.target.value})} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">{t('table.bloodGroup')}</label><select className="input w-full" value={form.blood_group} onChange={e => setForm({...form, blood_group: e.target.value})}>{BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}</select></div>
              <div><label className="label">{t('common:gender')}</label><select className="input w-full" value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}>
                {['Male', 'Female', 'Other'].map(g => <option key={g} value={g.toLowerCase()}>{t(`genders.${g}`)}</option>)}
              </select></div>
              <div><label className="label">{t('common:age')}</label><input className="input w-full" type="number" value={form.age} onChange={e => setForm({...form, age: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common:phone')}</label><input className="input w-full" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div><label className="label">{t('common:weight_kg')}</label><input className="input w-full" type="number" value={form.weight_kg} onChange={e => setForm({...form, weight_kg: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common:saving') : t('register')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Donations Tab ───────────────────────────────────────── */
function DonationsTab() {
  const { t } = useTranslation(['blood_bank', 'common']);
  const [bgFilter, setBgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const buildDonationsPath = () => {
    const params = new URLSearchParams();
    if (bgFilter) params.set('blood_group', bgFilter);
    if (statusFilter) params.set('status', statusFilter);
    const qs = params.toString();
    return qs ? `/api/blood-bank/donations?${qs}` : '/api/blood-bank/donations';
  };

  const { data: donationsData, isLoading: loading } = useApiQuery<ListResponse<Donation>>(
    queryKeys.bloodBank.donations({ blood_group: bgFilter, status: statusFilter }),
    buildDonationsPath(),
    { placeholderData: (prev) => prev },
  );
  const items = donationsData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <select className="input w-36 font-data" value={bgFilter} onChange={e => setBgFilter(e.target.value)}>
          <option value="">{t('allGroups')}</option>{BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
        </select>
        <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('allStatus')}</option>
          {['in_stock', 'issued', 'expired', 'quarantine'].map(s => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('table.bagNo')}</th><th>{t('table.donor')}</th><th>{t('table.bloodGroup')}</th><th>{t('table.component')}</th><th>{t('table.vol')}</th><th>{t('table.collected')}</th><th>{t('table.expiry')}</th><th>{t('table.screening')}</th><th>{t('table.status')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">{t('noDonations')}</td></tr>
              : items.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-xs font-medium">{d.bag_number}</td>
                  <td className="text-sm">{d.donor_name ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[d.blood_group] ?? ''}`}>{d.blood_group}</span></td>
                  <td className="text-xs">{t(`components.${d.component}`)}</td>
                  <td className="font-data text-sm">{d.volume_ml}ml</td>
                  <td className="text-xs">{d.collection_date?.slice(0, 10)}</td>
                  <td className="text-xs">{d.expiry_date?.slice(0, 10)}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SCREEN_BADGE[d.screening_status] ?? ''}`}>{t(`status.${d.screening_status}`)}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[d.status] ?? 'badge-neutral'}`}>{t(`status.${d.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Cross-Match Tab ─────────────────────────────────────── */
function CrossMatchTab() {
  const { t } = useTranslation(['blood_bank', 'common']);
  const { data: crossMatchData, isLoading: loading } = useApiQuery<ListResponse<CrossMatch>>(
    queryKeys.bloodBank.crossMatch(),
    '/api/blood-bank/cross-match',
  );
  const items = crossMatchData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('table.patient')}</th><th>{t('table.bloodGroup')}</th><th>{t('table.component')}</th><th>{t('table.units')}</th><th>{t('table.urgency')}</th><th>{t('table.compatibility')}</th><th>{t('table.bagNo')}</th><th>{t('table.status')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">{t('noCrossMatch')}</td></tr>
              : items.map(cm => (
                <tr key={cm.id}>
                  <td><span className="font-medium">{cm.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{cm.patient_code}</span></td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[cm.patient_blood_group] ?? ''}`}>{cm.patient_blood_group}</span></td>
                  <td className="text-xs">{t(`components.${cm.requested_component}`)}</td>
                  <td className="font-data text-center">{cm.units_requested}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[cm.urgency] ?? ''}`}>{t(`urgency.${cm.urgency}`)}</span></td>
                  <td>{cm.compatibility_result ? <span className={cm.compatibility_result === 'compatible' ? 'text-green-600 font-medium text-xs' : 'text-red-600 font-medium text-xs'}>{t(`compatibility.${cm.compatibility_result}`)}</span> : <span className="text-xs text-[var(--color-text-muted)]">{t('compatibility.pending')}</span>}</td>
                  <td className="font-mono text-xs">{cm.bag_number ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[cm.status] ?? 'badge-neutral'}`}>{t(`status.${cm.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Transfusions Tab ────────────────────────────────────── */
function TransfusionsTab() {
  const { t } = useTranslation(['blood_bank', 'common']);
  const { data: transfusionsData, isLoading: loading } = useApiQuery<ListResponse<Transfusion>>(
    queryKeys.bloodBank.transfusions(),
    '/api/blood-bank/transfusions',
  );
  const items = transfusionsData?.data ?? [];

  const REACTION_BADGE: Record<string, string> = { none: 'badge-success', mild: 'badge-warning', moderate: 'bg-orange-100 text-orange-700', severe: 'bg-red-100 text-red-700', fatal: 'bg-red-200 text-red-800' };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('table.patient')}</th><th>{t('table.bagNo')}</th><th>{t('table.bloodGroup')}</th><th>{t('table.component')}</th><th>{t('table.issuedAt')}</th><th>{t('table.status')}</th><th>{t('table.reaction')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noTransfusions')}</td></tr>
              : items.map(tx => (
                <tr key={tx.id}>
                  <td className="font-medium">{tx.patient_name ?? '—'}</td>
                  <td className="font-mono text-xs">{tx.bag_number}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[tx.blood_group] ?? ''}`}>{tx.blood_group}</span></td>
                  <td className="text-xs">{t(`components.${tx.component}`)}</td>
                  <td className="text-xs">{tx.issued_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[tx.status] ?? 'badge-neutral'}`}>{t(`status.${tx.status}`)}</span></td>
                  <td>{tx.reaction_type ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REACTION_BADGE[tx.reaction_type] ?? ''}`}>{t(`reaction.${tx.reaction_type}`)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TAB_COMPONENT: Record<Tab, React.FC> = {
  stock: StockTab,
  donors: DonorsTab,
  donations: DonationsTab,
  'cross-match': CrossMatchTab,
  transfusions: TransfusionsTab,
};

/* ─── Tab Map ─────────────────────────────────────────────── */
export default function BloodBankManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['blood_bank', 'common']);
  const [tab, setTab] = useState<Tab>('stock');
  const Content = TAB_COMPONENT[tab];

  const TAB_INFO: Record<Tab, { label: string; icon: typeof Droplets }> = {
    stock: { label: t('tabs.stock'), icon: Droplets },
    donors: { label: t('tabs.donors'), icon: Users },
    donations: { label: t('tabs.donations'), icon: Heart },
    'cross-match': { label: t('tabs.cross-match'), icon: FlaskConical },
    transfusions: { label: t('tabs.transfusions'), icon: Syringe },
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tId => {
            const info = TAB_INFO[tId];
            const Icon = info.icon;
            return (
              <button key={tId} onClick={() => setTab(tId)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === tId ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}>
                <Icon className="w-4 h-4" />{info.label}
              </button>
            );
          })}
        </div>

        <Content />
      </div>
    </DashboardLayout>
  );
}
