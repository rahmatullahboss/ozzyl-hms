import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Activity, Heart, Droplets, TrendingUp, TrendingDown, Award, Star, Flame, X } from 'lucide-react';

interface Insight {
  id: number;
  type: string;
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  icon: string;
  priority: number;
  severity: string;
  read: boolean;
}

const ICON_MAP: Record<string, typeof Moon> = {
  moon: Moon,
  activity: Activity,
  heart: Heart,
  droplets: Droplets,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  award: Award,
  star: Star,
  flame: Flame,
};

const ICON_COLORS: Record<string, string> = {
  moon: 'text-indigo-500 bg-indigo-50',
  activity: 'text-orange-500 bg-orange-50',
  heart: 'text-rose-500 bg-rose-50',
  droplets: 'text-cyan-500 bg-cyan-50',
  'trending-up': 'text-emerald-500 bg-emerald-50',
  'trending-down': 'text-red-500 bg-red-50',
  award: 'text-amber-500 bg-amber-50',
  star: 'text-yellow-500 bg-yellow-50',
  flame: 'text-orange-500 bg-orange-50',
};

const SEVERITY_BORDER: Record<string, string> = {
  warning: 'border-l-4 border-l-amber-400',
  info: 'border-l-4 border-l-blue-400',
  positive: 'border-l-4 border-l-emerald-400',
};

export default function InsightsCards() {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInsights = useCallback(async () => {
    try {
      const genRes = await fetch('/api/wellness/insights/generate', {
        method: 'POST',
        credentials: 'include',
      });
      if (genRes.ok) {
        const genData = await genRes.json() as { insights: Insight[]; generated: number };
        if (genData.generated > 0) {
          setInsights(genData.insights.map((ins, i) => ({ ...ins, id: ins.id || i + 1, read: false })));
          setLoading(false);
          return;
        }
      }

      const res = await fetch('/api/wellness/insights', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { insights: Insight[] };
        setInsights(data.insights || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  const dismissInsight = async (insight: Insight) => {
    setInsights((prev) => prev.filter((i) => i.type !== insight.type));
    try {
      if (insight.id) {
        await fetch(`/api/wellness/insights/${insight.id}/read`, {
          method: 'POST',
          credentials: 'include',
        });
      }
    } catch { /* ignore */ }
  };

  if (loading) return null;
  if (insights.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-700">
        {isBn ? 'আজকের ইনসাইট' : "Today's Insights"}
      </h3>
      {insights.map((insight) => {
        const Icon = ICON_MAP[insight.icon] || Star;
        const colorClass = ICON_COLORS[insight.icon] || 'text-slate-500 bg-slate-50';
        const borderClass = SEVERITY_BORDER[insight.severity] || '';
        return (
          <div
            key={insight.type}
            className={`bg-white rounded-xl p-4 shadow-sm flex items-start gap-3 relative ${borderClass}`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-sm font-semibold text-slate-900">
                {isBn ? insight.title_bn : insight.title_en}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {isBn ? insight.body_bn : insight.body_en}
              </p>
            </div>
            <button
              onClick={() => dismissInsight(insight)}
              className="absolute top-2 right-2 p-1 rounded-full hover:bg-slate-100 transition"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
