import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Activity, Calendar } from 'lucide-react';

export const ScoreTrendChart: React.FC = () => {
  const [view, setView] = useState<'weekly' | 'monthly'>('weekly');

  // Dummy data
  const currentScore = 88;
  const scoreChange = 4; // positive
  
  return (
    <div className="bg-surface-container-low rounded-xl p-6 shadow-sm border-none relative overflow-hidden font-inter">
      {/* Background ambient glow */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex justify-between items-start mb-6 relative">
        <div>
          <h2 className="font-manrope text-xl font-semibold text-on-surface flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Health Score Trend
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">Your overall wellness trajectory</p>
        </div>
        
        {/* Toggle */}
        <div className="flex bg-surface rounded-full p-1 shadow-inner border border-surface-container-highest">
          <button 
            onClick={() => setView('weekly')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${view === 'weekly' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Weekly
          </button>
          <button 
            onClick={() => setView('monthly')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${view === 'monthly' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Monthly
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 mb-8 relative">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-primary-container/30 flex items-center justify-center border-4 border-surface border-opacity-50">
            <span className="font-manrope text-4xl font-bold text-primary">{currentScore}</span>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
            {scoreChange > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {scoreChange > 0 ? `Improved by ${scoreChange}%` : `Declined by ${Math.abs(scoreChange)}%`}
          </div>
          <span className="text-sm text-on-surface-variant">Compared to last {view === 'weekly' ? 'week' : 'month'}</span>
        </div>
      </div>

      {/* Mock Chart Area */}
      <div className="h-40 w-full bg-surface rounded-xl border border-surface-container flex items-end justify-between p-4 relative overflow-hidden">
        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between p-4 opacity-10 pointer-events-none">
          <div className="w-full border-t border-on-surface" />
          <div className="w-full border-t border-on-surface" />
          <div className="w-full border-t border-on-surface" />
        </div>
        
        {/* Mock Bars */}
        {[65, 70, 72, 85, 82, 88, currentScore].map((val, i) => (
          <div key={i} className="w-8 flex flex-col justify-end items-center h-full gap-2 z-10 w-full max-w-[32px]">
            <div 
              className="w-full bg-primary/20 hover:bg-primary/40 rounded-t-md transition-all relative group cursor-pointer"
              style={{ height: `${val}%` }}
            >
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                {val}
              </div>
            </div>
            <span className="text-xs text-on-surface-variant">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</span>
          </div>
        ))}
      </div>
      
      {/* Insights */}
      <div className="mt-6 flex flex-col gap-3">
        <div className="bg-surface p-4 rounded-xl shadow-sm text-sm text-on-surface">
          <strong className="block text-primary mb-1">Insight</strong>
          Activity levels dipped on Tuesday, but consistent sleep hygiene pushed your score back up!
        </div>
      </div>
    </div>
  );
};
