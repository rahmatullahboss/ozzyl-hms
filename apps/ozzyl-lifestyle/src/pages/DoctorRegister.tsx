import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

const API = import.meta.env.VITE_API_URL || '';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ScheduleEntry {
  day_of_week: number;
  start_time: string;
  end_time: string;
  max_patients: number;
}

type Step = 1 | 2 | 3 | 4;

export default function DoctorRegister() {
  const navigate = useNavigate();
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
      if (!form.name.trim()) { setError('Name is required'); return false; }
      if (!form.email && !form.phone) { setError('Email or phone is required'); return false; }
      if (!form.password || form.password.length < 8) { setError('Password must be at least 8 characters'); return false; }
      if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return false; }
    }
    if (step === 2) {
      if (!form.specialty.trim()) { setError('Specialty is required'); return false; }
      if (!form.bmdc_registration.trim()) { setError('BMDC registration is required'); return false; }
    }
    if (step === 3) {
      if (!form.chamber_name.trim()) { setError('Chamber name is required'); return false; }
      if (!form.chamber_address.trim()) { setError('Chamber address is required'); return false; }
      if (!form.consultation_fee || Number(form.consultation_fee) < 0) { setError('Valid consultation fee is required'); return false; }
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
          consultation_fee: Math.round(Number(form.consultation_fee) * 100),
          schedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed');
        return;
      }
      localStorage.setItem('doctor_token', data.token);
      localStorage.setItem('doctor_tenant_id', data.tenant_id);
      navigate(`/h/${data.slug}/dashboard`);
    } catch {
      setError('Network error. Please try again.');
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
          <h1 className="text-2xl font-bold text-gray-900">Register Your Chamber</h1>
          <p className="text-sm text-gray-500 mt-1">Join the marketplace and receive patients online</p>
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
              <h2 className="font-semibold text-gray-900 mb-4">Account Details</h2>
              <div>
                <label className={labelCls}>Full Name *</label>
                <input type="text" value={form.name} onChange={e => updateForm('name', e.target.value)} className={inputCls} placeholder="Dr. Your Name" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} className={inputCls} placeholder="doctor@example.com" />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)} className={inputCls} placeholder="+8801XXXXXXXXX" />
              </div>
              <div>
                <label className={labelCls}>Password * (min 8 characters)</label>
                <input type="password" value={form.password} onChange={e => updateForm('password', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Confirm Password *</label>
                <input type="password" value={form.confirmPassword} onChange={e => updateForm('confirmPassword', e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          {/* Step 2: Professional */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-4">Professional Details</h2>
              <div>
                <label className={labelCls}>Specialty *</label>
                <input type="text" value={form.specialty} onChange={e => updateForm('specialty', e.target.value)} className={inputCls} placeholder="e.g. Cardiology" />
              </div>
              <div>
                <label className={labelCls}>BMDC Registration *</label>
                <input type="text" value={form.bmdc_registration} onChange={e => updateForm('bmdc_registration', e.target.value)} className={inputCls} placeholder="A-12345" />
              </div>
              <div>
                <label className={labelCls}>Qualifications</label>
                <input type="text" value={form.qualifications} onChange={e => updateForm('qualifications', e.target.value)} className={inputCls} placeholder="MBBS, MD, FRCS..." />
              </div>
              <div>
                <label className={labelCls}>Bio (for patients)</label>
                <textarea
                  value={form.public_bio}
                  onChange={e => updateForm('public_bio', e.target.value)}
                  rows={3}
                  className={inputCls}
                  placeholder="Brief description of your expertise and experience..."
                />
              </div>
            </div>
          )}

          {/* Step 3: Chamber */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-4">Chamber Details</h2>
              <div>
                <label className={labelCls}>Chamber Name *</label>
                <input type="text" value={form.chamber_name} onChange={e => updateForm('chamber_name', e.target.value)} className={inputCls} placeholder="Dr. Your Name's Chamber" />
              </div>
              <div>
                <label className={labelCls}>Address *</label>
                <textarea
                  value={form.chamber_address}
                  onChange={e => updateForm('chamber_address', e.target.value)}
                  rows={2}
                  className={inputCls}
                  placeholder="Full address..."
                />
              </div>
              <div>
                <label className={labelCls}>Consultation Fee (৳) *</label>
                <input type="number" value={form.consultation_fee} onChange={e => updateForm('consultation_fee', e.target.value)} className={inputCls} placeholder="1000" min="0" />
              </div>
            </div>
          )}

          {/* Step 4: Schedule */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900 mb-1">Weekly Schedule</h2>
              <p className="text-xs text-gray-500 mb-4">Select the days you practice</p>

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
                            <label className="text-xs text-gray-500">Start</label>
                            <input type="time" value={entry.start_time} onChange={e => updateScheduleEntry(i, 'start_time', e.target.value)} className="w-full rounded border border-gray-300 text-xs px-1.5 py-1" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">End</label>
                            <input type="time" value={entry.end_time} onChange={e => updateScheduleEntry(i, 'end_time', e.target.value)} className="w-full rounded border border-gray-300 text-xs px-1.5 py-1" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Max Patients</label>
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
                ← Back
              </button>
            )}
            {step < 4 ? (
              <button
                onClick={() => { if (validateStep()) setStep(s => (s + 1) as Step); }}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating Chamber...' : 'Create My Chamber'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          Already registered?{' '}
          <Link to="/doctor/login" className="text-blue-600 hover:underline">Doctor Login</Link>
        </p>
      </div>
    </div>
  );
}
