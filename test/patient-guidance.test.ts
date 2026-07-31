import { describe, expect, it } from 'vitest';
import { composePatientGuidance } from '../src/lib/patient-guidance';

describe('composePatientGuidance', () => {
  it('prioritizes incomplete identity and pending review items', () => {
    const result = composePatientGuidance({
      hasPhone: false,
      hasNationalId: false,
      upcomingAppointments: 1,
      recentPrescriptions: 1,
      pendingReviewItems: 3,
      verifiedItems: 2,
      vaultDocuments: 0,
      hasActiveVisitPass: false,
      recentLifestyleLog: true,
      recentAdr: true,
    });

    expect(result.status).toBe('attention');
    expect(result.headline.toLowerCase()).toContain('follow-up');
    expect(result.next_steps.some((item) => item.toLowerCase().includes('phone'))).toBe(true);
    expect(result.next_steps.some((item) => item.toLowerCase().includes('nid'))).toBe(true);
    expect(result.trust_notes.some((item) => item.toLowerCase().includes('pending review'))).toBe(true);
    expect(result.care_reminders.some((item) => item.toLowerCase().includes('visit pass'))).toBe(true);
  });

  it('returns stable guidance when identity is complete and reviewed data dominates', () => {
    const result = composePatientGuidance({
      hasPhone: true,
      hasNationalId: true,
      upcomingAppointments: 0,
      recentPrescriptions: 0,
      pendingReviewItems: 0,
      verifiedItems: 4,
      vaultDocuments: 3,
      hasActiveVisitPass: true,
      recentLifestyleLog: false,
      recentAdr: false,
    });

    expect(result.status).toBe('stable');
    expect(result.summary.toLowerCase()).toContain('doctor-reviewed');
    expect(result.trust_notes.some((item) => item.toLowerCase().includes('doctor-reviewed'))).toBe(true);
    expect(result.counts.active_visit_pass).toBe(1);
  });
});
