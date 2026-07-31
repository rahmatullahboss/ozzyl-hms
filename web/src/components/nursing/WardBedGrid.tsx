import { useState, useMemo } from 'react';
import { Users, Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BedGridItem {
  bed_id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  bed_status: string;
  floor?: string;
  rate_per_day?: number;
  admission_id?: number;
  admission_status?: string;
  admission_date?: string;
  provisional_diagnosis?: string;
  patient_id?: number;
  patient_name?: string;
  patient_code?: string;
  blood_group?: string;
  doctor_name?: string;
  latestVitals?: {
    systolic?: number;
    diastolic?: number;
    temperature?: number;
    heart_rate?: number;
    spo2?: number;
    recorded_at?: string;
  } | null;
  activeAlerts?: number;
  medDueCount?: number;
  statusColor?: 'empty' | 'stable' | 'medication-due' | 'critical' | 'vitals-abnormal' | 'isolation' | 'discharge-planned';
  allergy_count?: number;
  fall_risk?: boolean;
  isolation?: boolean;
  is_diabetic?: boolean;
  npo?: boolean;
}

interface WardBedGridProps {
  beds: BedGridItem[];
  onBedClick: (bed: BedGridItem) => void;
  filterMyPatients?: boolean;
  myPatientIds?: Set<number>;
}

const STATUS_STYLES: Record<string, { bg: string; border: string; badge: string; label: string }> = {
  empty:            { bg: 'bg-gray-50 dark:bg-gray-900/40',    border: 'border-gray-300 dark:border-gray-700', badge: 'bg-gray-200 text-gray-600', label: 'Empty' },
  stable:           { bg: 'bg-blue-50 dark:bg-blue-900/30',    border: 'border-blue-400 dark:border-blue-600', badge: 'bg-blue-100 text-blue-700', label: 'Stable' },
  'medication-due': { bg: 'bg-amber-50 dark:bg-amber-900/30',  border: 'border-amber-400 dark:border-amber-600', badge: 'bg-amber-100 text-amber-700', label: 'Med Due' },
  critical:         { bg: 'bg-red-50 dark:bg-red-900/30',      border: 'border-red-400 dark:border-red-600',   badge: 'bg-red-100 text-red-700',   label: 'Critical' },
  'vitals-abnormal':{ bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-400 dark:border-orange-600', badge: 'bg-orange-100 text-orange-700', label: 'Abnormal' },
  isolation:        { bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-400 dark:border-purple-600', badge: 'bg-purple-100 text-purple-700', label: 'Isolation' },
  'discharge-planned': { bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-400 dark:border-green-600', badge: 'bg-green-100 text-green-700', label: 'Discharge' },
};

export default function WardBedGrid({ beds, onBedClick, filterMyPatients, myPatientIds }: WardBedGridProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const wards = useMemo(() => {
    const set = new Set(beds.map(b => b.ward_name));
    return Array.from(set).sort();
  }, [beds]);

  const filteredBeds = useMemo(() => {
    let result = beds;
    if (wardFilter !== 'all') result = result.filter(b => b.ward_name === wardFilter);
    if (statusFilter !== 'all') result = result.filter(b => b.statusColor === statusFilter);
    if (filterMyPatients && myPatientIds) result = result.filter(b => !b.patient_id || myPatientIds.has(b.patient_id));
    return result;
  }, [beds, wardFilter, statusFilter, filterMyPatients, myPatientIds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select
            value={wardFilter}
            onChange={e => setWardFilter(e.target.value)}
            className="input input-sm max-w-48"
          >
            <option value="all">{t('allWards', { defaultValue: 'All Wards' })}</option>
            {wards.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'stable', 'medication-due', 'critical', 'vitals-abnormal', 'isolation', 'discharge-planned', 'empty'] as const).map(status => {
            const style = status === 'all' ? null : STATUS_STYLES[status];
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-[var(--color-primary)] text-white'
                    : style?.badge ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {status === 'all' ? t('common:all') : style?.label ?? status}
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {filteredBeds.length} {t('beds', { defaultValue: 'beds' })}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {filteredBeds.map(bed => {
          const status = bed.statusColor ?? 'empty';
          const style = STATUS_STYLES[status];
          const isOccupied = !!bed.patient_id;

          return (
            <button
              key={bed.bed_id}
              onClick={() => onBedClick(bed)}
              className={`relative rounded-xl border-2 p-3 text-left transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] min-h-[120px] ${style.bg} ${style.border} ${
                isOccupied ? 'cursor-pointer' : 'cursor-default opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--color-text)]">
                  {bed.ward_name} — {bed.bed_number}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${style.badge}`}>
                  {style.label}
                </span>
              </div>

              {isOccupied ? (
                <>
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {bed.patient_name}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                    {bed.patient_code} {bed.blood_group ? `· ${bed.blood_group}` : ''}
                  </p>

                  {bed.latestVitals && (
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {bed.latestVitals.systolic && (
                        <span>{bed.latestVitals.systolic}/{bed.latestVitals.diastolic}</span>
                      )}
                      {bed.latestVitals.heart_rate && <span>HR {bed.latestVitals.heart_rate}</span>}
                      {bed.latestVitals.spo2 && <span>SpO₂ {bed.latestVitals.spo2}%</span>}
                    </div>
                  )}

                  <div className="mt-1.5 flex gap-1">
                    {(bed.activeAlerts ?? 0) > 0 && (
                      <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                        {bed.activeAlerts} {t('alerts', { defaultValue: 'alerts' })}
                      </span>
                    )}
                    {(bed.medDueCount ?? 0) > 0 && (
                      <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                        {bed.medDueCount} {t('medDue', { defaultValue: 'med due' })}
                      </span>
                    )}
                    {(bed.allergy_count ?? 0) > 0 && (
                      <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-medium">
                        ⚠ {bed.allergy_count}
                      </span>
                    )}
                    {bed.fall_risk && (
                      <span className="text-[10px] bg-orange-100 text-orange-700 rounded-full px-1.5 py-0.5 font-medium">
                        {t('fallRisk', { defaultValue: 'Fall' })}
                      </span>
                    )}
                    {bed.isolation && (
                      <span className="text-[10px] bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5 font-medium">
                        {t('isolation', { defaultValue: 'Iso' })}
                      </span>
                    )}
                    {bed.is_diabetic && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">
                        DM
                      </span>
                    )}
                    {bed.npo && (
                      <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5 font-medium">
                        NPO
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-[var(--color-text-muted)]">{t('empty', { defaultValue: 'Empty' })}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {filteredBeds.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{t('noBedsFound', { defaultValue: 'No beds found matching filters' })}</p>
        </div>
      )}
    </div>
  );
}
