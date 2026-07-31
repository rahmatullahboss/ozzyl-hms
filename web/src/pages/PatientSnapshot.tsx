import { useParams } from 'react-router';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { Activity, Heart, Droplets, Thermometer, Wind, FileText, Pill, Stethoscope, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import type { DashData } from '../components/doctor/types';
import { formatDisplayDate } from '../lib/date-utils';
import { formatAgeFromDateOfBirth } from '../lib/age';

interface VitalSign {
  id: number;
  vital_type: string;
  value: string;
  unit: string;
  measured_at: string;
}

interface LabResult {
  id: number;
  test_name: string;
  result: string;
  unit: string;
  is_abnormal: number;
  created_at: string;
}

interface Medication {
  id: number;
  drug_name: string;
  dosage: string;
  frequency: string;
  status: string;
}

interface SnapshotData {
  patient: {
    id: number;
    name: string;
    patient_code: string;
    date_of_birth?: string;
    gender?: string;
    blood_group?: string;
  };
  vitals: VitalSign[];
  recentLabs: LabResult[];
  activeMeds: Medication[];
  allergies: { id: number; allergen: string; reaction: string }[];
  lastVisit?: {
    id: number;
    visit_date: string;
    chief_complaint?: string;
  };
  stats: {
    los_days?: number;
    pending_labs: number;
    active_meds_count: number;
    allergy_count: number;
  };
}

const VITAL_ICONS: Record<string, typeof Activity> = {
  'blood_pressure': Activity,
  'heart_rate': Heart,
  'temperature': Thermometer,
  'respiratory_rate': Wind,
  'oxygen_saturation': Droplets,
  'weight': Activity,
};

const VITAL_LABELS: Record<string, string> = {
  'blood_pressure': 'BP',
  'heart_rate': 'HR',
  'temperature': 'Temp',
  'respiratory_rate': 'RR',
  'oxygen_saturation': 'SpO2',
  'weight': 'Weight',
};

function calcAge(dob?: string): string {
  const age = formatAgeFromDateOfBirth(dob);
  return age === '—' ? '?' : age;
}

export default function PatientSnapshot() {
  const { slug, patientId } = useParams<{ slug: string; patientId: string }>();
  const { t } = useTranslation(['dashboard', 'common']);
  const basePath = `/h/${slug}`;

  const { data, isLoading } = useApiQuery<SnapshotData>(
    [...queryKeys.patientChart.detail(patientId ?? '0'), 'snapshot'],
    patientId ? `/api/patient-chart/${patientId}?snapshot=true` : '',
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--color-text-muted)]">Loading snapshot...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <p className="text-[var(--color-text-muted)]">Patient not found</p>
      </div>
    );
  }

  const { patient, vitals, recentLabs, activeMeds, allergies, lastVisit, stats } = data;

  // Group vitals by type, get latest
  const latestVitals: Record<string, VitalSign> = {};
  vitals?.forEach(v => {
    if (!latestVitals[v.vital_type] || new Date(v.measured_at) > new Date(latestVitals[v.vital_type].measured_at)) {
      latestVitals[v.vital_type] = v;
    }
  });

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
        {/* Header */}
        <div className="card p-4 flex items-center gap-3">
          <Link to={`${basePath}/patients/${patientId}/chart`} className="btn-ghost p-2">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">{patient.name}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {patient.patient_code} · {calcAge(patient.date_of_birth)} · {patient.gender} · {patient.blood_group}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {stats && (
              <div className="flex gap-3 text-xs">
                {stats.los_days !== undefined && (
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full font-medium">LOS: {stats.los_days}d</span>
                )}
                {stats.pending_labs > 0 && (
                  <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-full font-medium">
                    {stats.pending_labs} pending labs
                  </span>
                )}
                {stats.allergy_count > 0 && (
                  <span className="bg-red-50 text-red-700 px-2 py-1 rounded-full font-medium">
                    <Stethoscope className="w-3 h-3 inline mr-1" />
                    {stats.allergy_count} allergies
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Synopsis Grid - Epic Style */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Vitals Block */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--color-primary)]" />
              Vitals (24h)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(latestVitals).map(([type, vital]) => {
                const Icon = VITAL_ICONS[type] || Activity;
                return (
                  <div key={type} className="bg-[var(--color-bg)] rounded-lg p-3">
                    <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mb-1">
                      <Icon className="w-3 h-3" />
                      {VITAL_LABELS[type] || type}
                    </div>
                    <div className="text-lg font-bold text-[var(--color-text)]">
                      {vital.value} <span className="text-xs font-normal text-[var(--color-text-muted)]">{vital.unit}</span>
                    </div>
                  </div>
                );
              })}
              {Object.keys(latestVitals).length === 0 && (
                <div className="col-span-2 text-center py-4 text-[var(--color-text-muted)] text-sm">
                  No vitals recorded in last 24h
                </div>
              )}
            </div>
          </div>

          {/* Recent Labs Block */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--color-primary)]" />
              Recent Labs
            </h3>
            <div className="space-y-2">
              {recentLabs?.slice(0, 5).map(lab => (
                <div key={lab.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                  <span className="text-sm text-[var(--color-text)]">{lab.test_name}</span>
                  <span className={`text-sm font-medium ${lab.is_abnormal ? 'text-red-600' : 'text-[var(--color-text)]'}`}>
                    {lab.result} {lab.unit}
                  </span>
                </div>
              ))}
              {(!recentLabs || recentLabs.length === 0) && (
                <p className="text-center py-4 text-[var(--color-text-muted)] text-sm">No recent labs</p>
              )}
            </div>
          </div>

          {/* Active Medications Block */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Pill className="w-4 h-4 text-[var(--color-primary)]" />
              Active Meds ({activeMeds?.length || 0})
            </h3>
            <div className="space-y-2">
              {activeMeds?.map(med => (
                <div key={med.id} className="py-2 border-b border-[var(--color-border)] last:border-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">{med.drug_name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{med.dosage} · {med.frequency}</div>
                </div>
              ))}
              {(!activeMeds || activeMeds.length === 0) && (
                <p className="text-center py-4 text-[var(--color-text-muted)] text-sm">No active medications</p>
              )}
            </div>
          </div>

          {/* Allergies Block */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-red-500" />
              Allergies ({allergies?.length || 0})
            </h3>
            <div className="space-y-2">
              {allergies?.map(allergy => (
                <div key={allergy.id} className="py-2 border-b border-[var(--color-border)] last:border-0">
                  <div className="text-sm font-medium text-red-600">{allergy.allergen}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{allergy.reaction}</div>
                </div>
              ))}
              {(!allergies || allergies.length === 0) && (
                <p className="text-center py-4 text-[var(--color-text-muted)] text-sm">No known allergies</p>
              )}
            </div>
          </div>

          {/* Last Visit Block */}
          {lastVisit && (
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                Last Visit
              </h3>
              <div className="space-y-2">
                <div className="text-sm text-[var(--color-text-muted)]">
                  {formatDisplayDate(lastVisit.visit_date)}
                </div>
                {lastVisit.chief_complaint && (
                  <div className="text-sm text-[var(--color-text)]">{lastVisit.chief_complaint}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card p-4">
          <div className="flex gap-3 flex-wrap">
            <Link
              to={`${basePath}/patients/${patientId}/chart`}
              className="btn-primary text-xs"
            >
              Open Full Chart
            </Link>
            <Link
              to={`${basePath}/prescriptions/new?patient=${patientId}`}
              className="btn-ghost text-xs"
            >
              New Prescription
            </Link>
            <Link
              to={`${basePath}/patients/${patientId}/timeline`}
              className="btn-ghost text-xs"
            >
              View Timeline
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
