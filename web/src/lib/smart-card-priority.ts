export type CardType =
  | 'critical_alert'
  | 'med_reminder'
  | 'checkin_prompt'
  | 'streak_at_risk'
  | 'health_tip'
  | 'weekly_summary'
  | 'goal_progress'
  | 'discovery'
  | 'insight';

export interface SmartCard {
  type: CardType;
  priority: number;
  props?: Record<string, unknown>;
}

export interface SmartCardContext {
  hasCheckedInToday: boolean;
  hasMedsDue: boolean;
  streakAtRisk: boolean;
  hasLabResults: boolean;
  hasActiveGoals: boolean;
  weeklyReportReady: boolean;
  criticalAlerts: Array<{ title: string; message: string }>;
  hasInsights: boolean;
}

const PRIORITY_MAP: Record<CardType, number> = {
  critical_alert: 1,
  med_reminder: 2,
  checkin_prompt: 3,
  streak_at_risk: 4,
  insight: 5,
  goal_progress: 6,
  health_tip: 7,
  weekly_summary: 8,
  discovery: 9,
};

export function computeSmartCards(ctx: SmartCardContext): SmartCard[] {
  const cards: SmartCard[] = [];

  if (ctx.criticalAlerts.length > 0) {
    cards.push({
      type: 'critical_alert',
      priority: PRIORITY_MAP.critical_alert,
      props: { alerts: ctx.criticalAlerts },
    });
  }

  if (ctx.hasMedsDue) {
    cards.push({ type: 'med_reminder', priority: PRIORITY_MAP.med_reminder });
  }

  if (!ctx.hasCheckedInToday) {
    cards.push({ type: 'checkin_prompt', priority: PRIORITY_MAP.checkin_prompt });
  }

  if (ctx.streakAtRisk) {
    cards.push({ type: 'streak_at_risk', priority: PRIORITY_MAP.streak_at_risk });
  }

  if (ctx.hasInsights) {
    cards.push({ type: 'insight', priority: PRIORITY_MAP.insight });
  }

  if (ctx.hasActiveGoals) {
    cards.push({ type: 'goal_progress', priority: PRIORITY_MAP.goal_progress });
  }

  cards.push({ type: 'health_tip', priority: PRIORITY_MAP.health_tip });

  if (ctx.weeklyReportReady) {
    cards.push({ type: 'weekly_summary', priority: PRIORITY_MAP.weekly_summary });
  }

  if (ctx.hasLabResults) {
    cards.push({ type: 'discovery', priority: PRIORITY_MAP.discovery, props: { subtype: 'lab_results' } });
  }

  return cards.sort((a, b) => a.priority - b.priority);
}
