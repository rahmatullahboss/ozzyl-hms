import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appointmentConsultationFeeAmount, getPaidVisitContextDisplay, tokenModeOptions } from './AppointmentScheduler';

describe('AppointmentScheduler pricing helpers', () => {
  it('uses doctor consultation fee in taka without dividing by 100', () => {
    expect(appointmentConsultationFeeAmount(500)).toBe(500);
  });

  it('normalizes missing or invalid consultation fees to zero', () => {
    expect(appointmentConsultationFeeAmount(null)).toBe(0);
    expect(appointmentConsultationFeeAmount(Number.NaN)).toBe(0);
  });
});

describe('Token mode options', () => {
  it('exports exactly 3 token modes: auto, reserved, manual', () => {
    expect(tokenModeOptions).toHaveLength(3);
    expect(tokenModeOptions.map((o) => o.value)).toEqual(['auto', 'reserved', 'manual']);
  });

  it('each option has a label i18n key', () => {
    for (const opt of tokenModeOptions) {
      expect(opt.labelKey).toBeTruthy();
    }
  });
});


describe('AppointmentScheduler paid visit context', () => {
  const selectedDoctor = {
    appointmentId: 11,
    doctorId: 1,
    doctorName: 'Dr Aminul',
    appointmentType: 'new_patient',
    appointmentDate: '2026-05-12',
    paidAt: '2026-05-12 09:10:00',
  };
  const anotherDoctor = {
    appointmentId: 12,
    doctorId: 2,
    doctorName: 'Dr Farhana',
    appointmentType: 'old_patient',
    appointmentDate: '2026-05-15',
    paidAt: '2026-05-15 11:20:00',
  };

  it('keeps selected doctor history primary and a different latest appointment secondary', () => {
    expect(getPaidVisitContextDisplay({
      selectedDoctor,
      latestAnyDoctor: anotherDoctor,
    })).toEqual({
      primary: selectedDoctor,
      secondary: anotherDoctor,
    });
  });

  it('suppresses duplicate secondary context and handles missing history', () => {
    expect(getPaidVisitContextDisplay({
      selectedDoctor,
      latestAnyDoctor: selectedDoctor,
    })).toEqual({ primary: selectedDoctor, secondary: null });
    expect(getPaidVisitContextDisplay({
      selectedDoctor,
      latestAnyDoctor: { ...anotherDoctor, appointmentId: 99, doctorId: selectedDoctor.doctorId },
    })).toEqual({ primary: selectedDoctor, secondary: null });
    expect(getPaidVisitContextDisplay(undefined)).toEqual({ primary: null, secondary: null });
  });

  it('includes the paid-history panel labels in the booking modal', () => {
    const source = readFileSync('src/pages/AppointmentScheduler.tsx', 'utf8');
    expect(source).toContain('Last paid with selected doctor');
    expect(source).toContain('Latest paid appointment with another doctor');
  });
});

describe('AppointmentScheduler scheme benefits', () => {
  it('wires optional scheme benefit preview into Pay Now without changing normal flow', () => {
    const source = readFileSync('src/pages/AppointmentScheduler.tsx', 'utf8');
    expect(source).toContain('appointmentBenefitDrafts');
    expect(source).toContain('checkAppointmentSchemePreviewMutation');
    expect(source).toContain("service_category: 'appointment_payment'");
    expect(source).toContain("serviceCategory: preview.service_category ?? 'appointment_payment'");
    expect(source).toContain('schemeApplication: preview?.eligible');
    expect(source).toContain('Optional: leave empty for normal Pay Now.');
  });
});
