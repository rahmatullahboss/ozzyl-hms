import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Utensils } from 'lucide-react';

interface FoodLogEntry {
  id: number;
  meal_type: string;
  food_item_id?: number;
  custom_name?: string;
  name_bn?: string;
  name_en?: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  quantity: number;
}

interface NutritionModuleProps {
  onLogFood?: () => void;
}

const MEAL_EMOJIS: Record<string, string> = {
  breakfast: '☕',
  lunch: '🍛',
  snacks: '🍪',
  dinner: '🍲',
};

export default function NutritionModule({ onLogFood }: NutritionModuleProps) {
  const { t, i18n } = useTranslation('patientPortal');

  const [logs, setLogs] = useState<FoodLogEntry[]>([]);
  const [totals, setTotals] = useState({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [loading, setLoading] = useState(true);
  const calorieGoal = 2000;

  useEffect(() => {
    void (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/food/logs?date=${today}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json() as { logs: FoodLogEntry[]; totals: typeof totals };
          setLogs(data.logs || []);
          setTotals(data.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="bg-white rounded-2xl p-6 shadow-sm animate-pulse h-32" />;
  }

  // Empty state
  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <Utensils className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-3">{t('empty.noMeals')}</p>
        <button
          onClick={onLogFood}
          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-xl font-semibold hover:bg-emerald-500 transition-colors"
        >
          {t('empty.noMealsCta')}
        </button>
      </div>
    );
  }

  const calPercent = Math.min(100, Math.round((totals.calories / calorieGoal) * 100));
  const macroTotal = totals.protein_g + totals.carbs_g + totals.fat_g || 1;

  // Group by meal type
  const grouped = logs.reduce<Record<string, FoodLogEntry[]>>((acc, log) => {
    (acc[log.meal_type] = acc[log.meal_type] || []).push(log);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">{t('modules.nutrition')}</h3>
        <button
          onClick={onLogFood}
          className="text-xs text-emerald-600 font-semibold hover:underline"
        >
          + {t('quickActions.logFood')}
        </button>
      </div>

      {/* Calorie progress */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="font-semibold text-slate-700">{totals.calories.toLocaleString(i18n.language)} {t('nutrition.kcal')}</span>
          <span className="text-slate-400">/ {calorieGoal.toLocaleString(i18n.language)} {t('nutrition.kcal')}</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${calPercent}%` }}
          />
        </div>
      </div>

      {/* Macro bar */}
      <div className="flex gap-1 h-3 rounded-full overflow-hidden">
        <div className="bg-blue-400 rounded-l-full" style={{ width: `${(totals.protein_g / macroTotal) * 100}%` }} />
        <div className="bg-yellow-400" style={{ width: `${(totals.carbs_g / macroTotal) * 100}%` }} />
        <div className="bg-red-400 rounded-r-full" style={{ width: `${(totals.fat_g / macroTotal) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{t('nutrition.macros.protein')} {totals.protein_g.toLocaleString(i18n.language)}g</span>
        <span>{t('nutrition.macros.carbs')} {totals.carbs_g.toLocaleString(i18n.language)}g</span>
        <span>{t('nutrition.macros.fat')} {totals.fat_g.toLocaleString(i18n.language)}g</span>
      </div>

      {/* Meal sections */}
      {Object.entries(grouped).map(([meal, items]) => (
        <div key={meal}>
          <p className="text-xs font-semibold text-slate-500 mb-1">
            {MEAL_EMOJIS[meal]} {t(`nutrition.meals.${meal}`)}
          </p>
          {items.map((item) => (
            <div key={item.id} className="flex justify-between items-center py-1.5 text-sm">
              <span className="text-slate-700">
                {i18n.language === 'bn' ? (item.name_bn || item.custom_name) : (item.name_en || item.custom_name)}
                {item.quantity !== 1 && <span className="text-slate-400 ml-1">x{item.quantity.toLocaleString(i18n.language)}</span>}
              </span>
              <span className="text-slate-500 text-xs">{Math.round(item.calories).toLocaleString(i18n.language)} {t('nutrition.kcal')}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
