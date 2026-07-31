import { useState, useEffect } from 'react';
import { Heart, Plus, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface Vital {
  id: number;
  patient_name?: string;
  patient_code?: string;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  temperature?: number;
  pulse_rate?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  weight?: number;
  height?: number;
  recorded_by?: string;
  recorded_at?: string;
  created_at: string;
}

interface RecordVitalPayload {
  patient_id: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  temperature?: number;
  pulse_rate?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  weight?: number;
  height?: number;
}

function spo2Class(val?: number) {
  if (!val) return '';
  if (val < 90) return 'text-red-600 font-bold';
  if (val < 95) return 'text-amber-600 font-medium';
  return 'text-emerald-600';
}

export default function VitalsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['vitals', 'common']);
  const queryClient = useQueryClient();

  const [patientId, setPatientId]     = useState('');
  const [filterInput, setFilterInput] = useState('');
  const [showRecord, setShowRecord]   = useState(false);
  const [form, setForm] = useState({
    patient_id: '', blood_pressure_systolic: '', blood_pressure_diastolic: '',
    temperature: '', pulse_rate: '', respiratory_rate: '',
    oxygen_saturation: '', weight: '', height: '',
  });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowRecord(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  /* ─── Query: fetch vitals by patient ─────────────────────────────────── */
  const { data, isLoading: loading } = useApiQuery<{ vitals: Vital[] }>(
    queryKeys.vitals.list(patientId),
    `/api/vitals?patient_id=${patientId}`,
    { enabled: !!patientId },
  );
  const vitals = data?.vitals ?? [];

  /* ─── Mutation: record new vital ─────────────────────────────────────── */
  const recordMutation = useApiMutation<unknown, RecordVitalPayload>(
    'post',
    '/api/vitals',
    {
      onSuccess: () => {
        toast.success(t('vitals.vitals_recorded'));
        setShowRecord(false);
        setForm({
          patient_id: '', blood_pressure_systolic: '', blood_pressure_diastolic: '',
          temperature: '', pulse_rate: '', respiratory_rate: '',
          oxygen_saturation: '', weight: '', height: '',
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.vitals.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  const saving = recordMutation.isPending;

  const handleRecord = (e: React.FormEvent) => {
    e.preventDefault();
    const num = (v: string) => v ? parseFloat(v) : undefined;
    recordMutation.mutate({
      patient_id: parseInt(form.patient_id),
      blood_pressure_systolic: num(form.blood_pressure_systolic),
      blood_pressure_diastolic: num(form.blood_pressure_diastolic),
      temperature: num(form.temperature),
      pulse_rate: num(form.pulse_rate),
      respiratory_rate: num(form.respiratory_rate),
      oxygen_saturation: num(form.oxygen_saturation),
      weight: num(form.weight),
      height: num(form.height),
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title', { ns: 'vitals' })}</h1>
              <p className="section-subtitle">{t('recordedAt', { ns: 'vitals' })}</p>
            </div>
          </div>
          <button onClick={() => setShowRecord(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newVital', { ns: 'vitals' })}</button>
        </div>

        {/* Patient filter */}
        <div className="card p-3 flex gap-3 items-center">
          <input
            type="number"
            placeholder={t("vitals.filter_by_patient_id")}
            value={filterInput}
            onChange={e => setFilterInput(e.target.value)}
            className="input w-52"
          />
          <button onClick={() => setPatientId(filterInput)} className="btn-secondary">{t('filter', { ns: 'common' })}</button>
          {patientId && <button onClick={() => { setPatientId(''); setFilterInput(''); }} className="btn-ghost text-sm">{t('clear', { ns: 'common' })}</button>}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('patient', { ns: 'vitals' })}</th>
                  <th>{t('bloodPressure', { ns: 'vitals' })} (mmHg)</th>
                  <th>{t('pulse', { ns: 'vitals' })}</th>
                  <th>{t('temperature', { ns: 'vitals' })} (°C)</th>
                  <th>SpO₂ (%)</th>
                  <th>{t('respiratoryRate', { ns: 'vitals' })}</th>
                  <th>{t('weight', { ns: 'vitals' })}</th>
                  <th>{t('recordedAt', { ns: 'vitals' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : vitals.length === 0
                  ? <tr><td colSpan={8}><EmptyState icon={<Heart className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noVitals', { ns: 'vitals' })} description="No vital signs data found." action={<button onClick={() => setShowRecord(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('newVital', { ns: 'vitals' })}</button>} /></td></tr>
                  : vitals.map(v => (
                      <tr key={v.id}>
                        <td>
                          <p className="font-medium">{v.patient_name ?? '—'}</p>
                          {v.patient_code && <p className="text-xs text-[var(--color-text-muted)]">{v.patient_code}</p>}
                        </td>
                        <td className="font-data">
                          {v.blood_pressure_systolic && v.blood_pressure_diastolic
                            ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic}`
                            : '—'}
                        </td>
                        <td className="font-data">{v.pulse_rate ? `${v.pulse_rate} bpm` : '—'}</td>
                        <td className="font-data">{v.temperature ?? '—'}</td>
                        <td className={`font-data ${spo2Class(v.oxygen_saturation)}`}>
                          {v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}
                          {v.oxygen_saturation && v.oxygen_saturation < 90 && (
                            <AlertTriangle className="inline w-3 h-3 ml-1" />
                          )}
                        </td>
                        <td className="font-data">{v.respiratory_rate ? `${v.respiratory_rate}/min` : '—'}</td>
                        <td className="font-data">{v.weight ? `${v.weight} kg` : '—'}</td>
                        <td className="font-data text-sm">{(v.recorded_at ?? v.created_at)?.split('T')[0]}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">{t('newVital', { ns: 'vitals' })}</h3>
              <button onClick={() => setShowRecord(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecord} className="p-5 space-y-4">
              <div><label className="label">{t('patientId', { ns: 'billing' })} *</label><input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('systolic', { ns: 'vitals' })} (mmHg)</label><input className="input" type="number" value={form.blood_pressure_systolic} onChange={e => setForm(f => ({ ...f, blood_pressure_systolic: e.target.value }))} placeholder="e.g. 120" /></div>
                <div><label className="label">{t('diastolic', { ns: 'vitals' })} (mmHg)</label><input className="input" type="number" value={form.blood_pressure_diastolic} onChange={e => setForm(f => ({ ...f, blood_pressure_diastolic: e.target.value }))} placeholder="e.g. 80" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('pulse', { ns: 'vitals' })} (bpm)</label><input className="input" type="number" value={form.pulse_rate} onChange={e => setForm(f => ({ ...f, pulse_rate: e.target.value }))} /></div>
                <div><label className="label">{t('temperature', { ns: 'vitals' })} (°C)</label><input className="input" type="number" step="0.1" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('oxygenSaturation', { ns: 'vitals' })} (%)</label><input className="input" type="number" min="0" max="100" value={form.oxygen_saturation} onChange={e => setForm(f => ({ ...f, oxygen_saturation: e.target.value }))} /></div>
                <div><label className="label">{t('respiratoryRate', { ns: 'vitals' })} (/min)</label><input className="input" type="number" value={form.respiratory_rate} onChange={e => setForm(f => ({ ...f, respiratory_rate: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('weight', { ns: 'vitals' })} (kg)</label><input className="input" type="number" step="0.1" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} /></div>
                <div><label className="label">{t('height', { ns: 'vitals' })} (cm)</label><input className="input" type="number" step="0.1" value={form.height} onChange={e => setForm(f => ({ ...f, height: e.target.value }))} /></div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowRecord(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'vitals' }) : t('save', { ns: 'vitals' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
