import type { QueueItem } from './types';

export interface MedicationSafetyPayload {
  medication_name: string;
  dose_mg?: number;
  frequency_per_day?: number;
}

export function parseFrequencyPerDay(frequency: string): number | undefined {
  const normalized = frequency.trim().toLowerCase();
  if (!normalized || normalized === 'sos' || normalized === 'stat') return undefined;

  if (normalized.includes('+')) {
    const total = normalized.split('+').reduce((sum, part) => {
      const value = part.includes('½') ? 0.5 : Number.parseFloat(part);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return total > 0 ? Math.max(1, Math.round(total)) : undefined;
  }

  if (/\b(od|qd|once|daily)\b/.test(normalized)) return 1;
  if (/\b(bd|bid|twice)\b/.test(normalized)) return 2;
  if (/\b(tds|tid|three)\b/.test(normalized)) return 3;
  if (/\b(qid|four)\b/.test(normalized)) return 4;

  const times = normalized.match(/(\d+)\s*(x|times)\b/);
  if (times) {
    const value = Number.parseInt(times[1], 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  return undefined;
}

export function parseDoseMg(dosage: string): number | undefined {
  const normalized = dosage.trim().toLowerCase().replace(',', '.');
  if (!normalized) return undefined;

  const microgram = normalized.match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug)\b/);
  if (microgram) {
    const value = Number.parseFloat(microgram[1]);
    return Number.isFinite(value) && value > 0 ? value / 1000 : undefined;
  }

  const milligram = normalized.match(/(\d+(?:\.\d+)?)\s*mg\b/);
  if (milligram) {
    const value = Number.parseFloat(milligram[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  const gram = normalized.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gram) {
    const value = Number.parseFloat(gram[1]);
    return Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
  }

  return undefined;
}

export function buildMedicationSafetyPayload<T extends { medicine_name: string; dosage: string; frequency: string }>(items: T[]): MedicationSafetyPayload[] {
  return items
    .filter((item) => item.medicine_name.trim())
    .map((item) => ({
      medication_name: item.medicine_name.trim(),
      dose_mg: parseDoseMg(item.dosage),
      frequency_per_day: parseFrequencyPerDay(item.frequency),
    }));
}

export function buildPatientSafetyContext(queueItem: QueueItem) {
  const snapshot = queueItem.medical_snapshot;
  const conditions = snapshot?.chronicConditions ?? [];
  const numericAge = typeof queueItem.patient_age === 'number'
    ? queueItem.patient_age
    : typeof queueItem.patient_age === 'string'
      ? Number.parseInt(queueItem.patient_age, 10)
      : undefined;
  const age = snapshot?.age ?? (Number.isFinite(numericAge) ? numericAge : undefined);
  const normalizedGender = queueItem.gender?.trim().toLowerCase();
  const diagnoses = [
    ...conditions,
    queueItem.last_diagnosis ?? '',
  ].map((value) => value.trim()).filter(Boolean);

  return {
    age_years: age ?? undefined,
    sex: normalizedGender?.startsWith('m') ? 'M' : normalizedGender?.startsWith('f') ? 'F' : undefined,
    is_pregnant: conditions.some((value) => value.toLowerCase().includes('pregnan')) || undefined,
    diagnoses: diagnoses.length > 0 ? Array.from(new Set(diagnoses)) : undefined,
  };
}
