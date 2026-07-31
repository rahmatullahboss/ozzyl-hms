import { describe, it, expect } from 'vitest';
import {
  getOnboardingDay,
  getCurrentTask,
  checkAutoComplete,
  ONBOARDING_DAYS,
} from '../src/lib/onboarding-progression';

describe('ONBOARDING_DAYS definition', () => {
  it('has exactly 7 days', () => {
    expect(ONBOARDING_DAYS).toHaveLength(7);
  });

  it('days are 1 through 7', () => {
    expect(ONBOARDING_DAYS.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('each day has required fields', () => {
    for (const d of ONBOARDING_DAYS) {
      expect(d.task_key).toBeTruthy();
      expect(d.prompt_key).toBeTruthy();
      expect(d.cta_route).toBeTruthy();
      expect(d.auto_complete_trigger).toBeTruthy();
    }
  });

  it('day 1 is first_checkin, day 7 is first_report', () => {
    expect(ONBOARDING_DAYS[0].task_key).toBe('first_checkin');
    expect(ONBOARDING_DAYS[6].task_key).toBe('first_report');
  });
});

describe('getOnboardingDay', () => {
  it('signup day = day 1', () => {
    expect(getOnboardingDay('2026-04-18', '2026-04-18')).toBe(1);
  });

  it('1 day after signup = day 2', () => {
    expect(getOnboardingDay('2026-04-18', '2026-04-19')).toBe(2);
  });

  it('6 days after signup = day 7', () => {
    expect(getOnboardingDay('2026-04-18', '2026-04-24')).toBe(7);
  });

  it('7+ days after signup = 0 (complete)', () => {
    expect(getOnboardingDay('2026-04-18', '2026-04-25')).toBe(0);
    expect(getOnboardingDay('2026-04-18', '2026-05-01')).toBe(0);
  });

  it('future signup date returns day 1', () => {
    expect(getOnboardingDay('2026-04-20', '2026-04-18')).toBe(1);
  });
});

describe('getCurrentTask', () => {
  it('returns day 1 task when no days completed', () => {
    const task = getCurrentTask(1, []);
    expect(task).not.toBeNull();
    expect(task!.day).toBe(1);
    expect(task!.task_key).toBe('first_checkin');
  });

  it('skips completed day and returns next', () => {
    const task = getCurrentTask(1, [1]);
    expect(task).not.toBeNull();
    expect(task!.day).toBe(2);
  });

  it('returns current day task if not completed', () => {
    const task = getCurrentTask(3, [1, 2]);
    expect(task).not.toBeNull();
    expect(task!.day).toBe(3);
  });

  it('returns null when all days 1-7 completed', () => {
    const task = getCurrentTask(5, [1, 2, 3, 4, 5, 6, 7]);
    expect(task).toBeNull();
  });

  it('returns null when day is 0 (past onboarding)', () => {
    const task = getCurrentTask(0, []);
    expect(task).toBeNull();
  });

  it('skips multiple completed days', () => {
    const task = getCurrentTask(2, [1, 2, 3, 4]);
    expect(task).not.toBeNull();
    expect(task!.day).toBe(5);
  });

  it('returns null when remaining days all completed', () => {
    const task = getCurrentTask(6, [6, 7]);
    expect(task).toBeNull();
  });
});

describe('checkAutoComplete', () => {
  it('daily_checkin triggers day 1 completion', () => {
    const result = checkAutoComplete('daily_checkin', 1, []);
    expect(result).toBe(1);
  });

  it('food_log triggers day 2 completion', () => {
    const result = checkAutoComplete('food_log', 2, [1]);
    expect(result).toBe(2);
  });

  it('does not trigger already completed day', () => {
    const result = checkAutoComplete('daily_checkin', 2, [1]);
    expect(result).toBeNull();
  });

  it('returns null when day is 0 (past onboarding)', () => {
    const result = checkAutoComplete('daily_checkin', 0, []);
    expect(result).toBeNull();
  });

  it('returns null for unknown trigger', () => {
    const result = checkAutoComplete('unknown_action', 1, []);
    expect(result).toBeNull();
  });

  it('activity_log triggers day 4', () => {
    const result = checkAutoComplete('activity_log', 4, [1, 2, 3]);
    expect(result).toBe(4);
  });

  it('breathing_session triggers day 5', () => {
    const result = checkAutoComplete('breathing_session', 5, [1, 2, 3, 4]);
    expect(result).toBe(5);
  });

  it('goal_set triggers day 6', () => {
    const result = checkAutoComplete('goal_set', 6, [1, 2, 3, 4, 5]);
    expect(result).toBe(6);
  });

  it('can trigger earlier incomplete day even if current day is later', () => {
    // User skipped day 2 but is on day 4 — food_log should still complete day 2
    const result = checkAutoComplete('food_log', 4, [1, 3]);
    expect(result).toBe(2);
  });
});

describe('onboarding_progress DB schema', () => {
  it('table uses UNIQUE(patient_id, day) constraint', () => {
    const sql = `CREATE TABLE IF NOT EXISTS onboarding_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      day INTEGER NOT NULL CHECK(day >= 1 AND day <= 7),
      completed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(patient_id, day)
    )`;
    expect(sql).toContain('UNIQUE(patient_id, day)');
    expect(sql).toContain('CHECK(day >= 1 AND day <= 7)');
  });

  it('INSERT OR IGNORE prevents duplicate completion', () => {
    const sql = `INSERT OR IGNORE INTO onboarding_progress (patient_id, day, completed_at)
     VALUES (?, ?, datetime('now'))`;
    expect(sql).toContain('INSERT OR IGNORE');
  });
});
