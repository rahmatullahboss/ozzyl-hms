import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

export interface LifestyleLog {
  logged_on: string;
  mood?: string;
  energy_level?: string;
  sleep_hours?: number | string;
  exercise_minutes?: number | string;
  water_glasses?: number | string;
  notes?: string;
}

export interface WellnessScore {
  total: number;
  breakdown: {
    sleep: number;
    activity: number;
    nutrition: number;
    mood: number;
    medication: number;
    vitals: number;
  };
}

export interface StreakData {
  streak_type: string;
  current_count: number;
}

export interface ActivityLog {
  id: number;
  activity_type: string;
  duration_min: number;
  calories_burned?: number;
  steps?: number;
  logged_at: string;
}

const fetchWithCredentials = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Session expired');
    }
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
};

export function useLifestyleLogs(limit = 30) {
  return useQuery({
    queryKey: ['lifestyle-logs', limit],
    queryFn: () => fetchWithCredentials(`/api/patient-phr/lifestyle-logs?limit=${limit}`) as Promise<{ lifestyle_logs: LifestyleLog[] }>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWellnessScore(date: string) {
  return useQuery({
    queryKey: ['wellness-score', date],
    queryFn: () => fetchWithCredentials(`/api/wellness/score?date=${date}`) as Promise<WellnessScore>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWellnessScoreTrend(days = 7) {
  return useQuery({
    queryKey: ['wellness-score-trend', days],
    queryFn: () => fetchWithCredentials(`/api/wellness/score/trend?days=${days}`) as Promise<{ trend: Array<{ total_score: number }> }>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWellnessStreaks() {
  return useQuery({
    queryKey: ['wellness-streaks'],
    queryFn: () => fetchWithCredentials(`/api/wellness/streaks`) as Promise<{ streaks: StreakData[] }>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogDailyCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      date: string;
      mood: string;
      wellnessMood: string;
      energy: number;
      energyEnum: string;
      sleepHours: number;
      sleepQuality: number;
      exerciseMinutes: number;
      waterGlasses: number;
      notes?: string;
    }) => {
      // 1. Phr Lifestyle
      await fetchWithCredentials('/api/patient-phr/lifestyle-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logged_on: data.date,
          sleep_hours: data.sleepHours,
          exercise_minutes: data.exerciseMinutes,
          mood: data.mood,
          energy_level: data.energyEnum,
          water_glasses: data.waterGlasses,
          symptom_score: 0,
          notes: data.notes,
        }),
      });

      // 2. Wellness Batch
      const streakRes = await fetch('/api/wellness/logs/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: data.wellnessMood,
          energy_level: data.energy,
          sleep_hours: data.sleepHours,
          sleep_quality: data.sleepQuality,
          exercise_minutes: data.exerciseMinutes,
          exercise_type: 'walk',
          water_glasses: data.waterGlasses,
          notes: data.notes,
        }),
      });
      
      if (!streakRes.ok) throw new Error('Failed to update streak');
      return streakRes.json() as Promise<{ streak?: { current_count: number }; new_achievements?: string[] }>;
    },
    onMutate: async (newCheckIn) => {
      // 1. Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['daily-totals', newCheckIn.date] });

      // 2. Snapshot the previous value
      const previousTotals = queryClient.getQueryData(['daily-totals', newCheckIn.date]);

      // 3. Optimistically update to the new value
      queryClient.setQueryData(['daily-totals', newCheckIn.date], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          steps: (old.steps || 0) + (newCheckIn.exerciseMinutes * 100), // very rough estimate
          water: (old.water || 0) + (newCheckIn.waterGlasses * 250), // 250ml per glass
          sleep: newCheckIn.sleepHours,
          mood: newCheckIn.mood,
          energy: newCheckIn.energy,
        };
      });

      // Return a context object with the snapshotted value
      return { previousTotals };
    },
    onError: (_err, newCheckIn, context: any) => {
      // Rollback to the previous value if mutation fails
      if (context?.previousTotals) {
        queryClient.setQueryData(['daily-totals', newCheckIn.date], context.previousTotals);
      }
      toast.error('চেক-ইন সেভ করা যায়নি। আবার চেষ্টা করুন।');
    },
    onSettled: (_data, _error, variables) => {
      // Always invalidate to eventually get true server state
      queryClient.invalidateQueries({ queryKey: ['daily-totals', variables.date] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifestyle-logs'] });
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      queryClient.invalidateQueries({ queryKey: ['wellness-score-trend'] });
      queryClient.invalidateQueries({ queryKey: ['wellness-streaks'] });
      toast.success('✅ আজকের চেক-ইন সম্পন্ন!');
    }
  });
}

export function useActivityLogs(date: string) {
  return useQuery({
    queryKey: ['activity-logs', date],
    queryFn: () => fetchWithCredentials(`/api/wellness/logs/activity?date=${date}`) as Promise<{ logs: ActivityLog[] }>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { activity_type: string; duration_min: number; calories_burned: number }) => {
      await fetchWithCredentials('/api/wellness/logs/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, source: 'manual' }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-logs'] });
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      toast.success('Activity Logged Successfully!');
    },
  });
}

export function useLogMeditation() {
  return useMutation({
    mutationFn: async (data: { durationMinutes: number; type: string }) => {
      // Temporary or permanent endpoint depending on backend state
      await fetchWithCredentials('/api/wellness/meditation/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast.success('Meditation session logged!');
    },
    onError: () => {
      toast.error('Failed to log session. Please try again.');
    }
  });
}

export function useLogMentalHealthScreening() {
  return useMutation({
    mutationFn: async (data: { type: 'phq9' | 'gad7'; answers: number[] }) => {
      await fetchWithCredentials('/api/wellness/screening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast.success('Screening results saved securely.');
    },
    onError: () => {
      toast.error('Failed to save screening results.');
    }
  });
}

// ─── CYCLE TRACKER ────────────────────────────────────────────────────────
export interface CycleLog {
  start_date: string;
  end_date?: string | null;
  flow_intensity?: 'light' | 'medium' | 'heavy' | null;
  symptoms?: string | string[] | null;
}

export function useCycleHistory() {
  return useQuery({
    queryKey: ['cycle-history'],
    queryFn: async () => {
      const res = await fetchWithCredentials('/api/wellness/cycle/history');
      return res as {
        cycles?: CycleLog[];
        avg_cycle_length?: number;
        next_predicted?: string;
      };
    },
  });
}

export function useLogCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CycleLog) => {
      await fetchWithCredentials('/api/wellness/cycle/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle-history'] });
      toast.success('Cycle log saved!');
    },
    onError: () => {
      toast.error('Failed to log cycle data.');
    }
  });
}

// ─── SLEEP MODULE ─────────────────────────────────────────────────────────

export interface SleepLog {
  id?: number;
  bedtime?: string;
  wake_time?: string;
  duration_min?: number;
  quality_rating?: number;
  source: string;
  logged_at?: string;
}

export function useSleepHistory(days = 7) {
  return useQuery({
    queryKey: ['sleep-history', days],
    queryFn: async () => {
      const res = await fetchWithCredentials(`/api/wellness/logs/sleep?days=${days}`);
      return res as { logs?: SleepLog[] };
    },
  });
}

export function useLogSleep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: SleepLog) => {
      await fetchWithCredentials('/api/wellness/logs/sleep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sleep-history'] });
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      toast.success('Sleep logged accurately!');
    },
    onError: () => {
      toast.error('Failed to log sleep.');
    }
  });
}

// ─── SYMPTOM LOGGER ───────────────────────────────────────────────────────

export function useLogSymptoms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { symptoms: string[]; severity: number; notes: string }) => {
      // Send individual POSTs for each symptom
      await Promise.all(
        data.symptoms.map((symp) =>
          fetchWithCredentials('/api/wellness/logs/symptom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symptom: symp,
              severity: data.severity,
              note: data.notes || undefined,
            }),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      toast.success('Symptoms logged successfully');
    },
    onError: () => {
      toast.error('Failed to save symptoms');
    }
  });
}

// ─── DOCUMENT VAULT ───────────────────────────────────────────────────────

export interface DocumentRecord {
  id: number;
  type: string;
  title: string;
  description: string;
  fileSize: number;
  file_key: string;
  mime_type: string;
  file_name: string;
  date: string;
}

export function useDocuments(page = 1, limit = 50) {
  return useQuery({
    queryKey: ['medical-documents', page],
    queryFn: () => fetchWithCredentials(`/api/patient-portal/documents?page=${page}&limit=${limit}`) as Promise<{ data: DocumentRecord[], pagination: any }>,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── MEDICAL ALERTS & ADVERSE REACTIONS ───────────────────────────────────

export interface AdverseReaction {
  id: number;
  medication_name: string;
  reaction: string;
  severity: "mild" | "moderate" | "severe";
  created_at: string;
  review_status: string;
}

export function useAdverseReactions() {
  return useQuery({
    queryKey: ['adverse-reactions'],
    queryFn: async () => {
      const res = await fetchWithCredentials('/api/patient-phr/adverse-reactions');
      return res as { adverse_reactions: AdverseReaction[] };
    },
  });
}

export function useLogAdverseReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { medication_name: string; reaction: string; severity: "mild" | "moderate" | "severe"; notes?: string }) => {
      await fetchWithCredentials('/api/patient-phr/adverse-reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adverse-reactions'] });
      toast.success('Allergy recorded successfully', { id: 'adr-success' });
    },
    onError: () => {
      toast.error('Failed to record allergy', { id: 'adr-error' });
    }
  });
}

// ─── WELLNESS HUB (Preferences & Daily Progress) ─────────────────────────

export interface WellnessHubData {
  medication_reminders: string[];
  daily_routines: string[];
  suggested_medication_reminders: string[];
  suggested_daily_routines: string[];
  completed_items: string[];
  tracker_date: string;
  updated_at: string;
  patient_name: string | null;
}

export function useWellnessHub() {
  return useQuery({
    queryKey: ['wellness-hub'],
    queryFn: async () => {
      const res = await fetchWithCredentials('/api/global-portal/wellness-hub');
      return res as WellnessHubData;
    },
  });
}

export function useUpdateWellnessChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (completed_items: string[]) => {
      await fetchWithCredentials('/api/global-portal/wellness-hub/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed_items }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wellness-hub'] });
    }
  });
}

export function useUpdateWellnessPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { medication_reminders: string[], daily_routines: string[] }) => {
      await fetchWithCredentials('/api/global-portal/wellness-hub', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wellness-hub'] });
      toast.success('Medication Reminders Updated');
    }
  });
}

export interface DailyTotalsData {
  date: string;
  steps: number;
  water_ml: number;
  sleep_min: number;
  heart_rate_avg: number | null;
  rings: {
    move: { current: number; goal: number };
    exercise: { current: number; goal: number };
    stand: { current: number; goal: number };
  };
}

export function useDailyTotals(date?: string) {
  const d = date || new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['daily-totals', d],
    queryFn: async () => {
      return (await fetchWithCredentials(`/api/wellness/daily-totals?date=${d}`)) as DailyTotalsData;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface ScreeningData {
  id: number;
  patient_id: number;
  screening_type: string;
  total_score: number;
  severity: string;
  created_at: string;
}

export function useScreeningHistory(type?: string) {
  return useQuery({
    queryKey: ['screenings', type],
    queryFn: async () => {
      const url = type ? `/api/wellness/screenings?type=${type}` : '/api/wellness/screenings';
      const data = await fetchWithCredentials(url) as { screenings: ScreeningData[] };
      return data.screenings;
    },
  });
}

export interface ChallengeData {
  id: number;
  name: string;
  type: string;
  target: number;
  duration_days: number;
  status: string;
  created_at: string;
  current_value: number | null;
  joined_at: string | null;
}

export function useChallenges() {
  return useQuery({
    queryKey: ['challenges'],
    queryFn: async () => {
      const data = await fetchWithCredentials('/api/wellness/challenges') as { challenges: ChallengeData[] };
      return data.challenges || [];
    },
  });
}

