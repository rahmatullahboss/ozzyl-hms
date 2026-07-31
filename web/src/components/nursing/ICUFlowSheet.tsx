import { useMemo } from 'react';
import { Activity, Droplets, Wind, Syringe, TrendingUp, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface ICUFlowSheetProps {
  admissionId: number;
  patientName: string;
}

interface VitalsTrendPoint {
  recorded_at: string;
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  temperature?: number;
  spo2?: number;
  respiratory_rate?: number;
}

interface IOBlock {
  period_start: string;
  period_end: string;
  intake_total: number;
  output_total: number;
}

interface VentilatorSetting {
  recorded_at: string;
  mode?: string;
  fio2?: number;
  peep?: number;
  tidal_volume?: number;
  rate?: number;
}

interface InfusionEntry {
  id: number;
  drug_name: string;
  dose: string;
  unit: string;
  started_at: string;
  stopped_at?: string;
  dose_changes?: { time: string; dose: string }[];
}

function isAbnormalVital(key: string, value: number): boolean {
  switch (key) {
    case 'systolic': return value > 160 || value < 80;
    case 'diastolic': return value > 100 || value < 50;
    case 'heart_rate': return value > 120 || value < 50;
    case 'temperature': return value > 101 || value < 96;
    case 'spo2': return value < 92;
    case 'respiratory_rate': return value > 24 || value < 10;
    default: return false;
  }
}

function formatHour(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function generateHourSlots(): string[] {
  const slots: string[] = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now);
    h.setHours(now.getHours() - i, 0, 0, 0);
    slots.push(h.toISOString());
  }
  return slots;
}

export default function ICUFlowSheet({ admissionId, patientName }: ICUFlowSheetProps) {
  const { t } = useTranslation(['nursing', 'common']);

  const vitalsQuery = useApiQuery<{ vitals: VitalsTrendPoint[] }>(
    ['icu', 'vitals', admissionId],
    `/api/nurse-station/vitals-trends/${admissionId}?days=1`,
    { enabled: !!admissionId },
  );

  const ioQuery = useApiQuery<{ blocks: IOBlock[]; total_intake: number; total_output: number; balance: number }>(
    ['icu', 'io', admissionId],
    `/api/nursing/io/balance/${admissionId}?period=24&blocks=true`,
    { enabled: !!admissionId },
  );

  const ventQuery = useApiQuery<{ settings: VentilatorSetting[] }>(
    ['icu', 'ventilator', admissionId],
    `/api/nursing/ventilator/${admissionId}`,
    { enabled: !!admissionId },
  );

  const infusionsQuery = useApiQuery<{ infusions: InfusionEntry[] }>(
    ['icu', 'infusions', admissionId],
    `/api/nursing/iv-drugs?patient_id=${admissionId}&active=true`,
    { enabled: !!admissionId },
  );

  const hourSlots = useMemo(() => generateHourSlots(), []);

  const vitals = vitalsQuery.data?.vitals ?? [];
  const ioBlocks = ioQuery.data?.blocks ?? [];
  const ventSettings = ventQuery.data?.settings ?? [];
  const infusions = infusionsQuery.data?.infusions ?? [];

  const vitalKeys = [
    { key: 'systolic', label: 'SBP', unit: 'mmHg' },
    { key: 'diastolic', label: 'DBP', unit: 'mmHg' },
    { key: 'heart_rate', label: 'HR', unit: 'bpm' },
    { key: 'temperature', label: 'Temp', unit: '°F' },
    { key: 'spo2', label: 'SpO₂', unit: '%' },
    { key: 'respiratory_rate', label: 'RR', unit: '/min' },
  ];

  return (
    <div className="space-y-6" data-testid="icu-flow-sheet">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--color-primary)]" />
          {t('icu.title', { defaultValue: 'ICU Flow Sheet' })}
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">{patientName}</span>
      </div>

      {/* Vitals Timeline — 24h grid */}
      <section data-testid="vitals-timeline">
        <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          {t('icu.vitalsTimeline', { defaultValue: 'Vitals Timeline' })}
        </h4>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[var(--color-border-light)]">
                <th className="text-left px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)] w-16">
                  {t('icu.parameter', { defaultValue: 'Parameter' })}
                </th>
                {hourSlots.map((slot, i) => (
                  <th key={i} className="text-center px-1 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {formatHour(slot)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vitalKeys.map(vk => (
                <tr key={vk.key} className="hover:bg-[var(--color-border-light)]/30">
                  <td className="px-2 py-1.5 font-medium text-[var(--color-text)] border-b border-[var(--color-border)]">
                    {vk.label}
                  </td>
                  {hourSlots.map((slot, i) => {
                    const point = vitals.find(v => {
                      const vt = new Date(v.recorded_at);
                      const st = new Date(slot);
                      return vt.getHours() === st.getHours() && vt.getDate() === st.getDate();
                    });
                    const val = point ? (point as unknown as Record<string, unknown>)[vk.key] as number | undefined : undefined;
                    const abnormal = val !== undefined && isAbnormalVital(vk.key, val);
                    return (
                      <td
                        key={i}
                        className={`text-center px-1 py-1.5 border-b border-l border-[var(--color-border)] font-mono ${
                          abnormal
                            ? 'text-red-600 font-bold bg-red-50 dark:bg-red-900/20'
                            : val !== undefined
                              ? 'text-[var(--color-text)]'
                              : 'text-[var(--color-text-muted)]/40'
                        }`}
                      >
                        {val !== undefined ? val : '·'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* I/O Balance — 4h blocks */}
      <section data-testid="io-balance">
        <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5" />
          {t('icu.ioBalance', { defaultValue: 'I/O Balance' })}
        </h4>

        {/* Summary cards */}
        {ioQuery.data && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-center">
              <TrendingUp className="w-4 h-4 text-blue-600 mx-auto mb-1" />
              <p className="text-sm font-bold text-blue-600">
                {ioQuery.data.total_intake}<span className="text-[10px] font-normal ml-0.5">ml</span>
              </p>
              <p className="text-[10px] text-blue-500">{t('icu.totalIntake', { defaultValue: 'Total Intake' })}</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2 text-center">
              <TrendingDown className="w-4 h-4 text-amber-600 mx-auto mb-1" />
              <p className="text-sm font-bold text-amber-600">
                {ioQuery.data.total_output}<span className="text-[10px] font-normal ml-0.5">ml</span>
              </p>
              <p className="text-[10px] text-amber-500">{t('icu.totalOutput', { defaultValue: 'Total Output' })}</p>
            </div>
            <div className={`rounded-lg p-2 text-center ${ioQuery.data.balance >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
              <Activity className={`w-4 h-4 mx-auto mb-1 ${ioQuery.data.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
              <p className={`text-sm font-bold ${ioQuery.data.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {ioQuery.data.balance > 0 ? '+' : ''}{ioQuery.data.balance}<span className="text-[10px] font-normal ml-0.5">ml</span>
              </p>
              <p className={`text-[10px] ${ioQuery.data.balance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {t('icu.balance', { defaultValue: 'Balance' })}
              </p>
            </div>
          </div>
        )}

        {/* 4h block bars */}
        {ioBlocks.length > 0 && (
          <div className="space-y-1.5">
            {ioBlocks.map((block, i) => {
              const maxVal = Math.max(block.intake_total, block.output_total, 1);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-[10px] text-[var(--color-text-muted)] font-mono flex-shrink-0">
                    {formatHour(block.period_start)}–{formatHour(block.period_end)}
                  </span>
                  <div className="flex-1 flex gap-1 h-5">
                    <div
                      className="bg-blue-400 dark:bg-blue-500 rounded-sm flex items-center justify-end pr-1"
                      style={{ width: `${(block.intake_total / maxVal) * 100}%`, minWidth: block.intake_total > 0 ? '20px' : '0' }}
                    >
                      <span className="text-[9px] text-white font-medium">{block.intake_total}</span>
                    </div>
                    <div
                      className="bg-amber-400 dark:bg-amber-500 rounded-sm flex items-center justify-end pr-1"
                      style={{ width: `${(block.output_total / maxVal) * 100}%`, minWidth: block.output_total > 0 ? '20px' : '0' }}
                    >
                      <span className="text-[9px] text-white font-medium">{block.output_total}</span>
                    </div>
                  </div>
                  <span className={`w-14 text-right font-mono flex-shrink-0 ${block.intake_total - block.output_total >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {block.intake_total - block.output_total > 0 ? '+' : ''}{block.intake_total - block.output_total}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {ioBlocks.length === 0 && !ioQuery.isLoading && (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-3">
            {t('icu.noIOData', { defaultValue: 'No I/O data for this period' })}
          </p>
        )}
      </section>

      {/* Ventilator Settings */}
      <section data-testid="ventilator-section">
        <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5" />
          {t('icu.ventilator', { defaultValue: 'Ventilator' })}
        </h4>
        {ventSettings.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--color-border-light)]">
                  <th className="text-left px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                    {t('icu.hour', { defaultValue: 'Hour' })}
                  </th>
                  <th className="text-center px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {t('icu.mode', { defaultValue: 'Mode' })}
                  </th>
                  <th className="text-center px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {t('icu.fio2', { defaultValue: 'FiO₂' })}
                  </th>
                  <th className="text-center px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {t('icu.peep', { defaultValue: 'PEEP' })}
                  </th>
                  <th className="text-center px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {t('icu.tidalVolume', { defaultValue: 'TV' })}
                  </th>
                  <th className="text-center px-2 py-1.5 font-medium text-[var(--color-text-muted)] border-b border-l border-[var(--color-border)]">
                    {t('icu.rate', { defaultValue: 'Rate' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ventSettings.map((s, i) => (
                  <tr key={i} className="hover:bg-[var(--color-border-light)]/30">
                    <td className="px-2 py-1.5 font-mono text-[var(--color-text)] border-b border-[var(--color-border)]">
                      {formatHour(s.recorded_at)}
                    </td>
                    <td className="text-center px-2 py-1.5 border-b border-l border-[var(--color-border)]">{s.mode ?? '—'}</td>
                    <td className="text-center px-2 py-1.5 border-b border-l border-[var(--color-border)]">
                      {s.fio2 != null ? `${s.fio2}%` : '—'}
                    </td>
                    <td className="text-center px-2 py-1.5 border-b border-l border-[var(--color-border)]">
                      {s.peep != null ? `${s.peep}` : '—'}
                    </td>
                    <td className="text-center px-2 py-1.5 border-b border-l border-[var(--color-border)]">
                      {s.tidal_volume != null ? `${s.tidal_volume}` : '—'}
                    </td>
                    <td className="text-center px-2 py-1.5 border-b border-l border-[var(--color-border)]">
                      {s.rate != null ? `${s.rate}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-4 text-[var(--color-text-muted)]">
            <Wind className="w-6 h-6 mx-auto mb-1 opacity-40" />
            <p className="text-xs">{t('icu.noVentData', { defaultValue: 'No ventilator data' })}</p>
          </div>
        )}
      </section>

      {/* Continuous Infusions */}
      <section data-testid="infusions-section">
        <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Syringe className="w-3.5 h-3.5" />
          {t('icu.infusions', { defaultValue: 'Continuous Infusions' })}
        </h4>
        {infusions.length > 0 ? (
          <div className="space-y-2">
            {infusions.map(inf => (
              <div
                key={inf.id}
                className="p-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--color-text)]">{inf.drug_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${inf.stopped_at ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                    {inf.stopped_at ? t('icu.stopped', { defaultValue: 'Stopped' }) : t('icu.running', { defaultValue: 'Running' })}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {inf.dose} {inf.unit} · {t('icu.started', { defaultValue: 'Started' })}: {formatHour(inf.started_at)}
                </p>
                {inf.dose_changes && inf.dose_changes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {inf.dose_changes.map((dc, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-border-light)] text-[var(--color-text-muted)]">
                        {formatHour(dc.time)}: {dc.dose}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-[var(--color-text-muted)]">
            <Syringe className="w-6 h-6 mx-auto mb-1 opacity-40" />
            <p className="text-xs">{t('icu.noInfusions', { defaultValue: 'No active infusions' })}</p>
          </div>
        )}
      </section>
    </div>
  );
}
