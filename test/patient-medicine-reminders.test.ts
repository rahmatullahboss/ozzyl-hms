import { describe, expect, it } from 'vitest';

import {
  applySelectedDrugToReminderForm,
  buildMedicineReminderPayload,
  formatReminderLine,
  inferStrengthFromMedicineName,
} from '../src/lib/patient-medicine-reminders';

describe('patient medicine reminders helpers', () => {
  it('keeps per-dose amount separate when a master drug is selected', () => {
    const result = applySelectedDrugToReminderForm(
      {
        name: '',
        strength: '',
        doseAmount: '১ পিস',
        timeSlot: '08:00',
        timeBn: '',
        instruction: 'after_meal',
      },
      {
        brand_name: 'Napa',
        strength: '500 mg',
      },
    );

    expect(result.name).toBe('Napa');
    expect(result.strength).toBe('500 mg');
    expect(result.doseAmount).toBe('১ পিস');
  });

  it('builds a reminder payload even when no bangla time label is entered', () => {
    const payload = buildMedicineReminderPayload({
      name: 'Napa',
      strength: '500 mg',
      doseAmount: '১ পিস',
      timeSlot: '08:00',
      timeBn: '',
      instruction: 'after_meal',
    });

    expect(payload).toEqual({
      medicine_name: 'Napa',
      strength: '500 mg',
      dose_amount: '১ পিস',
      time_slot: '08:00',
      time_label: 'সকাল ৮:০০',
      instruction: 'after_meal',
      instruction_label: 'খাবারের পরে খাবেন',
    });
  });

  it('formats reminder cards with strength and per-dose amount as separate parts', () => {
    expect(formatReminderLine({
      medicine_name: 'Napa',
      strength: '500 mg',
      dose_amount: '১ পিস',
      dosage: null,
    })).toBe('Napa 500 mg · ১ পিস');
  });

  it('falls back to legacy dosage when new fields are absent', () => {
    expect(formatReminderLine({
      medicine_name: 'Old entry',
      strength: null,
      dose_amount: null,
      dosage: '১ চামচ',
    })).toBe('Old entry ১ চামচ');
  });

  it('infers strength from the medicine name when the user types it inline', () => {
    expect(inferStrengthFromMedicineName('Napa 500 mg')).toBe('500 mg');
    expect(inferStrengthFromMedicineName('Seclo 20mg')).toBe('20 mg');
    expect(inferStrengthFromMedicineName('Drops 5 ml')).toBe('5 ml');
  });

  it('prefers inferred strength when building payload without a dedicated strength field', () => {
    const payload = buildMedicineReminderPayload({
      name: 'Napa 500 mg',
      strength: '',
      doseAmount: '১ পিস',
      timeSlot: '08:00',
      timeBn: '',
      instruction: 'after_meal',
    });

    expect(payload.strength).toBe('500 mg');
  });
});
