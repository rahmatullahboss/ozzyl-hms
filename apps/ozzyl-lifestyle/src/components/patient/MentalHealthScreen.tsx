import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, AlertTriangle } from 'lucide-react';
import { useLogMentalHealthScreening } from '../../hooks/usePatientWellness';

type ScreeningType = 'phq9' | 'gad7';

const PHQ9_QUESTIONS = Array.from({ length: 9 }, (_, i) => `q${i + 1}`);
const GAD7_QUESTIONS = Array.from({ length: 7 }, (_, i) => `q${i + 1}`);

const FREQUENCY_OPTIONS = [
  { value: 0, key: 'notAtAll' },
  { value: 1, key: 'severalDays' },
  { value: 2, key: 'moreThanHalf' },
  { value: 3, key: 'nearlyEveryDay' },
];

function classifyPHQ9(score: number): { labelKey: string; severity: string; color: string } {
  if (score <= 4) return { labelKey: 'mentalHealth.severity.minimal', severity: 'minimal', color: 'text-emerald-600 bg-emerald-50' };
  if (score <= 9) return { labelKey: 'mentalHealth.severity.mild', severity: 'mild', color: 'text-amber-600 bg-amber-50' };
  if (score <= 14) return { labelKey: 'mentalHealth.severity.moderate', severity: 'moderate', color: 'text-orange-600 bg-orange-50' };
  if (score <= 19) return { labelKey: 'mentalHealth.severity.moderatelySevere', severity: 'moderately_severe', color: 'text-red-600 bg-red-50' };
  return { labelKey: 'mentalHealth.severity.severe', severity: 'severe', color: 'text-red-700 bg-red-100' };
}

function classifyGAD7(score: number): { labelKey: string; severity: string; color: string } {
  if (score <= 4) return { labelKey: 'mentalHealth.severity.minimal', severity: 'minimal', color: 'text-emerald-600 bg-emerald-50' };
  if (score <= 9) return { labelKey: 'mentalHealth.severity.mild', severity: 'mild', color: 'text-amber-600 bg-amber-50' };
  if (score <= 14) return { labelKey: 'mentalHealth.severity.moderate', severity: 'moderate', color: 'text-orange-600 bg-orange-50' };
  return { labelKey: 'mentalHealth.severity.severe', severity: 'severe', color: 'text-red-700 bg-red-100' };
}

export default function MentalHealthScreen() {
  const { t } = useTranslation('patientPortal');

  const [screeningType, setScreeningType] = useState<ScreeningType>('phq9');
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; classification: ReturnType<typeof classifyPHQ9> } | null>(null);
  const { mutateAsync: logScreening, isPending: submitting } = useLogMentalHealthScreening();

  const questions = screeningType === 'phq9' ? PHQ9_QUESTIONS : GAD7_QUESTIONS;
  const classify = screeningType === 'phq9' ? classifyPHQ9 : classifyGAD7;

  const handleAnswer = useCallback((value: number) => {
    const newAnswers = [...answers, value];
    setAnswers(newAnswers);

    if (newAnswers.length >= questions.length) {
      // Calculate score and submit
      const score = newAnswers.reduce((s, v) => s + v, 0);
      const classification = classify(score);
      setResult({ score, classification });

      // Save to API
      void (async () => {
        try {
          await logScreening({
            type: screeningType,
            answers: newAnswers,
          });
        } catch { /* ignore */ }
      })();
    } else {
      setCurrentQ(currentQ + 1);
    }
  }, [answers, currentQ, questions, classify, screeningType]);

  const restart = useCallback(() => {
    setAnswers([]);
    setCurrentQ(0);
    setResult(null);
  }, []);

  // Result screen
  if (result) {
    const isHighRisk = result.score >= 15;
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4 text-center">
        <Brain className="w-10 h-10 text-violet-500 mx-auto" />
        <h3 className="font-bold text-slate-900">
          {screeningType === 'phq9' ? 'PHQ-9' : 'GAD-7'} {t('mentalHealth.resultLabel')}
        </h3>
        <div className="text-3xl font-bold text-slate-900">{result.score}/{screeningType === 'phq9' ? 27 : 21}</div>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${result.classification.color}`}>
          {t(result.classification.labelKey)}
        </span>

        {isHighRisk && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-left">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-red-700 font-medium">
                  {t('mentalHealth.highRiskWarning')}
                </p>
                <p className="text-xs text-red-600 mt-1">📞 {t('mentalHealth.helplineName')}: 01779-554391</p>
              </div>
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-400">
          {t('mentalHealth.disclaimer')}
        </p>

        <div className="flex gap-2">
          <button onClick={restart} className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium">
            {t('mentalHealth.retakeBtn')}
          </button>
          <button
            onClick={() => { setScreeningType(screeningType === 'phq9' ? 'gad7' : 'phq9'); restart(); }}
            className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium"
          >
            {screeningType === 'phq9' ? t('mentalHealth.takeGad7Btn') : t('mentalHealth.takePhq9Btn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-500" />
          {screeningType === 'phq9' ? 'PHQ-9' : 'GAD-7'}
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => { if (answers.length === 0) { setScreeningType('phq9'); restart(); } }}
            className={`px-2 py-1 text-[10px] rounded-lg font-medium ${screeningType === 'phq9' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            PHQ-9
          </button>
          <button
            onClick={() => { if (answers.length === 0) { setScreeningType('gad7'); restart(); } }}
            className={`px-2 py-1 text-[10px] rounded-lg font-medium ${screeningType === 'gad7' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            GAD-7
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-1">
        {questions.map((_, i) => (
          <div key={i} className={`flex-1 h-1 rounded-full ${i < currentQ ? 'bg-violet-500' : i === currentQ ? 'bg-violet-300' : 'bg-slate-200'}`} />
        ))}
      </div>

      {/* Question */}
      <div>
        <p className="text-xs text-slate-400 mb-1">
          {t('mentalHealth.questionProgress', { current: currentQ + 1, total: questions.length })}
        </p>
        <p className="text-sm font-medium text-slate-900 mb-1">
          {t('mentalHealth.durationHint')}
        </p>
        <p className="text-sm text-slate-700">{t(`mentalHealth.${screeningType}.${questions[currentQ]}`)}</p>
      </div>

      {/* Answer options */}
      <div className="space-y-2">
        {FREQUENCY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleAnswer(opt.value)}
            className="w-full text-left p-3 bg-slate-50 rounded-xl hover:bg-violet-50 hover:border-violet-200 border border-transparent transition-colors text-sm"
          >
            <span className="font-medium text-slate-700">{opt.value}.</span>{' '}
            {t(`mentalHealth.options.${opt.key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
