import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, Calendar, Heart, Sparkles, ChevronRight, Pill, Droplets, Utensils } from 'lucide-react';
import {
  getPregnancyInfo,
  getPregnancyNutritionTips,
  type PregnancyInfo,
  type NutritionTip,
} from '../../lib/pregnancy-utils';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

const TRIMESTER_COLORS = {
  1: { from: 'from-pink-500', to: 'to-rose-400', bg: 'bg-pink-50', text: 'text-pink-700', ring: 'ring-pink-300' },
  2: { from: 'from-violet-500', to: 'to-purple-400', bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-300' },
  3: { from: 'from-amber-500', to: 'to-orange-400', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-300' },
};

const TIP_ICONS: Record<string, React.ReactNode> = {
  pill: <Pill className="w-4 h-4" />,
  droplets: <Droplets className="w-4 h-4" />,
  heart: <Heart className="w-4 h-4" />,
  utensils: <Utensils className="w-4 h-4" />,
};

export function PregnancyModeWidget() {
  const { t, i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';
  const lang = isBn ? 'bn-BD' : 'en-US';

  const [lmpDate, setLmpDate] = useState<string>(() => {
    return localStorage.getItem('ozzyl_pregnancy_lmp') ? atob(localStorage.getItem('ozzyl_pregnancy_lmp')!) : '';
  });
  const [info, setInfo] = useState<PregnancyInfo | null>(null);
  const [tips, setTips] = useState<NutritionTip[]>([]);
  const [showSetup, setShowSetup] = useState(!lmpDate);

  useEffect(() => {
    if (!lmpDate) {
      setInfo(null);
      setTips([]);
      return;
    }
    const pregnancyInfo = getPregnancyInfo(lmpDate);
    setInfo(pregnancyInfo);
    if (pregnancyInfo) {
      setTips(getPregnancyNutritionTips(pregnancyInfo.trimester));
    }
  }, [lmpDate]);

  const handleSaveLmp = (date: string) => {
    localStorage.setItem('ozzyl_pregnancy_lmp', btoa(date));
    setLmpDate(date);
    setShowSetup(false);
  };

  const handleReset = () => {
    localStorage.removeItem('ozzyl_pregnancy_lmp');
    setLmpDate('');
    setInfo(null);
    setShowSetup(true);
  };

  // Setup screen
  if (showSetup || !info) {
    return (
      <div className="p-6 bg-gradient-to-br from-pink-50 to-rose-50 rounded-3xl border border-pink-100 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-pink-100 text-pink-600 rounded-2xl">
            <Baby className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{t('pregnancy.title')}</h3>
            <p className="text-sm text-gray-500">{t('pregnancy.subtitle')}</p>
          </div>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            {t('pregnancy.lmpLabel')}
          </label>
          <input
            type="date"
            value={lmpDate}
            onChange={(e) => setLmpDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-pink-200 bg-white text-sm focus:ring-2 focus:ring-pink-400 focus:border-pink-400 outline-none"
          />
          <button
            onClick={() => lmpDate && handleSaveLmp(lmpDate)}
            disabled={!lmpDate}
            className="w-full py-3 bg-pink-600 text-white font-bold rounded-xl hover:bg-pink-700 transition disabled:opacity-40"
          >
            {t('pregnancy.startTracking')}
          </button>
        </div>
      </div>
    );
  }

  const colors = TRIMESTER_COLORS[info.trimester];

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 shadow-sm">
      {/* Header gradient */}
      <div className={`bg-gradient-to-r ${colors.from} ${colors.to} p-6 text-white relative`}>
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full blur-xl" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <Baby className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider opacity-80">
                  {t('pregnancy.trimester', { num: info.trimester })}
                </p>
                <h3 className="text-xl font-black">
                  {t('pregnancy.weekDay', { 
                    week: info.currentWeek, 
                    day: info.currentDay 
                  })}
                </h3>
              </div>
            </div>
            <button
               onClick={handleReset}
               className="text-xs text-white/70 hover:text-white underline"
            >
              {t('pregnancy.reset')}
            </button>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1 opacity-80">
              <span>{t('pregnancy.progress')}</span>
              <span>{info.progressPercent}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-700"
                style={{ width: `${info.progressPercent}%` }}
              />
            </div>
          </div>

          {/* Due date */}
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" />
            <span>
              {t('pregnancy.due', { 
                date: formatPatientDateMonthYear(info.dueDate)
              })}
            </span>
            <span className="opacity-70">• {t('pregnancy.daysToGo', { count: info.daysUntilDue })}</span>
          </div>
        </div>
      </div>

      {/* Baby size milestone */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start gap-4">
          <div className={`p-3 ${colors.bg} rounded-2xl flex-shrink-0`}>
            <Sparkles className={`w-5 h-5 ${colors.text}`} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{t('pregnancy.babySizeHeading')}</p>
            <p className="text-lg font-bold text-gray-900">{isBn ? (info as any).size_bn : info.babySize}</p>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">{isBn ? (info as any).note_bn : info.developmentNote}</p>
          </div>
        </div>
      </div>

      {/* Nutrition tips */}
      {tips.length > 0 && (
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            {t('pregnancy.nutritionHeading', { num: info.trimester })}
          </p>
          <div className="space-y-3">
            {tips.map((tip, idx) => (
              <div key={idx} className={`p-4 ${colors.bg} rounded-2xl`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={colors.text}>{TIP_ICONS[tip.icon] ?? <Heart className="w-4 h-4" />}</span>
                  <span className={`text-sm font-bold ${colors.text}`}>{isBn ? tip.title_bn : tip.title}</span>
                </div>
                <p className="text-sm text-gray-700">{isBn ? tip.body_bn : tip.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
