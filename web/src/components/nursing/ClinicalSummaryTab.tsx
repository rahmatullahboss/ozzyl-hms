import { useState } from 'react';
import {
  Activity, Clock, Droplets,
  Heart, Pill, FileText, Stethoscope, Thermometer,
  AlertTriangle, BedDouble, RefreshCw, Syringe,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '../../lib/queryKeys';
import { useApiQuery } from '../../hooks/useApiQuery';
import EmptyState from '../dashboard/EmptyState';
import { formatDisplayDate } from '../../lib/date-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  gender?: string;
  mobile?: string;
  admission_id?: number;
  admission_date?: string;
  admission_status?: string;
  visit_id?: number;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  provisional_diagnosis?: string;
}

interface Props {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

interface VitalRecord {
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  spo2?: number;
  temperature?: number;
  recorded_on?: string;
}

interface AllergyRecord {
  allergen?: string;
  type?: string;
  severity?: string;
  reaction?: string;
  is_drug_allergy?: boolean;
}

interface MedicationRecord {
  medication_name?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  priority?: string;
  status?: string;
  ordered_on?: string;
}

interface LabRecord {
  test_names?: string;
  ordered_on?: string;
  status?: string;
}

interface DiagnosisRecord {
  diagnosis_text?: string;
  icd10_code?: string;
  diagnosed_on?: string;
}

interface ClinicalSummaryData {
  vitals?: VitalRecord[];
  allergies?: AllergyRecord[];
  recent_medications?: MedicationRecord[];
  recent_labs?: LabRecord[];
  diagnoses?: DiagnosisRecord[];
  active_orders?: MedicationRecord[];
}

// ─── Threshold helpers ────────────────────────────────────────────────────────

type VitalLevel = 'normal' | 'warning' | 'critical';

function getBpLevel(systolic?: number, diastolic?: number): VitalLevel {
  const s = systolic ?? 0;
  const d = diastolic ?? 0;
  if (s < 80 || s > 160 || d < 50 || d > 100) return 'critical';
  if (s < 90 || s > 140 || d < 60 || d > 90) return 'warning';
  return 'normal';
}

function getHrLevel(hr?: number): VitalLevel {
  const v = hr ?? 0;
  if (v < 50 || v > 120) return 'critical';
  if (v < 60 || v > 100) return 'warning';
  return 'normal';
}

function getSpo2Level(spo2?: number): VitalLevel {
  const v = spo2 ?? 0;
  if (v < 92) return 'critical';
  if (v < 95) return 'warning';
  return 'normal';
}

function getTempLevel(temp?: number): VitalLevel {
  const v = temp ?? 0;
  if (v < 96 || v > 101) return 'critical';
  if (v < 97 || v > 99) return 'warning';
  return 'normal';
}

const LEVEL_COLORS: Record<VitalLevel, string> = {
  normal: 'var(--color-success, #22c55e)',
  warning: 'var(--color-warning, #f59e0b)',
  critical: 'var(--color-danger, #ef4444)',
};

function levelBg(level: VitalLevel): string {
  if (level === 'critical') return 'bg-red-50';
  if (level === 'warning') return 'bg-amber-50';
  return 'bg-emerald-50';
}

function levelBorder(level: VitalLevel): string {
  if (level === 'critical') return 'border-red-300';
  if (level === 'warning') return 'border-amber-300';
  return 'border-emerald-300';
}

function statusLabel(level: VitalLevel): string {
  if (level === 'critical') return 'Critical';
  if (level === 'warning') return 'Warning';
  return 'Normal';
}

function barPercent(label: string, value: number): number {
  switch (label) {
    case 'Blood Pressure': {
      const s = value;
      // Map 60-180 systolic to 0-100%
      return Math.min(100, Math.max(0, ((s - 60) / 120) * 100));
    }
    case 'Heart Rate': {
      // Map 40-160 bpm to 0-100%
      return Math.min(100, Math.max(0, ((value - 40) / 120) * 100));
    }
    case 'SpO2': {
      // Map 85-100% to 0-100%
      return Math.min(100, Math.max(0, ((value - 85) / 15) * 100));
    }
    case 'Temperature': {
      // Map 95-103°F to 0-100%
      return Math.min(100, Math.max(0, ((value - 95) / 8) * 100));
    }
    default:
      return 50;
  }
}

function PatientSelector({
  patients,
  selectedPatient,
  onSelectPatient,
}: {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}) {
  const { t } = useTranslation('nursing');

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Stethoscope className="w-4 h-4" />
        {t('selectPatient', { defaultValue: 'Select Patient' })}
      </h2>
      <div className="space-y-2">
        {patients.map(p => (
          <button
            key={p.patient_id}
            onClick={() => onSelectPatient(p.patient_id)}
            className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              selectedPatient === p.patient_id
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'
            }`}
          >
            <span className="font-medium block">{p.name}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Spo2Chart({ vitals }: { vitals: VitalRecord[] }) {
  const { t } = useTranslation('nursing');
  const data = [...vitals].reverse().slice(-10);

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Droplets className="w-4 h-4 text-blue-500" />
        {t('spo2Trend', { defaultValue: 'SpO2 Trend' })}
      </h3>
      {data.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t('noVitals', { defaultValue: 'No vitals data' })}</p>
      ) : (
        <div className="flex items-end gap-1 h-24">
          {data.map((v, i) => {
            const level = getSpo2Level(v.spo2);
            const barColor = LEVEL_COLORS[level];
            const h = v.spo2 ? Math.round(((v.spo2 - 80) / 20) * 100) : 10;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <span className="text-xs font-data">{v.spo2 ?? '—'}</span>
                <div
                  className="w-full rounded-sm transition-all"
                  style={{
                    height: `${Math.max(h, 5)}%`,
                    backgroundColor: barColor,
                    minHeight: '4px',
                  }}
                  title={`SpO2: ${v.spo2 ?? '—'}%`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PatientHeader({ patient }: { patient: Patient }) {
  const initials = patient.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isCritical = patient.admission_status === 'critical';

  return (
    <div className="card p-4 flex items-start gap-4">
      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold">{patient.name}</h2>
          <span className="text-sm text-[var(--color-text-muted)]">{patient.patient_code}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isCritical
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {isCritical ? t('critical', { ns: 'nursing', defaultValue: 'Critical' }) : t('admitted', { ns: 'nursing', defaultValue: 'Admitted' })}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
          {patient.ward_name && (
            <p className="flex items-center gap-1">
              <BedDouble className="w-3.5 h-3.5" />
              {patient.ward_name} {patient.bed_number ? `/ ${patient.bed_number}` : ''}
            </p>
          )}
          {patient.doctor_name && (
            <p className="flex items-center gap-1">
              <Stethoscope className="w-3.5 h-3.5" />
              {patient.doctor_name}
            </p>
          )}
          {patient.provisional_diagnosis && (
            <p className="flex items-center gap-1 col-span-2">
              <FileText className="w-3.5 h-3.5" />
              {patient.provisional_diagnosis}
            </p>
          )}
          {patient.admission_date && (
            <p className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatDisplayDate(patient.admission_date)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface VitalCardProps {
  label: string;
  value: string | number;
  unit: string;
  icon: React.ReactNode;
  level: VitalLevel;
  /** Numeric value for computing progress bar width */
  rawValue?: number;
}

function VitalCard({ label, value, unit, icon, level, rawValue }: VitalCardProps) {
  const pct = rawValue != null ? barPercent(label, rawValue) : level === 'critical' ? 100 : level === 'warning' ? 66 : 33;
  return (
    <div className={`card p-3 border ${levelBorder(level)} ${levelBg(level)}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {label}
        </span>
        <span className="text-[var(--color-text-muted)]">{icon}</span>
      </div>
      <p className="font-data text-2xl font-bold" style={{ color: LEVEL_COLORS[level] }}>
        {value}
        <span className="text-xs font-normal ml-1">{unit}</span>
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: LEVEL_COLORS[level],
          }}
        />
      </div>
      <span
        className="text-xs mt-1 inline-block font-medium"
        style={{ color: LEVEL_COLORS[level] }}
      >
        {statusLabel(level)}
      </span>
    </div>
  );
}

function VitalsGrid({ vitals }: { vitals: VitalRecord[] }) {
  const latest = vitals[vitals.length - 1] ?? {};

  const bpLevel = getBpLevel(latest.systolic, latest.diastolic);
  const hrLevel = getHrLevel(latest.heart_rate);
  const spo2Level = getSpo2Level(latest.spo2);
  const tempLevel = getTempLevel(latest.temperature);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <VitalCard
        label="Blood Pressure"
        value={latest.systolic && latest.diastolic ? `${latest.systolic}/${latest.diastolic}` : '—'}
        unit="mmHg"
        icon={<Heart className="w-4 h-4" />}
        level={bpLevel}
        rawValue={latest.systolic}
      />
      <VitalCard
        label="Heart Rate"
        value={latest.heart_rate ?? '—'}
        unit="bpm"
        icon={<Activity className="w-4 h-4" />}
        level={hrLevel}
        rawValue={latest.heart_rate ?? 0}
      />
      <VitalCard
        label="SpO2"
        value={latest.spo2 ?? '—'}
        unit="%"
        icon={<Droplets className="w-4 h-4" />}
        level={spo2Level}
        rawValue={latest.spo2 ?? 0}
      />
      <VitalCard
        label="Temperature"
        value={latest.temperature != null ? latest.temperature.toFixed(1) : '—'}
        unit="°F"
        icon={<Thermometer className="w-4 h-4" />}
        level={tempLevel}
        rawValue={latest.temperature ?? 0}
      />
    </div>
  );
}

type SectionTab = 'allergies' | 'medications' | 'labs' | 'diagnoses';

function SectionTabs({ active, onChange }: { active: SectionTab; onChange: (t: SectionTab) => void }) {
  const tabs: { key: SectionTab; label: string }[] = [
    { key: 'allergies', label: 'Allergies' },
    { key: 'medications', label: 'Medications' },
    { key: 'labs', label: 'Labs' },
    { key: 'diagnoses', label: 'Diagnoses' },
  ];

  return (
    <div className="flex border-b border-[var(--color-border)]">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            active === tab.key
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function AllergiesTab({ allergies }: { allergies: AllergyRecord[] }) {
  const { t } = useTranslation('nursing');

  if (allergies.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle className="w-8 h-8" />}
        title={t('noKnownAllergies', { defaultValue: 'No known allergies' })}
        description={t('noAllergiesHint', { defaultValue: 'No allergy records on file.' })}
      />
    );
  }

  return (
    <div className="space-y-2 p-4">
      {allergies.map((a, i) => {
        const isSevere = a.severity === 'severe' || a.severity === 'high';
        const isDrug = a.is_drug_allergy || a.type?.toLowerCase().includes('drug');
        return (
          <div
            key={i}
            className={`rounded-lg border p-3 ${
              isSevere ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className={`w-4 h-4 mt-0.5 shrink-0 ${isSevere ? 'text-red-500' : 'text-amber-500'}`}
              />
              <div className="flex-1">
                <p className="font-semibold text-sm">{a.allergen ?? 'Unknown'}</p>
                {a.type && (
                  <p className="text-xs text-[var(--color-text-muted)]">{a.type}</p>
                )}
                <p className="text-xs mt-1">
                  <span
                    className={`font-medium ${
                      isSevere ? 'text-red-700' : 'text-amber-700'
                    }`}
                  >
                    {a.severity ?? 'Unknown severity'}
                  </span>
                  {a.reaction && (
                    <span className="text-[var(--color-text-muted)]"> — {a.reaction}</span>
                  )}
                </p>
              </div>
              {isDrug && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold shrink-0">
                  {t('drugAllergy', { defaultValue: 'DRUG ALLERGY' })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MedicationsTab({ medications }: { medications: MedicationRecord[] }) {
  const { t } = useTranslation('nursing');

  if (medications.length === 0) {
    return (
      <EmptyState
        icon={<Pill className="w-8 h-8" />}
        title={t('noActiveMeds', { defaultValue: 'No active medication orders' })}
        description={t('noMedsHint', { defaultValue: 'No active medication orders for this patient.' })}
      />
    );
  }

  return (
    <div className="space-y-2 p-4">
      {medications.map((m, i) => {
        const isActive = m.status?.toLowerCase() === 'active';
        return (
          <div key={i} className="border border-[var(--color-border)] rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="font-semibold text-sm">{m.medication_name ?? 'Unknown'}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {[m.dose, m.route, m.frequency].filter(Boolean).join(' · ')}
                </p>
                {m.priority && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Priority: {m.priority}
                  </p>
                )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                  isActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {m.status ?? 'Unknown'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LabsTab({ labs }: { labs: LabRecord[] }) {
  const { t } = useTranslation('nursing');

  if (labs.length === 0) {
    return (
      <EmptyState
        icon={<Syringe className="w-8 h-8" />}
        title={t('noLabOrders', { defaultValue: 'No recent lab orders' })}
        description={t('noLabsHint', { defaultValue: 'No recent lab orders for this patient.' })}
      />
    );
  }

  return (
    <div className="space-y-2 p-4">
      {labs.map((l, i) => (
        <div key={i} className="border border-[var(--color-border)] rounded-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-semibold text-sm">{l.test_names ?? 'Unknown test'}</p>
              {l.ordered_on && (
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Ordered: {formatDisplayDate(l.ordered_on)}
                </p>
              )}
            </div>
            {l.status && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  l.status.toLowerCase() === 'completed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {l.status}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiagnosesTab({ diagnoses }: { diagnoses: DiagnosisRecord[] }) {
  const { t } = useTranslation('nursing');

  if (diagnoses.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="w-8 h-8" />}
        title={t('noDiagnoses', { defaultValue: 'No diagnoses recorded' })}
        description={t('noDiagnosesHint', { defaultValue: 'No diagnoses on record.' })}
      />
    );
  }

  return (
    <div className="space-y-2 p-4">
      {diagnoses.map((d, i) => (
        <div key={i} className="border border-[var(--color-border)] rounded-lg p-3">
          <p className="font-semibold text-sm">{d.diagnosis_text ?? 'Unknown'}</p>
          <div className="flex items-center gap-3 mt-1">
            {d.icd10_code && (
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-data">
                {d.icd10_code}
              </span>
            )}
            {d.diagnosed_on && (
              <span className="text-xs text-[var(--color-text-muted)]">
                {formatDisplayDate(d.diagnosed_on)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function ClinicalSummaryTab({ patients, selectedPatient, onSelectPatient }: Props) {
  const [activeSection, setActiveSection] = useState<SectionTab>('allergies');

  const clinicalSummaryQuery = useApiQuery<{ Results: ClinicalSummaryData }>(
    queryKeys.nursing.clinicalSummary(selectedPatient ?? 0),
    `/api/nursing/clinical-summary/${selectedPatient}`,
    { enabled: !!selectedPatient },
  );

  const data = clinicalSummaryQuery.data?.Results;
  const vitals: VitalRecord[] = data?.vitals ?? [];
  const allergies: AllergyRecord[] = data?.allergies ?? [];
  const medications: MedicationRecord[] = data?.recent_medications ?? [];
  const labs: LabRecord[] = data?.recent_labs ?? [];
  const diagnoses: DiagnosisRecord[] = data?.diagnoses ?? [];

  const selectedPatientData = patients.find(p => p.patient_id === selectedPatient);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left column — patient selector + SpO2 chart */}
      <div className="space-y-4">
        <PatientSelector
          patients={patients}
          selectedPatient={selectedPatient}
          onSelectPatient={onSelectPatient}
        />
        {selectedPatient && <Spo2Chart vitals={vitals} />}
      </div>

      {/* Right column — header + vitals + tabbed sections */}
      <div className="lg:col-span-2 space-y-4">
        {selectedPatientData ? (
          <>
            <PatientHeader patient={selectedPatientData} />
            <VitalsGrid vitals={vitals} />
            <div className="card overflow-hidden">
              <SectionTabs active={activeSection} onChange={setActiveSection} />
              {clinicalSummaryQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="skeleton h-6 w-6 rounded-full animate-spin border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
                </div>
              ) : clinicalSummaryQuery.isError ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                  <p className="text-sm text-[var(--color-text-muted)]">Failed to load clinical data</p>
                  <button
                    onClick={() => clinicalSummaryQuery.refetch()}
                    className="btn-secondary text-xs flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              ) : (
                <>
                  {activeSection === 'allergies' && <AllergiesTab allergies={allergies} />}
                  {activeSection === 'medications' && <MedicationsTab medications={medications} />}
                  {activeSection === 'labs' && <LabsTab labs={labs} />}
                  {activeSection === 'diagnoses' && <DiagnosesTab diagnoses={diagnoses} />}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="card p-8">
            <EmptyState
              icon={<Stethoscope className="w-8 h-8 text-[var(--color-text-muted)]" />}
              title={t('selectPatientFirst', { ns: 'nursing', defaultValue: 'Select a patient first' })}
              description={t('clinicalSummaryHint', { ns: 'nursing', defaultValue: 'Vitals, medicines, labs, diagnosis and allergies appear here.' })}
            />
          </div>
        )}
      </div>
    </div>
  );
}