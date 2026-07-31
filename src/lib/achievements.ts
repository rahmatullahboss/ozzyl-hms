export const ACHIEVEMENT_CATALOG = [
  'first_checkin',
  '3_day_streak',
  '7_day_streak',
  '14_day_streak',
  '30_day_streak',
  'first_food_log',
  'first_sleep_log',
  'first_goal_set',
  'perfect_day',
  'hydration_hero',
] as const;

export type AchievementKey = (typeof ACHIEVEMENT_CATALOG)[number];

interface StreakRow {
  streak_type: string;
  current_count: number;
  longest_count: number;
}

interface AchievementRow {
  achievement_key: string;
}

export async function checkAchievements(
  db: any,
  patientId: number,
  context: {
    justCheckedIn?: boolean;
    justLoggedFood?: boolean;
    justLoggedSleep?: boolean;
    justSetGoal?: boolean;
    todayScore?: number;
  },
): Promise<AchievementKey[]> {
  const earned = await db.prepare(
    'SELECT achievement_key FROM achievements WHERE patient_id = ?',
  ).bind(patientId).all() as { results: AchievementRow[] };

  const earnedSet = new Set((earned.results || []).map((r: AchievementRow) => r.achievement_key));

  const streaks = await db.prepare(
    'SELECT streak_type, current_count, longest_count FROM streaks WHERE patient_id = ?',
  ).bind(patientId).all() as { results: StreakRow[] };

  const streakMap = new Map<string, number>();
  for (const s of (streaks.results || [])) {
    streakMap.set(s.streak_type, s.current_count);
  }

  const newlyEarned: AchievementKey[] = [];

  const tryUnlock = (key: AchievementKey, condition: boolean) => {
    if (condition && !earnedSet.has(key)) {
      newlyEarned.push(key);
    }
  };

  const checkinStreak = streakMap.get('daily_checkin') ?? 0;

  tryUnlock('first_checkin', !!context.justCheckedIn || checkinStreak >= 1);
  tryUnlock('3_day_streak', checkinStreak >= 3);
  tryUnlock('7_day_streak', checkinStreak >= 7);
  tryUnlock('14_day_streak', checkinStreak >= 14);
  tryUnlock('30_day_streak', checkinStreak >= 30);
  tryUnlock('first_food_log', !!context.justLoggedFood);
  tryUnlock('first_sleep_log', !!context.justLoggedSleep);
  tryUnlock('first_goal_set', !!context.justSetGoal);
  tryUnlock('perfect_day', (context.todayScore ?? 0) >= 90);

  if (streakMap.get('water') ?? 0 >= 5) {
    tryUnlock('hydration_hero', true);
  }

  for (const key of newlyEarned) {
    await db.prepare(
      'INSERT OR IGNORE INTO achievements (patient_id, achievement_key) VALUES (?, ?)',
    ).bind(patientId, key).run();
  }

  return newlyEarned;
}
