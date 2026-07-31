import { formatAgeFromDateOfBirth } from './age';

export type PatientIdentityInput = {
  id?: number | null;
  patient_code?: string | null;
  age?: number | string | null;
  date_of_birth?: string | null;
  mobile?: string | null;
};

export function formatPatientAgeLabel(
  age?: number | string | null,
  dateOfBirth?: string | null,
  referenceDate: Date = new Date(),
): string | null {
  if (dateOfBirth) {
    const ageFromDob = formatAgeFromDateOfBirth(dateOfBirth, 'en-GB', referenceDate);
    if (ageFromDob !== '—') return ageFromDob.toLowerCase();
  }

  const rawAge = age !== null && age !== undefined ? String(age).trim() : '';
  if (!rawAge) return null;
  return /(?:y|yr|yrs|year|years)$/i.test(rawAge) ? rawAge : `${rawAge}y`;
}

export function formatPatientIdentityText(
  patient: PatientIdentityInput,
  fallbackCode?: string,
  referenceDate: Date = new Date(),
): string {
  const code = String(patient.patient_code ?? '').trim()
    || String(fallbackCode ?? '').trim()
    || (Number(patient.id ?? 0) > 0 ? `Patient #${patient.id}` : 'Patient');
  const ageLabel = formatPatientAgeLabel(patient.age, patient.date_of_birth, referenceDate);
  const mobile = String(patient.mobile ?? '').trim();

  return [code, ageLabel, mobile || null].filter(Boolean).join(' · ');
}
