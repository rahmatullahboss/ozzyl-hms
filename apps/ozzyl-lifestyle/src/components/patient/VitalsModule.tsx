import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, AlertTriangle, Activity, Droplets, Thermometer, Scale, Wind } from 'lucide-react';

interface VitalsModuleProps {
  isSessionReady?: boolean;
}

interface VitalsAlert {
  type: string;
  severity: string;
  message: string;
  disclaimer: string;
}

interface VitalsResponse {
  success: boolean;
  id: number;
  classification: Record<string, string | undefined>;
  alert: VitalsAlert | null;
}

const VITAL_FIELDS = [
  { key: 'systolic', unit: 'mmHg', icon: Activity },
  { key: 'diastolic', unit: 'mmHg', icon: Activity },
  { key: 'heart_rate', unit: 'bpm', icon: HeartPulse },
  { key: 'blood_sugar', unit: 'mmol/L', icon: Droplets },
  { key: 'weight_kg', unit: 'kg', icon: Scale },
  { key: 'temperature_f', unit: '°F', icon: Thermometer },
  { key: 'spo2', unit: '%', icon: Wind },
] as const;

const BS_CONTEXTS = ['fasting', 'post_prandial', 'random'] as const;

const CLASSIFICATION_COLORS: Record<string, string> = {
  normal: 'text-emerald-600 bg-emerald-50',
  elevated: 'text-amber-600 bg-amber-50',
  low_normal: 'text-amber-600 bg-amber-50',
  high_stage1: 'text-orange-600 bg-orange-50',
  high_stage2: 'text-red-600 bg-red-50',
  hypertensive_crisis: 'text-red-700 bg-red-100',
  high: 'text-red-600 bg-red-50',
  low_oxygen: 'text-red-700 bg-red-100',
  fever: 'text-red-600 bg-red-50',
  low_grade_fever: 'text-amber-600 bg-amber-50',
  logged: 'text-slate-500 bg-slate-50',
};

// Classification labels are now handled by i18n keys

export default function VitalsModule({ isSessionReady = true }: VitalsModuleProps) {
  const { t } = useTranslation('patientPortal');
  void isSessionReady;

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [bsContext, setBsContext] = useState('fasting');
  const [submitting, setSubmitting] = useState(false);
  const [latestResponse, setLatestResponse] = useState<VitalsResponse | null>(null);
  const [alert, setAlert] = useState<VitalsAlert | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (!value) continue;
        payload[key] = parseFloat(value);
      }
      if (payload.blood_sugar != null) {
        payload.blood_sugar_context = bsContext;
      }

      const res = await fetch('/api/wellness/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = (await res.json()) as VitalsResponse;
        setLatestResponse(data);
        setAlert(data.alert);
        setShowForm(false);
        setFormData({});
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  }, [formData, bsContext]);

  if (loading) {
    return <div className="bg-white rounded-2xl p-6 shadow-sm animate-pulse h-32" />;
  }

  const hasClassification = latestResponse?.classification && Object.keys(latestResponse.classification).length > 0;

  if (!latestResponse && !showForm) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <HeartPulse className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-3">{t('vitals.empty')}</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-rose-600 text-white text-sm rounded-xl font-semibold hover:bg-rose-500 transition-colors"
        >
          {t('vitals.recordCta')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-rose-500" />
          {t('vitals.title')}
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-rose-600 font-semibold hover:underline"
        >
          {showForm ? t('vitals.cancel') : t('vitals.addRecord')}
        </button>
      </div>

      {alert && (
        <div className={`flex items-start gap-2 rounded-xl p-3 ${alert.severity === 'critical' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`} />
          <div>
            <p className={`text-xs font-medium ${alert.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>{alert.message}</p>
            <p className="text-[10px] text-slate-500 mt-1">{alert.disclaimer}</p>
          </div>
        </div>
      )}

      {showForm ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {VITAL_FIELDS.map((field) => {
              const Icon = field.icon;
              const isBP = field.key === 'systolic' || field.key === 'diastolic';
              return (
                <div key={field.key} className={isBP ? 'col-span-1' : ''}>
                  <label className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                    <Icon className="w-3 h-3" />
                    {t(`vitals.fields.${field.key}`)} ({field.unit})
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData[field.key] || ''}
                    onChange={(e) => setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.unit}
                    className="w-full bg-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              );
            })}
          </div>

          {formData.blood_sugar && (
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t('vitals.measurementTime')}</label>
              <div className="flex gap-2">
                {BS_CONTEXTS.map((ctx) => (
                  <button
                    key={ctx}
                    onClick={() => setBsContext(ctx)}
                    className={`px-3 py-1.5 text-xs rounded-xl font-medium transition-colors ${bsContext === ctx ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {t(`vitals.contexts.${ctx}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || Object.values(formData).every((v) => !v)}
            className="w-full py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-500 transition-colors disabled:opacity-60"
          >
            {submitting ? '...' : t('vitals.save')}
          </button>
        </div>
      ) : hasClassification ? (
        <div className="grid grid-cols-2 gap-2">
          {VITAL_FIELDS.map((field) => {
            const classKey = field.key === 'systolic' || field.key === 'diastolic' ? 'bp' :
              field.key === 'temperature_f' ? 'temperature' :
              field.key === 'blood_sugar' ? 'blood_sugar' :
              field.key === 'spo2' ? 'spo2' :
              field.key === 'weight_kg' ? 'weight' : null;
            if (!classKey) return null;
            const classification = latestResponse!.classification[classKey];
            if (!classification) return null;
            const Icon = field.icon;
            const colorClass = CLASSIFICATION_COLORS[classification] || 'text-slate-500 bg-slate-50';
            const label = t(`vitals.classifications.${classification}`);
            return (
              <div key={field.key} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Icon className="w-3 h-3" />
                  {t(`vitals.fields.${field.key}`)}
                </p>
                <p className="text-lg font-bold text-slate-900">{formData[field.key] || '--'}</p>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block mt-1 ${colorClass}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
