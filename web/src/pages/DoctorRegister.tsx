import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { setAccessToken } from '../lib/tokenStore';

const API = import.meta.env.VITE_API_URL || '';

interface ScheduleEntry {
  day_of_week: number;
  start_time: string;
  end_time: string;
  max_patients: number;
}

type Step = 1 | 2 | 3 | 4;

export default function DoctorRegister() {
  const { t } = useTranslation(['auth']);
  const navigate = useNavigate();
  const DAYS = t('days', { returnObjects: true }) as string[];
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    specialty: '', bmdc_registration: '', qualifications: '', public_bio: '',
    chamber_name: '', chamber_address: '', consultation_fee: '',
  });
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);

  const updateForm = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const toggleDay = (dayIndex: number) => {
    const existing = schedule.find(s => s.day_of_week === dayIndex);
    if (existing) {
      setSchedule(prev => prev.filter(s => s.day_of_week !== dayIndex));
    } else {
      setSchedule(prev => [...prev, { day_of_week: dayIndex, start_time: '09:00', end_time: '17:00', max_patients: 20 }]);
    }
  };

  const updateScheduleEntry = (dayIndex: number, field: keyof ScheduleEntry, value: string | number) => {
    setSchedule(prev => prev.map(s =>
      s.day_of_week === dayIndex ? { ...s, [field]: value } : s
    ));
  };

  const validateStep = (): boolean => {
    if (step === 1) {
      if (!form.name.trim()) { setError(t('register.errors.nameRequired')); return false; }
      if (!form.email && !form.phone) { setError(t('register.errors.credentialRequired')); return false; }
      if (!form.password || form.password.length < 8) { setError(t('register.errors.passwordMin')); return false; }
      if (form.password !== form.confirmPassword) { setError(t('register.errors.passwordMismatch')); return false; }
    }
    if (step === 2) {
      if (!form.specialty.trim()) { setError(t('register.errors.specialtyRequired')); return false; }
      if (!form.bmdc_registration.trim()) { setError(t('register.errors.bmdcRequired')); return false; }
    }
    if (step === 3) {
      if (!form.chamber_name.trim()) { setError(t('register.errors.chamberNameRequired')); return false; }
      if (!form.chamber_address.trim()) { setError(t('register.errors.addressRequired')); return false; }
      if (!form.consultation_fee || Number(form.consultation_fee) < 0) { setError(t('register.errors.feeRequired')); return false; }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/doctor-auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          password: form.password,
          specialty: form.specialty,
          bmdc_registration: form.bmdc_registration,
          qualifications: form.qualifications || undefined,
          public_bio: form.public_bio || undefined,
          chamber_name: form.chamber_name,
          chamber_address: form.chamber_address,
          consultation_fee: Math.round(Number(form.consultation_fee)),
          schedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('register.errors.registerFailed'));
        return;
      }
      // P0-34: token is held in memory only via tokenStore.
      setAccessToken(data.token);
      navigate(`/h/${data.slug}/dashboard`);
    } catch {
      setError(t('register.errors.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🩺</div>
          <h1 className="text-2xl font-bold text-gray-900">{t('register.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('register.subtitle')}</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step === s ? 'bg-blue-600 text-white' : step > s ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {step > s ? '✓' : s}
              </div>
              {s < 4 && <div className={`w-8 h-0.5 ${step > s ? 'bg-green-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* Step 1: Account */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-4">{t('register.steps.account')}</h2>
              <div>
                <label className={labelCls}>{t('register.form.fullName')} *</label>
                <input type="text" value={form.name} onChange={e => updateForm('name', e.target.value)} className={inputCls} placeholder={t('register.form.fullNamePlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.email')}</label>
                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} className={inputCls} placeholder={t('register.form.emailPlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.phone')}</label>
                <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)} className={inputCls} placeholder={t('register.form.phonePlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.password')} *</label>
                <input type="password" value={form.password} onChange={e => updateForm('password', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.confirmPassword')} *</label>
                <input type="password" value={form.confirmPassword} onChange={e => updateForm('confirmPassword', e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          {/* Step 2: Professional */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-4">{t('register.steps.professional')}</h2>
              <div>
                <label className={labelCls}>{t('register.form.specialty')} *</label>
                <input type="text" value={form.specialty} onChange={e => updateForm('specialty', e.target.value)} className={inputCls} placeholder={t('register.form.specialtyPlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.bmdc')} *</label>
                <input type="text" value={form.bmdc_registration} onChange={e => updateForm('bmdc_registration', e.target.value)} className={inputCls} placeholder={t('register.form.bmdcPlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.qualifications')}</label>
                <input type="text" value={form.qualifications} onChange={e => updateForm('qualifications', e.target.value)} className={inputCls} placeholder={t('register.form.qualificationsPlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.bio')}</label>
                <textarea
                  value={form.public_bio}
                  onChange={e => updateForm('public_bio', e.target.value)}
                  rows={3}
                  className={inputCls}
                  placeholder={t('register.form.bioPlaceholder')}
                />
              </div>
            </div>
          )}

          {/* Step 3: Chamber */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-4">{t('register.steps.chamber')}</h2>
              <div>
                <label className={labelCls}>{t('register.form.chamberName')} *</label>
                <input type="text" value={form.chamber_name} onChange={e => updateForm('chamber_name', e.target.value)} className={inputCls} placeholder={t('register.form.chamberNamePlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.address')} *</label>
                <textarea
                  value={form.chamber_address}
                  onChange={e => updateForm('chamber_address', e.target.value)}
                  rows={2}
                  className={inputCls}
                  placeholder={t('register.form.addressPlaceholder')}
                />
              </div>
              <div>
                <label className={labelCls}>{t('register.form.fee')} *</label>
                <input type="number" value={form.consultation_fee} onChange={e => updateForm('consultation_fee', e.target.value)} className={inputCls} placeholder={t('register.form.feePlaceholder')} min="0" />
              </div>
            </div>
          )}

          {/* Step 4: Schedule */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-1">{t('register.form.scheduleTitle')}</h2>
              <p className="text-xs text-gray-500 mb-4">{t('register.form.scheduleSubtitle')}</p>

              <div className="space-y-3">
                {DAYS.map((day, i) => {
                  const entry = schedule.find(s => s.day_of_week === i);
                  return (
                    <div key={day} className={`rounded-lg border p-3 transition-colors ${entry ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!entry} onChange={() => toggleDay(i)} className="rounded" />
                          <span className="text-sm font-medium text-gray-700">{day}</span>
                        </label>
                      </div>
                      {entry && (
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <div>
                            <label className="text-xs text-gray-500">{t('register.form.start')}</label>
                            <input type="time" value={entry.start_time} onChange={e => updateScheduleEntry(i, 'start_time', e.target.value)} className="w-full rounded border border-gray-300 text-xs px-1.5 py-1" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">{t('register.form.end')}</label>
                            <input type="time" value={entry.end_time} onChange={e => updateScheduleEntry(i, 'end_time', e.target.value)} className="w-full rounded border border-gray-300 text-xs px-1.5 py-1" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">{t('register.form.maxPatients')}</label>
                            <input type="number" value={entry.max_patients} onChange={e => updateScheduleEntry(i, 'max_patients', Number(e.target.value))} min={1} max={200} className="w-full rounded border border-gray-300 text-xs px-1.5 py-1" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as Step)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← {t('register.buttons.back')}
              </button>
            )}
            {step < 4 ? (
              <button
                onClick={() => { if (validateStep()) setStep(s => (s + 1) as Step); }}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('register.buttons.next')} →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {loading ? t('register.buttons.creating') : t('register.buttons.create')}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          {t('register.footer.alreadyRegistered')}{' '}
          <Link to="/doctor/login" className="text-blue-600 hover:underline">{t('register.footer.login')}</Link>
        </p>
      </div>
    </div>
  );
}
