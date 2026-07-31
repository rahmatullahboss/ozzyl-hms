import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Baby, Droplet, Droplets, Heart, HeartPulse, Phone, ShieldAlert, User, Wind } from 'lucide-react';
import type { QueueItem } from './types';

export interface RiskFactors {
  isDiabetic?: boolean;
  isHypertensive?: boolean;
  isPregnant?: boolean;
  hasCKD?: boolean;
  hasAsthma?: boolean;
  hasHeartDisease?: boolean;
}

export interface PatientHeaderProps {
  patient: QueueItem;
  bloodGroup?: string;
  riskFactors?: RiskFactors;
}

function parseAge(age?: number | string | null): number | null {
  if (age == null) return null;
  const n = typeof age === 'number' ? age : parseInt(String(age), 10);
  return Number.isFinite(n) ? n : null;
}

function visitTypeLabel(visitType?: string): string {
  if (!visitType) return '';
  return visitType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function validityLabel(value?: string | null): { label: string; expired: boolean } | null {
  if (value === 'follow_up_expired') return { label: 'Follow-up Expired', expired: true };
  if (value === 'report_show_expired') return { label: 'Report Show Expired', expired: true };
  if (value === 'valid_follow_up') return { label: 'Valid Follow-up', expired: false };
  if (value === 'valid_report_show') return { label: 'Valid Report Show', expired: false };
  return null;
}

export const PatientHeader = memo(function PatientHeader({ patient, bloodGroup, riskFactors }: PatientHeaderProps) {
  const { t } = useTranslation(['dashboard', 'common']);

  const numericAge = parseAge(patient.patient_age);
  const isChild = numericAge != null && numericAge < 12;
  const isElderly = numericAge != null && numericAge > 65;
  const hasAllergies = Boolean(patient.allergy_summary) || Number(patient.allergy_count ?? 0) > 0;
  const validity = validityLabel(patient.validity_badge);

  return (
    <header
      data-testid="patient-header"
      role="banner"
      aria-label="Patient information"
      className="border-t border-b-2 border-red-200 bg-[var(--color-surface)] px-4 sm:px-6 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-[var(--color-text)] truncate">
              {patient.patient_name}
            </h2>
            {patient.gender && (
              <span className="rounded-full bg-[var(--color-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                {patient.gender}
              </span>
            )}
            {numericAge != null && (
              <span className="text-sm text-[var(--color-text-muted)]">
                {numericAge} {t('years', { defaultValue: 'yrs' })}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {patient.patient_code}
            </span>
            {patient.patient_mobile && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                {patient.patient_mobile}
              </span>
            )}
            {bloodGroup && (
              <span className="flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5" />
                {bloodGroup}
              </span>
            )}
            {patient.visit_type && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                {visitTypeLabel(patient.visit_type)}
              </span>
            )}
            <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text)]">
              #{t('token', { defaultValue: 'Token' })} {patient.token_no}
            </span>
            {validity && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                validity.expired ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {validity.label}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="risk-badges" role="list" aria-label="Risk factors">
        {hasAllergies && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t('allergy', { defaultValue: 'ALLERGY' })}
            {patient.allergy_summary && (
              <span className="ml-1 font-normal">— {patient.allergy_summary}</span>
            )}
          </span>
        )}

        {riskFactors?.hasHeartDisease && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
            <Heart className="w-3.5 h-3.5" />
            {t('heartDisease', { defaultValue: 'Heart Disease' })}
          </span>
        )}

        {riskFactors?.isDiabetic && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
            <Droplet className="w-3.5 h-3.5" />
            {t('diabetic', { defaultValue: 'Diabetic' })}
          </span>
        )}

        {riskFactors?.isHypertensive && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
            <HeartPulse className="w-3.5 h-3.5" />
            {t('hypertensive', { defaultValue: 'Hypertensive' })}
          </span>
        )}

        {riskFactors?.isPregnant && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-800">
            <Baby className="w-3.5 h-3.5" />
            {t('pregnant', { defaultValue: 'Pregnant' })}
          </span>
        )}

        {riskFactors?.hasCKD && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
            <ShieldAlert className="w-3.5 h-3.5" />
            {t('ckd', { defaultValue: 'CKD' })}
          </span>
        )}

        {riskFactors?.hasAsthma && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
            <Wind className="w-3.5 h-3.5" />
            {t('asthma', { defaultValue: 'Asthma' })}
          </span>
        )}

        {isChild && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
            <Baby className="w-3.5 h-3.5" />
            {t('childPatient', { defaultValue: 'Child' })}
          </span>
        )}

        {isElderly && (
          <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
            <User className="w-3.5 h-3.5" />
            {t('elderlyPatient', { defaultValue: 'Elderly' })}
          </span>
        )}
      </div>
    </header>
  );
});
