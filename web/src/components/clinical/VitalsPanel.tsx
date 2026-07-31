import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Activity, Thermometer, Heart, Wind, Droplets, Scale, Ruler } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface Vital {
  id: number;
  patient_id: number;
  temperature?: number;
  pulse?: number;
  systolic?: number;
  diastolic?: number;
  spo2?: number;
  respiratory_rate?: number;
  weight?: number;
  height?: number;
  bmi?: number;
  pain_scale?: number;
  blood_sugar?: number;
  notes?: string;
  recorded_at: string;
  recorded_by?: string;
}

interface VitalsResponse {
  vitals?: Vital[];
}

interface TrendResponse {
  vitals?: Vital[];
}

function getBmiColor(bmi: number): string {
  if (bmi < 18.5) return 'text-blue-600';
  if (bmi < 25) return 'text-emerald-600';
  if (bmi < 30) return 'text-amber-600';
  return 'text-red-600';
}

function getBpColor(sys: number, dia: number): string {
  if (sys >= 180 || dia >= 120) return 'text-red-600';
  if (sys >= 140 || dia >= 90) return 'text-orange-600';
  if (sys >= 130 || dia >= 80) return 'text-amber-600';
  return 'text-emerald-600';
}

function getSpo2Color(spo2: number): string {
  if (spo2 < 90) return 'text-red-600';
  if (spo2 < 95) return 'text-amber-600';
  return 'text-emerald-600';
}

function getTempColor(temp: number): string {
  if (temp >= 39 || temp <= 35) return 'text-red-600';
  if (temp >= 37.5) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function VitalsPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [trendVitals, setTrendVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    temperature: '',
    pulse: '',
    systolic: '',
    diastolic: '',
    spo2: '',
    respiratory_rate: '',
    weight: '',
    height: '',
    pain_scale: '',
    blood_sugar: '',
    notes: '',
  });

  const fetchVitals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<VitalsResponse>(`/api/clinical/vitals?patientId=${patientId}&limit=20`);
      setVitals(data.vitals || []);
    } catch {
      toast.error(t('toast.vitalsLoadFailed', { defaultValue: 'Failed to load vitals' }));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const fetchTrend = useCallback(async () => {
    try {
      const data = await apiFetch<TrendResponse>(`/api/clinical/vitals/trend/${patientId}?limit=5`);
      setTrendVitals(data.vitals || []);
    } catch {
      // silent fail for trend
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) {
      fetchVitals();
      fetchTrend();
    }
  }, [fetchVitals, fetchTrend, patientId]);

  // Auto-calculate BMI
  const calculatedBmi = (() => {
    const w = parseFloat(form.weight);
    const h = parseFloat(form.height);
    if (w > 0 && h > 0) {
      const heightM = h / 100;
      return (w / (heightM * heightM)).toFixed(1);
    }
    return '';
  })();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { patient_id: Number(patientId) };
      // Treat empty string as "not provided" but a real numeric 0 as a valid value.
      // Falsy-zero trap: `if (form.pulse)` would drop a legitimate 0 reading.
      if (form.temperature !== '') payload.temperature = parseFloat(form.temperature);
      if (form.pulse !== '') payload.pulse = parseInt(form.pulse, 10);
      if (form.systolic !== '') payload.systolic = parseInt(form.systolic, 10);
      if (form.diastolic !== '') payload.diastolic = parseInt(form.diastolic, 10);
      if (form.spo2 !== '') payload.spo2 = parseInt(form.spo2, 10);
      if (form.respiratory_rate !== '') payload.respiratory_rate = parseInt(form.respiratory_rate, 10);
      if (form.weight !== '') payload.weight = parseFloat(form.weight);
      if (form.height !== '') payload.height = parseFloat(form.height);
      if (calculatedBmi) payload.bmi = parseFloat(calculatedBmi);
      if (form.pain_scale !== '') payload.pain_scale = parseInt(form.pain_scale, 10);
      if (form.blood_sugar !== '') payload.blood_sugar = parseFloat(form.blood_sugar);
      if (form.notes) payload.notes = form.notes;

      await apiFetch('/api/clinical/vitals', { method: 'POST', body: payload });
      toast.success(t('toast.vitalsAdded', { defaultValue: 'Vitals recorded' }));
      setShowAdd(false);
      setForm({ temperature: '', pulse: '', systolic: '', diastolic: '', spo2: '', respiratory_rate: '', weight: '', height: '', pain_scale: '', blood_sugar: '', notes: '' });
      fetchVitals();
      fetchTrend();
    } catch {
      toast.error(t('toast.vitalsAddFailed', { defaultValue: 'Failed to record vitals' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="section-title flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--color-primary)]" />
          {t('vitals.title', { defaultValue: 'Vitals' })}
        </h3>
        <div className="flex gap-2">
          <button onClick={() => { fetchVitals(); fetchTrend(); }} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })} aria-label={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('vitals.add', { defaultValue: 'Record Vitals' })}
          </button>
        </div>
      </div>

      {/* Trend Mini-Chart (last 5 readings) */}
      {trendVitals.length >= 2 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
            {t('vitals.trend', { defaultValue: 'Trend (last 5 readings)' })}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { key: 'systolic', label: 'BP', unit: 'mmHg', icon: <Activity className="w-3.5 h-3.5" /> },
              { key: 'pulse', label: 'Pulse', unit: 'bpm', icon: <Heart className="w-3.5 h-3.5" /> },
              { key: 'temperature', label: 'Temp', unit: '\u00b0C', icon: <Thermometer className="w-3.5 h-3.5" /> },
              { key: 'spo2', label: 'SpO\u2082', unit: '%', icon: <Wind className="w-3.5 h-3.5" /> },
            ].map(({ key, label, unit, icon }) => {
              const values = trendVitals
                .map(v => v[key as keyof Vital] as number | undefined)
                .filter((v): v is number => v !== undefined && v !== null);
              if (values.length < 2) return null;
              const min = Math.min(...values);
              const max = Math.max(...values);
              const latest = values[values.length - 1];
              const prev = values[values.length - 2];
              const trend = latest > prev ? 'up' : latest < prev ? 'down' : 'flat';
              return (
                <div key={key} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg)]">
                  <div className="text-[var(--color-text-muted)]">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                    <p className="text-sm font-bold text-[var(--color-text)]">{latest}{unit}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-medium ${trend === 'up' ? 'text-red-500' : trend === 'down' ? 'text-blue-500' : 'text-gray-400'}`}>
                      {trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2192'}
                    </span>
                    <p className="text-[10px] text-[var(--color-text-muted)]">{min}-{max}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('vitals.new', { defaultValue: 'Record New Vitals' })}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <div>
              <label className="label flex items-center gap-1"><Thermometer className="w-3 h-3" /> {t('vitals.temperature', { defaultValue: 'Temperature (\u00b0C)' })}</label>
              <input type="number" step="0.1" min="30" max="45" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} className="input" placeholder="36.5" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Heart className="w-3 h-3" /> {t('vitals.pulse', { defaultValue: 'Pulse (bpm)' })}</label>
              <input type="number" min="20" max="250" value={form.pulse} onChange={e => setForm({ ...form, pulse: e.target.value })} className="input" placeholder="72" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Activity className="w-3 h-3" /> {t('vitals.systolic', { defaultValue: 'Systolic (mmHg)' })}</label>
              <input type="number" min="50" max="300" value={form.systolic} onChange={e => setForm({ ...form, systolic: e.target.value })} className="input" placeholder="120" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Activity className="w-3 h-3" /> {t('vitals.diastolic', { defaultValue: 'Diastolic (mmHg)' })}</label>
              <input type="number" min="30" max="200" value={form.diastolic} onChange={e => setForm({ ...form, diastolic: e.target.value })} className="input" placeholder="80" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Wind className="w-3 h-3" /> {t('vitals.spo2', { defaultValue: 'SpO\u2082 (%)' })}</label>
              <input type="number" min="50" max="100" value={form.spo2} onChange={e => setForm({ ...form, spo2: e.target.value })} className="input" placeholder="98" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Wind className="w-3 h-3" /> {t('vitals.respRate', { defaultValue: 'Resp. Rate (/min)' })}</label>
              <input type="number" min="5" max="60" value={form.respiratory_rate} onChange={e => setForm({ ...form, respiratory_rate: e.target.value })} className="input" placeholder="16" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Scale className="w-3 h-3" /> {t('vitals.weight', { defaultValue: 'Weight (kg)' })}</label>
              <input type="number" step="0.1" min="0.5" max="500" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} className="input" placeholder="70" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><Ruler className="w-3 h-3" /> {t('vitals.height', { defaultValue: 'Height (cm)' })}</label>
              <input type="number" step="0.1" min="30" max="250" value={form.height} onChange={e => setForm({ ...form, height: e.target.value })} className="input" placeholder="170" />
            </div>
            <div>
              <label className="label">{t('vitals.bmi', { defaultValue: 'BMI' })}</label>
              <input type="text" value={calculatedBmi ? `${calculatedBmi} kg/m\u00b2` : ''} className="input bg-gray-50 dark:bg-gray-800" readOnly tabIndex={-1} placeholder={t('vitals.bmiAuto', { defaultValue: 'Auto-calculated' })} />
            </div>
            <div>
              <label className="label">{t('vitals.painScale', { defaultValue: 'Pain (0-10)' })}</label>
              <select value={form.pain_scale} onChange={e => setForm({ ...form, pain_scale: e.target.value })} className="input">
                <option value="">--</option>
                {[0,1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="label flex items-center gap-1"><Droplets className="w-3 h-3" /> {t('vitals.bloodSugar', { defaultValue: 'Blood Sugar (mg/dL)' })}</label>
              <input type="number" min="20" max="600" value={form.blood_sugar} onChange={e => setForm({ ...form, blood_sugar: e.target.value })} className="input" placeholder="100" />
            </div>
            <div className="sm:col-span-2 md:col-span-4">
              <label className="label">{t('vitals.notes', { defaultValue: 'Notes' })}</label>
              <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input" placeholder={t('vitals.notesPlaceholder', { defaultValue: 'Optional notes...' })} />
            </div>
            <div className="sm:col-span-2 md:col-span-4 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel', { defaultValue: 'Cancel' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('vitals.save', { defaultValue: 'Save Vitals' })}</button>
            </div>
          </form>
        </div>
      )}

      {/* Vitals List */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('vitals.time', { defaultValue: 'Time' })}</th>
              <th><Thermometer className="w-3.5 h-3.5 inline" /> {t('vitals.temp', { defaultValue: 'Temp' })}</th>
              <th><Heart className="w-3.5 h-3.5 inline" /> {t('vitals.pulse', { defaultValue: 'Pulse' })}</th>
              <th><Activity className="w-3.5 h-3.5 inline" /> {t('vitals.bp', { defaultValue: 'BP' })}</th>
              <th><Wind className="w-3.5 h-3.5 inline" /> {t('vitals.spo2Short', { defaultValue: 'SpO\u2082' })}</th>
              <th>{t('vitals.sugar', { defaultValue: 'Sugar' })}</th>
              <th>{t('vitals.bmiShort', { defaultValue: 'BMI' })}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-4 text-gray-500">{t('common.loading', { defaultValue: 'Loading...' })}</td></tr>
            ) : vitals.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-500">{t('vitals.none', { defaultValue: 'No vitals recorded' })}</td></tr>
            ) : (
              vitals.map(v => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap text-xs">
                    {new Date(v.recorded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    <span className="text-[var(--color-text-muted)] ml-1">{new Date(v.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </td>
                  <td>
                    {v.temperature != null ? (
                      <span className={`font-medium ${getTempColor(v.temperature)}`}>{v.temperature}\u00b0C</span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {v.pulse != null ? (
                      <span className="font-medium">{v.pulse} <span className="text-xs text-[var(--color-text-muted)]">bpm</span></span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {v.systolic != null && v.diastolic != null ? (
                      <span className={`font-medium ${getBpColor(v.systolic, v.diastolic)}`}>{v.systolic}/{v.diastolic}</span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {v.spo2 != null ? (
                      <span className={`font-medium ${getSpo2Color(v.spo2)}`}>{v.spo2}%</span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {v.blood_sugar != null ? (
                      <span className="font-medium">{v.blood_sugar} <span className="text-xs text-[var(--color-text-muted)]">mg/dL</span></span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {v.bmi != null ? (
                      <span className={`font-medium ${getBmiColor(v.bmi)}`}>{v.bmi}</span>
                    ) : '\u2014'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
