import { useTranslation } from 'react-i18next';
import { AlertCircle, Bell, CheckCircle2, Flame, Lightbulb, BarChart3, Target, Compass, Sparkles } from 'lucide-react';
import type { SmartCard } from '../../lib/smart-card-priority';

interface SmartCardRendererProps {
  cards: SmartCard[];
  onAction?: (type: SmartCard['type'], props?: Record<string, unknown>) => void;
}

const ICON_MAP: Record<SmartCard['type'], typeof AlertCircle> = {
  critical_alert: AlertCircle,
  med_reminder: Bell,
  checkin_prompt: CheckCircle2,
  streak_at_risk: Flame,
  health_tip: Lightbulb,
  weekly_summary: BarChart3,
  goal_progress: Target,
  discovery: Compass,
  insight: Sparkles,
};

const BG_MAP: Record<SmartCard['type'], string> = {
  critical_alert: 'from-red-50 to-rose-50',
  med_reminder: 'from-blue-50 to-indigo-50',
  checkin_prompt: 'from-emerald-50 to-teal-50',
  streak_at_risk: 'from-amber-50 to-orange-50',
  health_tip: 'from-amber-50 to-orange-50',
  weekly_summary: 'from-violet-50 to-purple-50',
  goal_progress: 'from-cyan-50 to-sky-50',
  discovery: 'from-slate-50 to-gray-50',
  insight: 'from-purple-50 to-fuchsia-50',
};

const ICON_BG_MAP: Record<SmartCard['type'], string> = {
  critical_alert: 'bg-red-100 text-red-600',
  med_reminder: 'bg-blue-100 text-blue-600',
  checkin_prompt: 'bg-emerald-100 text-emerald-600',
  streak_at_risk: 'bg-amber-100 text-amber-600',
  health_tip: 'bg-amber-100 text-amber-600',
  weekly_summary: 'bg-violet-100 text-violet-600',
  goal_progress: 'bg-cyan-100 text-cyan-600',
  discovery: 'bg-slate-100 text-slate-600',
  insight: 'bg-purple-100 text-purple-600',
};

const I18N_KEY_MAP: Record<SmartCard['type'], { title: string; desc: string; cta: string }> = {
  critical_alert: { title: 'smartCards.criticalAlert', desc: 'smartCards.criticalAlertDesc', cta: 'smartCards.viewDetails' },
  med_reminder: { title: 'smartCards.medReminder', desc: 'smartCards.medReminderDesc', cta: 'smartCards.takeNow' },
  checkin_prompt: { title: 'smartCards.checkinPrompt', desc: 'smartCards.checkinPromptDesc', cta: 'smartCards.checkInNow' },
  streak_at_risk: { title: 'smartCards.streakAtRisk', desc: 'smartCards.streakAtRiskDesc', cta: 'smartCards.keepGoing' },
  health_tip: { title: 'smartCards.healthTip', desc: 'smartCards.healthTipDesc', cta: '' },
  weekly_summary: { title: 'smartCards.weeklySummary', desc: 'smartCards.weeklySummaryDesc', cta: 'smartCards.viewReport' },
  goal_progress: { title: 'smartCards.goalProgress', desc: 'smartCards.goalProgressDesc', cta: 'smartCards.viewGoals' },
  discovery: { title: 'smartCards.discovery', desc: 'smartCards.discoveryDesc', cta: 'smartCards.explore' },
  insight: { title: 'smartCards.insight', desc: 'smartCards.insightDesc', cta: 'smartCards.viewInsights' },
};

export default function SmartCardRenderer({ cards, onAction }: SmartCardRendererProps) {
  const { t } = useTranslation('patientPortal');

  if (cards.length === 0) return null;

  return (
    <div className="space-y-3">
      {cards.map((card) => {
        const Icon = ICON_MAP[card.type];
        const keys = I18N_KEY_MAP[card.type];
        const ctaText = t(keys.cta);
        const isCritical = card.type === 'critical_alert';

        return (
          <div
            key={card.type}
            className={`bg-gradient-to-br ${BG_MAP[card.type]} rounded-2xl p-5 flex items-start gap-4 ${
              isCritical ? 'ring-2 ring-red-200' : ''
            }`}
          >
            <div className={`p-2 rounded-lg shrink-0 ${ICON_BG_MAP[card.type]}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${isCritical ? 'text-red-900' : 'text-slate-800'} mb-1`}>
                {t(keys.title)}
              </p>
              <p className={`text-xs ${isCritical ? 'text-red-700/80' : 'text-slate-600'} leading-relaxed`}>
                {t(keys.desc)}
              </p>
              {ctaText && ctaText !== keys.cta && (
                <button
                  onClick={() => onAction?.(card.type, card.props)}
                  className={`mt-2 text-xs font-semibold ${
                    isCritical ? 'text-red-700 hover:text-red-900' : 'text-emerald-700 hover:text-emerald-900'
                  } transition`}
                >
                  {ctaText} →
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
