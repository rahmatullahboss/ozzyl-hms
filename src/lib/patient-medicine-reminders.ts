export interface MedicineReminderFormState {
  name: string;
  strength: string;
  doseAmount: string;
  timeSlot: string;
  timeBn: string;
  instruction: string;
}

export interface MasterDrugLike {
  brand_name: string;
  strength?: string | null;
}

export interface BuildReminderPayloadInput extends MedicineReminderFormState {}

const STRENGTH_PATTERN = /\b(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml)\b/i;

const INSTRUCTION_LABELS: Record<string, string> = {
  before_meal: 'খালি পেটে খাবেন',
  after_meal: 'খাবারের পরে খাবেন',
  with_meal: 'খাবারের সাথে খাবেন',
  anytime: 'যেকোনো সময়',
};

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

const toBanglaDigits = (value: string): string =>
  value.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);

export const buildBanglaTimeLabel = (timeSlot: string): string => {
  const [rawHour = '00', minute = '00'] = timeSlot.split(':');
  const hour = Number(rawHour);
  const suffix =
    hour < 5 ? 'রাত' :
    hour < 12 ? 'সকাল' :
    hour < 16 ? 'দুপুর' :
    hour < 19 ? 'বিকাল' : 'রাত';

  const normalizedHour = hour % 12 || 12;
  return `${suffix} ${toBanglaDigits(`${normalizedHour}`)}:${toBanglaDigits(minute)}`;
};

export const applySelectedDrugToReminderForm = (
  form: MedicineReminderFormState,
  drug: MasterDrugLike,
): MedicineReminderFormState => ({
  ...form,
  name: drug.brand_name,
  strength: drug.strength ?? form.strength,
});

export const inferStrengthFromMedicineName = (name: string): string | undefined => {
  const match = name.match(STRENGTH_PATTERN);
  if (!match) return undefined;
  return `${match[1]}${match[2].length === 1 ? '' : ' '}${match[2]}`.trim();
};

export const buildMedicineReminderPayload = (form: BuildReminderPayloadInput) => ({
  medicine_name: form.name.trim(),
  strength: form.strength.trim() || inferStrengthFromMedicineName(form.name.trim()),
  dose_amount: form.doseAmount.trim() || undefined,
  time_slot: form.timeSlot,
  time_label: form.timeBn.trim() || buildBanglaTimeLabel(form.timeSlot),
  instruction: form.instruction,
  instruction_label: INSTRUCTION_LABELS[form.instruction] ?? INSTRUCTION_LABELS.after_meal,
});

export const formatReminderLine = (reminder: {
  medicine_name: string;
  strength: string | null;
  dose_amount: string | null;
  dosage: string | null;
}): string => {
  const primary = [
    reminder.medicine_name,
    reminder.strength?.trim() || null,
  ].filter(Boolean).join(' ');
  const amount = reminder.dose_amount?.trim() || reminder.dosage?.trim() || null;
  if (!amount) return primary;
  return reminder.strength?.trim() ? `${primary} · ${amount}` : `${primary} ${amount}`;
};
