import React, { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, Apple, Activity, BrainCircuit } from 'lucide-react';

export const AIHealthPlanViewer: React.FC = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setTimeout(() => setProgress(75), 500);
  }, []);

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-white flex flex-col font-sans relative pb-20">
      <div className="absolute inset-0 bg-gradient-to-b from-teal-50/50 to-white -z-10" />

      <header className="p-6 pt-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
            Health Sanctuary <Sparkles className="w-5 h-5 text-teal-400" />
          </h1>
          <p className="text-sm text-slate-500 mt-1">Your AI-curated weekly path</p>
        </div>
        <img src="https://ui-avatars.com/api/?name=Rahim&background=f8fafc&color=0f172a" alt="Profile" className="w-10 h-10 rounded-full ring-2 ring-white shadow-sm" />
      </header>

      <main className="flex-1 p-6 space-y-6">
        {/* Progress Tracker Ring */}
        <div className="flex flex-col items-center justify-center p-6 bg-white rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-400 to-emerald-400" style={{ width: `${progress}%`, transition: 'width 1.5s ease-out' }} />
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90 pointer-events-none">
              <circle cx="64" cy="64" r="56" fill="none" stroke="#f1f5f9" strokeWidth="6" />
              <circle 
                cx="64" cy="64" r="56" 
                fill="none" 
                stroke="#2DD4BF" 
                strokeWidth="6" 
                strokeDasharray="351.8" 
                strokeDashoffset={351.8 - (351.8 * progress) / 100} 
                strokeLinecap="round" 
                className="transition-all duration-1500 ease-out" 
              />
            </svg>
            <div className="absolute text-center">
              <span className="text-3xl font-bold text-slate-800">{progress}%</span>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mt-1">Weekly Goal</p>
            </div>
          </div>
        </div>

        {/* Plan Sections */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 pl-1">This Week's Focus</h2>
          
          <div className="p-5 bg-white/60 backdrop-blur-xl rounded-3xl border border-slate-100 shadow-sm flex items-start gap-4">
            <div className="p-3 bg-rose-50 rounded-2xl text-rose-500 shrink-0">
              <Apple className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Diet & Nutrition</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Focus on anti-inflammatory foods this week. Try adding more turmeric and berries to your meals. Maintain 2L of water daily.</p>
              <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-400 px-3 py-1 bg-slate-50 rounded-full w-fit">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" /> Tracked today
              </div>
            </div>
          </div>

          <div className="p-5 bg-white/60 backdrop-blur-xl rounded-3xl border border-slate-100 shadow-sm flex items-start gap-4">
            <div className="p-3 bg-blue-50 rounded-2xl text-blue-500 shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Movement</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Low-impact recovery. Aim for a 20-minute restorative yoga session or a relaxed evening walk to keep joints mobile without stress.</p>
            </div>
          </div>

          <div className="p-5 bg-white/60 backdrop-blur-xl rounded-3xl border border-slate-100 shadow-sm flex items-start gap-4">
            <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-500 shrink-0">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Mind & Balance</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Log a 5-minute mindfulness session before bed. Write down 3 points of gratitude in your journal.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
