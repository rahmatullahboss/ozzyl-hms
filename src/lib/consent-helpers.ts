import type { PortableHealthSummary } from './health-summary';

export type ConsentClinicalArea =
  | 'allergies'
  | 'prescriptions'
  | 'diagnoses'
  | 'vitals'
  | 'labs'
  | 'vaccinations'
  | 'visits'
  | 'all';

export function parseConsentClinicalAreas(value: unknown): ConsentClinicalArea[] | null {
  if (value == null) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is ConsentClinicalArea => typeof item === 'string') : null;
  } catch {
    return null;
  }
}

export function filterSummaryByClinicalAreas(
  summary: PortableHealthSummary,
  allowedAreas: ConsentClinicalArea[] | null,
): PortableHealthSummary {
  if (!allowedAreas || allowedAreas.includes('all')) return summary;

  const allowed = new Set(allowedAreas);
  const lifeThreateningAllergies = summary.allergies.filter((item) => item.severity === 'life_threatening');

  return {
    ...summary,
    allergies: allowed.has('allergies') ? summary.allergies : lifeThreateningAllergies,
    active_problems: allowed.has('diagnoses') ? summary.active_problems : [],
    current_medications: allowed.has('prescriptions') ? summary.current_medications : [],
    recent_diagnoses: allowed.has('diagnoses') ? summary.recent_diagnoses : [],
    last_vitals: allowed.has('vitals') ? summary.last_vitals : null,
    vaccinations: allowed.has('vaccinations') ? summary.vaccinations : [],
    recent_lab_results: allowed.has('labs') ? summary.recent_lab_results : [],
  };
}
