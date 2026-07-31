import React from 'react';
import { Flame, Check, Plus } from 'lucide-react';

export const StreakTrackerWidget: React.FC = () => {
  const currentStreak = 14;
  
  // Past 7 days (true = logged, false = missed)
  const days = [true, true, true, true, false, true, true]; 
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="bg-surface-container-low rounded-xl p-6 shadow-sm border-none relative overflow-hidden font-inter">
      {/* Background ambient glow matching primary brand */}
      <div className="absolute top-0 right-0 w-48 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />

      <div className="flex flex-col items-center justify-center mb-6 pt-4 relative">
        <div className="relative mb-2">
          <Flame className="w-12 h-12 text-[#FF7A00] drop-shadow-md" />
          <div className="absolute inset-0 bg-[#FF7A00] opacity-20 blur-xl rounded-full" />
        </div>
        <h2 className="font-manrope text-3xl font-bold text-on-surface">{currentStreak} Days Fire</h2>
        <p className="text-sm text-on-surface-variant font-medium mt-1">Current wellness streak</p>
      </div>

      {/* 7-Day Visual Log */}
      <div className="flex justify-between items-center bg-surface p-4 rounded-2xl mb-6 relative">
        {days.map((logged, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div 
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                logged 
                  ? 'bg-primary/10 text-primary border border-primary/20' 
                  : 'bg-surface-container text-on-surface-variant/50'
              }`}
            >
              {logged ? <Check className="w-4 h-4" /> : <div className="w-1.5 h-1.5 rounded-full bg-current opacity-30" />}
            </div>
            <span className={`text-xs font-semibold ${logged ? 'text-primary' : 'text-on-surface-variant/50'}`}>
              {dayNames[i]}
            </span>
          </div>
        ))}
      </div>

      {/* CTA Button */}
      <button className="w-full py-4 bg-gradient-to-br border-none from-primary-container to-primary text-on-primary-container hover:brightness-105 transition-all shadow-md active:scale-[0.98] rounded-xl font-semibold text-lg flex justify-center items-center gap-2">
        <Check className="w-5 h-5 bg-on-primary-container/20 p-0.5 rounded-full" />
        Log Today's Habits
      </button>
    </div>
  );
};
