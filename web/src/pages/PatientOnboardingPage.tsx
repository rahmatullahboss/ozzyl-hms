import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Bot } from 'lucide-react';
import { useOnboardingState, type OnboardingData } from '../hooks/useOnboardingState';

const GOAL_KEYS = [
  'goalActive', 'goalEat', 'goalSleep', 'goalMind',
  'goalMeds', 'goalWeight', 'goalBpDiabetes', 'goalPregnancy',
] as const;

export default function PatientOnboardingPage() {
  const { t, i18n } = useTranslation('patientPortal');
  const navigate = useNavigate();
  const { step, setStep, data, updateData, next, back, toggleGoal } = useOnboardingState();
  const [submitting, setSubmitting] = useState(false);

  async function handleComplete() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/patient-auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          language: data.language,
          name: data.name,
          gender: data.gender,
          height_cm: data.height_cm ? parseFloat(data.height_cm) : null,
          weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
          goals: data.goals,
          skip_hospital: data.skipHospital,
          permissions: data.permissions,
        }),
      });
      if (res.ok) {
        navigate('/patient/home', { replace: true });
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setSubmitting(false);
    }
  }

  function handleLanguageSelect(lang: 'bn' | 'en') {
    updateData({ language: lang });
    i18n.changeLanguage(lang);
    next();
  }

  // Progress bar for steps 1-6
  const progress = step > 0 ? (step / 6) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Progress bar */}
      {step > 0 && (
        <div className="h-1 bg-slate-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Back button */}
      {step > 0 && (
        <button
          onClick={back}
          className="absolute top-4 left-4 z-10 p-2 rounded-full hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Screen 0: Welcome */}
        {step === 0 && (
          <div className="text-center space-y-8 max-w-sm">
            <div className="text-5xl font-bold text-emerald-400">OzzyLife</div>
            <p className="text-lg text-slate-300">{t('onboarding.welcome')}</p>
            <div className="space-y-3">
              <button
                onClick={next}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-colors"
              >
                {t('onboarding.getStarted')}
              </button>
              <button
                onClick={() => navigate('/patient/login')}
                className="w-full py-3 text-slate-400 hover:text-white transition-colors"
              >
                {t('onboarding.haveAccount')}
              </button>
            </div>
          </div>
        )}

        {/* Screen 1: Language */}
        {step === 1 && (
          <div className="text-center space-y-8 max-w-sm">
            <h2 className="text-xl font-semibold">{t('onboarding.chooseLanguage')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleLanguageSelect('bn')}
                className={`py-6 rounded-xl text-lg font-bold transition-all ${
                  data.language === 'bn' ? 'bg-emerald-600 ring-2 ring-emerald-400' : 'bg-slate-800 hover:bg-slate-700'
                }`}
              >
                বাংলা
              </button>
              <button
                onClick={() => handleLanguageSelect('en')}
                className={`py-6 rounded-xl text-lg font-bold transition-all ${
                  data.language === 'en' ? 'bg-emerald-600 ring-2 ring-emerald-400' : 'bg-slate-800 hover:bg-slate-700'
                }`}
              >
                English
              </button>
            </div>
          </div>
        )}

        {/* Screen 2: About You */}
        {step === 2 && (
          <div className="w-full max-w-sm space-y-6">
            <h2 className="text-xl font-semibold text-center">{t('onboarding.aboutYou')}</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">{t('onboarding.name')}</label>
                <input
                  type="text"
                  value={data.name}
                  onChange={(e) => updateData({ name: e.target.value })}
                  className="w-full bg-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">{t('onboarding.age')}</label>
                <input
                  type="number"
                  value={data.age}
                  onChange={(e) => updateData({ age: e.target.value })}
                  className="w-full bg-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-2 block">{t('onboarding.gender')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['male', 'female', 'other'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => updateData({ gender: g })}
                      className={`py-2 rounded-xl text-sm font-medium transition-all ${
                        data.gender === g ? 'bg-emerald-600' : 'bg-slate-800 hover:bg-slate-700'
                      }`}
                    >
                      {t(`onboarding.${g}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 mb-1 block">{t('onboarding.height')} (cm)</label>
                  <input
                    type="number"
                    value={data.height_cm}
                    onChange={(e) => updateData({ height_cm: e.target.value })}
                    className="w-full bg-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-400 mb-1 block">{t('onboarding.weight')} (kg)</label>
                  <input
                    type="number"
                    value={data.weight_kg}
                    onChange={(e) => updateData({ weight_kg: e.target.value })}
                    className="w-full bg-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={next}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-colors"
            >
              {t('onboarding.continue')}
            </button>
          </div>
        )}

        {/* Screen 3: Goals */}
        {step === 3 && (
          <div className="w-full max-w-sm space-y-6">
            <h2 className="text-xl font-semibold text-center">{t('onboarding.yourGoals')}</h2>
            <p className="text-center text-sm text-slate-400">Max 3</p>
            <div className="grid grid-cols-2 gap-3">
              {GOAL_KEYS.map((key) => {
                const selected = data.goals.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleGoal(key)}
                    className={`py-3 px-4 rounded-xl text-sm font-medium text-left transition-all ${
                      selected
                        ? 'bg-emerald-600 ring-2 ring-emerald-400'
                        : 'bg-slate-800 hover:bg-slate-700'
                    } ${!selected && data.goals.length >= 3 ? 'opacity-50' : ''}`}
                  >
                    {t(`onboarding.${key}`)}
                  </button>
                );
              })}
            </div>
            <button
              onClick={next}
              disabled={data.goals.length === 0}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('onboarding.continue')}
            </button>
          </div>
        )}

        {/* Screen 4: Hospital Connection */}
        {step === 4 && (
          <div className="text-center space-y-6 max-w-sm">
            <h2 className="text-xl font-semibold">{t('onboarding.connectHospital')}</h2>
            <p className="text-slate-400">{t('onboarding.connectDesc')}</p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  updateData({ skipHospital: false });
                  next();
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-colors"
              >
                {t('onboarding.connectCta')}
              </button>
              <button
                onClick={() => {
                  updateData({ skipHospital: true });
                  next();
                }}
                className="w-full py-3 text-slate-400 hover:text-white transition-colors"
              >
                {t('onboarding.skipForNow')}
              </button>
            </div>
          </div>
        )}

        {/* Screen 5: Permissions */}
        {step === 5 && (
          <div className="w-full max-w-sm space-y-6">
            <h2 className="text-xl font-semibold text-center">{t('onboarding.permissions')}</h2>
            <div className="space-y-3">
              {([
                { key: 'notifications' as const, label: t('onboarding.permNotifications') },
                { key: 'health' as const, label: t('onboarding.permHealth') },
                { key: 'camera' as const, label: t('onboarding.permCamera') },
                { key: 'biometric' as const, label: t('onboarding.permBiometric') },
              ]).map((perm) => (
                <button
                  key={perm.key}
                  onClick={() =>
                    updateData({
                      permissions: {
                        ...data.permissions,
                        [perm.key]: !data.permissions[perm.key],
                      },
                    })
                  }
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                    data.permissions[perm.key] ? 'bg-emerald-900/50 ring-1 ring-emerald-500' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${
                    data.permissions[perm.key] ? 'bg-emerald-500 text-white' : 'bg-slate-600'
                  }`}>
                    {data.permissions[perm.key] ? '✓' : ''}
                  </div>
                  <span className="text-sm">{perm.label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() =>
                  updateData({
                    permissions: { notifications: true, health: true, camera: true, biometric: true },
                  })
                }
                className="py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-semibold transition-colors"
              >
                {t('onboarding.allowAll')}
              </button>
              <button
                onClick={next}
                className="py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors"
              >
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        )}

        {/* Screen 6: Meet Ozzy */}
        {step === 6 && (
          <div className="text-center space-y-8 max-w-sm">
            <h2 className="text-xl font-semibold">{t('onboarding.meetOzzy')}</h2>
            <div className="w-20 h-20 mx-auto bg-emerald-600 rounded-full flex items-center justify-center">
              <Bot className="w-10 h-10 text-white" />
            </div>
            <p className="text-slate-300">{t('onboarding.ozzyIntro')}</p>
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition-colors disabled:opacity-60"
            >
              {submitting ? '...' : t('onboarding.startJourney')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
