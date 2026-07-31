import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Droplets, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCycleHistory, useLogCycle } from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

interface CycleDayLog {
  date: string;
  flow_level?: number; // 1-4
  symptoms?: string[];
  notes?: string;
}

const SYMPTOMS = [
  { key: 'cramps', label: 'cycleTracker.symptomNames.cramps' },
  { key: 'headache', label: 'cycleTracker.symptomNames.headache' },
  { key: 'bloating', label: 'cycleTracker.symptomNames.bloating' },
  { key: 'fatigue', label: 'cycleTracker.symptomNames.fatigue' },
  { key: 'mood_swings', label: 'cycleTracker.symptomNames.mood_swings' },
  { key: 'back_pain', label: 'cycleTracker.symptomNames.back_pain' },
  { key: 'breast_tenderness', label: 'cycleTracker.symptomNames.breast_tenderness' },
  { key: 'acne', label: 'cycleTracker.symptomNames.acne' },
];

const FLOW_LEVELS = [
  { value: 1, label: 'cycleTracker.flowLevels.light', color: 'bg-pink-200' },
  { value: 2, label: 'cycleTracker.flowLevels.medium', color: 'bg-pink-400' },
  { value: 3, label: 'cycleTracker.flowLevels.heavy', color: 'bg-pink-600' },
  { value: 4, label: 'cycleTracker.flowLevels.veryHeavy', color: 'bg-pink-800' },
];

export default function CycleTracker() {
  const { t, i18n } = useTranslation('patientPortal');
  const lang = i18n.language === 'bn' ? 'bn-BD' : 'en-US';

  const [logs, setLogs] = useState<CycleDayLog[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [flowLevel, setFlowLevel] = useState<number>(0);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [showLogForm, setShowLogForm] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data: historyData } = useCycleHistory();
  const { mutateAsync: logCycle } = useLogCycle();

  // Combine fetched data with local fallback calculation
  const { avgCycleLength, nextPredicted, mappedLogs } = useMemo(() => {
    let localAvg = 28;
    let localNext: string | null = null;
    let fallbackLogs: CycleDayLog[] = [];

    if (historyData) {
      fallbackLogs = (historyData.cycles || []).flatMap((cycle) => {
        const symptoms = Array.isArray(cycle.symptoms)
          ? cycle.symptoms
          : typeof cycle.symptoms === 'string' && cycle.symptoms.trim()
            ? JSON.parse(cycle.symptoms) as string[]
            : [];
        const flow_level =
          cycle.flow_intensity === 'heavy' ? 3 : cycle.flow_intensity === 'medium' ? 2 : cycle.flow_intensity === 'light' ? 1 : undefined;

        return [{ date: cycle.start_date, flow_level, symptoms }];
      });

      const sortedStarts = (historyData.cycles || []).map((c) => c.start_date).filter(Boolean).sort();

      if (historyData.avg_cycle_length) {
        localAvg = historyData.avg_cycle_length;
      } else if (sortedStarts.length >= 2) {
        const diffs = sortedStarts.slice(1).map((date, index) => {
          const prev = new Date(sortedStarts[index]);
          const curr = new Date(date);
          return Math.max(1, Math.round((curr.getTime() - prev.getTime()) / 86_400_000));
        });
        localAvg = Math.round(diffs.reduce((sum, val) => sum + val, 0) / diffs.length);
      }

      if (historyData.next_predicted) {
        localNext = historyData.next_predicted;
      } else if (sortedStarts.length > 0) {
        const latest = new Date(sortedStarts[sortedStarts.length - 1]);
        latest.setDate(latest.getDate() + localAvg);
        localNext = latest.toISOString().slice(0, 10);
      }
    }

    return { avgCycleLength: localAvg, nextPredicted: localNext, mappedLogs: fallbackLogs };
  }, [historyData]);

  useEffect(() => {
    setLogs(mappedLogs);
  }, [mappedLogs]);

  const handleLog = useCallback(async () => {
    try {
      await logCycle({
        start_date: selectedDate,
        end_date: selectedDate,
        flow_intensity: flowLevel >= 3 ? 'heavy' : flowLevel === 2 ? 'medium' : flowLevel === 1 ? 'light' : undefined,
        symptoms: selectedSymptoms.length > 0 ? selectedSymptoms : undefined,
      });

      setLogs((prev) => [...prev, { date: selectedDate, flow_level: flowLevel || undefined, symptoms: selectedSymptoms }]);
      setShowLogForm(false);
      setFlowLevel(0);
      setSelectedSymptoms([]);
    } catch { /* ignore */ }
  }, [selectedDate, flowLevel, selectedSymptoms, logCycle]);

  // Calendar generation
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const periodDates = new Set(logs.filter((l) => l.flow_level && l.flow_level > 0).map((l) => l.date));

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Droplets className="w-4 h-4 text-pink-500" />
          {t('cycleTracker.title')}
        </h3>
        <button
          onClick={() => setShowLogForm(!showLogForm)}
          className="text-xs text-pink-600 font-semibold hover:underline"
        >
          {showLogForm ? t('cycleTracker.cancel') : `+ ${t('cycleTracker.log')}`}
        </button>
      </div>

      {/* Prediction */}
      {nextPredicted && (
        <div className="bg-pink-50 rounded-xl p-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500" />
          <div>
            <p className="text-xs font-semibold text-pink-700">
              {t('cycleTracker.nextPeriod')}
            </p>
            <p className="text-sm font-bold text-pink-900">
              {formatPatientDateMonthYear(nextPredicted)}
            </p>
            <p className="text-[10px] text-pink-500">{t('cycleTracker.avgCycle', { count: avgCycleLength })}</p>
          </div>
        </div>
      )}

      {/* Mini calendar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button onClick={prevMonth} className="p-1 hover:bg-slate-100 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
          <p className="text-sm font-semibold text-slate-700">
            {currentMonth.toLocaleDateString(lang, { month: 'long', year: 'numeric' })}
          </p>
          <button onClick={nextMonth} className="p-1 hover:bg-slate-100 rounded-lg"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-slate-400 font-medium py-1">{d}</div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPeriod = periodDates.has(dateStr);
            const isToday = dateStr === new Date().toISOString().slice(0, 10);
            return (
              <button
                key={day}
                onClick={() => { setSelectedDate(dateStr); setShowLogForm(true); }}
                className={`py-1 rounded-full text-xs transition-colors ${
                  isPeriod ? 'bg-pink-500 text-white font-bold' :
                  isToday ? 'bg-slate-200 font-bold' :
                  'hover:bg-slate-100'
                }`}
              >
                {day.toLocaleString(i18n.language)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Log form */}
      {showLogForm && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">{t('cycleTracker.date')}: <span className="font-semibold">{formatPatientDateMonthYear(selectedDate)}</span></p>

          {/* Flow level */}
          <div>
            <p className="text-xs text-slate-500 mb-1">{t('cycleTracker.flow')}</p>
            <div className="flex gap-2">
              {FLOW_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => setFlowLevel(flowLevel === level.value ? 0 : level.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    flowLevel === level.value ? `${level.color} text-white` : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {t(level.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Symptoms */}
          <div>
            <p className="text-xs text-slate-500 mb-1">{t('cycleTracker.symptoms')}</p>
            <div className="flex flex-wrap gap-1.5">
              {SYMPTOMS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSelectedSymptoms((prev) =>
                    prev.includes(s.key) ? prev.filter((x) => x !== s.key) : [...prev, s.key]
                  )}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    selectedSymptoms.includes(s.key) ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleLog}
            disabled={!flowLevel && selectedSymptoms.length === 0}
            className="w-full py-2.5 bg-pink-600 text-white rounded-xl text-sm font-semibold hover:bg-pink-500 disabled:opacity-50 transition-colors"
          >
            {t('cycleTracker.save')}
          </button>
        </div>
      )}
    </div>
  );
}
