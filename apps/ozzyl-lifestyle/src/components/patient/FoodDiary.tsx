import { useQuery } from '@tanstack/react-query';
import { Plus, Flame, Fish, Wheat, Droplets } from 'lucide-react';
import FoodLogModal from './FoodLogModal';
import { useState } from 'react';

interface FoodLog {
  id: number;
  meal_type: string;
  custom_name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export default function FoodDiary() {
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const dateStr = new Date().toISOString().split('T')[0];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['patient-food-diary', dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/food-diary?date=${dateStr}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch food diary');
      return res.json() as Promise<{ logs: FoodLog[], summary: any }>;
    }
  });

  const logs = data?.logs || [];
  const currentCals = data?.summary?.total_calories || 0;
  
  // Calculate macros
  const currentProtein = logs.reduce((sum, l) => sum + (l.protein_g || 0), 0);
  const currentCarbs = logs.reduce((sum, l) => sum + (l.carbs_g || 0), 0);
  const currentFat = logs.reduce((sum, l) => sum + (l.fat_g || 0), 0);

  const MACROS = {
    calories: { current: currentCals, daily: 2000 },
    protein: { current: currentProtein, daily: 120 },
    carbs: { current: currentCarbs, daily: 200 },
    fat: { current: currentFat, daily: 65 },
  };

  const calPercent = Math.min((MACROS.calories.current / MACROS.calories.daily) * 100, 100);

  // Group by meal
  const mealsMap = {
    breakfast: { name: 'Breakfast', items: [] as FoodLog[] },
    lunch: { name: 'Lunch', items: [] as FoodLog[] },
    snacks: { name: 'Snacks', items: [] as FoodLog[] },
    dinner: { name: 'Dinner', items: [] as FoodLog[] },
  };

  logs.forEach(log => {
    const type = log.meal_type as keyof typeof mealsMap;
    if (mealsMap[type]) mealsMap[type].items.push(log);
  });

  const MEALS = [mealsMap.breakfast, mealsMap.lunch, mealsMap.dinner, mealsMap.snacks];

  return (
    <div className="space-y-6 max-w-lg mx-auto pb-24">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-2xl font-bold text-slate-800 font-manrope">Food Diary</h2>
        <span className="text-sm font-semibold text-slate-500 font-manrope">Today</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-40 bg-slate-100 rounded-3xl" />
          <div className="h-24 bg-slate-100 rounded-3xl" />
          <div className="h-24 bg-slate-100 rounded-3xl" />
        </div>
      ) : (
        <>
          {/* Macro Summary Header */}
          <div className="p-6 bg-surface-container-lowest rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col md:flex-row gap-6 items-center">
            {/* Calorie Ring */}
            <div className="relative flex-shrink-0 w-32 h-32">
              <svg className="w-full h-full -rotate-90">
                <circle cx="50%" cy="50%" r="45%" stroke="currentColor" strokeWidth="8%" fill="transparent" className="text-slate-100" />
                <circle
                  cx="50%" cy="50%" r="45%" stroke="currentColor" strokeWidth="8%" fill="transparent"
                  strokeDasharray="283"
                  strokeDashoffset={283 - (283 * calPercent) / 100}
                  className="text-emerald-500 transition-all duration-1000"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-slate-800 leading-none mb-1">
                  {Math.max(0, MACROS.calories.daily - MACROS.calories.current)}
                </span>
                <span className="text-[10px] uppercase font-bold text-slate-400">Left</span>
              </div>
            </div>

            {/* Macros Breakdown */}
            <div className="flex-1 w-full space-y-4">
              <MacroRow 
                icon={<Fish className="w-4 h-4 text-blue-500" />} 
                label="Protein" 
                current={MACROS.protein.current} 
                total={MACROS.protein.daily} 
                colorClass="bg-blue-500" 
              />
              <MacroRow 
                icon={<Wheat className="w-4 h-4 text-amber-500" />} 
                label="Carbs" 
                current={MACROS.carbs.current} 
                total={MACROS.carbs.daily} 
                colorClass="bg-amber-500" 
              />
              <MacroRow 
                icon={<Droplets className="w-4 h-4 text-purple-500" />} 
                label="Fat" 
                current={MACROS.fat.current} 
                total={MACROS.fat.daily} 
                colorClass="bg-purple-500" 
              />
            </div>
          </div>

          {/* Meals List */}
          <div className="space-y-4">
            {MEALS.map((meal) => {
              const mealCals = meal.items.reduce((sum, item) => sum + (item.calories || 0), 0);
              return (
                <div key={meal.name} className="p-5 bg-surface-container-low rounded-3xl transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-800 font-manrope">{meal.name}</h3>
                    <span className="text-sm font-bold text-emerald-600 font-manrope">{mealCals} kcal</span>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    {meal.items.length > 0 ? (
                      meal.items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-sm text-slate-600 font-medium bg-white p-2 rounded-lg border border-slate-50">
                          <span>{item.custom_name}</span>
                          <span className="text-xs text-slate-400 font-bold">{item.calories} kcal</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-400 italic">No food logged yet.</p>
                    )}
                  </div>

                  <button 
                    onClick={() => setIsLogModalOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-slate-50 transition-colors text-emerald-700 font-bold text-sm rounded-xl border border-slate-100 shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add Food
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isLogModalOpen && (
        <FoodLogModal 
          isOpen={isLogModalOpen} 
          onClose={() => setIsLogModalOpen(false)} 
          onLogged={() => {
            setIsLogModalOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function MacroRow({ icon, label, current, total, colorClass }: { icon: React.ReactNode, label: string, current: number, total: number, colorClass: string }) {
  const percent = Math.min((current / total) * 100, 100);
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs font-bold mb-1 font-manrope">
        <div className="flex items-center gap-1.5 text-slate-600">
          {icon} <span>{label}</span>
        </div>
        <span className="text-slate-800">{current} <span className="text-slate-400 font-normal">/ {total}g</span></span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
