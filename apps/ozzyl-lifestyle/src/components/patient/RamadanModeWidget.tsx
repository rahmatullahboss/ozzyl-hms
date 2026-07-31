import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Clock, Utensils } from 'lucide-react';
import { getRamadanInfo, getIftarCountdown, RAMADAN_MEAL_TYPES } from '../../lib/ramadan';

export function RamadanModeWidget() {
  const { t, i18n } = useTranslation('patientPortal');
  const info = getRamadanInfo();
  const [countdown, setCountdown] = useState(getIftarCountdown());

  useEffect(() => {
    if (!info.isRamadan) return;
    const intervalId = setInterval(() => {
      setCountdown(getIftarCountdown());
    }, 1000);
    return () => clearInterval(intervalId);
  }, [info.isRamadan]);

  if (!info.isRamadan) {
    return (
      <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl border border-slate-200 text-center">
        <Moon className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{t('ramadan.inactive')}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 text-white p-6 shadow-xl">
      {/* Decorative crescent */}
      <div className="absolute -top-8 -right-8 w-32 h-32 bg-amber-400/10 rounded-full blur-2xl" />
      <div className="absolute top-4 right-6 text-amber-400 opacity-40">
        <Moon className="w-16 h-16" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-amber-500/20 rounded-xl">
            <Moon className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">{t('ramadan.title')}</h3>
            <p className="text-xs text-purple-300">
              {t('ramadan.dayInfo', { 
                day: info.dayOfRamadan?.toLocaleString(i18n.language), 
                remaining: info.daysRemaining?.toLocaleString(i18n.language) 
              })}
            </p>
          </div>
        </div>

        {/* Sehri / Iftar Times */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Moon className="w-4 h-4 text-indigo-300" />
              <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">{t('ramadan.sehri')}</span>
            </div>
            <p className="text-2xl font-black tabular-nums tracking-tight">
              {info.sehriTime}
            </p>
            <p className="text-xs text-purple-400 mt-1">AM</p>
          </div>
          <div className="p-4 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sun className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">{t('ramadan.iftar')}</span>
            </div>
            <p className="text-2xl font-black tabular-nums tracking-tight">
              {info.iftarTime}
            </p>
            <p className="text-xs text-purple-400 mt-1">PM</p>
          </div>
        </div>

        {/* Iftar Countdown */}
        {countdown && (
          <div className="p-4 bg-gradient-to-r from-amber-500/20 to-orange-500/10 rounded-2xl border border-amber-500/20 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">{t('ramadan.countdown')}</span>
            </div>
            <div className="flex items-baseline gap-4 justify-center">
              <div className="text-center">
                <span className="text-3xl font-black tabular-nums">{countdown.hours.toLocaleString(i18n.language, { minimumIntegerDigits: 2 })}</span>
                <p className="text-[10px] text-amber-400/70 uppercase mt-1">{t('ramadan.hours')}</p>
              </div>
              <span className="text-2xl font-light text-amber-400/50">:</span>
              <div className="text-center">
                <span className="text-3xl font-black tabular-nums">{countdown.minutes.toLocaleString(i18n.language, { minimumIntegerDigits: 2 })}</span>
                <p className="text-[10px] text-amber-400/70 uppercase mt-1">{t('ramadan.min')}</p>
              </div>
              <span className="text-2xl font-light text-amber-400/50">:</span>
              <div className="text-center">
                <span className="text-3xl font-black tabular-nums">{countdown.seconds.toLocaleString(i18n.language, { minimumIntegerDigits: 2 })}</span>
                <p className="text-[10px] text-amber-400/70 uppercase mt-1">{t('ramadan.sec')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Meal Log */}
        <div className="flex gap-2">
          {RAMADAN_MEAL_TYPES.map((meal) => (
            <button
              key={meal.key}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold transition-colors border border-white/5"
            >
              <Utensils className="w-3.5 h-3.5" />
              {t(meal.label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
