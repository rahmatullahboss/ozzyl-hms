import React from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  Footprints, 
  Flame, 
  Moon, 
  Droplet, 
  Clock, 
  Smile, 
  Activity 
} from 'lucide-react';
import { 
  useDailyTotals, 
  useActivityLogs, 
  useWellnessScoreTrend 
} from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

const glassCard = "bg-[#f7f9fb]/70 backdrop-blur-3xl rounded-[2rem] border border-[#bacac5]/15 p-6 shadow-[0px_20px_40px_rgba(25,28,30,0.06)]";

export function DailyHealthSummary() {
  const { t, i18n } = useTranslation('patientPortal');
  const lang = i18n.language === 'bn' ? 'bn-BD' : 'en-US';
  const today = new Date().toISOString().slice(0, 10);
  
  const { data: totals, isLoading: loadingTotals } = useDailyTotals(today);
  const { data: activityData, isLoading: loadingActivities } = useActivityLogs(today);
  const { data: trendData, isLoading: loadingTrends } = useWellnessScoreTrend(7);

  const steps = totals?.steps || 0;
  const cals = totals?.rings.move.current || 0;
  const sleepHrs = Math.floor((totals?.sleep_min || 0) / 60);
  const sleepMins = (totals?.sleep_min || 0) % 60;
  const glasses = Math.floor((totals?.water_ml || 0) / 250);

  const activities = activityData?.logs || [];
  
  // Format trend data for mood chart
  const chartData = [...(trendData?.trend || [])].reverse().map((t: any) => ({
    name: formatPatientDateMonthYear(t.date),
    score: t.total_score || 0
  }));

  if (loadingTotals || loadingActivities || loadingTrends) {
    return (
      <div className="flex justify-center items-center h-48 animate-pulse text-[#006b5f]">
        {t('dailySummary.loading')}
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 font-['Be_Vietnam_Pro'] text-[#191c1e]">
      
      {/* Header */}
      <div className="flex flex-col gap-1 px-2">
        <p className="text-sm font-medium text-[#635c61]">{t('dailySummary.breadcrumb')}</p>
        <h1 className="font-['Manrope'] text-3xl font-light tracking-tight text-[#00201c]">{t('dailySummary.title')}</h1>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Steps */}
        <div className={glassCard + " flex items-center justify-between"}>
          <div>
            <p className="text-sm font-medium text-[#3c4a46] mb-1">{t('dailySummary.stepsWalked')}</p>
            <p className="font-['Manrope'] text-2xl font-semibold text-[#006b5f]">
              {steps.toLocaleString(lang)} <span className="text-sm font-light text-[#6b7a76]">/ {(10000).toLocaleString(lang)}</span>
            </p>
          </div>
          <div className="p-3 bg-gradient-to-br from-[#006b5f] to-[#2dd4bf] rounded-full text-white shadow-md">
            <Footprints className="w-6 h-6" />
          </div>
        </div>

        {/* Calories */}
        <div className={glassCard + " flex items-center justify-between"}>
          <div>
            <p className="text-sm font-medium text-[#3c4a46] mb-1">{t('dailySummary.activeCalories')}</p>
            <p className="font-['Manrope'] text-2xl font-semibold text-[#006b5f]">
              {cals.toLocaleString(lang)} <span className="text-sm font-light text-[#6b7a76]">{t('nutrition.kcal')}</span>
            </p>
          </div>
          <div className="p-3 bg-[#fdd0ea] text-[#79576c] rounded-full shadow-sm">
            <Flame className="w-6 h-6" />
          </div>
        </div>

        {/* Sleep */}
        <div className={glassCard + " flex items-center justify-between"}>
          <div>
            <p className="text-sm font-medium text-[#3c4a46] mb-1">{t('dailySummary.sleepDuration')}</p>
            <p className="font-['Manrope'] text-2xl font-semibold text-[#006b5f]">
              {sleepHrs.toLocaleString(lang)}{t('common.hoursAbbr') || 'h'} {sleepMins.toLocaleString(lang)}{t('common.minsAbbr') || 'm'}
            </p>
          </div>
          <div className="p-3 bg-[#e0e3e5] text-[#2d3133] rounded-full shadow-sm">
            <Moon className="w-6 h-6" />
          </div>
        </div>

        {/* Hydration */}
        <div className={glassCard + " flex items-center justify-between"}>
          <div>
            <p className="text-sm font-medium text-[#3c4a46] mb-1">{t('dailySummary.hydration')}</p>
            <p className="font-['Manrope'] text-2xl font-semibold text-[#006b5f]">
              {glasses.toLocaleString(lang)} <span className="text-sm font-light text-[#6b7a76]">{t('dailySummary.glasses')}</span>
            </p>
          </div>
          <div className="p-3 bg-[#eff1f3] text-[#3cddc7] rounded-full shadow-sm">
            <Droplet className="w-6 h-6" />
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Timeline */}
        <div className={`col-span-1 lg:col-span-2 ${glassCard} p-8`}>
          <div className="flex items-center gap-3 mb-6">
            <Activity className="w-6 h-6 text-[#006b5f]" />
            <h2 className="font-['Manrope'] text-xl font-medium tracking-tight">{t('dailySummary.timelineTitle')}</h2>
          </div>
          
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[#bacac5] before:to-transparent">
            {activities.length > 0 ? activities.map((log: any, idx: number) => (
              <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#ffffff] bg-[#2dd4bf] text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-[#ffffff] p-4 rounded-xl shadow-sm border border-[#bacac5]/10">
                  <div className="flex items-center justify-between mb-1">
                    <time className="text-xs font-semibold text-[#006b5f] uppercase">
                      {new Date(log.logged_at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  <p className="text-[#3c4a46] font-medium capitalize">{(log.activity_type || 'unknown activity').replace('_', ' ')}</p>
                  <p className="text-sm text-[#635c61]">{log.duration_min.toLocaleString(lang)} {t('dailySummary.mins')}</p>
                </div>
              </div>
            )) : (
              <p className="text-center text-[#635c61] italic py-8">{t('dailySummary.noActivities')}</p>
            )}
          </div>
        </div>

        {/* Mood Tracking */}
        <div className={`col-span-1 ${glassCard} p-8 flex flex-col`}>
          <div className="flex items-center gap-3 mb-6">
            <Smile className="w-6 h-6 text-[#79576c]" />
            <h2 className="font-['Manrope'] text-xl font-medium tracking-tight">{t('dailySummary.recentMoodTitle')}</h2>
          </div>
          
          <div className="flex-1 min-h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6b7a76', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#6b7a76', fontSize: 12}} domain={['dataMin - 10', 100]} />
                <Tooltip 
                   contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                   itemStyle={{ color: '#006b5f' }}
                   cursor={{ stroke: '#bacac5', strokeWidth: 1, strokeDasharray: '4 4' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#2dd4bf" 
                  strokeWidth={4} 
                  dot={{ r: 4, fill: '#006b5f', strokeWidth: 0 }} 
                  activeDot={{ r: 6, fill: '#62fae3' }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-6 flex justify-around p-4 bg-[#ffffff] rounded-2xl border border-[#bacac5]/10 shadow-sm">
            <div className="text-center">
              <span className="text-2xl block mb-1">🧘‍♂️</span>
              <span className="text-xs font-semibold text-[#006b5f]">{t('dailySummary.moodCalm')}</span>
            </div>
            <div className="text-center">
              <span className="text-2xl block mb-1">⚡</span>
              <span className="text-xs font-semibold text-[#79576c]">{t('dailySummary.moodEnergetic')}</span>
            </div>
            <div className="text-center">
              <span className="text-2xl block mb-1">🎯</span>
              <span className="text-xs font-semibold text-[#3cddc7]">{t('dailySummary.moodFocused')}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
