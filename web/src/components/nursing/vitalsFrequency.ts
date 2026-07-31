export const VITALS_FREQUENCY_KEY = 'hms_vitals_frequency';

export type VitalsFrequency = 'q4h' | 'q6h' | 'q8h' | 'q12h' | 'Daily' | 'PRN';

export const FREQUENCY_OPTIONS: { value: VitalsFrequency; label: string; hours: number }[] = [
  { value: 'q4h', label: 'q4h', hours: 4 },
  { value: 'q6h', label: 'q6h', hours: 6 },
  { value: 'q8h', label: 'q8h', hours: 8 },
  { value: 'q12h', label: 'q12h', hours: 12 },
  { value: 'Daily', label: 'Daily', hours: 24 },
  { value: 'PRN', label: 'PRN', hours: Infinity },
];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export interface NextDueResult {
  dueTime: string;
  minutesUntilDue: number | null;
}

export function calculateNextDue(lastRecorded: string | null, frequency: VitalsFrequency): NextDueResult {
  if (frequency === 'PRN') return { dueTime: 'Not scheduled', minutesUntilDue: null };
  if (!lastRecorded) return { dueTime: 'No vitals recorded', minutesUntilDue: null };

  const freq = FREQUENCY_OPTIONS.find(f => f.value === frequency);
  if (!freq || freq.hours === Infinity) return { dueTime: 'Not scheduled', minutesUntilDue: null };

  const last = new Date(lastRecorded);
  const due = new Date(last.getTime() + freq.hours * 60 * 60 * 1000);
  const now = new Date();
  const minutesUntilDue = Math.round((due.getTime() - now.getTime()) / 60000);

  return {
    dueTime: `${pad(due.getHours())}:${pad(due.getMinutes())}`,
    minutesUntilDue,
  };
}

export type DueStatus = 'overdue' | 'due-soon' | 'on-track' | 'none';

export interface DueStatusResult {
  status: DueStatus;
  label: string;
  minutesUntilDue: number | null;
}

export function getDueStatus(lastRecorded: string | null, frequency: VitalsFrequency): DueStatusResult {
  if (frequency === 'PRN') return { status: 'none', label: 'PRN', minutesUntilDue: null };
  if (!lastRecorded) return { status: 'overdue', label: 'No vitals', minutesUntilDue: null };

  const { minutesUntilDue } = calculateNextDue(lastRecorded, frequency);
  if (minutesUntilDue === null) return { status: 'none', label: '', minutesUntilDue: null };

  if (minutesUntilDue <= 0) return { status: 'overdue', label: 'Overdue', minutesUntilDue };
  if (minutesUntilDue <= 30) return { status: 'due-soon', label: 'Due soon', minutesUntilDue };
  return { status: 'on-track', label: 'On track', minutesUntilDue };
}

export function getFrequencyForPatient(patientId: number): VitalsFrequency {
  if (typeof window === 'undefined') return 'q4h';
  const stored = localStorage.getItem(`${VITALS_FREQUENCY_KEY}_${patientId}`);
  if (stored && FREQUENCY_OPTIONS.some(f => f.value === stored)) return stored as VitalsFrequency;
  return 'q4h';
}

export function setFrequencyForPatient(patientId: number, frequency: VitalsFrequency): void {
  localStorage.setItem(`${VITALS_FREQUENCY_KEY}_${patientId}`, frequency);
}
