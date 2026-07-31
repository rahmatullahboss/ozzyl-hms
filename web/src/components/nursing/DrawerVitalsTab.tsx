import { useState, useCallback, useMemo } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import VitalsTrend from '../VitalsTrend';
import type { BedGridItem } from './WardBedGrid';

interface DrawerVitalsTabProps {
  bed: BedGridItem;
}

export default function DrawerVitalsTab({ bed }: DrawerVitalsTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    systolic: '',
    diastolic: '',
    temperature: '',
    heart_rate: '',
    spo2: '',
    respiratory_rate: '',
    weight: '',
    notes: '',
  });
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());

  const { save, flush, isPending } = useAutoSave({
    endpoint: '/api/nurse-station/vitals',
    method: 'post',
    debounceMs: 1500,
    invalidateKeys: [queryKeys.nurseStation.all as unknown as unknown[]],
    onSuccess: () => {
      setSavedFields(new Set(Object.keys(form).filter(k => form[k as keyof typeof form])));
      setTimeout(() => setSavedFields(new Set()), 2000);
      setForm({ systolic: '', diastolic: '', temperature: '', heart_rate: '', spo2: '', respiratory_rate: '', weight: '', notes: '' });
    },
  });

  const trendQuery = useApiQuery<{ vitals: Record<string, unknown>[]; thresholds: Record<string, unknown>[] }>(
    // Safe: parent PatientDrawer guards with if (!bed.patient_id) return null
    queryKeys.nurseStation.vitalsTrends(bed.patient_id!),
    `/api/nurse-station/vitals-trends/${bed.patient_id}?days=1`,
  );

  const handleBlur = useCallback((field: string, value: string) => {
    if (!value.trim()) return;
    const body: Record<string, unknown> = { patient_id: bed.patient_id, admission_id: bed.admission_id };
    body[field] = field === 'temperature' || field === 'weight' ? parseFloat(value) : parseInt(value);
    save(body);
  }, [bed.patient_id, bed.admission_id, save]);

  const getBorderColor = (field: string): string => {
    const val = form[field as keyof typeof form];
    if (!val) return '';
    const num = parseFloat(val);
    if (field === 'systolic' && (num > 160 || num < 80)) return 'border-red-400 focus:ring-red-400';
    if (field === 'diastolic' && (num > 100 || num < 50)) return 'border-red-400 focus:ring-red-400';
    if (field === 'spo2' && num < 92) return 'border-red-400 focus:ring-red-400';
    if (field === 'heart_rate' && (num > 120 || num < 50)) return 'border-red-400 focus:ring-red-400';
    if (field === 'temperature' && (num > 101 || num < 96)) return 'border-red-400 focus:ring-red-400';
    return 'border-[var(--color-border)] focus:ring-[var(--color-primary)]';
  };

  const vitalsFields = useMemo(() => [
    { key: 'systolic', label: t('systolic'), placeholder: '120', type: 'number' },
    { key: 'diastolic', label: t('diastolic'), placeholder: '80', type: 'number' },
    { key: 'temperature', label: t('temp_f'), placeholder: '98.6', type: 'number', step: '0.1' },
    { key: 'heart_rate', label: t('heart_rate'), placeholder: '72', type: 'number' },
    { key: 'spo2', label: 'SpO₂', placeholder: '98', type: 'number' },
    { key: 'respiratory_rate', label: t('resp_rate'), placeholder: '18', type: 'number' },
    { key: 'weight', label: t('weight_kg'), placeholder: '65', type: 'number', step: '0.1' },
  ], [t]);

  return (
    <div className="space-y-5" data-testid="vitals-tab">
      {/* Latest Vitals Display */}
      {bed.latestVitals && (
        <div className="grid grid-cols-4 gap-3" data-testid="latest-vitals">
          {[
            { label: 'BP', value: `${bed.latestVitals.systolic ?? '-'}/${bed.latestVitals.diastolic ?? '-'}`, unit: 'mmHg' },
            { label: 'HR', value: String(bed.latestVitals.heart_rate ?? '-'), unit: 'bpm' },
            { label: 'SpO₂', value: `${bed.latestVitals.spo2 ?? '-'}`, unit: '%' },
            { label: 'Temp', value: String(bed.latestVitals.temperature ?? '-'), unit: '°F' },
          ].map(v => (
            <div key={v.label} className="bg-[var(--color-border-light)] rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{v.label}</p>
              <p className="text-lg font-bold text-[var(--color-text)]">{v.value}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{v.unit}</p>
            </div>
          ))}
        </div>
      )}

      {/* Vitals Input Form — Auto-save on blur */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
          {t('recordVitals')}
          {isPending && <span className="ml-2 text-xs text-amber-500" data-testid="saving-indicator">Saving...</span>}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {vitalsFields.map(field => (
            <div key={field.key} className="relative">
              <label className="label text-xs">{field.label}</label>
              <div className="relative">
                <input
                  type={field.type}
                  step={field.step}
                  value={form[field.key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  onBlur={e => handleBlur(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className={`input pr-8 ${getBorderColor(field.key)}`}
                  data-testid={`vital-${field.key}`}
                />
                {savedFields.has(field.key) && (
                  <Check className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" data-testid="saved-check" />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label className="label text-xs">{t('notes')}</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            onBlur={e => {
              if (e.target.value.trim()) {
                save({ patient_id: bed.patient_id, admission_id: bed.admission_id, notes: e.target.value });
              }
            }}
            rows={2}
            placeholder={t('additional_observations')}
            className="input resize-none"
            data-testid="vital-notes"
          />
        </div>
      </div>

      {/* 24h Trend */}
      {trendQuery.data?.vitals && trendQuery.data.vitals.length > 1 && (
        <div data-testid="trend-chart">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">
            {t('drawer.vitals.trend24h', { defaultValue: '24h Trend' })}
          </h3>
          <VitalsTrend
            patientId={bed.patient_id ?? 0}
            days={1}
            compact
          />
        </div>
      )}
    </div>
  );
}
