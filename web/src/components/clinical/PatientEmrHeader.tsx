import { useTranslation } from 'react-i18next';
import { Droplet, AlertTriangle, Clock, Tag } from 'lucide-react';

interface PatientInfo {
  id: number;
  patient_code?: string;
  uhid?: string | null;
  name: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  mobile?: string;
}

interface AllergyItem {
  id: number;
  allergen: string;
  severity: 'mild' | 'moderate' | 'severe';
  allergy_type: string;
}

interface PatientEmrHeaderProps {
  patient: PatientInfo;
  allergies?: AllergyItem[];
  chronicConditions?: string[];
  visitType?: string;
  lastVisitDate?: string;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PatientEmrHeader({
  patient,
  allergies,
  chronicConditions,
  visitType,
  lastVisitDate,
}: PatientEmrHeaderProps) {
  const { t } = useTranslation(['patients', 'common']);

  const displayCode = patient.patient_code ?? patient.uhid;
  const hasAllergies = allergies && allergies.length > 0;
  const hasConditions = chronicConditions && chronicConditions.length > 0;
  const formattedDate = formatDate(lastVisitDate);

  return (
    <header
      data-testid="patient-emr-header"
      className="sticky top-0 z-30 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 sm:px-6 py-2.5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="font-bold text-[var(--color-text)] text-base truncate max-w-[200px]">
          {patient.name}
        </span>

        {patient.age != null && patient.gender && (
          <span className="text-[var(--color-text-muted)]">
            {patient.age}y &middot; {patient.gender}
          </span>
        )}

        {patient.blood_group && (
          <span className="inline-flex items-center gap-1 text-red-600">
            <Droplet className="w-3.5 h-3.5" />
            <span>{patient.blood_group}</span>
          </span>
        )}

        {displayCode && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            {displayCode}
          </span>
        )}

        {hasAllergies && allergies!.map((a) => (
          <span
            key={a.id}
            data-testid="allergy-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700"
          >
            <AlertTriangle className="w-3 h-3" />
            {a.allergen}
          </span>
        ))}

        {hasConditions && chronicConditions!.map((c) => (
          <span
            key={c}
            data-testid="chronic-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700"
          >
            {c}
          </span>
        ))}

        {visitType && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <Tag className="w-3 h-3" />
            {visitType}
          </span>
        )}

        {formattedDate && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] ml-auto">
            <Clock className="w-3 h-3" />
            {t('lastVisit', { defaultValue: 'Last visit' })}: {formattedDate}
          </span>
        )}
      </div>
    </header>
  );
}
