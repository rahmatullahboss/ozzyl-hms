import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Building2, CalendarDays, CheckCircle2, ChevronDown, CreditCard, FileText, Link2Off, Pill, RefreshCw, Shield, TestTube2 } from 'lucide-react';
import {
  type HospitalLink,
  useHospitalConsents,
  useHospitalData,
  useHospitalLinks,
  usePreVisitInsight,
  useSelectedHospitalLiveVisit,
  useSyncHospitalData,
  useUnlinkHospital,
  useUpdateConsent,
} from '../../hooks/useConnectedCare';
import {
  buildSelectedHospitalCareOverview,
  formatPatientDateMonthYear,
  normalizePatientClinicalDataForDisplay,
  PATIENT_SELECTED_HOSPITAL_STORAGE_KEY,
} from '../../lib/patientPortalUx';

interface ConnectedCareTabProps {
  onFindHospital?: () => void;
}

type CareSection = 'appointments' | 'prescriptions' | 'labs' | 'bills';

type EmptyStateProps = {
  icon: typeof Building2;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

const CONSENT_LABELS: Record<string, { bn: string; en: string; sensitive: boolean }> = {
  ai_access: { bn: 'AI কোচ ক্লিনিক্যাল অ্যাক্সেস', en: 'AI Coach Clinical Access', sensitive: false },
  vitals_sharing: { bn: 'ভাইটাল ডেটা শেয়ার', en: 'Vitals Sharing', sensitive: false },
  medication_sharing: { bn: 'ওষুধ ডেটা শেয়ার', en: 'Medication Sharing', sensitive: false },
  lab_sharing: { bn: 'ল্যাব রিপোর্ট শেয়ার', en: 'Lab Report Sharing', sensitive: false },
  mood_sharing: { bn: 'মুড ডেটা শেয়ার', en: 'Mood Data Sharing', sensitive: true },
  cycle_sharing: { bn: 'মাসিক চক্র শেয়ার', en: 'Menstrual Cycle Sharing', sensitive: true },
};

const SECTIONS = [
  { key: 'appointments' as const, icon: CalendarDays, bn: 'অ্যাপয়েন্টমেন্ট', en: 'Appointments' },
  { key: 'prescriptions' as const, icon: FileText, bn: 'প্রেসক্রিপশন', en: 'Prescriptions' },
  { key: 'labs' as const, icon: TestTube2, bn: 'ল্যাব রিপোর্ট', en: 'Lab Results' },
  { key: 'bills' as const, icon: CreditCard, bn: 'বিল', en: 'Bills' },
];

function isVerifiedLink(link: HospitalLink) {
  return String(link.status ?? '').toLowerCase() === 'verified';
}

function getSectionLabel(section: CareSection, isBn: boolean) {
  const match = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];
  return isBn ? match.bn : match.en;
}

function EmptyCareState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
      <Icon className="w-14 h-14 text-slate-300 mx-auto mb-4" />
      <h2 className="text-lg font-bold text-slate-900 mb-2">{title}</h2>
      <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-colors">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function getCareRecordValue(record: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return '';
}

function formatCareDate(value: unknown) {
  return formatPatientDateMonthYear(value);
}

function formatCareAmount(value: number) {
  const normalized = value > 10000 ? value / 100 : value;
  return `৳${normalized.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function CareOverviewCard({
  icon: Icon,
  label,
  title,
  meta,
  empty,
}: {
  icon: typeof Building2;
  label: string;
  title: string;
  meta: string;
  empty?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${empty ? 'border-slate-100 bg-slate-50/70' : 'border-cyan-100 bg-white shadow-sm'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${empty ? 'bg-white text-slate-400' : 'bg-cyan-50 text-cyan-700'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      </div>
      <p className="text-sm font-extrabold text-slate-900 line-clamp-2">{title}</p>
      <p className="mt-1 text-xs text-slate-500 line-clamp-2">{meta}</p>
    </div>
  );
}

export default function ConnectedCareTab({ onFindHospital }: ConnectedCareTabProps) {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';
  const [selectedLink, setSelectedLink] = useState<HospitalLink | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState('');
  const [syncingLabs, setSyncingLabs] = useState(false);
  const [syncingPrescriptions, setSyncingPrescriptions] = useState(false);
  const [showConsents, setShowConsents] = useState(false);
  const [activeSection, setActiveSection] = useState<CareSection>('appointments');

  const { data: linksData, isLoading: loadingLinks } = useHospitalLinks();
  const allLinks = useMemo(() => {
    const all = linksData?.all_hospitals;
    return all && all.length > 0 ? all : (linksData?.hospitals ?? []);
  }, [linksData]);
  const verifiedLinks = useMemo(() => (linksData?.hospitals ?? []).filter(isVerifiedLink), [linksData]);
  const pendingLinks = useMemo(
    () => linksData?.pending_hospitals ?? allLinks.filter((link) => !isVerifiedLink(link)),
    [allLinks, linksData],
  );

  useEffect(() => {
    const savedTenantId = window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
    if (verifiedLinks.length === 0) {
      setSelectedLink(null);
      if (savedTenantId) window.sessionStorage.removeItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
      return;
    }

    const matchedSavedLink = savedTenantId
      ? verifiedLinks.find((link) => String(link.tenant_id) === savedTenantId) ?? null
      : null;

    setSelectedLink((current) => {
      if (current && verifiedLinks.some((link) => link.id === current.id)) return current;
      return matchedSavedLink;
    });

    if (savedTenantId && !matchedSavedLink) {
      window.sessionStorage.removeItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
    }
  }, [verifiedLinks]);

  const selectedTenantId = selectedLink?.tenant_id ?? null;
  const { data: clinicalRes, isFetching: loadingClinicalData } = useHospitalData(selectedLink?.id ?? null);
  const clinicalData = useMemo(
    () => normalizePatientClinicalDataForDisplay(clinicalRes?.data ?? null),
    [clinicalRes?.data],
  );
  const { data: consentRes } = useHospitalConsents(selectedTenantId);
  const { data: liveVisitRes } = useSelectedHospitalLiveVisit(selectedTenantId);
  const { data: preVisitRes } = usePreVisitInsight(selectedLink?.id ?? null);
  const { mutateAsync: updateConsent } = useUpdateConsent();
  const { mutateAsync: unlinkHospital } = useUnlinkHospital();
  const { mutateAsync: syncHospitalData } = useSyncHospitalData();

  const consents = consentRes?.consents ?? [];
  const careOverview = useMemo(() => buildSelectedHospitalCareOverview({
    hospitalName: selectedLink?.hospital_name ?? null,
    clinicalData,
    liveVisit: liveVisitRes?.live_visit ?? null,
  }), [clinicalData, liveVisitRes?.live_visit, selectedLink?.hospital_name]);
  const overviewCards = useMemo(() => {
    const nextAppointment = careOverview.nextAppointment;
    const recentPrescription = careOverview.recentPrescription;
    const latestLabResult = careOverview.latestLabResult;
    const latestDueBill = careOverview.billSummary.latestDueBill;

    return [
      {
        key: 'next-appointment',
        icon: CalendarDays,
        label: isBn ? 'পরবর্তী অ্যাপয়েন্টমেন্ট' : 'Next appointment',
        title: nextAppointment
          ? getCareRecordValue(nextAppointment, ['doctor_name', 'department', 'chief_complaint']) || (isBn ? 'অ্যাপয়েন্টমেন্ট' : 'Appointment')
          : (isBn ? 'কোনো অ্যাপয়েন্টমেন্ট নেই' : 'No appointment yet'),
        meta: nextAppointment
          ? `${formatCareDate(nextAppointment.appointment_date ?? nextAppointment.appt_date ?? nextAppointment.date)} ${getCareRecordValue(nextAppointment, ['appointment_time', 'appt_time'])}`.trim()
          : (isBn ? 'এই হাসপাতালে নতুন booking করুন' : 'Book from this selected hospital'),
        empty: !nextAppointment,
      },
      {
        key: 'recent-prescription',
        icon: Pill,
        label: isBn ? 'সাম্প্রতিক প্রেসক্রিপশন' : 'Recent prescription',
        title: recentPrescription
          ? getCareRecordValue(recentPrescription, ['doctor_name', 'rx_no', 'diagnosis']) || (isBn ? 'Final prescription' : 'Final prescription')
          : (isBn ? 'Final prescription নেই' : 'No final prescription'),
        meta: recentPrescription
          ? formatCareDate(recentPrescription.prescribed_date ?? recentPrescription.date ?? recentPrescription.created_at)
          : (isBn ? 'Draft/void prescription hidden থাকে' : 'Draft or void prescriptions stay hidden'),
        empty: !recentPrescription,
      },
      {
        key: 'latest-lab',
        icon: TestTube2,
        label: isBn ? 'সর্বশেষ ল্যাব রিপোর্ট' : 'Latest lab result',
        title: latestLabResult
          ? getCareRecordValue(latestLabResult, ['test_name', 'order_no', 'name']) || (isBn ? 'Released lab result' : 'Released lab result')
          : (isBn ? 'Released result নেই' : 'No released result'),
        meta: latestLabResult
          ? `${formatCareDate(latestLabResult.result_date ?? latestLabResult.collected_date ?? latestLabResult.created_at)} · ${getCareRecordValue(latestLabResult, ['status', 'result_status'])}`
          : (isBn ? 'Unverified result hidden থাকে' : 'Unverified results stay hidden'),
        empty: !latestLabResult,
      },
      {
        key: 'bill-summary',
        icon: CreditCard,
        label: isBn ? 'বিল summary' : 'Bill summary',
        title: careOverview.billSummary.dueCount > 0
          ? `${careOverview.billSummary.dueCount} ${isBn ? 'টি due bill' : 'due bill'} · ${formatCareAmount(careOverview.billSummary.totalDue)}`
          : (isBn ? 'কোনো due bill নেই' : 'No due bill'),
        meta: latestDueBill
          ? `${formatCareDate(latestDueBill.bill_date ?? latestDueBill.created_at)} · ${getCareRecordValue(latestDueBill, ['invoice_no', 'status', 'payment_status'])}`
          : (isBn ? 'Paid/settled bill history-তে থাকবে' : 'Paid or settled bills stay in history'),
        empty: careOverview.billSummary.dueCount === 0,
      },
    ];
  }, [careOverview, isBn]);
  const preVisitInsight = preVisitRes?.insight ?? null;
  const preVisitActions = preVisitRes?.actions ?? [];

  const selectHospital = useCallback((linkIdText: string) => {
    const linkId = Number(linkIdText);
    const nextLink = verifiedLinks.find((link) => link.id === linkId) ?? null;
    setSelectedLink(nextLink);
    setBridgeMessage('');
    if (nextLink?.tenant_id) {
      window.sessionStorage.setItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY, nextLink.tenant_id);
    } else {
      window.sessionStorage.removeItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
    }
  }, [verifiedLinks]);

  async function toggleConsent(consentType: string, granted: boolean) {
    if (!selectedLink) return;
    try {
      await updateConsent({ tenant_id: selectedLink.tenant_id, consent_type: consentType, granted });
    } catch {
      // Ignore transient consent write errors; mutation hook owns user-visible error handling.
    }
  }

  async function handleUnlink() {
    if (!selectedLink) return;
    if (!confirm(isBn ? 'এই হাসপাতাল থেকে সংযোগ বিচ্ছিন্ন করবেন?' : 'Disconnect from this hospital?')) return;
    const tenantId = selectedLink.tenant_id;
    try {
      await unlinkHospital(selectedLink.id);
      setSelectedLink(null);
      if (window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY) === tenantId) {
        window.sessionStorage.removeItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
      }
    } catch {
      // Ignore; mutation hook owns user-visible error handling.
    }
  }

  const runBridgeSync = useCallback(async (kind: 'labs' | 'prescriptions') => {
    if (!selectedLink) return;
    const setLoadingState = kind === 'labs' ? setSyncingLabs : setSyncingPrescriptions;
    const successLabel = kind === 'labs'
      ? (isBn ? 'ল্যাব রিপোর্ট wellness data-তে sync হয়েছে' : 'Lab results synced into wellness data')
      : (isBn ? 'প্রেসক্রিপশন medication tracker-এ sync হয়েছে' : 'Prescriptions synced into medication tracker');

    setLoadingState(true);
    setBridgeMessage('');
    try {
      const data = await syncHospitalData({ linkId: selectedLink.id, kind }) as { synced?: number };
      const synced = data.synced ?? 0;
      setBridgeMessage(`${successLabel}${synced > 0 ? ` (${synced})` : ''}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : (isBn ? 'Sync করা যায়নি' : 'Could not sync right now');
      setBridgeMessage(message);
    } finally {
      setLoadingState(false);
    }
  }, [isBn, selectedLink, syncHospitalData]);

  if (loadingLinks) {
    return <div className="space-y-4 animate-pulse"><div className="h-32 bg-slate-200 rounded-2xl" /><div className="h-48 bg-slate-200 rounded-2xl" /></div>;
  }

  if (allLinks.length === 0) {
    return (
      <EmptyCareState
        icon={Building2}
        title={isBn ? 'কোনো হাসপাতাল সংযুক্ত নেই' : 'No hospital linked'}
        description={isBn ? 'প্রথমে আপনার হাসপাতালের সাথে link request করুন। verified না হওয়া পর্যন্ত clinical data দেখানো হবে না।' : 'Link a hospital first. Clinical data is not shown until a hospital verifies the connection.'}
        actionLabel={isBn ? 'হাসপাতাল খুঁজুন' : 'Find a hospital'}
        onAction={onFindHospital}
      />
    );
  }

  if (verifiedLinks.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyCareState
          icon={Shield}
          title={isBn ? 'কোনো verified hospital নেই' : 'No verified hospital yet'}
          description={isBn ? 'Hospital-side approval শেষ না হলে clinical data load বা display হবে না।' : 'Clinical data is not loaded or displayed until hospital-side verification is complete.'}
          actionLabel={isBn ? 'আরেকটি হাসপাতাল যোগ করুন' : 'Add another hospital'}
          onAction={onFindHospital}
        />
        {pendingLinks.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-bold text-slate-800">{isBn ? 'Pending link requests' : 'Pending link requests'}</p>
            <div className="space-y-2">
              {pendingLinks.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-800">{link.hospital_name}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">{link.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-100 bg-white p-4 shadow-sm">
        <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">
          {isBn ? 'Care context' : 'Care context'}
        </label>
        <div className="relative mt-3">
          <select
            value={selectedLink?.id ?? ''}
            onChange={(event) => selectHospital(event.target.value)}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-10 text-sm font-medium"
            aria-label={isBn ? 'Verified hospital নির্বাচন করুন' : 'Select a verified hospital'}
          >
            <option value="">{isBn ? 'Verified hospital নির্বাচন করুন' : 'Select a verified hospital'}</option>
            {verifiedLinks.map((link) => <option key={link.id} value={link.id}>{link.hospital_name}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {isBn
            ? 'Hospital select না করলে appointments, prescriptions, labs বা bills load হবে না।'
            : 'Appointments, prescriptions, labs, and bills load only after you explicitly select a verified hospital.'}
        </p>
      </div>

      {!selectedLink ? (
        <>
          <EmptyCareState
            icon={CheckCircle2}
            title={isBn ? 'হাসপাতাল select করুন' : 'Select a hospital to continue'}
            description={isBn ? 'আপনার verified hospital আছে, কিন্তু selected care context নেই। Clinical data দেখার আগে কোন হাসপাতালের data দেখতে চান তা নির্বাচন করুন।' : 'You have verified hospitals, but no selected care context. Choose which hospital’s data you want to view before any clinical data is loaded.'}
          />
          <button onClick={onFindHospital} className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-600">
            + {isBn ? 'আরেকটি হাসপাতাল যোগ করুন' : 'Add another hospital'}
          </button>
        </>
      ) : (
        <>
          <div className="rounded-3xl border border-cyan-100 bg-gradient-to-r from-cyan-50 via-white to-teal-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">
                  {isBn ? 'নির্বাচিত হাসপাতাল' : 'Selected hospital'}
                </p>
                <h3 className="mt-2 text-xl font-extrabold text-slate-900">{selectedLink.hospital_name}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {isBn ? 'নিচের data এই verified hospital context-এ scoped।' : 'The data below is scoped to this verified hospital context.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SECTIONS.map((section) => (
                  <div key={section.key} className="rounded-2xl border border-white bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isBn ? section.bn : section.en}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{clinicalData[section.key].length}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">
                  {isBn ? 'Selected hospital overview' : 'Selected hospital overview'}
                </p>
                <h3 className="mt-2 text-xl font-extrabold text-slate-900">
                  {isBn ? 'এই হাসপাতালের care snapshot' : 'Care snapshot for this hospital'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {isBn ? 'Live visit, appointment, prescription, lab এবং bill summary একই selected hospital context থেকে।' : 'Live visit, appointment, prescription, lab, and bill summary are all scoped to the selected hospital.'}
                </p>
              </div>
              <button onClick={() => setActiveSection('appointments')} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                {isBn ? 'Details দেখুন' : 'View details'}
              </button>
            </div>

            {careOverview.liveVisit && (
              <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">{isBn ? 'Live visit' : 'Live visit'}</p>
                      <h4 className="mt-1 text-base font-extrabold text-slate-900">
                        {careOverview.liveVisit.queue?.token_no
                          ? `${isBn ? 'Token' : 'Token'} ${careOverview.liveVisit.queue.token_no}`
                          : careOverview.liveVisit.status}
                      </h4>
                      <p className="mt-1 text-xs text-slate-600">
                        {careOverview.liveVisit.arrival_guidance?.label || careOverview.liveVisit.next_step_label || (isBn ? 'Queue status live update হচ্ছে।' : 'Queue status is updating live.')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">{isBn ? 'Status' : 'Status'}</span><b>{careOverview.liveVisit.status}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">{isBn ? 'Ahead' : 'Ahead'}</span><b>{careOverview.liveVisit.patients_ahead ?? 0}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">ETA</span><b>{careOverview.liveVisit.estimated_wait_minutes ?? '—'}</b></div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {overviewCards.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'next-appointment') setActiveSection('appointments');
                    if (item.key === 'recent-prescription') setActiveSection('prescriptions');
                    if (item.key === 'latest-lab') setActiveSection('labs');
                    if (item.key === 'bill-summary') setActiveSection('bills');
                  }}
                  className="text-left"
                >
                  <CareOverviewCard icon={item.icon} label={item.label} title={item.title} meta={item.meta} empty={item.empty} />
                </button>
              ))}
            </div>
          </section>

          <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏥</span>
              <div>
                <p className="text-sm font-semibold text-emerald-900">{selectedLink.hospital_name}</p>
                <p className="text-xs text-emerald-600">{isBn ? 'Verified এবং selected' : 'Verified and selected'}</p>
              </div>
            </div>
            <button onClick={handleUnlink} className="rounded-lg p-2 transition hover:bg-emerald-100" title={isBn ? 'সংযোগ বিচ্ছিন্ন' : 'Disconnect'}>
              <Link2Off className="h-4 w-4 text-emerald-600" />
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const count = clinicalData[section.key].length;
              return (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${activeSection === section.key ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {isBn ? section.bn : section.en}
                  {count > 0 && <span className="ml-1 text-[10px] opacity-75">({count})</span>}
                </button>
              );
            })}
            <button onClick={() => setShowConsents(!showConsents)} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap">
              <Shield className="h-3.5 w-3.5" />
              {isBn ? 'গোপনীয়তা' : 'Privacy'}
            </button>
          </div>

          {showConsents && (
            <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700">{isBn ? 'ডেটা শেয়ারিং সেটিংস' : 'Data Sharing Settings'}</h3>
              {Object.entries(CONSENT_LABELS).map(([type, label]) => {
                const consent = consents.find((item) => item.consent_type === type);
                const granted = consent ? !!consent.granted : false;
                return (
                  <div key={type} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-700">{isBn ? label.bn : label.en}</p>
                      {label.sensitive && <p className="text-[10px] text-amber-600">{isBn ? 'সংবেদনশীল ডেটা' : 'Sensitive data'}</p>}
                    </div>
                    <button onClick={() => toggleConsent(type, !granted)} className={`relative h-6 w-10 rounded-full transition-colors ${granted ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <div className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: granted ? 'translateX(16px)' : 'translateX(0)' }} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {preVisitInsight && (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/80 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">{isBn ? 'প্রি-ভিজিট প্রস্তুতি' : 'Pre-visit prep'}</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">{isBn ? preVisitInsight.title_bn : preVisitInsight.title_en}</h3>
              <p className="mt-2 text-sm text-slate-600">{isBn ? preVisitInsight.body_bn : preVisitInsight.body_en}</p>
              {preVisitActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preVisitActions.map((action, index) => (
                    <span key={`${action.en}-${index}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800">
                      {isBn ? action.bn : action.en}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{isBn ? 'ক্লিনিক্যাল টু ওয়েলনেস ব্রিজ' : 'Clinical to wellness bridge'}</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900">{isBn ? 'হাসপাতালের ডেটা আপনার wellness flow-তে আনুন' : 'Bring hospital data into your wellness flow'}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {isBn ? 'শুধু selected verified hospital থেকে released lab ও final/active prescription sync করা হবে।' : 'Only released labs and final/active prescriptions from the selected verified hospital are synced.'}
                </p>
              </div>
              <div className="rounded-2xl bg-white/90 p-3 text-emerald-600 shadow-sm"><RefreshCw className="h-5 w-5" /></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button onClick={() => void runBridgeSync('labs')} disabled={syncingLabs} className="rounded-2xl bg-slate-900 px-4 py-3 text-left text-white transition hover:bg-slate-800 disabled:opacity-50">
                <span className="flex items-center gap-2 text-sm font-semibold"><TestTube2 className="h-4 w-4" />{syncingLabs ? (isBn ? 'ল্যাব sync হচ্ছে...' : 'Syncing labs...') : (isBn ? 'ল্যাব wellness-এ sync করুন' : 'Sync labs to wellness')}</span>
                <span className="mt-1 block text-xs text-white/70">{isBn ? 'সাম্প্রতিক completed lab result vital history-তে নিন' : 'Pull recent completed lab results into vital history'}</span>
              </button>
              <button onClick={() => void runBridgeSync('prescriptions')} disabled={syncingPrescriptions} className="rounded-2xl bg-emerald-600 px-4 py-3 text-left text-white transition hover:bg-emerald-500 disabled:opacity-50">
                <span className="flex items-center gap-2 text-sm font-semibold"><Pill className="h-4 w-4" />{syncingPrescriptions ? (isBn ? 'প্রেসক্রিপশন sync হচ্ছে...' : 'Syncing prescriptions...') : (isBn ? 'প্রেসক্রিপশন tracker-এ sync করুন' : 'Sync prescriptions to tracker')}</span>
                <span className="mt-1 block text-xs text-white/75">{isBn ? 'active hospital prescription medication list-এ আনুন' : 'Bring active hospital prescriptions into the medication list'}</span>
              </button>
            </div>
            {bridgeMessage && <p className="mt-3 text-sm font-medium text-emerald-700">{bridgeMessage}</p>}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{isBn ? 'Selected care context' : 'Selected care context'}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{selectedLink.hospital_name} · {getSectionLabel(activeSection, isBn)}</p>
            </div>
            {loadingClinicalData ? (
              <div className="space-y-3 animate-pulse"><div className="h-14 rounded-xl bg-slate-100" /><div className="h-14 rounded-xl bg-slate-100" /></div>
            ) : (
              <>
                {activeSection === 'appointments' && <AppointmentList appointments={clinicalData.appointments} isBn={isBn} />}
                {activeSection === 'prescriptions' && <PrescriptionList prescriptions={clinicalData.prescriptions} isBn={isBn} />}
                {activeSection === 'labs' && <LabList labs={clinicalData.labs} isBn={isBn} />}
                {activeSection === 'bills' && <BillList bills={clinicalData.bills} isBn={isBn} />}
              </>
            )}
          </div>

          <button onClick={onFindHospital} className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-600">
            + {isBn ? 'আরেকটি হাসপাতাল যোগ করুন' : 'Add another hospital'}
          </button>
        </>
      )}
    </div>
  );
}

function AppointmentList({ appointments, isBn }: { appointments: any[]; isBn: boolean }) {
  if (appointments.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-6">{isBn ? 'এই হাসপাতালে কোনো অ্যাপয়েন্টমেন্ট নেই' : 'No appointments for this selected hospital'}</p>;
  }
  return (
    <div className="space-y-3">
      {appointments.map((appt) => (
        <div key={appt.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
          <CalendarDays className="w-5 h-5 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900">{appt.doctor_name || appt.department}</p>
            <p className="text-xs text-slate-500">{formatCareDate(appt.appointment_date)} {appt.appointment_time}</p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${appt.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : appt.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
            {appt.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function PrescriptionList({ prescriptions, isBn }: { prescriptions: any[]; isBn: boolean }) {
  if (prescriptions.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-6">{isBn ? 'এই হাসপাতালে final/active প্রেসক্রিপশন নেই' : 'No final or active prescriptions for this selected hospital'}</p>;
  }
  return (
    <div className="space-y-3">
      {prescriptions.map((rx) => (
        <div key={rx.id} className="p-3 bg-slate-50 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-slate-900">{rx.doctor_name}</p>
            <span className="text-xs text-slate-400">{formatCareDate(rx.prescribed_date)}</span>
          </div>
          <p className="text-xs text-slate-600">{rx.medications}</p>
        </div>
      ))}
    </div>
  );
}

function LabList({ labs, isBn }: { labs: any[]; isBn: boolean }) {
  if (labs.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-6">{isBn ? 'এই হাসপাতালে released/completed ল্যাব রিপোর্ট নেই' : 'No released or completed lab results for this selected hospital'}</p>;
  }
  return (
    <div className="space-y-3">
      {labs.map((lab) => (
        <div key={lab.id} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-slate-900">{lab.test_name}</p>
            <p className="text-xs text-slate-500">{formatCareDate(lab.collected_date)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-900">{lab.result_value} <span className="text-xs font-normal text-slate-400">{lab.unit}</span></p>
            {lab.normal_range && <p className="text-[10px] text-slate-400">{isBn ? 'স্বাভাবিক' : 'Normal'}: {lab.normal_range}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BillList({ bills, isBn }: { bills: any[]; isBn: boolean }) {
  if (bills.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-6">{isBn ? 'এই হাসপাতালে কোনো বিল নেই' : 'No bills for this selected hospital'}</p>;
  }
  return (
    <div className="space-y-3">
      {bills.map((bill) => (
        <div key={bill.id} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-500">{formatCareDate(bill.bill_date)}</p>
            <p className={`text-[10px] font-medium ${bill.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>{bill.status}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-900">৳{((bill.total_amount || 0) / 100).toLocaleString()}</p>
            {bill.paid_amount < bill.total_amount && (
              <p className="text-[10px] text-red-500">{isBn ? 'বকেয়া' : 'Due'}: ৳{(((bill.total_amount - bill.paid_amount) || 0) / 100).toLocaleString()}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
