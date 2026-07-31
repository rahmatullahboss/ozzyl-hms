/**
 * Onboarding Progression Engine
 *
 * Guides new users through their first 7 days with Ozzy.
 * Day 1: First mood check-in
 * Day 2: First food log
 * Day 3: First sleep log
 * Day 4: Discover activity tracking
 * Day 5: First breathing exercise
 * Day 6: Set first weekly goal
 * Day 7: View first weekly report
 */

export interface OnboardingDay {
  day: number;
  task_key: string;
  /** i18n key under patientPortal.ozzyGuide */
  prompt_key: string;
  /** Route to navigate to when CTA is tapped */
  cta_route: string;
  /** Which log/action completes this day automatically */
  auto_complete_trigger: string;
}

export const ONBOARDING_DAYS: OnboardingDay[] = [
  { day: 1, task_key: 'first_checkin',    prompt_key: 'day1', cta_route: '/patient/dashboard#checkin',    auto_complete_trigger: 'daily_checkin' },
  { day: 2, task_key: 'first_food_log',   prompt_key: 'day2', cta_route: '/patient/dashboard#food',       auto_complete_trigger: 'food_log' },
  { day: 3, task_key: 'first_sleep_log',  prompt_key: 'day3', cta_route: '/patient/dashboard#sleep',      auto_complete_trigger: 'sleep_log' },
  { day: 4, task_key: 'first_activity',   prompt_key: 'day4', cta_route: '/patient/dashboard#activity',   auto_complete_trigger: 'activity_log' },
  { day: 5, task_key: 'first_breathing',  prompt_key: 'day5', cta_route: '/patient/dashboard#breathing',  auto_complete_trigger: 'breathing_session' },
  { day: 6, task_key: 'first_goal',       prompt_key: 'day6', cta_route: '/patient/dashboard#goals',      auto_complete_trigger: 'goal_set' },
  { day: 7, task_key: 'first_report',     prompt_key: 'day7', cta_route: '/patient/dashboard#report',     auto_complete_trigger: 'weekly_report_viewed' },
];

/**
 * Calculate which onboarding day the user is on (1-7).
 * Returns 0 if past day 7 (onboarding complete).
 */
export function getOnboardingDay(signupDateStr: string, nowDateStr?: string): number {
  const signup = new Date(signupDateStr);
  const now = nowDateStr ? new Date(nowDateStr) : new Date();

  // Reset to midnight for day calculation
  signup.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffMs = now.getTime() - signup.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Day 1 = signup day, Day 7 = 6 days after signup
  const day = diffDays + 1;

  if (day < 1) return 1; // Future signup date edge case
  if (day > 7) return 0; // Past onboarding window
  return day;
}

/**
 * Get the current onboarding task for a given day, skipping already completed tasks.
 * If the current day's task is done, look ahead for the next incomplete task.
 */
export function getCurrentTask(
  day: number,
  completedDays: number[],
): OnboardingDay | null {
  if (day === 0) return null; // Past day 7

  // First try the current day
  const currentDayTask = ONBOARDING_DAYS.find((d) => d.day === day);
  if (currentDayTask && !completedDays.includes(day)) {
    return currentDayTask;
  }

  // If current day is done, find next incomplete up to day 7
  for (let d = day; d <= 7; d++) {
    if (!completedDays.includes(d)) {
      return ONBOARDING_DAYS.find((t) => t.day === d) ?? null;
    }
  }

  // All done
  return null;
}

/**
 * Check if a log action should auto-complete an onboarding day.
 * Returns the day number if it should be marked complete, or null.
 */
export function checkAutoComplete(
  trigger: string,
  currentDay: number,
  completedDays: number[],
): number | null {
  if (currentDay === 0) return null;

  // Check if any incomplete day matches this trigger
  for (let d = 1; d <= 7; d++) {
    if (completedDays.includes(d)) continue;
    const task = ONBOARDING_DAYS.find((t) => t.day === d);
    if (task && task.auto_complete_trigger === trigger) {
      return d;
    }
  }

  return null;
}
