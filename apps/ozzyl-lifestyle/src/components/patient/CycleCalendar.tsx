import { Calendar as CalendarIcon, Beaker, Plus, Heart } from 'lucide-react';

export default function CycleCalendar() {
  const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1);
  const currentDay = 15;
  const periodDays = [12, 13, 14, 15, 16];
  const predictedDays = [9, 10, 11];

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Header and Prediction Card */}
      <div className="p-6 text-white rounded-3xl bg-gradient-to-br from-rose-400 to-rose-300 shadow-xl shadow-rose-200">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold font-manrope">Cycle Tracker</h2>
          <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
            <Heart className="w-6 h-6 text-white" />
          </div>
        </div>

        <div>
          <p className="text-rose-100 text-sm font-semibold uppercase tracking-wider mb-1 font-manrope">
            Prediction
          </p>
          <div className="flex items-end gap-2">
            <span className="text-5xl font-bold font-manrope leading-none">Day 4</span>
            <span className="text-xl font-medium text-rose-50 mb-1 font-manrope">of Period</span>
          </div>
          <p className="text-rose-50 text-sm mt-3 opacity-90">
            Next cycle expected in 24 days.
          </p>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-surface-container-lowest p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-bold text-slate-800 font-manrope">October</h3>
          <div className="flex bg-slate-100 p-1 rounded-full">
            <button className="px-4 py-1.5 text-xs font-bold bg-white shadow-sm rounded-full text-slate-800">
              Calendar
            </button>
            <button className="px-4 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700">
              Analysis
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-y-4 gap-x-2 text-center text-sm mb-2">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
            <div key={i} className="text-xs font-bold text-slate-400">
              {day}
            </div>
          ))}

          {/* Empty cells for starting day offset */}
          <div /> <div />

          {daysInMonth.map((day) => {
            const isPeriod = periodDays.includes(day);
            const isPredicted = predictedDays.includes(day);
            const isToday = day === currentDay;

            let bgClass = 'bg-transparent text-slate-700 hover:bg-slate-50';
            if (isPeriod) {
              bgClass = 'bg-rose-500 text-white shadow-md shadow-rose-200';
            } else if (isPredicted) {
              bgClass = 'bg-rose-100 text-rose-700 font-semibold';
            }

            return (
              <div
                key={day}
                className="flex justify-center items-center aspect-square"
              >
                <button
                  className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-300 font-medium ${bgClass} ${
                    isToday && !isPeriod ? 'ring-2 ring-rose-300 ring-offset-2' : ''
                  }`}
                >
                  {day}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button className="flex items-center justify-center gap-2 p-4 text-emerald-700 transition-colors bg-emerald-50 rounded-2xl hover:bg-emerald-100">
          <Beaker className="w-5 h-5" />
          <span className="font-bold text-sm font-manrope">Log Symptoms</span>
        </button>
        <button className="flex items-center justify-center gap-2 p-4 text-rose-700 transition-colors bg-rose-50 rounded-2xl hover:bg-rose-100">
          <Plus className="w-5 h-5" />
          <span className="font-bold text-sm font-manrope">Edit Dates</span>
        </button>
      </div>
    </div>
  );
}
