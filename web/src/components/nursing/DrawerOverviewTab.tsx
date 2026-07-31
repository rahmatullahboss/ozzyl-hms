import { useMemo } from 'react';
import { Stethoscope, Calendar, Clock, Pill, ClipboardList, FlaskConical, AlertTriangle, UtensilsCrossed, HeartPulse, Syringe, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface DrawerOverviewTabProps {
  bed: BedGridItem;
}

interface MarScheduleResponse {
  data?: { id: number; medicine_name: string; dose: string; route: string; frequency: string }[];
}

interface MedicationOrdersResponse {
  data?: { id: number; status: string }[];
}

interface InvestigationResultsResponse {
  data?: { id: number; status: string }[];
}

function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export default function DrawerOverviewTab({ bed }: DrawerOverviewTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const basePath = `/h/${slug}`;

  const marQuery = useApiQuery<MarScheduleResponse>(
    queryKeys.nursing.marSchedule(bed.patient_id!),
    `/api/nursing/mar/schedule?patient_id=${bed.patient_id}`,
  );

  const ordersQuery = useApiQuery<MedicationOrdersResponse>(
    queryKeys.nursing.medicationOrders(bed.patient_id!),
    `/api/nursing/medication-orders?patient_id=${bed.patient_id}`,
  );

  const labsQuery = useApiQuery<InvestigationResultsResponse>(
    queryKeys.nursing.investigationResults(bed.patient_id!),
    `/api/nursing/investigation-results?patient_id=${bed.patient_id}`,
  );

  const activeMeds = useMemo(() => {
    const data = marQuery.data?.data;
    if (!data || !Array.isArray(data)) return [];
    return data.slice(0, 5);
  }, [marQuery.data]);

  const pendingOrders = useMemo(() => {
    const data = ordersQuery.data?.data;
    if (!data || !Array.isArray(data)) return 0;
    return data.filter((o) => o.status === 'pending').length;
  }, [ordersQuery.data]);

  const pendingLabs = useMemo(() => {
    const data = labsQuery.data?.data;
    if (!data || !Array.isArray(data)) return 0;
    return data.filter((r) => r.status === 'pending').length;
  }, [labsQuery.data]);

  const admissionDays = daysSince(bed.admission_date);

  return (
    <div className="space-y-5" data-testid="overview-tab">
      {/* Diagnosis */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Stethoscope className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.overview.diagnosis', { defaultValue: 'Diagnosis' })}
          </h3>
        </div>
        <p className="text-sm text-[var(--color-text)] pl-6" data-testid="overview-diagnosis">
          {bed.provisional_diagnosis || t('drawer.overview.notSpecified', { defaultValue: 'Not specified' })}
        </p>
      </section>

      {/* Consultant Doctor & Admission Info */}
      <div className="grid grid-cols-2 gap-4">
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Stethoscope className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {t('drawer.overview.consultant', { defaultValue: 'Consultant' })}
            </h3>
          </div>
          <p className="text-sm font-medium text-[var(--color-text)] pl-6" data-testid="overview-doctor">
            {bed.doctor_name || t('drawer.overview.notAssigned', { defaultValue: 'Not assigned' })}
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {t('drawer.overview.admissionDate', { defaultValue: 'Admission Date' })}
            </h3>
          </div>
          <p className="text-sm text-[var(--color-text)] pl-6" data-testid="overview-admission-date">
            {bed.admission_id ? t('drawer.overview.admitted', { defaultValue: 'Admitted' }) : '—'}
          </p>
        </section>
      </div>

      {/* Admission Duration */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
            {t('drawer.overview.duration', { defaultValue: 'Admission Duration' })}
          </h3>
        </div>
        <p className="text-sm text-[var(--color-text)] pl-6" data-testid="overview-admission-duration">
          {admissionDays !== null
            ? t('drawer.overview.daysCount', { count: admissionDays, defaultValue: `${admissionDays} day(s)` })
            : bed.admission_id
              ? t('drawer.overview.active', { defaultValue: 'Active' })
              : '—'}
        </p>
      </section>

      {/* Current Medications */}
      <section data-testid="overview-medications">
        <div className="flex items-center gap-2 mb-2">
          <Pill className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.overview.currentMeds', { defaultValue: 'Current Medications' })}
          </h3>
          {marQuery.isLoading && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {t('loading', { defaultValue: 'Loading...' })}
            </span>
          )}
        </div>
        {activeMeds.length > 0 ? (
          <ul className="space-y-1.5 pl-6">
            {activeMeds.map((med) => (
              <li key={med.id} className="text-sm text-[var(--color-text)]">
                <span className="font-medium">{med.medicine_name}</span>
                {med.dose && <span className="text-[var(--color-text-muted)]"> — {med.dose}</span>}
                {med.frequency && <span className="text-[var(--color-text-muted)]"> ({med.frequency})</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] pl-6">
            {t('drawer.overview.noActiveMeds', { defaultValue: 'No active medications' })}
          </p>
        )}
      </section>

      {/* Pending Counts */}
      <div className="grid grid-cols-2 gap-4">
        <section data-testid="overview-pending-orders">
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {t('drawer.overview.pendingOrders', { defaultValue: 'Pending Orders' })}
            </h3>
          </div>
          <p className="text-lg font-bold text-[var(--color-text)] pl-6">
            {ordersQuery.isLoading ? '—' : pendingOrders}
          </p>
        </section>

        <section data-testid="overview-pending-labs">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {t('drawer.overview.pendingLabs', { defaultValue: 'Pending Lab Reports' })}
            </h3>
          </div>
          <p className="text-lg font-bold text-[var(--color-text)] pl-6">
            {labsQuery.isLoading ? '—' : pendingLabs}
          </p>
        </section>
      </div>

      {/* Allergies */}
      <section data-testid="overview-allergies">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.overview.allergies', { defaultValue: 'Allergies' })}
          </h3>
        </div>
        <p className="text-sm text-[var(--color-text)] pl-6">
          {(bed.allergy_count ?? 0) > 0
            ? t('drawer.overview.allergyCount', { count: bed.allergy_count, defaultValue: `${bed.allergy_count} allergy(ies)` })
            : t('drawer.overview.noAllergies', { defaultValue: 'None known' })}
        </p>
      </section>

      {/* Diet Status */}
      <section data-testid="overview-diet">
        <div className="flex items-center gap-2 mb-2">
          <UtensilsCrossed className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.overview.diet', { defaultValue: 'Diet Status' })}
          </h3>
        </div>
        <p className="text-sm text-[var(--color-text)] pl-6">
          {bed.npo
            ? 'NPO'
            : t('drawer.overview.regularDiet', { defaultValue: 'Regular diet' })}
        </p>
      </section>

      {/* Quick Actions */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
          {t('drawer.overview.quickActions', { defaultValue: 'Quick Actions' })}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`${basePath}/nursing?tab=vitals&patient=${bed.patient_id}`)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors"
            data-testid="quick-action-vitals"
          >
            <HeartPulse className="w-3.5 h-3.5" />
            {t('drawer.overview.addVitals', { defaultValue: 'Add Vitals' })}
          </button>
          <button
            onClick={() => navigate(`${basePath}/nursing?tab=mar&patient=${bed.patient_id}`)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 transition-colors"
            data-testid="quick-action-medicine"
          >
            <Syringe className="w-3.5 h-3.5" />
            {t('drawer.overview.giveMedicine', { defaultValue: 'Give Medicine' })}
          </button>
          <button
            onClick={() => navigate(`${basePath}/nursing?tab=notes&patient=${bed.patient_id}`)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 transition-colors"
            data-testid="quick-action-note"
          >
            <FileText className="w-3.5 h-3.5" />
            {t('drawer.overview.addNote', { defaultValue: 'Add Note' })}
          </button>
        </div>
      </section>
    </div>
  );
}
