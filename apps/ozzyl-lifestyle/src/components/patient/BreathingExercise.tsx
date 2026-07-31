import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Wind } from 'lucide-react';

type BreathPattern = 'box' | '478' | 'belly';

const PATTERNS: Record<BreathPattern, { inhale: number; hold1: number; exhale: number; hold2: number; bn: string; en: string }> = {
  box:   { inhale: 4, hold1: 4, exhale: 4, hold2: 4, bn: 'বক্স ব্রিদিং', en: 'Box Breathing' },
  '478': { inhale: 4, hold1: 7, exhale: 8, hold2: 0, bn: '৪-৭-৮ ব্রিদিং', en: '4-7-8 Breathing' },
  belly: { inhale: 4, hold1: 2, exhale: 6, hold2: 2, bn: 'বেলি ব্রিদিং', en: 'Belly Breathing' },
};

type Phase = 'inhale' | 'hold1' | 'exhale' | 'hold2' | 'idle';

const PHASE_LABELS: Record<Phase, { bn: string; en: string }> = {
  inhale: { bn: 'শ্বাস নিন', en: 'Breathe In' },
  hold1:  { bn: 'ধরে রাখুন', en: 'Hold' },
  exhale: { bn: 'ছাড়ুন', en: 'Breathe Out' },
  hold2:  { bn: 'ধরে রাখুন', en: 'Hold' },
  idle:   { bn: 'প্রস্তুত', en: 'Ready' },
};

export default function BreathingExercise() {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const [pattern, setPattern] = useState<BreathPattern>('box');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [timer, setTimer] = useState(0);
  const [cycles, setCycles] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const p = PATTERNS[pattern];
  const totalCycle = p.inhale + p.hold1 + p.exhale + p.hold2;

  const getPhaseForTime = useCallback((t: number): Phase => {
    const pos = t % totalCycle;
    if (pos < p.inhale) return 'inhale';
    if (pos < p.inhale + p.hold1) return 'hold1';
    if (pos < p.inhale + p.hold1 + p.exhale) return 'exhale';
    return 'hold2';
  }, [p, totalCycle]);

  const start = useCallback(() => {
    setRunning(true);
    setTimer(0);
    setCycles(0);
    setPhase('inhale');
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    setPhase('idle');
    setTimer(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setTimer((prev) => {
        const next = prev + 1;
        const newPhase = getPhaseForTime(next);
        setPhase(newPhase);
        if (next > 0 && next % totalCycle === 0) {
          setCycles((c) => c + 1);
        }
        return next;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, getPhaseForTime, totalCycle]);

  // Circle scale based on phase
  const scale = phase === 'inhale' ? 1.3 : phase === 'exhale' ? 0.7 : 1;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <Wind className="w-5 h-5 text-cyan-500" />
        <h3 className="font-bold text-slate-900">{isBn ? 'শ্বাস-প্রশ্বাস' : 'Breathing'}</h3>
      </div>

      {/* Pattern selector */}
      <div className="flex gap-2">
        {(Object.entries(PATTERNS) as [BreathPattern, typeof PATTERNS['box']][]).map(([key, val]) => (
          <button
            key={key}
            onClick={() => { if (!running) setPattern(key); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              pattern === key ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isBn ? val.bn : val.en}
          </button>
        ))}
      </div>

      {/* Breathing circle */}
      <div className="flex flex-col items-center py-4">
        <div
          className="w-32 h-32 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center transition-transform duration-1000 ease-in-out"
          style={{ transform: `scale(${scale})` }}
        >
          <div className="text-center text-white">
            <p className="text-lg font-bold">{isBn ? PHASE_LABELS[phase].bn : PHASE_LABELS[phase].en}</p>
            {running && <p className="text-sm opacity-80">{Math.floor(timer % totalCycle)}s</p>}
          </div>
        </div>

        {running && (
          <p className="mt-4 text-xs text-slate-500">
            {isBn ? `সাইকেল: ${cycles}` : `Cycles: ${cycles}`}
          </p>
        )}
      </div>

      {/* Start/Stop */}
      <button
        onClick={running ? stop : start}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
          running ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-cyan-600 text-white hover:bg-cyan-500'
        }`}
      >
        {running ? (isBn ? 'থামুন' : 'Stop') : (isBn ? 'শুরু করুন' : 'Start')}
      </button>
    </div>
  );
}
