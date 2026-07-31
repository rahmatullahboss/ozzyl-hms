import React from 'react';
import { AlertTriangle, Droplets, Thermometer, Sun, Shield } from 'lucide-react';
import { getSeasonalAlerts } from '../../../src/lib/seasonal-alerts';

const ICON_MAP: Record<string, React.ReactNode> = {
  'alert-triangle': <AlertTriangle className="w-5 h-5" />,
  'droplets': <Droplets className="w-5 h-5" />,
  'thermometer': <Thermometer className="w-5 h-5" />,
  'sun': <Sun className="w-5 h-5" />,
};

const PRIORITY_STYLES: Record<string, { bg: string; border: string; iconBg: string; text: string }> = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100 text-red-600', text: 'text-red-900' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-100 text-amber-600', text: 'text-amber-900' },
  info: { bg: 'bg-cyan-50', border: 'border-cyan-200', iconBg: 'bg-cyan-100 text-cyan-600', text: 'text-cyan-900' },
};

function getPriorityLevel(priority: number): 'critical' | 'warning' | 'info' {
  if (priority <= 2) return 'critical';
  if (priority <= 5) return 'warning';
  return 'info';
}

interface SeasonalAlertsWidgetProps {
  recentSymptoms?: string[];
}

export function SeasonalAlertsWidget({ recentSymptoms = [] }: SeasonalAlertsWidgetProps) {
  const month = new Date().getMonth() + 1;
  const alerts = getSeasonalAlerts({ month, recentSymptoms });

  if (alerts.length === 0) {
    return null; // Nothing to show
  }

  // Sort by priority (lower = more urgent)
  const sorted = [...alerts].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-amber-100 text-amber-600 rounded-2xl">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Seasonal Health Alerts</h3>
          <p className="text-xs text-gray-500">Relevant tips for the current season in Bangladesh</p>
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((alert, idx) => {
          const level = getPriorityLevel(alert.priority);
          const style = PRIORITY_STYLES[level];
          const icon = ICON_MAP[alert.icon ?? 'alert-triangle'] ?? <AlertTriangle className="w-5 h-5" />;

          return (
            <div
              key={`${alert.type}-${idx}`}
              className={`p-5 rounded-2xl border ${style.bg} ${style.border} transition-all hover:shadow-md`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${style.iconBg}`}>
                  {icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className={`font-bold ${style.text}`}>{alert.title_en}</h4>
                    {level === 'critical' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-red-600 text-white rounded-full">
                        Urgent
                      </span>
                    )}
                  </div>
                  <p className={`text-sm font-medium ${style.text} opacity-80 mb-2`}>{alert.title_bn}</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{alert.body_en}</p>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{alert.body_bn}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
