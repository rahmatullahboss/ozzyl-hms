import { describe, it, expect } from 'vitest';
import { computeSmartCards } from './smart-card-priority';
import type { SmartCardContext } from './smart-card-priority';

const emptyCtx: SmartCardContext = {
  hasCheckedInToday: false,
  hasMedsDue: false,
  streakAtRisk: false,
  hasLabResults: false,
  hasActiveGoals: false,
  weeklyReportReady: false,
  criticalAlerts: [],
  hasInsights: false,
};

describe('computeSmartCards', () => {
  it('returns health_tip as minimum when no other conditions are true', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasCheckedInToday: true });
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe('health_tip');
  });

  it('includes critical_alert when alerts exist', () => {
    const ctx: SmartCardContext = {
      ...emptyCtx,
      hasCheckedInToday: true,
      criticalAlerts: [{ title: 'High BP', message: 'Check your blood pressure' }],
    };
    const cards = computeSmartCards(ctx);
    expect(cards.some((c) => c.type === 'critical_alert')).toBe(true);
    expect(cards.find((c) => c.type === 'critical_alert')?.props?.alerts).toHaveLength(1);
  });

  it('includes med_reminder when meds are due', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasMedsDue: true });
    expect(cards.some((c) => c.type === 'med_reminder')).toBe(true);
  });

  it('includes checkin_prompt when not checked in today', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasCheckedInToday: false });
    expect(cards.some((c) => c.type === 'checkin_prompt')).toBe(true);
  });

  it('excludes checkin_prompt when already checked in', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasCheckedInToday: true });
    expect(cards.some((c) => c.type === 'checkin_prompt')).toBe(false);
  });

  it('includes streak_at_risk when streak is at risk', () => {
    const cards = computeSmartCards({ ...emptyCtx, streakAtRisk: true });
    expect(cards.some((c) => c.type === 'streak_at_risk')).toBe(true);
  });

  it('includes insight when hasInsights is true', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasInsights: true });
    expect(cards.some((c) => c.type === 'insight')).toBe(true);
  });

  it('excludes insight when hasInsights is false', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasCheckedInToday: true });
    expect(cards.some((c) => c.type === 'insight')).toBe(false);
  });

  it('includes goal_progress when there are active goals', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasActiveGoals: true });
    expect(cards.some((c) => c.type === 'goal_progress')).toBe(true);
  });

  it('includes weekly_summary when report is ready', () => {
    const cards = computeSmartCards({ ...emptyCtx, weeklyReportReady: true });
    expect(cards.some((c) => c.type === 'weekly_summary')).toBe(true);
  });

  it('includes discovery when lab results exist', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasLabResults: true });
    expect(cards.some((c) => c.type === 'discovery')).toBe(true);
  });

  it('sorts cards by priority (critical first)', () => {
    const ctx: SmartCardContext = {
      ...emptyCtx,
      hasMedsDue: true,
      hasActiveGoals: true,
      criticalAlerts: [{ title: 'Alert', message: 'msg' }],
    };
    const cards = computeSmartCards(ctx);
    expect(cards[0].type).toBe('critical_alert');
    expect(cards[1].type).toBe('med_reminder');
  });

  it('returns all applicable cards in priority order', () => {
    const ctx: SmartCardContext = {
      hasCheckedInToday: false,
      hasMedsDue: true,
      streakAtRisk: true,
      hasLabResults: true,
      hasActiveGoals: true,
      weeklyReportReady: true,
      criticalAlerts: [{ title: 'A', message: 'B' }],
      hasInsights: true,
    };
    const cards = computeSmartCards(ctx);
    const types = cards.map((c) => c.type);
    expect(types).toEqual([
      'critical_alert',
      'med_reminder',
      'checkin_prompt',
      'streak_at_risk',
      'insight',
      'goal_progress',
      'health_tip',
      'weekly_summary',
      'discovery',
    ]);
  });

  it('assigns correct priority numbers', () => {
    const cards = computeSmartCards({ ...emptyCtx, hasCheckedInToday: true });
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].priority).toBeGreaterThanOrEqual(cards[i - 1].priority);
    }
  });
});
