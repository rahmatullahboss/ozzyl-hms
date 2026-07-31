import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertCircle,
  Building2,
  Calendar,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Pill,
  QrCode,
  ShieldCheck,
  Sparkles,
  TestTube,
  User,
} from 'lucide-react';
import PersonalizedGreeting from '../PersonalizedGreeting';
import { DailyHealthSummary } from '../DailyHealthSummary';
import QuickCheckInCard from '../QuickCheckInCard';
import WellnessScoreCard from '../WellnessScoreCard';
import { ScoreTrendChart } from '../ScoreTrendChart';
import InsightsCards from '../InsightsCards';
import { StreakTrackerWidget } from '../StreakTrackerWidget';
import LifestyleQuickActions from '../LifestyleQuickActions';
import SmartCardRenderer from '../SmartCardRenderer';
import { computeSmartCards } from '../../../lib/smart-card-priority';
import { buildPatientSyncedAppointmentStatus, type PatientLiveVisitSummary } from '../../../lib/patientPortalUx';
import { PatientSectionIntro } from './PatientSectionIntro';

interface PatientUserSnapshot {
  id: number;
  name: string;
  phone: string | null;
  national_id?: string | null;
  uhid: string | null;
  created_at?: string | null;
}

interface DashboardAppointment {
  id: number;
  hospital_name: string;
  doctor_name: string | null;
  appointment_date: string;
  appointment_time: string | null;
  status: string | null;
  department?: string | null;
}

interface DashboardPrescription {
  id: number;
  hospital_name: string;
  doctor_name: string | null;
  date: string;
}

interface DashboardReport {
  id: number;
  hospital_name: string;
  order_no?: string | null;
  result_date: string | null;
  status: string | null;
  test_names?: string | null;
  abnormal_count?: number | null;
}

interface DashboardBill {
  id: number;
  hospital_name: string;
  bill_date: string;
  grand_total: number | null;
  payment_status: string | null;
}

interface PatientGuidanceSummary {
  headline: string;
  status: 'attention' | 'watch' | 'stable';
  summary: string;
  what_changed: string[];
  next_steps: string[];
  trust_notes: string[];
  care_reminders: string[];
  counts: {
    pending_review_items: number;
    verified_items: number;
    vault_documents: number;
    active_visit_pass: number;
  };
}

interface DashboardResponse {
  hospitalsCount: number;
  appointments: DashboardAppointment[];
  prescriptions: DashboardPrescription[];
  reports: DashboardReport[];
  labResults: DashboardReport[];
  bills: DashboardBill[];
  patient_guidance?: PatientGuidanceSummary;
}

interface QuickActionItem {
  key: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  action: () => void;
}

interface GuidanceMetric {
  key: 'pending' | 'verified' | 'vault' | 'hospitals';
  value: number;
}

interface GuidanceTone {
  shell: string;
  badge: string;
  icon: string;
}

interface PatientHomeSectionProps {
  profileNeedsCompletion: boolean;
  profile: PatientUserSnapshot;
  userInitial: string;
  globalStatusLabel: string;
  currentStreak: number;
  hasCheckedInToday: boolean;
  todayMood?: string;
  hasActiveGoals: boolean;
  dashboard: DashboardResponse;
  liveVisit: PatientLiveVisitSummary | null;
  visibleQuickActions: QuickActionItem[];
  primaryAction?: QuickActionItem;
  guidanceChecklist: string[];
  guidanceMetrics: GuidanceMetric[];
  guidanceBadge: string;
  guidanceReasons: string[];
  guidanceTone: GuidanceTone;
  wellnessScores: {
    total: number;
    breakdown: { sleep: number; activity: number; nutrition: number; mood: number; medication: number; vitals: number };
    trend: number;
  };
  onOpenProfile: () => void;
  onOpenCare: () => void;
  onOpenCheckIn: () => void;
  onOpenFoodLog: () => void;
  onOpenGoalModal: () => void;
  formatDate: (value: string | null | undefined) => string;
  formatAmount: (value: number | null | undefined) => string;
  formatLiveVisitUpdatedAt: (value: string | null | undefined) => string | null;
  getAppointmentToneClass: (tone: 'slate' | 'amber' | 'cyan' | 'blue' | 'emerald' | 'rose') => string;
}

export function PatientHomeSection({
  profileNeedsCompletion,
  profile,
  userInitial,
  globalStatusLabel,
  currentStreak,
  hasCheckedInToday,
  todayMood,
  hasActiveGoals,
  dashboard,
  liveVisit,
  visibleQuickActions,
  primaryAction,
  guidanceChecklist,
  guidanceMetrics,
  guidanceBadge,
  guidanceReasons,
  guidanceTone,
  wellnessScores,
  onOpenProfile,
  onOpenCare,
  onOpenCheckIn,
  onOpenFoodLog,
  onOpenGoalModal,
  formatDate,
  formatAmount,
  formatLiveVisitUpdatedAt,
  getAppointmentToneClass,
}: PatientHomeSectionProps) {
  const { t, i18n } = useTranslation(['patientPortal', 'patients']);
  const nextAppointment = dashboard.appointments[0] ?? null;
  const latestPrescription = dashboard.prescriptions[0] ?? null;
  const latestReport = dashboard.reports[0] ?? dashboard.labResults[0] ?? null;
  const dueBill = dashboard.bills.find((bill) => {
    const status = String(bill.payment_status ?? '').toLowerCase();
    return Number(bill.grand_total ?? 0) > 0 && status !== 'paid' && status !== 'settled';
  }) ?? null;
  const healthSummaryItems = [
    {
      key: 'next-appointment',
      label: 'Next appointment',
      title: nextAppointment
        ? (nextAppointment.department || nextAppointment.doctor_name || 'Hospital visit')
        : 'No upcoming appointment',
      meta: nextAppointment
        ? `${formatDate(nextAppointment.appointment_date)}${nextAppointment.appointment_time ? ` · ${nextAppointment.appointment_time}` : ''}`
        : 'Book from your selected hospital workspace',
      sub: nextAppointment?.hospital_name ?? 'Choose a hospital to book care',
      icon: Calendar,
      action: onOpenCare,
      actionLabel: nextAppointment ? 'View care' : 'Book now',
    },
    {
      key: 'latest-prescription',
      label: 'Latest prescription',
      title: latestPrescription
        ? (latestPrescription.doctor_name || 'Prescription ready')
        : 'No final prescription yet',
      meta: latestPrescription ? formatDate(latestPrescription.date) : 'Final prescriptions will appear here',
      sub: latestPrescription?.hospital_name ?? 'Only final prescriptions are shown',
      icon: Pill,
      action: onOpenCare,
      actionLabel: 'Open prescriptions',
    },
    {
      key: 'latest-result',
      label: 'Latest result',
      title: latestReport
        ? (latestReport.test_names || latestReport.order_no || 'Lab result ready')
        : 'No released result yet',
      meta: latestReport ? formatDate(latestReport.result_date) : 'Verified or released reports will appear here',
      sub: latestReport
        ? `${latestReport.hospital_name}${Number(latestReport.abnormal_count ?? 0) > 0 ? ` · ${latestReport.abnormal_count} flagged` : ''}`
        : 'Draft or unverified results stay hidden',
      icon: TestTube,
      action: onOpenCare,
      actionLabel: 'View labs',
    },
    {
      key: 'due-bill',
      label: 'Due bill',
      title: dueBill ? formatAmount(dueBill.grand_total) : 'No due bill',
      meta: dueBill ? formatDate(dueBill.bill_date) : 'Paid or settled bills stay in history',
      sub: dueBill?.hospital_name ?? 'You are clear for now',
      icon: CreditCard,
      action: onOpenCare,
      actionLabel: dueBill ? 'Review bill' : 'Open bills',
    },
  ];

  return (
    <div className="max-w-md mx-auto lg:max-w-none space-y-6">
      {profileNeedsCompletion && (
        <section className="bg-amber-50 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div>
            <h3 className="text-amber-900 font-bold mb-1">{t('patientDashboard.profileCompletionNeeded')}</h3>
            <p className="text-amber-800/80 text-sm">{t('patientDashboard.profileCompletionDescription')}</p>
          </div>
          <button
            onClick={onOpenProfile}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 transition whitespace-nowrap"
          >
            {t('patientDashboard.goToDataTab')}
          </button>
        </section>
      )}

      <PatientSectionIntro
        eyebrow={t('patientDashboard.homeEyebrow')}
        title={t('patientDashboard.homeTitle')}
        description={t('patientDashboard.homeDescription')}
        icon={Activity}
      />

      <PersonalizedGreeting
        name={profile.name?.split(' ')[0] || t('patientDashboard.user')}
        streak={currentStreak}
      />

      <DailyHealthSummary />

      <section className="bg-white rounded-3xl p-6 shadow-[0_12px_40px_rgba(0,96,103,0.06)] border border-slate-100">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">MVP health summary</p>
            <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1">Today at a glance</h3>
            <p className="text-sm text-slate-500 mt-1">Appointments, final prescriptions, released lab reports, and bills from verified hospital links.</p>
          </div>
          <button onClick={onOpenCare} className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition">
            Open care
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {healthSummaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={item.action}
                className="group rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-100 hover:bg-cyan-50/40 hover:shadow-lg hover:shadow-cyan-900/5"
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-white text-cyan-700 flex items-center justify-center shadow-sm">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{item.label}</span>
                </div>
                <h4 className="text-base font-extrabold text-slate-900 line-clamp-2">{item.title}</h4>
                <p className="mt-2 text-xs font-semibold text-cyan-700">{item.meta}</p>
                <p className="mt-1 text-xs text-slate-500 line-clamp-2">{item.sub}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-slate-700 group-hover:text-cyan-700">
                  {item.actionLabel}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <QuickCheckInCard
            hasCheckedInToday={hasCheckedInToday}
            onStartCheckIn={onOpenCheckIn}
            todayMood={todayMood}
          />

          <WellnessScoreCard
            totalScore={wellnessScores.total}
            breakdown={wellnessScores.breakdown}
            trend={wellnessScores.trend}
          />
          <ScoreTrendChart />
          <InsightsCards />
        </div>

        <div className="space-y-6">
          <StreakTrackerWidget />

          <LifestyleQuickActions
            onCheckIn={onOpenCheckIn}
            onLogFood={onOpenFoodLog}
            completedToday={hasCheckedInToday ? new Set(['checkIn']) : new Set()}
          />

          <SmartCardRenderer
            cards={computeSmartCards({
              hasCheckedInToday,
              hasMedsDue: false,
              streakAtRisk: currentStreak > 0 && !hasCheckedInToday,
              hasLabResults: false,
              hasActiveGoals,
              weeklyReportReady: false,
              criticalAlerts: [],
              hasInsights: false,
            })}
            onAction={(type) => {
              if (type === 'checkin_prompt') onOpenCheckIn();
              if (type === 'goal_progress') onOpenGoalModal();
            }}
          />
        </div>
      </div>

      <section>
        <div className="bg-white rounded-3xl p-8 shadow-[0_12px_40px_rgba(0,96,103,0.06)] flex flex-col md:flex-row gap-12 relative overflow-hidden border border-slate-100">
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-50/80 rounded-full -mr-20 -mt-20 blur-3xl" />
          <div className="flex-1 space-y-6 relative z-10">
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-lg bg-cyan-100 border-2 border-white flex items-center justify-center text-4xl font-bold text-cyan-800">
                {userInitial}
              </div>
              <div>
                <span className="text-slate-500 text-[10px] mb-1 block uppercase tracking-widest font-bold">{t('patientDashboard.patientIdentity')}</span>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight leading-none mb-2">{profile.name || t('patientDashboard.loadingName')}</h1>
                <p className="text-cyan-700 font-medium flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  {t('patientDashboard.verifiedPatient')} · {t('patientDashboard.id')}: {profile.uhid || t('patientDashboard.uhidPending')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pt-6 border-t border-slate-100">
              <div>
                <p className="text-slate-500 text-xs mb-1 font-semibold uppercase">{t('patientDashboard.phone')}</p>
                <p className="text-lg font-bold text-slate-900">{profile.phone || t('patientDashboard.na')}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-1 font-semibold uppercase">{t('patientDashboard.nid')}</p>
                <p className="text-lg font-bold text-slate-900">{profile.national_id || t('patientDashboard.na')}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-1 font-semibold uppercase">{t('patientDashboard.joined')}</p>
                <p className="text-lg font-bold text-slate-900">{(profile.created_at ? new Date(profile.created_at).getFullYear() : 2024).toLocaleString(i18n.language === 'bn' ? 'bn-BD' : 'en-US', { useGrouping: false })}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-1 font-semibold uppercase">{t('patientDashboard.globalStatus')}</p>
                <p className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  {globalStatusLabel}
                  <span className={`w-2 h-2 rounded-full ${(dashboard.patient_guidance?.counts.pending_review_items ?? 0) > 0 || profileNeedsCompletion ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                </p>
              </div>
            </div>
          </div>

          <div className="w-full md:w-72 lg:w-80 shrink-0 relative z-10 flex flex-col justify-center mt-6 md:mt-0">
            <div className="bg-gradient-to-br from-cyan-600 to-teal-700 rounded-[2rem] p-6 text-white shadow-xl shadow-cyan-900/20 relative overflow-hidden h-full min-h-[16rem] border border-cyan-500/30">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <QrCode className="w-48 h-48 -mr-10 -mt-10" />
              </div>
              <div className="relative z-10 h-full flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  <p className="text-cyan-100/90 text-[10px] font-bold uppercase tracking-widest break-words leading-tight">{t('patientDashboard.digitalHealthCard')}</p>
                  <div className="bg-white/10 p-2 rounded-xl backdrop-blur-sm border border-white/20">
                    <Activity className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="bg-white p-3 rounded-2xl w-fit mb-auto shadow-inner">
                  <QrCode className="w-16 h-16 text-slate-800" />
                </div>
                <div className="mt-6">
                  <p className="text-white font-black text-xl mb-0.5 tracking-tight">{profile.name || '-'}</p>
                  <p className="text-cyan-200 font-mono text-sm tracking-wider uppercase">{profile.uhid || t('patientDashboard.uhidPending')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-white rounded-3xl p-6 shadow-[0_12px_40px_rgba(0,96,103,0.06)] border border-slate-100 h-full flex flex-col">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-900">
              <Activity className="w-5 h-5 text-cyan-600" />
              {t('patientDashboard.quickActions')}
            </h3>

            <div className="space-y-3">
              {visibleQuickActions.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.key} onClick={item.action} className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-50 hover:bg-cyan-50/40 transition-all group border border-slate-100 hover:border-cyan-100 text-left">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform ${item.tone}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{item.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition-transform shrink-0" />
                  </button>
                );
              })}
            </div>

            <div className="mt-auto pt-8">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-100 flex items-start gap-4">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-amber-700/70 font-bold uppercase tracking-widest mb-1">{t('patientDashboard.healthTip')}</p>
                  <p className="text-sm font-medium text-amber-900 leading-snug">{t('patientDashboard.healthTipDescription')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-3xl p-8 shadow-[0_12px_40px_rgba(0,96,103,0.06)] border border-slate-100 h-full relative overflow-hidden flex flex-col">
            {dashboard.patient_guidance ? (
              <>
                <div className="flex justify-between items-start gap-4 mb-8">
                  <div>
                    <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-1">{t('patientDashboard.guidancePanelTitle')}</h3>
                    <p className="text-slate-500 text-sm font-medium">{t('patientDashboard.guidancePanelDescription')}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <div className={`px-4 py-1.5 rounded-full text-xs font-bold ${guidanceTone.badge}`}>
                      {guidanceBadge}
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl p-6 border ${guidanceTone.shell} mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-6`}>
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm shrink-0 ${guidanceTone.icon}`}>
                    {dashboard.patient_guidance.status === 'stable' ? <ShieldCheck className="w-8 h-8" /> : <Sparkles className="w-8 h-8" />}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-slate-900 mb-2">{dashboard.patient_guidance.headline}</h4>
                    <p className="text-slate-700 leading-relaxed text-sm lg:text-base">{dashboard.patient_guidance.summary}</p>
                  </div>
                  {primaryAction && (
                    <button
                      onClick={primaryAction.action}
                      className="shrink-0 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-all"
                    >
                      {primaryAction.label}
                    </button>
                  )}
                </div>

                {guidanceChecklist.length > 0 ? (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <ClipboardList className="w-4 h-4 text-cyan-600" />
                      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700">{t('patientDashboard.guidanceTasksTitle')}</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {guidanceChecklist.map((item, index) => (
                        <div key={`${item}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 mb-1">{t('patientDashboard.stepLabel')} {index + 1}</p>
                          <p className="text-sm font-medium text-slate-800 leading-relaxed">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-5 py-4">
                    <h4 className="text-sm font-bold text-emerald-900 mb-1">{t('patientDashboard.guidanceNoTasksTitle')}</h4>
                    <p className="text-sm text-emerald-800/90">{t('patientDashboard.guidanceNoTasksDescription')}</p>
                  </div>
                )}

                {guidanceReasons.length > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-slate-500" />
                      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700">{t('patientDashboard.guidanceReasonsTitle')}</h4>
                    </div>
                    <div className="space-y-2">
                      {guidanceReasons.map((item, index) => (
                        <p key={`${item}-${index}`} className="text-sm text-slate-600 leading-relaxed">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {guidanceMetrics.length > 0 ? (
                  <div className="mt-auto">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700">{t('patientDashboard.recordStatusTitle')}</h4>
                      <p className="text-xs text-slate-500">{t('patientDashboard.recordStatusDescription')}</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {guidanceMetrics.map((metric) => (
                        <div key={metric.key} className={`rounded-2xl p-4 border ${
                          metric.key === 'verified'
                            ? 'bg-cyan-50/50 border-cyan-100/50'
                            : metric.key === 'vault'
                              ? 'bg-teal-50/50 border-teal-100/50'
                              : 'bg-slate-50 border-slate-100'
                        }`}>
                          <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                            metric.key === 'verified'
                              ? 'text-cyan-700'
                              : metric.key === 'vault'
                                ? 'text-teal-700'
                                : 'text-slate-500'
                          }`}>
                            {metric.key === 'pending'
                              ? t('patientDashboard.uhidPending')
                              : metric.key === 'verified'
                                ? t('patientDashboard.verified')
                                : metric.key === 'vault'
                                  ? t('patientDashboard.vaultDocs')
                                  : t('patientDashboard.hospitals')}
                          </p>
                          <p className={`text-2xl font-extrabold ${
                            metric.key === 'verified'
                              ? 'text-cyan-800'
                              : metric.key === 'vault'
                                ? 'text-teal-800'
                                : 'text-slate-900'
                          }`}>
                            {metric.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-auto text-sm text-slate-500">{t('patientDashboard.noRecordStatus')}</p>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 mx-auto mb-4">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <p className="text-slate-700 font-semibold">{t('patientDashboard.guidanceNoTasksTitle')}</p>
                <p className="text-slate-500 text-sm mt-2 max-w-md">{t('patientDashboard.guidanceNoTasksDescription')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {liveVisit && (
        <section className="mb-10">
          <div className="bg-gradient-to-r from-cyan-50 via-white to-teal-50 rounded-3xl p-6 border border-cyan-100 shadow-[0_4px_20px_rgba(0,96,103,0.04)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{t('patientDashboard.liveVisit.title')}</p>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900">
                  {liveVisit.queue?.token_no ? `${t('patientDashboard.liveVisit.token')} ${liveVisit.queue.token_no}` : t('patientDashboard.liveVisit.active')}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {liveVisit.arrival_guidance?.label || t('patientDashboard.liveVisit.guidance')}
                </p>
                {liveVisit.next_step_label && (
                  <p className="mt-2 text-xs font-medium text-cyan-800">
                    {liveVisit.next_step_label}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-white px-4 py-3 border border-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('patientDashboard.liveVisit.status')}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.status}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 border border-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('patientDashboard.liveVisit.current')}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.current_serving_token_no || t('common.na')}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 border border-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('patientDashboard.liveVisit.ahead')}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.patients_ahead ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 border border-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('patientDashboard.liveVisit.eta')}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {liveVisit.estimated_wait_minutes !== null && liveVisit.estimated_wait_minutes !== undefined
                      ? `${liveVisit.estimated_wait_minutes} ${t('common.minutes')}`
                      : t('common.na')}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {liveVisit.journey?.map((step) => (
                <span
                  key={step.key}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    step.state === 'done'
                      ? 'bg-emerald-100 text-emerald-800'
                      : step.state === 'current'
                        ? 'bg-cyan-100 text-cyan-800'
                        : 'bg-white text-slate-500 border border-slate-200'
                  }`}
                >
                  {step.label}
                </span>
              ))}
            </div>
            {liveVisit.last_updated_at && (
              <p className="mt-3 text-xs text-slate-500">
                {t('patientDashboard.liveVisit.lastUpdated')} {formatLiveVisitUpdatedAt(liveVisit.last_updated_at)}
              </p>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="flex justify-between items-end mb-6">
          <div>
            <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">{t('patientDashboard.recentAppointments')}</h3>
            <p className="text-slate-500 text-sm">{t('patientDashboard.recentAppointmentsDescription')}</p>
          </div>
          <button onClick={onOpenCare} className="text-cyan-700 font-bold text-sm hover:underline">{t('patientDashboard.viewAllRecords')}</button>
        </div>

        {dashboard.appointments.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)] text-center">
            <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4">
              <Calendar className="w-6 h-6" />
            </div>
            <h4 className="text-lg font-bold text-slate-900 mb-1">{t('patientDashboard.noRecentAppointments')}</h4>
            <p className="text-slate-500 text-sm max-w-sm mx-auto mb-6">{t('patientDashboard.noRecentAppointmentsDescription')}</p>
            <button onClick={onOpenCare} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all shadow-md shadow-cyan-500/20 text-sm">
              {t('patientDashboard.bookAnAppointment')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {dashboard.appointments.slice(0, 3).map((apt) => {
              const synced = buildPatientSyncedAppointmentStatus(apt);
              return (
                <div key={apt.id} className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-transparent hover:border-cyan-100 transition-all group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center">
                      <Activity className="w-6 h-6" />
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${getAppointmentToneClass(synced.tone)}`}>
                      {synced.label}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">{apt.department || t('patientDashboard.generalConsultation')}</h4>
                  <p className="text-slate-500 text-sm mb-4">{apt.doctor_name || t('patientDashboard.generalDoctor')}</p>
                  <div className="flex items-center gap-4 py-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {formatDate(apt.appointment_date)}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {apt.hospital_name}
                    </div>
                  </div>
                  {synced.details.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {synced.details.map((detail) => (
                        <span key={`${apt.id}-${detail}`} className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {detail}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
