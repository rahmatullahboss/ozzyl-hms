import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Target, TrendingUp, Trash2 } from 'lucide-react';

interface Goal {
  id: number;
  goal_type: string;
  target_value: number;
  current_value: number;
  unit: string;
  start_date: string;
  end_date: string | null;
  status: string;
  ai_suggested: number;
}

interface GoalSettingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoalChange?: () => void;
}

const GOAL_TYPES = [
  { key: 'steps', unit: 'steps', icon: '👟' },
  { key: 'sleep_hours', unit: 'hours', icon: '😴' },
  { key: 'water_glasses', unit: 'glasses', icon: '💧' },
  { key: 'exercise_minutes', unit: 'minutes', icon: '🏋️' },
  { key: 'weight_kg', unit: 'kg', icon: '⚖️' },
  { key: 'meditation_minutes', unit: 'minutes', icon: '🧘' },
] as const;

const GOAL_LABELS: Record<string, { en: string; bn: string }> = {
  steps: { en: 'Daily Steps', bn: 'দৈনিক পদক্ষেপ' },
  sleep_hours: { en: 'Sleep Hours', bn: 'ঘুমের ঘণ্টা' },
  water_glasses: { en: 'Water Intake', bn: 'পানি পান' },
  exercise_minutes: { en: 'Exercise', bn: 'ব্যায়াম' },
  weight_kg: { en: 'Weight Goal', bn: 'ওজনের লক্ষ্য' },
  meditation_minutes: { en: 'Meditation', bn: 'ধ্যান' },
};

const DEFAULT_TARGETS: Record<string, number> = {
  steps: 10000,
  sleep_hours: 8,
  water_glasses: 8,
  exercise_minutes: 30,
  weight_kg: 70,
  meditation_minutes: 15,
};

export default function GoalSettingModal({ isOpen, onClose, onGoalChange }: GoalSettingModalProps) {
  const { i18n } = useTranslation('patientPortal');
  const { t } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('steps');
  const [targetValue, setTargetValue] = useState<number>(10000);

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/wellness/goals?status=active', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { goals: Goal[] };
        setGoals(data.goals || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) fetchGoals();
  }, [isOpen, fetchGoals]);

  useEffect(() => {
    setTargetValue(DEFAULT_TARGETS[selectedType] ?? 100);
  }, [selectedType]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const goalMeta = GOAL_TYPES.find((g) => g.key === selectedType);
      const res = await fetch('/api/wellness/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          goal_type: selectedType,
          target_value: targetValue,
          unit: goalMeta?.unit ?? selectedType,
        }),
      });
      if (res.ok) {
        onGoalChange?.();
        fetchGoals();
      }
    } catch { /* ignore */ }
    setCreating(false);
  }, [selectedType, targetValue, onGoalChange, fetchGoals]);

  const handleAbandon = useCallback(async (goalId: number) => {
    try {
      const res = await fetch(`/api/wellness/goals/${goalId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        onGoalChange?.();
        fetchGoals();
      }
    } catch { /* ignore */ }
  }, [onGoalChange, fetchGoals]);

  if (!isOpen) return null;

  const activeGoalTypes = new Set(goals.map((g) => g.goal_type));

  const progressPct = (g: Goal) =>
    g.target_value > 0 ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-t-3xl max-h-[85vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-slate-900">{t('goals.title')}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
          {loading ? (
            <p className="text-center text-sm text-slate-400 py-8">
              {isBn ? 'লোড হচ্ছে...' : 'Loading...'}
            </p>
          ) : (
            <>
              {goals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('goals.activeGoals')}
                  </p>
                  {goals.map((g) => {
                    const pct = progressPct(g);
                    const label = GOAL_LABELS[g.goal_type];
                    return (
                      <div key={g.id} className="bg-slate-50 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {GOAL_TYPES.find((gt) => gt.key === g.goal_type)?.icon ?? '🎯'}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {isBn ? label?.bn : label?.en ?? g.goal_type}
                              </p>
                              <p className="text-xs text-slate-500">
                                {g.current_value} / {g.target_value} {g.unit}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-emerald-600">{pct}%</span>
                            <button
                              onClick={() => handleAbandon(g.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {goals.length === 0 && (
                <div className="text-center py-6">
                  <Target className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">{t('goals.noGoals')}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('goals.noGoalsDesc')}</p>
                </div>
              )}

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('goals.addNew')}
                </p>

                <div className="grid grid-cols-3 gap-2">
                  {GOAL_TYPES.map((gt) => {
                    const isActive = activeGoalTypes.has(gt.key);
                    const label = GOAL_LABELS[gt.key];
                    return (
                      <button
                        key={gt.key}
                        disabled={isActive}
                        onClick={() => setSelectedType(gt.key)}
                        className={`p-2.5 rounded-xl text-center transition-all ${
                          selectedType === gt.key
                            ? 'bg-emerald-600 text-white ring-2 ring-emerald-300'
                            : isActive
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-slate-100 text-slate-700 hover:bg-emerald-50'
                        }`}
                      >
                        <span className="text-lg block">{gt.icon}</span>
                        <span className="text-[10px] font-medium block mt-0.5">
                          {isBn ? label?.bn : label?.en}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-600 shrink-0">{t('goals.target')}</label>
                  <input
                    type="number"
                    value={targetValue}
                    onChange={(e) => setTargetValue(Number(e.target.value))}
                    className="flex-1 px-3 py-2 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-slate-500 shrink-0">
                    {GOAL_TYPES.find((gt) => gt.key === selectedType)?.unit ?? ''}
                  </span>
                </div>

                <button
                  onClick={handleCreate}
                  disabled={creating || activeGoalTypes.has(selectedType)}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <TrendingUp className="w-4 h-4" />
                  {creating
                    ? '...'
                    : activeGoalTypes.has(selectedType)
                    ? t('goals.alreadyActive')
                    : t('goals.setGoal')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
