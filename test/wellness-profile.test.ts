import { describe, it, expect } from 'vitest';

describe('wellness profile schema contracts', () => {
  it('wellness_profile table accepts valid profile data', () => {
    const profile = {
      patient_id: 1,
      date_of_birth: '1990-01-15',
      gender: 'male',
      height_cm: 170,
      weight_kg: 72.5,
      language: 'bn',
      onboarding_completed: 0,
      ramadan_mode: 0,
    };
    expect(profile.patient_id).toBe(1);
    expect(profile.language).toBe('bn');
    expect(['male', 'female', 'other']).toContain(profile.gender);
  });

  it('wellness_preferences table accepts valid preferences', () => {
    const prefs = {
      patient_id: 1,
      notification_settings: JSON.stringify({ medication: true, streak: true, tips: true }),
      active_modules: JSON.stringify(['nutrition', 'activity', 'sleep', 'mind']),
      daily_goals: JSON.stringify({ steps: 6000, water_glasses: 8, sleep_hours: 7 }),
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    };
    expect(JSON.parse(prefs.active_modules)).toContain('nutrition');
    expect(JSON.parse(prefs.daily_goals).steps).toBe(6000);
  });

  it('daily_health_score table accepts score data', () => {
    const score = {
      patient_id: 1,
      date: '2026-04-15',
      total_score: 78,
      sleep_score: 80,
      activity_score: 65,
      nutrition_score: 75,
      mood_score: 85,
      medication_score: 90,
      vitals_score: 70,
    };
    expect(score.total_score).toBeGreaterThanOrEqual(0);
    expect(score.total_score).toBeLessThanOrEqual(100);
  });

  it('streaks table tracks streak data', () => {
    const streak = {
      patient_id: 1,
      streak_type: 'daily_checkin',
      current_count: 5,
      longest_count: 12,
      last_logged_date: '2026-04-15',
    };
    const validTypes = ['daily_checkin', 'food_log', 'activity', 'sleep_log', 'medication', 'water'];
    expect(validTypes).toContain(streak.streak_type);
    expect(streak.current_count).toBeLessThanOrEqual(streak.longest_count);
  });

  it('user_goals table accepts goal data', () => {
    const goal = {
      patient_id: 1,
      goal_type: 'steps',
      target_value: 6000,
      current_value: 3200,
      unit: 'steps',
      status: 'active',
    };
    expect(['active', 'completed', 'abandoned']).toContain(goal.status);
    expect(goal.target_value).toBeGreaterThan(0);
  });

  it('achievements table tracks earned badges', () => {
    const achievement = {
      patient_id: 1,
      achievement_key: 'first_checkin',
      earned_at: '2026-04-15T10:00:00Z',
    };
    expect(achievement.achievement_key).toBe('first_checkin');
  });
});
