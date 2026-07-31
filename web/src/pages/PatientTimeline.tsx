import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import PatientEmrHeader from '../components/clinical/PatientEmrHeader';
import TimelineEventExpandable from '../components/clinical/TimelineEventExpandable';
import type { TimelineEvent } from '../components/clinical/TimelineEventExpandable';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

// --- Types ---

interface PatientInfo {
  id: number;
  patient_code?: string;
  name: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  mobile?: string;
}

interface PatientResponse {
  patient: PatientInfo;
}

// --- Config ---

const TYPE_CONFIG: Record<string, { color: string }> = {
  visit: { color: '#3b82f6' },
  consultation: { color: '#6366f1' },
  soap: { color: '#8b5cf6' },
  prescription: { color: '#10b981' },
  lab: { color: '#f59e0b' },
  radiology_order: { color: '#ec4899' },
  radiology_report: { color: '#f43f5e' },
  admission: { color: '#ef4444' },
  discharge: { color: '#14b8a6' },
  appointment: { color: '#06b6d4' },
  document: { color: '#64748b' },
  referral: { color: '#a855f7' },
};

const TIMELINE_FILTERS = [
  'all',
  'visit',
  'consultation',
  'soap',
  'prescription',
  'lab',
  'radiology_order',
  'radiology_report',
  'admission',
  'discharge',
  'appointment',
  'document',
  'referral',
];

function getTimelineTypeLabel(type: string, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Record<string, string> = {
    visit: t('timeline.filters.visit', { defaultValue: 'Visits' }),
    consultation: t('timeline.filters.consultation', { defaultValue: 'Consultations' }),
    soap: t('timeline.filters.soap', { defaultValue: 'SOAP notes' }),
    prescription: t('timeline.filters.prescription', { defaultValue: 'Prescriptions' }),
    lab: t('timeline.filters.lab', { defaultValue: 'Lab results' }),
    radiology_order: t('timeline.filters.radiologyOrder', { defaultValue: 'Radiology orders' }),
    radiology_report: t('timeline.filters.radiologyReport', { defaultValue: 'Radiology reports' }),
    admission: t('timeline.filters.admission', { defaultValue: 'Admissions' }),
    discharge: t('timeline.filters.discharge', { defaultValue: 'Discharges' }),
    appointment: t('timeline.filters.appointment', { defaultValue: 'Appointments' }),
    document: t('timeline.filters.document', { defaultValue: 'Documents' }),
    referral: t('timeline.filters.referral', { defaultValue: 'Referrals' }),
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

// --- Component ---

export default function PatientTimeline({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['patients', 'common', 'dashboard']);

  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const basePath = `/h/${slug}`;
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: patientData } = useApiQuery<PatientResponse>(
    queryKeys.patients.detail(Number(id)),
    `/api/patients/${id}`,
    { enabled: !!id }
  );

  const { data: summaryData } = useApiQuery<{
    allergies: { id: number; allergen: string; severity: string; allergy_type: string }[];
    recent_visits: { id: number; visit_type?: string; created_at?: string }[];
    recent_diagnoses: { id: number; Diagnosis?: string; ICD10Description?: string; IsActive?: boolean }[];
  }>(
    queryKeys.patients.summary(Number(id)),
    `/api/patients/${id}/summary`,
    { enabled: !!id }
  );

  const { data: timelineData, isLoading: loading, isError } = useApiQuery<{ events: TimelineEvent[]; patient_name?: string }>(
    queryKeys.patientTimeline.events(id),
    `/api/patients/${id}/timeline`,
    { enabled: !!id }
  );

  const events = timelineData?.events ?? [];
  const patientName = timelineData?.patient_name;
  const loadError = isError ? t('timelineLoadError', { defaultValue: 'Failed to load timeline' }) : null;

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-3xl mx-auto">
        {patientData?.patient && (
          <PatientEmrHeader
            patient={patientData.patient}
            allergies={summaryData?.allergies?.map(a => ({ id: a.id, allergen: a.allergen, severity: a.severity as 'mild' | 'moderate' | 'severe', allergy_type: a.allergy_type }))}
            chronicConditions={summaryData?.recent_diagnoses?.filter(d => d.IsActive !== false).map(d => d.Diagnosis ?? d.ICD10Description ?? '').filter(Boolean)}
            visitType={summaryData?.recent_visits?.[0]?.visit_type}
            lastVisitDate={summaryData?.recent_visits?.[0]?.created_at}
          />
        )}

        {/* Header */}
        <div>
          <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
            <Link to={`${basePath}/dashboard`} className="hover:underline">
              {t('dashboard:dashboard', { defaultValue: 'Dashboard' })}
            </Link>
            <ChevronRight className="w-3 h-3" />
            <Link to={`${basePath}/patients`} className="hover:underline">
              {t('title', { defaultValue: 'Patients' })}
            </Link>
            <ChevronRight className="w-3 h-3" />
            <Link to={`${basePath}/patients/${id}`} className="hover:underline">{patientName ?? '—'}</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[var(--color-text)] font-medium">{t('timeline', { defaultValue: 'Timeline' })}</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            {t('timeline.title', { defaultValue: 'Medical timeline' })}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('timeline.patientHistory', { name: patientName ?? '—', defaultValue: 'Complete medical history for {{name}}' })}
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {TIMELINE_FILTERS.map((type) => (
            <button key={type} onClick={() => setFilter(type)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition capitalize ${
                filter === type
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-[var(--color-text-muted)] hover:bg-gray-200'
              }`}>
              {type === 'all'
                ? t('timeline.filters.all', { count: events.length, defaultValue: 'All ({{count}})' })
                : getTimelineTypeLabel(type, t)}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="animate-pulse h-24 bg-gray-100 rounded-xl" />)}</div>
        ) : isError ? (
          <div className="card p-6 text-center border-l-4 border-l-red-400">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="font-medium text-red-700">{loadError}</p>
            <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.patientTimeline.events(id) })} className="btn btn-primary text-sm mt-3">
              <RefreshCw className="w-4 h-4" /> {t('common:retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-[var(--color-border)]" />

            <div className="space-y-4">
              {filtered.map(event => {
                const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.visit;
                return (
                  <div key={event.id} className="relative pl-14">
                    {/* Dot on timeline */}
                    <div className="absolute left-4 top-4 w-5 h-5 rounded-full border-2 border-white shadow-sm flex items-center justify-center"
                         style={{ background: cfg.color }}>
                      <div className="w-2 h-2 rounded-full bg-white" />
                    </div>

                    {/* Expandable Card */}
                    <TimelineEventExpandable
                      event={event}
                      isExpanded={expandedId === event.id}
                      onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                    />
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-12 text-[var(--color-text-muted)]">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{loadError ?? t('timeline.noEvents', { defaultValue: 'No events found' })}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
