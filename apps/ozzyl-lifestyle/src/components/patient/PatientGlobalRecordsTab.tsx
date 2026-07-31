import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  Building2,
  Clock,
  HeartPulse,
  Loader2,
  Shield,
  TriangleAlert,
  Users,
  QrCode,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PatientVisitPass } from './PatientVisitPass';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';
import {
  useAddPatientDependentMutation,
  usePatientFamilySummaryQuery,
  usePatientHospitalsQuery,
  usePatientVisitPassQuery,
  type GlobalHospitalLink,
} from '../../hooks/patient-portal/usePatientPortalQueries';

const FAMILY_RELATIONSHIPS = [
  'child',
  'parent',
  'spouse',
  'sibling',
  'caregiver',
  'legal_guardian',
  'grandparent',
  'grandchild',
  'other',
] as const;

function formatDate(value: string | null | undefined, t: (key: string) => string, _i18n: any) {
  return formatPatientDateMonthYear(value, t('globalRecords.na'));
}

export default function PatientGlobalRecordsTab() {
  const { t, i18n } = useTranslation('patientPortal');
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [showVisitPassModal, setShowVisitPassModal] = useState(false);
  const [familyForm, setFamilyForm] = useState({
    name: '',
    relationship: 'child',
    date_of_birth: '',
    gender: 'other',
    phone: '',
  });
  const hospitalsQuery = usePatientHospitalsQuery();
  const familyQuery = usePatientFamilySummaryQuery();
  const visitPassQuery = usePatientVisitPassQuery();
  const addDependentMutation = useAddPatientDependentMutation();
  const hospitals: GlobalHospitalLink[] = hospitalsQuery.data?.hospitals ?? [];
  const family = familyQuery.data ?? null;
  const visitPass = visitPassQuery.data ?? null;
  const loading = hospitalsQuery.isLoading || familyQuery.isLoading || visitPassQuery.isLoading;
  const savingFamily = addDependentMutation.isPending;
  const loadError = hospitalsQuery.error || familyQuery.error || visitPassQuery.error;

  async function handleAddFamilyMember() {
    if (!familyForm.name.trim()) {
      toast.error(t('globalRecords.family.nameRequired'));
      return;
    }
    try {
      await addDependentMutation.mutateAsync({
        name: familyForm.name.trim(),
        relationship: familyForm.relationship,
        date_of_birth: familyForm.date_of_birth || undefined,
        gender: familyForm.gender || undefined,
        phone: familyForm.phone || undefined,
      });
      toast.success(t('globalRecords.family.addSuccess'));
      setShowFamilyModal(false);
      setFamilyForm({
        name: '',
        relationship: 'child',
        date_of_birth: '',
        gender: 'other',
        phone: '',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('globalRecords.family.addFailed'));
    }
  }

  if (loadError) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        {loadError instanceof Error ? loadError.message : t('globalRecords.errors.loadFailed')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-[0_12px_40px_rgba(8,145,178,0.06)] border border-slate-100 space-y-8 animate-fade-in-up animate-in fade-in duration-500">
      {/* Top Overview Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-5 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-50 dark:bg-cyan-900/30">
              <Building2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('globalRecords.cards.linkedHospitals')}</p>
          </div>
          <h2 className="mt-3 text-3xl font-bold font-manrope text-slate-900 dark:text-white">{hospitals.length}</h2>
        </div>
        <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-5 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-900/30">
              <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('globalRecords.cards.familyProfiles')}</p>
          </div>
          <h2 className="mt-3 text-3xl font-bold font-manrope text-slate-900 dark:text-white">{family?.managed_profiles?.length ?? 0}</h2>
        </div>
        <div 
          className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-5 shadow-sm backdrop-blur-md cursor-pointer transition hover:bg-white/90 hover:shadow-md dark:hover:bg-slate-800/80"
          onClick={() => setShowVisitPassModal(true)}
          role="button"
          tabIndex={0}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-900/30">
              <BadgeCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('globalRecords.cards.activeVisitPass')}</p>
          </div>
          <h2 className="mt-3 text-lg font-bold font-manrope text-slate-900 dark:text-white">{visitPass?.active_pass?.pass_code || t('globalRecords.none')}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{visitPass?.active_pass?.expires_at ? formatDate(visitPass.active_pass.expires_at, t, i18n) : t('globalRecords.generateWhenNeeded')}</p>
        </div>
        <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-5 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-900/30">
              <HeartPulse className="h-5 w-5 text-rose-500 dark:text-rose-400" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('globalRecords.cards.familyRiskWatch')}</p>
          </div>
          <h2 className="mt-3 text-lg font-bold font-manrope text-slate-900 dark:text-white">{family?.risk_overview?.headline || t('globalRecords.stable')}</h2>
        </div>
      </section>

      {/* Connected Hospitals */}
      <section className="space-y-4">
        <h3 className="text-xl font-bold font-manrope text-slate-900 dark:text-white flex items-center gap-2 px-2">
          {t('globalRecords.connectedHospitals')}
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {hospitals.length === 0 ? (
            <div className="col-span-full p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-[1.5rem] text-center">
               <p className="text-slate-500 dark:text-slate-400">{t('globalRecords.hospitals.empty')}</p>
            </div>
          ) : hospitals.map((hospital) => (
            <div key={`${hospital.tenantId}-${hospital.patientId}`} className="bg-white/80 dark:bg-slate-900/80 p-0 rounded-[1.5rem] border border-white/40 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-cyan-50 dark:hover:shadow-cyan-900/10 transition-all flex flex-col group overflow-hidden">
               <div className="h-24 w-full bg-gradient-to-r from-cyan-600 to-teal-500 relative">
                 <div className="absolute inset-0 bg-white/10 dark:bg-black/10 mix-blend-overlay"></div>
               </div>
               <div className="px-5 pb-5 pt-0 relative flex-1 flex flex-col">
                  <div className="w-14 h-14 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 mx-auto -mt-7 flex items-center justify-center mb-3">
                     <Building2 className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <h4 className="font-bold text-center text-slate-900 dark:text-white mb-1 line-clamp-1">{hospital.hospitalName}</h4>
                  <p className="text-xs text-center text-slate-500 dark:text-slate-400 mb-4">ID: {hospital.tenantId}</p>

                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                     <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {t('globalRecords.hospitals.activeSync')}
                     </div>
                     <span className="text-slate-400 dark:text-slate-500 text-xs">{t('globalRecords.hospitals.recentlyUpdated')}</span>
                  </div>
               </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Linked Family horizontal scroller */}
        <div className="space-y-4">
          <div className="flex justify-between items-end px-2">
            <h3 className="text-xl font-bold font-manrope text-slate-900 dark:text-white">{t('globalRecords.linkedFamily')}</h3>
            <button
              type="button"
              onClick={() => setShowFamilyModal(true)}
              className="w-8 h-8 rounded-full bg-cyan-600 text-white flex items-center justify-center hover:opacity-90 transition transform active:scale-95 shadow-md shadow-cyan-600/20"
            >
              <span className="material-symbols-outlined text-sm font-bold">+</span>
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 px-2 custom-scrollbar">
            {/* Real members */}
            {(family?.managed_profiles ?? []).map((profile) => (
              <div key={profile.identity_id} className="flex-shrink-0 w-32 bg-white/80 dark:bg-slate-900/80 p-4 rounded-xl text-center space-y-3 shadow-sm border border-white/40 dark:border-slate-800">
                <div className="w-16 h-16 mx-auto rounded-full bg-cyan-50 dark:bg-cyan-900/30 flex items-center justify-center border-2 border-cyan-100 dark:border-cyan-800">
                  <span className="font-bold text-xl text-cyan-700 dark:text-cyan-300">
                    {profile.name ? profile.name.charAt(0).toUpperCase() : '?'}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-sm text-slate-900 dark:text-white truncate" title={profile.name || t('globalRecords.family.managedProfile')}>{profile.name || t('globalRecords.family.managed')}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t(`globalRecords.family.relationshipOptions.${profile.relationship}`)}</p>
                </div>
              </div>
            ))}

            {/* Placeholder Add missing if needed */}
            <button
              type="button"
              onClick={() => setShowFamilyModal(true)}
              className="flex-shrink-0 w-32 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center space-y-2 opacity-60 hover:opacity-100 hover:border-cyan-400 transition cursor-pointer min-h-[140px]"
            >
               <Users className="w-6 h-6 text-slate-400" />
               <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('globalRecords.family.addMember')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 px-2">
            {(family?.risk_overview?.insights ?? []).slice(0, 2).map((insight, index) => (
              <div key={`${insight.label}-${index}`} className="rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4 text-amber-600" />
                  <p className="font-semibold text-slate-900 dark:text-white">{insight.label}</p>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{insight.rationale}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sharing and emergency tools */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-2">
            <h3 className="text-xl font-bold font-manrope text-slate-900 dark:text-white">{t('globalRecords.sharing.title')}</h3>
          </div>
          <div className="space-y-3 px-2">
            <a href={`#visit-pass`} className="flex bg-white/70 dark:bg-slate-900/70 rounded-2xl border border-white/40 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 rounded-xl bg-cyan-50 dark:bg-cyan-900/30 flex justify-center items-center mr-4 shrink-0">
                  <Clock className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('globalRecords.sharing.visitPassHistory')}</p>
                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {(visitPass?.history ?? []).length > 0 ? (
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400"></span> {visitPass?.history?.length ?? 0} {t('globalRecords.sharing.passesGenerated')}</span>
                  ) : t('globalRecords.sharing.noHistory')}
                </div>
              </div>
            </a>
            <a href={`#visit-pass#emergency-pack`} className="flex bg-white/70 dark:bg-slate-900/70 rounded-2xl border border-white/40 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-900/30 flex justify-center items-center mr-4 shrink-0">
                  <HeartPulse className="w-6 h-6 text-rose-500 dark:text-rose-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('globalRecords.sharing.emergencyPack')}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('globalRecords.sharing.emergencyPackDesc')}</p>
              </div>
            </a>
            <a href={`#access-log`} className="flex bg-white/70 dark:bg-slate-900/70 rounded-2xl border border-white/40 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-800 flex justify-center items-center mr-4 shrink-0">
                  <Shield className="w-6 h-6 text-slate-500 dark:text-slate-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('globalRecords.sharing.accessHistory')}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('globalRecords.sharing.accessHistoryDesc')}</p>
              </div>
            </a>
          </div>
        </div>
      </section>

      {showFamilyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">{t('globalRecords.family.addModalTitle')}</h3>
                <p className="mt-1 text-sm text-slate-500">{t('globalRecords.family.addModalDescription')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFamilyModal(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                {t('globalRecords.close')}
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">{t('globalRecords.family.nameLabel')}</span>
                <input
                  value={familyForm.name}
                  onChange={(event) => setFamilyForm((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-cyan-400"
                  placeholder={t('globalRecords.family.namePlaceholder')}
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-semibold text-slate-700">{t('globalRecords.family.relationshipLabel')}</span>
                <select
                  value={familyForm.relationship}
                  onChange={(event) => setFamilyForm((current) => ({ ...current, relationship: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-400"
                >
                  {FAMILY_RELATIONSHIPS.map((option) => (
                    <option key={option} value={option}>
                      {t(`globalRecords.family.relationshipOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-2 block text-sm font-semibold text-slate-700">{t('globalRecords.family.genderLabel')}</span>
                <select
                  value={familyForm.gender}
                  onChange={(event) => setFamilyForm((current) => ({ ...current, gender: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-400"
                >
                  <option value="other">{t('globalRecords.family.genderOptions.other')}</option>
                  <option value="male">{t('globalRecords.family.genderOptions.male')}</option>
                  <option value="female">{t('globalRecords.family.genderOptions.female')}</option>
                </select>
              </label>

              <label>
                <span className="mb-2 block text-sm font-semibold text-slate-700">{t('globalRecords.family.birthDateLabel')}</span>
                <input
                  type="date"
                  value={familyForm.date_of_birth}
                  onChange={(event) => setFamilyForm((current) => ({ ...current, date_of_birth: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-cyan-400"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-semibold text-slate-700">{t('globalRecords.family.phoneLabel')}</span>
                <input
                  value={familyForm.phone}
                  onChange={(event) => setFamilyForm((current) => ({ ...current, phone: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-cyan-400"
                  placeholder={t('globalRecords.family.phonePlaceholder')}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowFamilyModal(false)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t('globalRecords.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleAddFamilyMember()}
                disabled={savingFamily}
                className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                {savingFamily ? t('globalRecords.family.adding') : t('globalRecords.family.addNow')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patient Visit Pass Modal */}
      {showVisitPassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowVisitPassModal(false)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden border border-white/20">
            <button 
              onClick={() => setShowVisitPassModal(false)} 
              className="absolute top-4 right-4 z-10 p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 rounded-full transition-colors"
              aria-label="Close Visit Pass"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-2 sm:p-6 pb-0">
              <PatientVisitPass />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
