import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  Building2,
  Calendar,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Pill,
  QrCode,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DailyCheckInWidget, { type CheckInData } from '../components/patient/DailyCheckInWidget';
import WellnessScoreCard from '../components/patient/WellnessScoreCard';
import { DailyHealthSummary } from '../components/patient/DailyHealthSummary';
import StreakTrackerCard, { type StreakData } from '../components/patient/StreakTrackerCard';
import PersonalizedGreeting from '../components/patient/PersonalizedGreeting';
import QuickCheckInCard from '../components/patient/QuickCheckInCard';
import SmartCardRenderer from '../components/patient/SmartCardRenderer';
import { computeSmartCards, type SmartCardContext } from '../lib/smart-card-priority';
import LifestyleQuickActions from '../components/patient/LifestyleQuickActions';
import MobileBottomNav, { type BottomNavTab } from '../components/patient/MobileBottomNav';
import { PatientPortalHeader } from '../components/patient/PatientPortalHeader';
import { PatientPortalSidebar } from '../components/patient/PatientPortalSidebar';
import { PatientPortalDrawer } from '../components/patient/PatientPortalDrawer';
import { PatientDashboardLoadingState } from '../components/patient/PatientDashboardLoadingState';
import InsightsCards from '../components/patient/InsightsCards';
import AchievementToast from '../components/patient/AchievementToast';
import NotificationPermission from '../components/patient/NotificationPermission';
import { ScoreTrendChart } from '../components/patient/ScoreTrendChart';
import { StreakTrackerWidget } from '../components/patient/StreakTrackerWidget';
import { initPushNotifications } from '../lib/push-notifications';
import {
  buildPatientSyncedAppointmentStatus,
  PATIENT_SELECTED_HOSPITAL_STORAGE_KEY,
  buildPatientGuidanceChecklist,
  buildPatientGuidanceMetrics,
  getPatientQuickActionKeys,
  getPatientGuidanceBadge,
  normalizePatientDashboardPayload,
  normalizePatientLiveVisitSummary,
  type PatientLiveVisitSummary,
} from '../lib/patientPortalUx';
import {
  PATIENT_PORTAL_PRIMARY_NAV,
  PATIENT_PORTAL_SECONDARY_NAV,
  type PatientDashboardTabId,
} from '../lib/patientPortalNav';
import { useNativePatientShell } from '../hooks/useNativePatientShell';
import { useLogDailyCheckIn } from '../hooks/usePatientWellness';
import {
  patientGlobalDashboardQueryOptions,
  patientHospitalsQueryOptions,
  patientPortalQueryKeys,
  type PatientPortalQueryError,
  usePatientGlobalDashboardQuery,
  usePatientProfileQuery,
} from '../hooks/patient-portal/usePatientPortalQueries';
import {
  getPatientPortalPathForBottomNav,
  getPatientPortalPathForTab,
  getPatientPortalTabFromLocation,
} from '../lib/patientPortalRouting';

const AIBuddyChat = lazy(() => import('../components/patient/AIBuddyChat'));
const FoodLogModal = lazy(() => import('../components/patient/FoodLogModal'));
const GoalSettingModal = lazy(() => import('../components/patient/GoalSettingModal'));
const SymptomLoggerModal = lazy(() => import('../components/patient/SymptomLoggerModal'));
const PatientCareSection = lazy(() =>
  import('../components/patient/sections/PatientCareSection').then((module) => ({ default: module.PatientCareSection })),
);
const PatientHomeSection = lazy(() =>
  import('../components/patient/sections/PatientHomeSection').then((module) => ({ default: module.PatientHomeSection })),
);
const PatientRecordsSection = lazy(() =>
  import('../components/patient/sections/PatientRecordsSection').then((module) => ({ default: module.PatientRecordsSection })),
);
const PatientWellnessSection = lazy(() =>
  import('../components/patient/sections/PatientWellnessSection').then((module) => ({ default: module.PatientWellnessSection })),
);
const PatientFamilySection = lazy(() =>
  import('../components/patient/sections/PatientFamilySection').then((module) => ({ default: module.PatientFamilySection })),
);
const PatientProfileSection = lazy(() =>
  import('../components/patient/sections/PatientProfileSection').then((module) => ({ default: module.PatientProfileSection })),
);
interface PatientUser {
  id: number;
  name: string;
  email: string | null;
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

interface DashboardResponse {
  hospitalsCount: number;
  appointments: DashboardAppointment[];
  prescriptions: DashboardPrescription[];
  reports: DashboardReport[];
  labResults: DashboardReport[];
  bills: DashboardBill[];
  patient_guidance?: {
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
  };
  message?: string;
  error?: string;
}

const PATIENT_STORAGE_KEY = 'global_patient_user';
const phonePattern = /^01\d{9}$/;
const nidPattern = /^\d{10}$|^\d{17}$/;

const criticalNoStoreFetchInit: RequestInit = {
  credentials: 'include',
  cache: 'no-store',
  headers: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  },
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function formatDate(dateText: string | null | undefined, language = 'bn') {
  if (!dateText) return 'N/A';
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return dateText;
  const locale = language === 'bn' ? 'bn-BD' : 'en-US';
  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatAmount(amount: number | null | undefined, language = 'bn') {
  if (typeof amount !== 'number') return 'N/A';
  const locale = language === 'bn' ? 'bn-BD' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(amount);
}

function getPhoneError(phone: string, t: (key: string) => string) {
  if (!phone) return '';
  if (!phonePattern.test(phone)) return t('patientDashboard.phoneFormatError');
  return '';
}

function getNidError(nid: string, t: (key: string) => string) {
  if (!nid) return '';
  if (!nidPattern.test(nid)) return t('patientDashboard.nidFormatError');
  return '';
}

function getGuidanceTone(status: DashboardResponse['patient_guidance'] extends infer T ? T extends { status: infer S } ? S | undefined : undefined : undefined) {
  if (status === 'attention') {
    return {
      shell: 'border-amber-200/80 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
      icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    };
  }
  if (status === 'watch') {
    return {
      shell: 'border-cyan-200/80 dark:border-cyan-900/60 bg-cyan-50 dark:bg-cyan-950/20',
      badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
      icon: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
    };
  }
  return {
    shell: 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/20',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  };
}

function formatLiveVisitUpdatedAt(value: string | null | undefined, language = 'bn') {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const locale = language === 'bn' ? 'bn-BD' : 'en-US';
  return parsed.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAppointmentToneClass(tone: 'slate' | 'amber' | 'cyan' | 'blue' | 'emerald' | 'rose') {
  if (tone === 'amber') return 'bg-amber-100 text-amber-700';
  if (tone === 'cyan') return 'bg-cyan-100 text-cyan-700';
  if (tone === 'blue') return 'bg-blue-100 text-blue-700';
  if (tone === 'emerald') return 'bg-emerald-100 text-emerald-700';
  if (tone === 'rose') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
}

function PatientSectionSuspenseFallback() {
  return <div className="h-48 rounded-[2rem] bg-slate-100/80 animate-pulse" />;
}

export default function PatientDashboardPage() {
  const { t, i18n } = useTranslation('patients');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PatientDashboardTabId>(
    getPatientPortalTabFromLocation(location.pathname, location.search),
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState<PatientUser | null>(() => {
    const stored = localStorage.getItem(PATIENT_STORAGE_KEY);
    return stored ? JSON.parse(stored) as PatientUser : null;
  });
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    nationalId: '',
  });
  const [dashboard, setDashboard] = useState<DashboardResponse>({
    hospitalsCount: 0,
    appointments: [],
    prescriptions: [],
    reports: [],
    labResults: [],
    bills: [],
  });
  const [liveVisit, setLiveVisit] = useState<PatientLiveVisitSummary | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showFoodLog, setShowFoodLog] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSymptomLogger, setShowSymptomLogger] = useState(false);
  const [hasActiveGoals, setHasActiveGoals] = useState(false);
  const [pendingAchievements, setPendingAchievements] = useState<string[]>([]);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [todayMood, setTodayMood] = useState<string | undefined>();
  const [todayCheckInData, setTodayCheckInData] = useState<CheckInData | undefined>();
  const [currentStreak, setCurrentStreak] = useState(0);
  const [weekDays, setWeekDays] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const [streaks, setStreaks] = useState<StreakData[]>([]);
  const [wellnessScores, setWellnessScores] = useState<{
    total: number;
    breakdown: { sleep: number; activity: number; nutrition: number; mood: number; medication: number; vitals: number };
    trend: number;
  }>({ total: 0, breakdown: { sleep: 0, activity: 0, nutrition: 0, mood: 0, medication: 0, vitals: 0 }, trend: 0 });
  const [mobileNavTab, setMobileNavTab] = useState<BottomNavTab | null>('home');
  const { mutateAsync: logDailyCheckIn } = useLogDailyCheckIn();
  const patientProfileQuery = usePatientProfileQuery();
  const patientGlobalDashboardQuery = usePatientGlobalDashboardQuery();
  const loading = patientProfileQuery.isLoading || patientGlobalDashboardQuery.isLoading;
  const isSessionReady = Boolean(patientProfileQuery.data?.user && patientGlobalDashboardQuery.data);
  const phoneError = getPhoneError(profileForm.phone, t);
  const nidError = getNidError(profileForm.nationalId, t);
  const guidanceTone = getGuidanceTone(dashboard.patient_guidance?.status);

  const handleNativeBack = useCallback(() => {
    if (showCheckIn) {
      setShowCheckIn(false);
      return true;
    }
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
      return true;
    }
    if (activeTab !== 'overview') {
      setMobileNavTab('home');
      navigate(getPatientPortalPathForTab('overview'), { replace: true });
      return true;
    }
    return false;
  }, [activeTab, isMobileMenuOpen, navigate, showCheckIn]);

  useNativePatientShell({
    statusBarColor: '#ffffff',
    statusBarStyle: 'dark',
    onBack: handleNativeBack,
  });

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    queryClient.prefetchQuery({
      queryKey: ['daily-totals', today],
      queryFn: () => fetch('/api/wellness/daily-totals?date=' + today, { credentials: 'include' }).then((r) => r.json()),
    });
    queryClient.prefetchQuery(patientHospitalsQueryOptions());
    queryClient.prefetchQuery({
      queryKey: ['family-proxy-invites'],
      queryFn: () => fetch('/api/global-portal/family/proxy-invites', { credentials: 'include' }).then((r) => r.json()),
    });
  }, [queryClient]);

  useEffect(() => {
    const authError = [patientProfileQuery.error, patientGlobalDashboardQuery.error].find((error) => {
      const status = (error as PatientPortalQueryError | undefined)?.status;
      return status === 401 || status === 403;
    });

    if (!authError) return;
    localStorage.removeItem(PATIENT_STORAGE_KEY);
    navigate('/patient/login', { replace: true });
  }, [navigate, patientGlobalDashboardQuery.error, patientProfileQuery.error]);

  useEffect(() => {
    if (patientProfileQuery.data?.user) {
      const user = patientProfileQuery.data.user;
      setProfile(user);
      setProfileForm({
        name: user.name || '',
        phone: user.phone || '',
        nationalId: user.national_id || '',
      });
      localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(user));
    }
  }, [patientProfileQuery.data]);

  useEffect(() => {
    if (!patientGlobalDashboardQuery.data) return;
    setDashboard(normalizePatientDashboardPayload(patientGlobalDashboardQuery.data as DashboardResponse));
  }, [patientGlobalDashboardQuery.data]);

  useEffect(() => {
    const nonAuthError = [patientProfileQuery.error, patientGlobalDashboardQuery.error].find((error) => {
      const status = (error as PatientPortalQueryError | undefined)?.status;
      return status !== 401 && status !== 403 && error;
    });

    if (!nonAuthError) return;
    const message = nonAuthError instanceof Error ? nonAuthError.message : t('patientDashboard.dashboardDataLoadFailed');
    toast.error(message);
    setProfile(null);
    localStorage.removeItem(PATIENT_STORAGE_KEY);
  }, [patientGlobalDashboardQuery.error, patientProfileQuery.error, t]);

  useEffect(() => {
    if (isSessionReady) {
      initPushNotifications().catch(() => {});
    }
  }, [isSessionReady]);

  useEffect(() => {
    const nextTab = getPatientPortalTabFromLocation(location.pathname, location.search);
    setActiveTab((currentTab) => (currentTab === nextTab ? currentTab : nextTab));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (activeTab === 'hospital-services' || activeTab === 'find-care') {
      setMobileNavTab('care');
      return;
    }
    if (activeTab === 'global-records' || activeTab === 'vault') {
      setMobileNavTab('records');
      return;
    }
    if (
      activeTab === 'trends' ||
      activeTab === 'tips' ||
      activeTab === 'diary-history' ||
      activeTab === 'medicine-tracker' ||
      activeTab === 'wellness'
    ) {
      setMobileNavTab(null);
      return;
    }
    if (activeTab === 'data' || activeTab === 'privacy' || activeTab === 'family') {
      setMobileNavTab('profile');
      return;
    }
    setMobileNavTab('home');
  }, [activeTab]);

  useEffect(() => {
    const canonicalPath = getPatientPortalPathForTab(activeTab);
    const currentPath = `${location.pathname}${location.search}`;
    if (currentPath === canonicalPath) return;

    navigate(canonicalPath, { replace: true });
  }, [activeTab, location.pathname, location.search, navigate]);

  useEffect(() => {
    let mounted = true;

    async function loadLiveVisit() {
      if (!isSessionReady || dashboard.hospitalsCount === 0) {
        if (mounted) setLiveVisit(null);
        return;
      }

      const selectedTenantId = window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
      if (!selectedTenantId) {
        if (mounted) setLiveVisit(null);
        return;
      }

      try {
        const response = await fetch('/api/patient-portal/live-visit-status', {
          credentials: 'include',
          headers: {
            'X-Tenant-ID': selectedTenantId,
          },
        });

        const data = await parseJsonSafely<{ live_visit?: PatientLiveVisitSummary | null }>(response);
        if (!response.ok) {
          throw new Error('Failed to load live visit status.');
        }

        if (!mounted) return;
        setLiveVisit(normalizePatientLiveVisitSummary(data?.live_visit));
      } catch {
        if (!mounted) return;
        setLiveVisit(null);
      }
    }

    void loadLiveVisit();

    return () => {
      mounted = false;
    };
  }, [dashboard.hospitalsCount, isSessionReady]);

  useEffect(() => {
    if (!isSessionReady || dashboard.hospitalsCount === 0) return;

    const interval = window.setInterval(() => {
      const selectedTenantId = window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
      if (!selectedTenantId) return;

      void (async () => {
        try {
          const response = await fetch('/api/patient-portal/live-visit-status', {
            credentials: 'include',
            headers: {
              'X-Tenant-ID': selectedTenantId,
            },
          });

          const data = await parseJsonSafely<{ live_visit?: PatientLiveVisitSummary | null }>(response);
          if (!response.ok) return;
          setLiveVisit(normalizePatientLiveVisitSummary(data?.live_visit));
        } catch {
          // Keep showing the last successful snapshot.
        }
      })();
    }, 20_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [dashboard.hospitalsCount, isSessionReady]);

  async function handleLogout() {
    try {
      await fetch('/api/patient-auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network failure and clear client state anyway.
    }

    localStorage.removeItem(PATIENT_STORAGE_KEY);
    window.location.replace('/patient/login');
  }

  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phoneError || nidError) {
      toast.error(phoneError || nidError);
      return;
    }
    setSavingProfile(true);

    try {
      const response = await fetch('/api/patient-auth/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: profileForm.name,
          phone: profileForm.phone || null,
          national_id: profileForm.nationalId || null,
        }),
      });

      const data = await response.json() as { user?: PatientUser; error?: string; message?: string };
      if (!response.ok || !data.user) {
        throw new Error(data.error || data.message || t('patientDashboard.profileSaveFailed'));
      }

      setProfile(data.user);
      setProfileForm({
        name: data.user.name || '',
        phone: data.user.phone || '',
        nationalId: data.user.national_id || '',
      });
      localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(data.user));
      queryClient.setQueryData(patientPortalQueryKeys.profile, { user: data.user });
      toast.success(t('patientDashboard.profileSaved'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('patientDashboard.profileSaveFailed');
      toast.error(message);
    } finally {
      setSavingProfile(false);
    }
  }

  // Lifestyle check-in handler
  const handleCheckInSubmit = useCallback(async (data: CheckInData) => {
    try {
      const widgetToBackendMood: Record<string, string> = {
        excellent: 'excellent', good: 'good', okay: 'neutral', bad: 'low', terrible: 'very_low',
      };
      const wellnessMood: Record<string, string> = {
        excellent: 'great', good: 'good', okay: 'okay', bad: 'low', terrible: 'struggling',
      };
      const moodScoreMap: Record<string, number> = { excellent: 5, good: 4, okay: 3, bad: 2, terrible: 1 };
      const energyToEnum = (n: number): string => {
        if (n <= 3) return 'very_low';
        if (n <= 5) return 'low';
        if (n <= 7) return 'moderate';
        return 'high';
      };

      const result = await logDailyCheckIn({
        date: new Date().toISOString().slice(0, 10),
        mood: widgetToBackendMood[data.mood] ?? 'neutral',
        wellnessMood: wellnessMood[data.mood] ?? 'okay',
        energy: data.energy,
        energyEnum: energyToEnum(data.energy),
        sleepHours: data.sleepHours,
        sleepQuality: data.sleepQuality === 'deep' ? 5 : data.sleepQuality === 'light' ? 3 : 1,
        exerciseMinutes: data.exerciseMinutes,
        waterGlasses: data.waterGlasses,
        notes: data.notes || undefined,
      });

      setHasCheckedInToday(true);
      setTodayMood(data.mood);
      setTodayCheckInData(data);
      
      if (result.streak?.current_count) {
        setCurrentStreak(result.streak.current_count);
      } else {
        setCurrentStreak((prev) => prev + 1);
      }
      
      if (result.new_achievements && result.new_achievements.length > 0) {
        setPendingAchievements(result.new_achievements);
      }

      setShowCheckIn(false);

      setWellnessScores((prev) => ({
        ...prev,
        breakdown: {
          ...prev.breakdown,
          sleep: Math.min(100, Math.round((data.sleepHours / 8) * 100)),
          activity: Math.min(100, Math.round((data.exerciseMinutes / 30) * 100)),
          mood: (moodScoreMap[data.mood] ?? 3) * 20,
        },
      }));
    } catch {
      toast.error(t('checkinError', { ns: 'patientPortal' }));
    }
  }, []);

  // Load lifestyle log status on mount
  useEffect(() => {
    if (!isSessionReady) return;
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch('/api/patient-phr/lifestyle-logs?limit=30', { credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json() as { lifestyle_logs?: Array<{ logged_on: string; mood?: string; energy_level?: string; sleep_hours?: number | string; exercise_minutes?: number | string; water_glasses?: number | string; notes?: string }> };
        const logs = data.lifestyle_logs ?? [];
        if (!mounted || logs.length === 0) return;

        // Check if today has a log
        const today = new Date().toISOString().slice(0, 10);
        const todayLog = logs.find((log) => log.logged_on === today);
        if (todayLog) {
          setHasCheckedInToday(true);
          setTodayMood(todayLog.mood ?? undefined);
          
          // Map backend enums back to widget format
          const enumToEnergy = (e?: string): number => {
            if (e === 'very_low') return 2;
            if (e === 'low') return 5;
            if (e === 'moderate') return 7;
            if (e === 'high') return 9;
            return 8; // default
          };
          const backendToWidgetMood: Record<string, CheckInData['mood']> = {
            excellent: 'excellent', good: 'good', neutral: 'okay', low: 'bad', very_low: 'terrible'
          };
          
          setTodayCheckInData({
            mood: backendToWidgetMood[todayLog.mood ?? 'neutral'] ?? 'okay',
            energy: enumToEnergy(todayLog.energy_level),
            sleepHours: Number(todayLog.sleep_hours) || 7.5,
            sleepQuality: 'deep', // Add backend mapped field if available, fallback to deep
            exerciseMinutes: Number(todayLog.exercise_minutes) || 30,
            waterGlasses: Number(todayLog.water_glasses) || 5,
            notes: todayLog.notes ?? '',
          });

          // Sync initial wellness scores with the latest today data
          const moodScoreMap: Record<string, number> = { excellent: 5, good: 4, neutral: 3, low: 2, very_low: 1 };
          setWellnessScores((prev) => ({
            ...prev,
            breakdown: {
              ...prev.breakdown,
              sleep: Math.min(100, Math.round(((Number(todayLog.sleep_hours) || 0) / 8) * 100)),
              activity: Math.min(100, Math.round(((Number(todayLog.exercise_minutes) || 0) / 30) * 100)),
              mood: (moodScoreMap[todayLog.mood ?? 'neutral'] ?? 3) * 20,
            },
          }));
        }

        // Calculate streak
        let streak = 0;
        const sortedDates = [...new Set(logs.map((l) => l.logged_on))].sort().reverse();
        const todayDate = new Date(today);
        for (let i = 0; i < sortedDates.length; i++) {
          const expected = new Date(todayDate);
          expected.setDate(expected.getDate() - i);
          if (sortedDates[i] === expected.toISOString().slice(0, 10)) {
            streak++;
          } else {
            break;
          }
        }
        setCurrentStreak(streak);

        // Build week calendar
        const dayOfWeek = todayDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const weekStart = new Date(todayDate);
        weekStart.setDate(todayDate.getDate() + mondayOffset);
        const weekChecks = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return sortedDates.includes(d.toISOString().slice(0, 10));
        });
        setWeekDays(weekChecks);
      } catch {
        // Silently handle - lifestyle logs may not be available yet
      }
    })();
    return () => { mounted = false; };
  }, [isSessionReady]);

  // Fetch wellness score from API
  useEffect(() => {
    if (!isSessionReady) return;
    void (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [scoreRes, trendRes] = await Promise.all([
          fetch(`/api/wellness/score?date=${today}`, { credentials: 'include' }),
          fetch('/api/wellness/score/trend?days=7', { credentials: 'include' }),
        ]);
        if (scoreRes.ok) {
          const scoreData = await scoreRes.json() as { total: number; breakdown: any };
          let trend = 0;
          if (trendRes.ok) {
            const trendData = await trendRes.json() as { trend: Array<{ total_score: number }> };
            const scores = trendData.trend?.map((t: any) => t.total_score) ?? [];
            if (scores.length >= 2) {
              trend = scores[0] - scores[scores.length - 1];
            }
          }
          setWellnessScores({
            total: scoreData.total ?? 0,
            breakdown: scoreData.breakdown ?? { sleep: 0, activity: 0, nutrition: 0, mood: 0, medication: 0, vitals: 0 },
            trend,
          });
        }

        // Fetch streaks
        const streaksRes = await fetch('/api/wellness/streaks', { credentials: 'include' });
        if (streaksRes.ok) {
          const streaksData = await streaksRes.json() as { streaks: StreakData[] };
          setStreaks(streaksData.streaks ?? []);

          const checkinStreak = streaksData.streaks?.find((s) => s.streak_type === 'daily_checkin');
          if (checkinStreak) {
            setCurrentStreak(checkinStreak.current_count);
          }
        }
      } catch {
        // Score API may not be available — use fallback from lifestyle logs
      }
    })();
  }, [isSessionReady]);

  // Mobile bottom nav tab handler
  function handleMobileNavChange(tab: BottomNavTab) {
    setMobileNavTab(tab);
    navigate(getPatientPortalPathForBottomNav(tab), { replace: true });
  }

  const profileNeedsCompletion = !profile?.phone || !profile?.national_id;
  const completedFields = [profile?.phone, profile?.national_id].filter(Boolean).length;
  const quickActionKeys = getPatientQuickActionKeys({
    profileNeedsCompletion,
    hasPatientData: dashboard.prescriptions.length > 0 || dashboard.appointments.length > 0,
    hasVaultDocuments: (dashboard.patient_guidance?.counts.vault_documents ?? 0) > 0,
    hasActiveVisitPass: (dashboard.patient_guidance?.counts.active_visit_pass ?? 0) > 0,
    hasLinkedHospitals: dashboard.hospitalsCount > 0,
    hasFamilyProfiles: false,
    hasOutstandingBills: dashboard.bills.some((bill) => Number(bill.grand_total ?? 0) > 0 && String(bill.payment_status ?? '').toLowerCase() !== 'paid'),
    hasRecentPrescriptions: dashboard.prescriptions.length > 0,
  });
  const guidanceChecklist = buildPatientGuidanceChecklist(dashboard.patient_guidance);
  const guidanceMetrics = buildPatientGuidanceMetrics({
    pendingReviewItems: dashboard.patient_guidance?.counts.pending_review_items ?? 0,
    verifiedItems: dashboard.patient_guidance?.counts.verified_items ?? 0,
    vaultDocuments: dashboard.patient_guidance?.counts.vault_documents ?? 0,
    hospitalsCount: dashboard.hospitalsCount,
  });
  const guidanceBadge = getPatientGuidanceBadge(dashboard.patient_guidance?.status, guidanceChecklist.length);
  const guidanceReasons = dashboard.patient_guidance?.trust_notes?.filter(Boolean).slice(0, 2) ?? [];
  const globalStatusLabel = profileNeedsCompletion
    ? t('patientDashboard.profileStatusIncomplete')
    : (dashboard.patient_guidance?.counts.pending_review_items ?? 0) > 0
      ? t('patientDashboard.profileStatusReview')
      : t('patientDashboard.profileStatusReady');

  const quickActionConfig: Record<string, {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    action: () => void;
  }> = {
    complete_profile: {
      label: t('patientDashboard.completeProfileAction'),
      description: t('patientDashboard.completeProfileDesc'),
      icon: User,
      tone: 'text-amber-600',
      action: () => handleTabChange('data'),
    },
    book_appointment: {
      label: t('patientDashboard.bookAppointmentAction'),
      description: t('patientDashboard.bookAppointmentDesc'),
      icon: Calendar,
      tone: 'text-cyan-600',
      action: () => handleTabChange('hospital-services'),
    },
    review_bills: {
      label: t('patientDashboard.reviewBillsAction'),
      description: t('patientDashboard.reviewBillsDesc'),
      icon: CreditCard,
      tone: 'text-rose-600',
      action: () => handleTabChange('hospital-services'),
    },
    manage_prescriptions: {
      label: t('patientDashboard.managePrescriptionAction'),
      description: t('patientDashboard.managePrescriptionDesc'),
      icon: FileText,
      tone: 'text-teal-600',
      action: () => handleTabChange('hospital-services'),
    },
    report_health_data: {
      label: t('patientDashboard.reportDataAction'),
      description: t('patientDashboard.reportDataDesc'),
      icon: ClipboardList,
      tone: 'text-cyan-600',
      action: () => handleTabChange('data'),
    },
    upload_document: {
      label: t('patientDashboard.uploadDocumentAction'),
      description: t('patientDashboard.uploadDocumentDesc'),
      icon: FileText,
      tone: 'text-teal-600',
      action: () => handleTabChange('vault'),
    },
    create_visit_pass: {
      label: t('patientDashboard.createVisitPassAction'),
      description: t('patientDashboard.createVisitPassDesc'),
      icon: QrCode,
      tone: 'text-blue-600',
      action: () => handleTabChange('global-records'),
    },
    create_emergency_pack: {
      label: t('patientDashboard.createEmergencyPackAction'),
      description: t('patientDashboard.createEmergencyPackDesc'),
      icon: Shield,
      tone: 'text-rose-600',
      action: () => handleTabChange('global-records'),
    },
    open_global_records: {
      label: t('patientDashboard.openGlobalRecordsAction'),
      description: t('patientDashboard.openGlobalRecordsDesc'),
      icon: Link2,
      tone: 'text-indigo-600',
      action: () => handleTabChange('global-records'),
    },
  };
  const visibleQuickActions = quickActionKeys
    .map((key) => ({ key, ...quickActionConfig[key] }))
    .filter((item) => item.label)
    .slice(0, 4);
  const primaryAction = visibleQuickActions[0];

  const userInitial = profile?.name?.trim().charAt(0).toUpperCase() || 'P';
  const userIdLabel = profile?.uhid || (profile ? `${t('patientDashboard.id')}: ${profile.id}` : t('patientDashboard.user'));

  function handleTabChange(nextTab: typeof activeTab) {
    setActiveTab(nextTab);
    navigate(getPatientPortalPathForTab(nextTab), { replace: true });
  }

  if (loading && !profile) {
    return (
      <PatientDashboardLoadingState
        title={t('patientDashboard.loadingTitle')}
        description={t('patientDashboard.loadingDescription')}
      />
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="patient-shell">
      <PatientPortalHeader
        language={i18n.language}
        onChangeLanguage={(language) => i18n.changeLanguage(language)}
        onOpenMenu={() => setIsMobileMenuOpen(true)}
        userInitial={userInitial}
      />
      <PatientPortalSidebar
        activeTab={activeTab}
        canDownloadAndroidApp={!Capacitor.isNativePlatform()}
        navigationLabel={t('patientDashboard.navigation')}
        bookAppointmentLabel={t('patientDashboard.bookAppointment')}
        signOutLabel={t('patientDashboard.signOut')}
        onBookAppointment={() => handleTabChange('hospital-services')}
        onLogout={handleLogout}
        onTabChange={handleTabChange}
      />
      <PatientPortalDrawer
        activeTab={activeTab}
        isOpen={isMobileMenuOpen}
        navigationLabel={t('patientDashboard.navigation')}
        bookAppointmentLabel={t('patientDashboard.bookAppointment')}
        signOutLabel={t('patientDashboard.signOut')}
        onBookAppointment={() => handleTabChange('hospital-services')}
        onClose={() => setIsMobileMenuOpen(false)}
        onLogout={handleLogout}
        onTabChange={handleTabChange}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activeTab={mobileNavTab} onTabChange={handleMobileNavChange} />

      {/* Symptom Logger Modal */}
      {showSymptomLogger && (
        <Suspense fallback={null}>
          <SymptomLoggerModal
            isOpen={showSymptomLogger}
            onClose={() => setShowSymptomLogger(false)}
          />
        </Suspense>
      )}

      {/* Daily Check-In Modal */}
      {showCheckIn && (
        <DailyCheckInWidget
          onClose={() => setShowCheckIn(false)}
          onSubmit={handleCheckInSubmit}
          currentStreak={currentStreak}
          initialData={todayCheckInData}
        />
      )}

      {/* Food Log Modal */}
      {showFoodLog && (
        <Suspense fallback={null}>
          <FoodLogModal
            isOpen={showFoodLog}
            onClose={() => setShowFoodLog(false)}
          />
        </Suspense>
      )}

      {/* Goal Setting Modal */}
      {showGoalModal && (
        <Suspense fallback={null}>
          <GoalSettingModal
            isOpen={showGoalModal}
            onClose={() => setShowGoalModal(false)}
            onGoalChange={() => setHasActiveGoals(true)}
          />
        </Suspense>
      )}

      {/* Achievement Toast */}
      <AchievementToast
        achievements={pendingAchievements}
        onClose={() => setPendingAchievements([])}
      />

      {/* Main Content Area */}
      <main className="patient-shell-main">
        {(loading || !isSessionReady) ? (
          <div className="max-w-md mx-auto lg:max-w-none space-y-6 animate-pulse mt-2">
            {/* Header Skeleton */}
            <div className="h-32 bg-slate-200/60 rounded-[2rem] w-full" />
            
            {/* Daily check-in card skeleton */}
            <div className="h-24 bg-slate-200/60 rounded-3xl w-full" />
            
            {/* Health score circle skeleton */}
            <div className="h-64 bg-slate-200/60 rounded-[2.5rem] w-full flex items-center justify-center">
               <div className="h-32 w-32 bg-slate-300/50 rounded-full" />
            </div>

            {/* Quick action grid skeleton */}
            <div className="grid grid-cols-4 gap-4">
               {[1, 2, 3, 4].map((i) => (
                 <div key={i} className="h-28 bg-slate-200/60 rounded-[1.5rem] w-full" />
               ))}
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <Suspense fallback={<PatientSectionSuspenseFallback />}>
                <PatientHomeSection
                  profileNeedsCompletion={profileNeedsCompletion}
                  profile={profile}
                  userInitial={userInitial}
                  globalStatusLabel={globalStatusLabel}
                  currentStreak={currentStreak}
                  hasCheckedInToday={hasCheckedInToday}
                  todayMood={todayMood}
                  hasActiveGoals={hasActiveGoals}
                  dashboard={dashboard}
                  liveVisit={liveVisit}
                  visibleQuickActions={visibleQuickActions}
                  primaryAction={primaryAction}
                  guidanceChecklist={guidanceChecklist}
                  guidanceMetrics={guidanceMetrics}
                  guidanceBadge={guidanceBadge}
                  guidanceReasons={guidanceReasons}
                  guidanceTone={guidanceTone}
                  wellnessScores={wellnessScores}
                  onOpenProfile={() => handleTabChange('data')}
                  onOpenCare={() => handleTabChange('hospital-services')}
                  onOpenCheckIn={() => setShowCheckIn(true)}
                  onOpenFoodLog={() => setShowFoodLog(true)}
                  onOpenGoalModal={() => setShowGoalModal(true)}
                  formatDate={(d) => formatDate(d, i18n.language)}
                  formatAmount={(amount) => formatAmount(amount, i18n.language)}
                  formatLiveVisitUpdatedAt={(v) => formatLiveVisitUpdatedAt(v, i18n.language)}
                  getAppointmentToneClass={getAppointmentToneClass}
                />
              </Suspense>
            )}

            <Suspense fallback={<PatientSectionSuspenseFallback />}>
              <PatientCareSection activeTab={activeTab} onTabChange={handleTabChange} />
              <PatientRecordsSection activeTab={activeTab} onTabChange={handleTabChange} />
              <PatientWellnessSection
                activeTab={activeTab}
                isSessionReady={isSessionReady}
                onLogFood={() => setShowFoodLog(true)}
                onTabChange={handleTabChange}
              />
              <PatientFamilySection activeTab={activeTab} />
              <PatientProfileSection activeTab={activeTab} onTabChange={handleTabChange} />
            </Suspense>
          </>
        )}
        
        <NotificationPermission />
        <Suspense fallback={null}>
          <AIBuddyChat />
        </Suspense>
      </main>
    </div>
  );
}
