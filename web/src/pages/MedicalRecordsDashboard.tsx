import { useState, useEffect } from 'react';
import {
  FileText, Search, Plus, Baby, Heart, X, BookOpen, Activity,
  RefreshCw, ChevronRight, ArrowUpRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total_records: number;
  total_births: number;
  total_deaths: number;
  total_diagnoses: number;
  total_referrals: number;
}

interface MedicalRecord {
  id: number;
  patientId: number;
  patientName: string;
  visitId?: number;
  fileNumber?: string;
  dischargeType?: string;
  dischargeCondition?: string;
  isOperationConducted?: number;
  referredTo?: string;
  referredDate?: string;
  remarks?: string;
  createdAt: string;
}

interface BirthRecord {
  id: number;
  certificateNumber?: string;
  babyName?: string;
  sex?: string;
  weightKg?: number;
  birthDate: string;
  birthTime?: string;
  birthType?: string;
  birthCondition?: string;
  deliveryType?: string;
  fatherName?: string;
  motherName?: string;
  patientId: number;
  patientName?: string;
  printCount: number;
  createdAt: string;
}

interface DeathRecord {
  id: number;
  certificateNumber?: string;
  deathDate: string;
  deathTime?: string;
  causeOfDeath?: string;
  mannerOfDeath?: string;
  placeOfDeath?: string;
  ageAtDeath?: string;
  patientId: number;
  patientName?: string;
  printCount: number;
  createdAt: string;
}

interface Icd10Code {
  id: number;
  code: string;
  description: string;
  diseaseGroupId?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Badge({ text, color = 'gray', t }: { text: string; color?: string; t?: (key: string) => string }) {
  const map: Record<string, string> = {
    normal: 'bg-green-50 text-green-700 border-green-200',
    lama: 'bg-red-50 text-red-700 border-red-200',
    absconded: 'bg-orange-50 text-orange-700 border-orange-200',
    referred: 'bg-amber-50 text-amber-700 border-amber-200',
    expired: 'bg-slate-100 text-slate-700 border-slate-200',
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[text?.toLowerCase()] ?? map[color]}`}>
      {t ? t(text ?? '—') : (text ?? '—')}
    </span>
  );
}

type TabKey = 'records' | 'births' | 'deaths' | 'icd10' | 'referrals';

const TABS: { key: TabKey; labelKey: string; icon: typeof FileText }[] = [
  { key: 'records', labelKey: 'tabs.records', icon: FileText },
  { key: 'births', labelKey: 'tabs.births', icon: Baby },
  { key: 'deaths', labelKey: 'tabs.deaths', icon: Heart },
  { key: 'icd10', labelKey: 'tabs.icd10', icon: BookOpen },
  { key: 'referrals', labelKey: 'tabs.referrals', icon: ArrowUpRight },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MedicalRecordsDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('medical-records');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('records');

  // ── Records state
  const [recordSearch, setRecordSearch] = useState('');
  const [recordPage, setRecordPage] = useState(1);

  // ── Birth state
  const [birthFromDate, setBirthFromDate] = useState('');
  const [birthToDate, setBirthToDate] = useState('');
  const [birthFetchTrigger, setBirthFetchTrigger] = useState(0);

  // ── Death state
  const [deathFromDate, setDeathFromDate] = useState('');
  const [deathToDate, setDeathToDate] = useState('');
  const [deathFetchTrigger, setDeathFetchTrigger] = useState(0);

  // ── ICD-10 state
  const [icdSearch, setIcdSearch] = useState('');
  const [debouncedIcdSearch, setDebouncedIcdSearch] = useState('');

  // ── Referrals state
  const [referralPage, setReferralPage] = useState(1);

  // ── New Record modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordForm, setRecordForm] = useState({
    patient_id: '', file_number: '', discharge_type: '', discharge_condition: '',
    is_operation_conducted: false, operation_date: '', operation_diagnosis: '',
    referred_to: '', referred_date: '', referred_reason: '', remarks: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // ── New Birth modal
  const [showBirthModal, setShowBirthModal] = useState(false);
  const [birthForm, setBirthForm] = useState({
    patient_id: '', baby_name: '', sex: '', birth_date: '', birth_time: '',
    birth_type: '', birth_condition: '', delivery_type: '',
    weight_kg: '', father_name: '', mother_name: '', issued_by: '', certified_by: '',
  });

  // ── New Death modal
  const [showDeathModal, setShowDeathModal] = useState(false);
  const [deathForm, setDeathForm] = useState({
    patient_id: '', death_date: '', death_time: '', cause_of_death: '',
    secondary_cause: '', manner_of_death: '', place_of_death: '',
    age_at_death: '', father_name: '', mother_name: '', spouse_name: '', certified_by: '',
  });

  // ── Debounce ICD search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedIcdSearch(icdSearch), 350);
    return () => clearTimeout(timer);
  }, [icdSearch]);

  // ── Debounce record search
  const [debouncedRecordSearch, setDebouncedRecordSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRecordSearch(recordSearch), 400);
    return () => clearTimeout(timer);
  }, [recordSearch]);

  // ── Stats query
  const { data: stats = { total_records: 0, total_births: 0, total_deaths: 0, total_diagnoses: 0, total_referrals: 0 }, isLoading: statsLoading, refetch: refetchStats } = useApiQuery<Stats>(
    queryKeys.medicalRecords.stats(),
    '/api/medical-records/stats',
  );

  // ── Records query
  const recordQs = new URLSearchParams({ page: String(recordPage), limit: '20', ...(debouncedRecordSearch ? { search: debouncedRecordSearch } : {}) }).toString();
  const { data: recordsRaw, isLoading: recordsLoading } = useApiQuery<any>(
    queryKeys.medicalRecords.list({ search: debouncedRecordSearch, page: recordPage }),
    `/api/medical-records?${recordQs}`,
    { enabled: activeTab === 'records' },
  );
  const records: MedicalRecord[] = recordsRaw?.records ?? [];
  const recordTotal = recordsRaw?.meta?.total ?? 0;

  // ── Births query
  const birthQs = new URLSearchParams({ limit: '20', ...(birthFromDate ? { from_date: birthFromDate } : {}), ...(birthToDate ? { to_date: birthToDate } : {}) }).toString();
  const { data: birthsRaw, isLoading: birthsLoading, refetch: refetchBirths } = useApiQuery<any>(
    queryKeys.medicalRecords.births({ from: birthFromDate, to: birthToDate, trigger: birthFetchTrigger }),
    `/api/medical-records/births?${birthQs}`,
    { enabled: activeTab === 'births' },
  );
  const births: BirthRecord[] = birthsRaw?.births ?? [];
  const birthTotal = birthsRaw?.meta?.total ?? 0;

  // ── Deaths query
  const deathQs = new URLSearchParams({ limit: '20', ...(deathFromDate ? { from_date: deathFromDate } : {}), ...(deathToDate ? { to_date: deathToDate } : {}) }).toString();
  const { data: deathsRaw, isLoading: deathsLoading, refetch: refetchDeaths } = useApiQuery<any>(
    queryKeys.medicalRecords.deaths({ from: deathFromDate, to: deathToDate, trigger: deathFetchTrigger }),
    `/api/medical-records/deaths?${deathQs}`,
    { enabled: activeTab === 'deaths' },
  );
  const deaths: DeathRecord[] = deathsRaw?.deaths ?? [];
  const deathTotal = deathsRaw?.meta?.total ?? 0;

  // ── ICD-10 query
  const icdQs = new URLSearchParams({ limit: '100', ...(debouncedIcdSearch ? { search: debouncedIcdSearch } : {}) }).toString();
  const { data: icdRaw, isLoading: icdLoading } = useApiQuery<any>(
    queryKeys.medicalRecords.icd10(debouncedIcdSearch),
    `/api/medical-records/icd10?${icdQs}`,
    { enabled: activeTab === 'icd10' },
  );
  const icdCodes: Icd10Code[] = icdRaw?.codes ?? [];

  // ── Referrals query
  const refQs = new URLSearchParams({ page: String(referralPage), limit: '20' }).toString();
  const { data: referralsRaw, isLoading: referralsLoading } = useApiQuery<any>(
    queryKeys.medicalRecords.referrals({ page: referralPage }),
    `/api/medical-records/referrals?${refQs}`,
    { enabled: activeTab === 'referrals' },
  );
  const referrals: MedicalRecord[] = referralsRaw?.referrals ?? [];
  const referralTotal = referralsRaw?.meta?.total ?? 0;

  // ── Mutations
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.medicalRecords.all });
  };

  const submitRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordForm.patient_id) return toast.error(t('toast.patientIdRequired'));
    setSubmitting(true);
    try {
      await api.post('/api/medical-records', {
        patient_id: parseInt(recordForm.patient_id),
        file_number: recordForm.file_number || undefined,
        discharge_type: recordForm.discharge_type || undefined,
        discharge_condition: recordForm.discharge_condition || undefined,
        is_operation_conducted: recordForm.is_operation_conducted,
        operation_date: recordForm.operation_date || undefined,
        operation_diagnosis: recordForm.operation_diagnosis || undefined,
        referred_to: recordForm.referred_to || undefined,
        referred_date: recordForm.referred_date || undefined,
        referred_reason: recordForm.referred_reason || undefined,
        remarks: recordForm.remarks || undefined,
      });
      toast.success(t('toast.recordCreated'));
      setShowRecordModal(false);
      setRecordForm({ patient_id: '', file_number: '', discharge_type: '', discharge_condition: '', is_operation_conducted: false, operation_date: '', operation_diagnosis: '', referred_to: '', referred_date: '', referred_reason: '', remarks: '' });
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message || t('toast.recordCreateFailed'));
    }
    setSubmitting(false);
  };

  const submitBirth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!birthForm.patient_id || !birthForm.birth_date) return toast.error(t('toast.patientIdAndBirthDateRequired'));
    setSubmitting(true);
    try {
      await api.post('/api/medical-records/births', {
        patient_id: parseInt(birthForm.patient_id),
        baby_name: birthForm.baby_name || undefined,
        sex: birthForm.sex || undefined,
        birth_date: birthForm.birth_date,
        birth_time: birthForm.birth_time || undefined,
        birth_type: birthForm.birth_type || undefined,
        birth_condition: birthForm.birth_condition || undefined,
        delivery_type: birthForm.delivery_type || undefined,
        weight_kg: birthForm.weight_kg ? parseFloat(birthForm.weight_kg) : undefined,
        father_name: birthForm.father_name || undefined,
        mother_name: birthForm.mother_name || undefined,
        issued_by: birthForm.issued_by || undefined,
        certified_by: birthForm.certified_by || undefined,
      });
      toast.success(t('toast.birthRecordCreated'));
      setShowBirthModal(false);
      setBirthForm({ patient_id: '', baby_name: '', sex: '', birth_date: '', birth_time: '', birth_type: '', birth_condition: '', delivery_type: '', weight_kg: '', father_name: '', mother_name: '', issued_by: '', certified_by: '' });
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message || t('toast.birthRecordFailed'));
    }
    setSubmitting(false);
  };

  const submitDeath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deathForm.patient_id || !deathForm.death_date) return toast.error(t('toast.patientIdAndDeathDateRequired'));
    setSubmitting(true);
    try {
      await api.post('/api/medical-records/deaths', {
        patient_id: parseInt(deathForm.patient_id),
        death_date: deathForm.death_date,
        death_time: deathForm.death_time || undefined,
        cause_of_death: deathForm.cause_of_death || undefined,
        secondary_cause: deathForm.secondary_cause || undefined,
        manner_of_death: deathForm.manner_of_death || undefined,
        place_of_death: deathForm.place_of_death || undefined,
        age_at_death: deathForm.age_at_death || undefined,
        father_name: deathForm.father_name || undefined,
        mother_name: deathForm.mother_name || undefined,
        spouse_name: deathForm.spouse_name || undefined,
        certified_by: deathForm.certified_by || undefined,
      });
      toast.success(t('toast.deathRecordCreated'));
      setShowDeathModal(false);
      setDeathForm({ patient_id: '', death_date: '', death_time: '', cause_of_death: '', secondary_cause: '', manner_of_death: '', place_of_death: '', age_at_death: '', father_name: '', mother_name: '', spouse_name: '', certified_by: '' });
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message || t('toast.deathRecordFailed'));
    }
    setSubmitting(false);
  };

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="medical_records" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
            <button onClick={() => refetchStats()} className="btn-secondary" title={t('actions.refresh')}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPICard title={t('kpis.medRecords')} value={stats.total_records} loading={statsLoading} icon={<FileText className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('kpis.births')} value={stats.total_births} loading={statsLoading} icon={<Baby className="w-5 h-5" />} iconBg="bg-pink-50 text-pink-600" />
          <KPICard title={t('kpis.deaths')} value={stats.total_deaths} loading={statsLoading} icon={<Heart className="w-5 h-5" />} iconBg="bg-slate-100 text-slate-600" />
          <KPICard title={t('kpis.diagnoses')} value={stats.total_diagnoses} loading={statsLoading} icon={<Activity className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('kpis.referrals')} value={stats.total_referrals} loading={statsLoading} icon={<ArrowUpRight className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" />
        </div>

        {/* ── Tab Navigation ── */}
        <div className="flex gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* MEDICAL RECORDS TAB */}
        {activeTab === 'records' && (
          <div className="space-y-4">
            <div className="card p-4 flex flex-wrap gap-3 items-center justify-between">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input type="text" placeholder={t('placeholders.searchRecords')} value={recordSearch} onChange={e => setRecordSearch(e.target.value)} className="input pl-9" />
              </div>
              <button onClick={() => setShowRecordModal(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('actions.newRecord')}</button>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>#</th><th>{t('records.patient')}</th><th>{t('records.fileNo')}</th><th>{t('records.dischargeType')}</th><th>{t('records.operation')}</th><th>{t('records.referredTo')}</th><th>{t('records.created')}</th><th>{t('records.actions')}</th></tr></thead>
                  <tbody>
                    {recordsLoading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : records.length === 0 ? <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">{t('records.noRecordsFound')}</td></tr>
                    : records.map((r, idx) => (
                      <tr key={r.id}>
                        <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-medium">{r.patientName || `Patient #${r.patientId}`}</td>
                        <td className="font-data">{r.fileNumber || '—'}</td>
                        <td><Badge text={r.dischargeType || '—'} t={t} /></td>
                        <td>{r.isOperationConducted ? <span className="badge badge-warning text-xs">{t('common.yes')}</span> : <span className="text-[var(--color-text-muted)]">{t('common.no')}</span>}</td>
                        <td className="text-sm">{r.referredTo || '—'}</td>
                        <td className="text-sm text-[var(--color-text-muted)]">{r.createdAt ? formatDisplayDate(r.createdAt) : '—'}</td>
                        <td><button className="btn-ghost p-1.5" title={t('records.viewDetails')}><ChevronRight className="w-4 h-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recordTotal > 20 && (
                <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between text-sm text-[var(--color-text-muted)]">
                  <span>{t('pagination.total', { total: recordTotal, type: t('tabs.records') })}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setRecordPage(p => Math.max(1, p - 1))} disabled={recordPage === 1} className="btn-secondary px-3 py-1 text-xs">{t('pagination.prev')}</button>
                    <button onClick={() => setRecordPage(p => p + 1)} disabled={records.length < 20} className="btn-secondary px-3 py-1 text-xs">{t('pagination.next')}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BIRTH REGISTER TAB */}
        {activeTab === 'births' && (
          <div className="space-y-4">
            <div className="card p-4 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-2 items-center">
                <label className="label">{t('birth.from')}</label>
                <input type="date" value={birthFromDate} onChange={e => setBirthFromDate(e.target.value)} className="input w-auto" />
                <label className="label">{t('birth.to')}</label>
                <input type="date" value={birthToDate} onChange={e => setBirthToDate(e.target.value)} className="input w-auto" />
                <button onClick={() => setBirthFetchTrigger(n => n + 1)} className="btn-secondary">{t('actions.apply')}</button>
              </div>
              <button onClick={() => setShowBirthModal(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('actions.registerBirth')}</button>
            </div>
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2"><Baby className="w-4 h-4 text-pink-500" /><h2 className="font-semibold text-sm">{t('birth.registerTitle', { count: birthTotal })}</h2></div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>#</th><th>{t('birth.certificateNo')}</th><th>{t('birth.babyName')}</th><th>{t('birth.sex')}</th><th>{t('birth.weightKg')}</th><th>{t('birth.birthDate')}</th><th>{t('birth.deliveryType')}</th><th>{t('birth.mother')}</th><th>{t('birth.father')}</th></tr></thead>
                  <tbody>
                    {birthsLoading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : births.length === 0 ? <tr><td colSpan={9} className="py-16 text-center text-[var(--color-text-muted)]">{t('birth.noRecordsFound')}</td></tr>
                    : births.map((b, idx) => (
                      <tr key={b.id}>
                        <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-data text-xs">{b.certificateNumber || '—'}</td>
                        <td className="font-medium">{b.babyName || '—'}</td>
                        <td>{b.sex ? <span className={`badge ${b.sex === 'Male' ? 'badge-info' : 'badge-warning'}`}>{t(`birth.sexValues.${b.sex.toLowerCase()}`, b.sex)}</span> : '—'}</td>
                        <td>{b.weightKg ? `${b.weightKg} kg` : '—'}</td>
                        <td className="font-data">{b.birthDate}</td>
                        <td>{b.deliveryType || '—'}</td>
                        <td>{b.motherName || '—'}</td>
                        <td>{b.fatherName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* DEATH REGISTER TAB */}
        {activeTab === 'deaths' && (
          <div className="space-y-4">
            <div className="card p-4 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-2 items-center">
                <label className="label">{t('death.from')}</label>
                <input type="date" value={deathFromDate} onChange={e => setDeathFromDate(e.target.value)} className="input w-auto" />
                <label className="label">{t('death.to')}</label>
                <input type="date" value={deathToDate} onChange={e => setDeathToDate(e.target.value)} className="input w-auto" />
                <button onClick={() => setDeathFetchTrigger(n => n + 1)} className="btn-secondary">{t('actions.apply')}</button>
              </div>
              <button onClick={() => setShowDeathModal(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('actions.registerDeath')}</button>
            </div>
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2"><Heart className="w-4 h-4 text-slate-500" /><h2 className="font-semibold text-sm">{t('death.registerTitle', { count: deathTotal })}</h2></div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>#</th><th>{t('death.certificateNo')}</th><th>{t('death.patient')}</th><th>{t('death.dateOfDeath')}</th><th>{t('death.time')}</th><th>{t('death.causeOfDeath')}</th><th>{t('death.manner')}</th><th>{t('death.place')}</th><th>{t('death.age')}</th></tr></thead>
                  <tbody>
                    {deathsLoading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : deaths.length === 0 ? <tr><td colSpan={9} className="py-16 text-center text-[var(--color-text-muted)]">{t('death.noRecordsFound')}</td></tr>
                    : deaths.map((d, idx) => (
                      <tr key={d.id}>
                        <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-data text-xs">{d.certificateNumber || '—'}</td>
                        <td className="font-medium">{d.patientName || `Patient #${d.patientId}`}</td>
                        <td className="font-data">{d.deathDate}</td>
                        <td>{d.deathTime || '—'}</td>
                        <td className="max-w-xs truncate" title={d.causeOfDeath || ''}>{d.causeOfDeath || '—'}</td>
                        <td>{d.mannerOfDeath || '—'}</td>
                        <td>{d.placeOfDeath || '—'}</td>
                        <td>{d.ageAtDeath || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ICD-10 BROWSER TAB */}
        {activeTab === 'icd10' && (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex gap-3 items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input type="text" placeholder={t('placeholders.searchIcd10')} value={icdSearch} onChange={e => setIcdSearch(e.target.value)} className="input pl-9" />
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('icd10.showingCodes', { count: icdCodes.length })}</p>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>{t('icd10.code')}</th><th>{t('icd10.description')}</th><th>{t('icd10.groupId')}</th></tr></thead>
                  <tbody>
                    {icdLoading ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(3)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : icdCodes.length === 0 ? <tr><td colSpan={3} className="py-16 text-center text-[var(--color-text-muted)]">{icdSearch ? t('icd10.noCodesFoundWithSearch') : t('icd10.noCodesFound')}</td></tr>
                    : icdCodes.map(code => (
                      <tr key={code.id}>
                        <td><span className="font-data font-semibold text-[var(--color-primary)]">{code.code}</span></td>
                        <td>{code.description}</td>
                        <td className="text-[var(--color-text-muted)] text-sm">{code.diseaseGroupId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* REFERRALS TAB */}
        {activeTab === 'referrals' && (
          <div className="space-y-4">
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-amber-500" /><h2 className="font-semibold text-sm">{t('referrals.title')}</h2></div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>#</th><th>{t('referrals.patient')}</th><th>{t('referrals.referredTo')}</th><th>{t('referrals.referredDate')}</th><th>{t('referrals.fileNo')}</th><th>{t('referrals.reason')}</th></tr></thead>
                  <tbody>
                    {referralsLoading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : referrals.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">{t('referrals.noRecordsFound')}</td></tr>
                    : referrals.map((r, idx) => (
                      <tr key={r.id}>
                        <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-medium">{r.patientName || `Patient #${r.patientId}`}</td>
                        <td>{r.referredTo || '—'}</td>
                        <td className="font-data">{r.referredDate || '—'}</td>
                        <td>{r.fileNumber || '—'}</td>
                        <td className="text-sm max-w-xs truncate" title={r.remarks || ''}>{r.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {referralTotal > 20 && (
                <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between text-sm text-[var(--color-text-muted)]">
                  <span>{t('pagination.total', { total: referralTotal, type: t('tabs.referrals') })}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setReferralPage(p => Math.max(1, p - 1))} disabled={referralPage === 1} className="btn-secondary px-3 py-1 text-xs">{t('pagination.prev')}</button>
                    <button onClick={() => setReferralPage(p => p + 1)} disabled={referrals.length < 20} className="btn-secondary px-3 py-1 text-xs">{t('pagination.next')}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODALS */}

        {/* ── New Medical Record Modal ── */}
        {showRecordModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold flex items-center gap-2"><FileText className="w-5 h-5" /> {t('modals.newRecord.title')}</h3>
                <button onClick={() => setShowRecordModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={submitRecord} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('modals.newRecord.patientId')} *</label><input className="input" type="number" required value={recordForm.patient_id} onChange={e => setRecordForm({ ...recordForm, patient_id: e.target.value })} placeholder={t('placeholders.patientId')} /></div>
                  <div><label className="label">{t('modals.newRecord.fileNumber')}</label><input className="input" value={recordForm.file_number} onChange={e => setRecordForm({ ...recordForm, file_number: e.target.value })} placeholder={t('placeholders.fileNumber')} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('modals.newRecord.dischargeType')}</label><select className="input" value={recordForm.discharge_type} onChange={e => setRecordForm({ ...recordForm, discharge_type: e.target.value })}><option value="">{t('common.select')}</option><option value="normal">{t('dischargeTypes.normal')}</option><option value="lama">{t('dischargeTypes.lama')}</option><option value="absconded">{t('dischargeTypes.absconded')}</option><option value="referred">{t('dischargeTypes.referred')}</option><option value="expired">{t('dischargeTypes.expired')}</option></select></div>
                  <div><label className="label">{t('modals.newRecord.dischargeCondition')}</label><select className="input" value={recordForm.discharge_condition} onChange={e => setRecordForm({ ...recordForm, discharge_condition: e.target.value })}><option value="">{t('common.select')}</option><option value="improved">{t('dischargeConditions.improved')}</option><option value="unchanged">{t('dischargeConditions.unchanged')}</option><option value="worsened">{t('dischargeConditions.worsened')}</option><option value="cured">{t('dischargeConditions.cured')}</option></select></div>
                </div>
                <div className="flex items-center gap-3"><input type="checkbox" id="op_conducted" checked={recordForm.is_operation_conducted} onChange={e => setRecordForm({ ...recordForm, is_operation_conducted: e.target.checked })} className="w-4 h-4" /><label htmlFor="op_conducted" className="label cursor-pointer">{t('modals.newRecord.operationConducted')}</label></div>
                {recordForm.is_operation_conducted && (
                  <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-[var(--color-border)]">
                    <div><label className="label">{t('modals.newRecord.operationDate')}</label><input type="date" className="input" value={recordForm.operation_date} onChange={e => setRecordForm({ ...recordForm, operation_date: e.target.value })} /></div>
                    <div><label className="label">{t('modals.newRecord.operationDiagnosis')}</label><input className="input" value={recordForm.operation_diagnosis} onChange={e => setRecordForm({ ...recordForm, operation_diagnosis: e.target.value })} placeholder={t('placeholders.operationDiagnosis')} /></div>
                  </div>
                )}
                {recordForm.discharge_type === 'referred' && (
                  <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-amber-200">
                    <div><label className="label">{t('modals.newRecord.referredTo')}</label><input className="input" value={recordForm.referred_to} onChange={e => setRecordForm({ ...recordForm, referred_to: e.target.value })} placeholder={t('placeholders.referredTo')} /></div>
                    <div><label className="label">{t('modals.newRecord.referralDate')}</label><input type="date" className="input" value={recordForm.referred_date} onChange={e => setRecordForm({ ...recordForm, referred_date: e.target.value })} /></div>
                    <div className="col-span-2"><label className="label">{t('modals.newRecord.referralReason')}</label><textarea className="input min-h-[60px]" value={recordForm.referred_reason} onChange={e => setRecordForm({ ...recordForm, referred_reason: e.target.value })} placeholder={t('placeholders.referralReason')} /></div>
                  </div>
                )}
                <div><label className="label">{t('modals.newRecord.remarks')}</label><textarea className="input min-h-[60px]" value={recordForm.remarks} onChange={e => setRecordForm({ ...recordForm, remarks: e.target.value })} placeholder={t('placeholders.remarks')} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowRecordModal(false)} className="btn-secondary">{t('common.cancel')}</button><button type="submit" disabled={submitting} className="btn-primary">{submitting ? t('common.creating') : t('modals.newRecord.createRecord')}</button></div>
              </form>
            </div>
          </div>
        )}

        {/* ── Register Birth Modal ── */}
        {showBirthModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold flex items-center gap-2"><Baby className="w-5 h-5 text-pink-500" /> {t('modals.birth.title')}</h3><button onClick={() => setShowBirthModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={submitBirth} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('modals.birth.mPatientId')} *</label><input className="input" type="number" required value={birthForm.patient_id} onChange={e => setBirthForm({ ...birthForm, patient_id: e.target.value })} placeholder={t('placeholders.motherPatientId')} /></div><div><label className="label">{t('modals.birth.babyName')}</label><input className="input" value={birthForm.baby_name} onChange={e => setBirthForm({ ...birthForm, baby_name: e.target.value })} placeholder={t('placeholders.optional')} /></div></div>
                <div className="grid grid-cols-3 gap-4"><div><label className="label">{t('birth.sex')}</label><select className="input" value={birthForm.sex} onChange={e => setBirthForm({ ...birthForm, sex: e.target.value })}><option value="">{t('common.select')}</option><option value="Male">{t('birth.sexValues.male')}</option><option value="Female">{t('birth.sexValues.female')}</option><option value="Other">{t('birth.sexValues.other')}</option></select></div><div><label className="label">{t('birth.weightKg')}</label><input className="input" type="number" step="0.01" min="0" value={birthForm.weight_kg} onChange={e => setBirthForm({ ...birthForm, weight_kg: e.target.value })} placeholder={t('placeholders.weightKg')} /></div><div><label className="label">{t('birth.birthType')}</label><select className="input" value={birthForm.birth_type} onChange={e => setBirthForm({ ...birthForm, birth_type: e.target.value })}><option value="">{t('common.select')}</option><option value="Single">{t('birth.birthTypes.single')}</option><option value="Twin">{t('birth.birthTypes.twin')}</option><option value="Triplet">{t('birth.birthTypes.triplet')}</option><option value="Quadruplet">{t('birth.birthTypes.quadruplet')}</option></select></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('birth.birthDate')} *</label><input type="date" className="input" required value={birthForm.birth_date} onChange={e => setBirthForm({ ...birthForm, birth_date: e.target.value })} /></div><div><label className="label">{t('birth.birthTime')}</label><input type="time" className="input" value={birthForm.birth_time} onChange={e => setBirthForm({ ...birthForm, birth_time: e.target.value })} /></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('birth.deliveryType')}</label><select className="input" value={birthForm.delivery_type} onChange={e => setBirthForm({ ...birthForm, delivery_type: e.target.value })}><option value="">{t('common.select')}</option><option value="Normal">{t('birth.deliveryTypes.normal')}</option><option value="Cesarean">{t('birth.deliveryTypes.cesarean')}</option><option value="Forceps">{t('birth.deliveryTypes.forceps')}</option><option value="Vacuum">{t('birth.deliveryTypes.vacuum')}</option></select></div><div><label className="label">{t('birth.birthCondition')}</label><select className="input" value={birthForm.birth_condition} onChange={e => setBirthForm({ ...birthForm, birth_condition: e.target.value })}><option value="">{t('common.select')}</option><option value="Alive">{t('birth.birthConditions.alive')}</option><option value="Stillborn">{t('birth.birthConditions.stillborn')}</option></select></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('birth.fatherName')}</label><input className="input" value={birthForm.father_name} onChange={e => setBirthForm({ ...birthForm, father_name: e.target.value })} /></div><div><label className="label">{t('birth.motherName')}</label><input className="input" value={birthForm.mother_name} onChange={e => setBirthForm({ ...birthForm, mother_name: e.target.value })} /></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('modals.birth.issuedBy')}</label><input className="input" value={birthForm.issued_by} onChange={e => setBirthForm({ ...birthForm, issued_by: e.target.value })} /></div><div><label className="label">{t('modals.birth.certifiedBy')}</label><input className="input" value={birthForm.certified_by} onChange={e => setBirthForm({ ...birthForm, certified_by: e.target.value })} /></div></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowBirthModal(false)} className="btn-secondary">{t('common.cancel')}</button><button type="submit" disabled={submitting} className="btn-primary">{submitting ? t('common.registering') : t('modals.birth.registerBirth')}</button></div>
              </form>
            </div>
          </div>
        )}

        {/* ── Register Death Modal ── */}
        {showDeathModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold flex items-center gap-2"><Heart className="w-5 h-5 text-slate-500" /> {t('modals.death.title')}</h3><button onClick={() => setShowDeathModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={submitDeath} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('modals.death.patientId')} *</label><input className="input" type="number" required value={deathForm.patient_id} onChange={e => setDeathForm({ ...deathForm, patient_id: e.target.value })} placeholder={t('placeholders.patientId')} /></div><div><label className="label">{t('death.ageAtDeath')}</label><input className="input" value={deathForm.age_at_death} onChange={e => setDeathForm({ ...deathForm, age_at_death: e.target.value })} placeholder={t('placeholders.ageAtDeath')} /></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('death.dateOfDeath')} *</label><input type="date" className="input" required value={deathForm.death_date} onChange={e => setDeathForm({ ...deathForm, death_date: e.target.value })} /></div><div><label className="label">{t('death.timeOfDeath')}</label><input type="time" className="input" value={deathForm.death_time} onChange={e => setDeathForm({ ...deathForm, death_time: e.target.value })} /></div></div>
                <div><label className="label">{t('death.causeOfDeath')}</label><textarea className="input min-h-[60px]" value={deathForm.cause_of_death} onChange={e => setDeathForm({ ...deathForm, cause_of_death: e.target.value })} placeholder={t('placeholders.primaryCause')} /></div>
                <div><label className="label">{t('death.secondaryCause')}</label><textarea className="input min-h-[60px]" value={deathForm.secondary_cause} onChange={e => setDeathForm({ ...deathForm, secondary_cause: e.target.value })} placeholder={t('placeholders.contributingCause')} /></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('death.mannerOfDeath')}</label><select className="input" value={deathForm.manner_of_death} onChange={e => setDeathForm({ ...deathForm, manner_of_death: e.target.value })}><option value="">{t('common.select')}</option><option value="Natural">{t('death.mannerValues.natural')}</option><option value="Accident">{t('death.mannerValues.accident')}</option><option value="Suicide">{t('death.mannerValues.suicide')}</option><option value="Homicide">{t('death.mannerValues.homicide')}</option><option value="Undetermined">{t('death.mannerValues.undetermined')}</option></select></div><div><label className="label">{t('death.placeOfDeath')}</label><select className="input" value={deathForm.place_of_death} onChange={e => setDeathForm({ ...deathForm, place_of_death: e.target.value })}><option value="">{t('common.select')}</option><option value="Ward">{t('death.placeValues.ward')}</option><option value="ICU">{t('death.placeValues.icu')}</option><option value="Emergency">{t('death.placeValues.emergency')}</option><option value="OT">{t('death.placeValues.ot')}</option><option value="Other">{t('death.placeValues.other')}</option></select></div></div>
                <div className="grid grid-cols-3 gap-4"><div><label className="label">{t('death.fatherName')}</label><input className="input" value={deathForm.father_name} onChange={e => setDeathForm({ ...deathForm, father_name: e.target.value })} /></div><div><label className="label">{t('death.motherName')}</label><input className="input" value={deathForm.mother_name} onChange={e => setDeathForm({ ...deathForm, mother_name: e.target.value })} /></div><div><label className="label">{t('death.spouseName')}</label><input className="input" value={deathForm.spouse_name} onChange={e => setDeathForm({ ...deathForm, spouse_name: e.target.value })} /></div></div>
                <div><label className="label">{t('modals.death.certifiedBy')}</label><input className="input" value={deathForm.certified_by} onChange={e => setDeathForm({ ...deathForm, certified_by: e.target.value })} placeholder={t('placeholders.doctorName')} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowDeathModal(false)} className="btn-secondary">{t('common.cancel')}</button><button type="submit" disabled={submitting} className="btn-primary">{submitting ? t('common.registering') : t('modals.death.registerDeath')}</button></div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
