import { describe, expect, it } from 'vitest';
import { isMedicationEndingSoon, isMissedOrOverdueFollowUp } from '../src/lib/clinical-reminder-dates';

describe('clinical reminder dates', () => {
  it('treats a scheduled follow-up as overdue using the supplied current date', () => {
    expect(isMissedOrOverdueFollowUp('scheduled', '2026-05-25', '2026-05-26')).toBe(true);
    expect(isMissedOrOverdueFollowUp('scheduled', '2026-05-27', '2026-05-26')).toBe(false);
  });

  it('always surfaces explicitly missed or cancelled follow-ups', () => {
    expect(isMissedOrOverdueFollowUp('no_show', '2026-06-01', '2026-05-26')).toBe(true);
    expect(isMissedOrOverdueFollowUp('cancelled', '2026-06-01', '2026-05-26')).toBe(true);
  });

  it('detects medication end dates inside a rolling seven-day review window', () => {
    expect(isMedicationEndingSoon('2026-06-02', '2026-05-26')).toBe(true);
    expect(isMedicationEndingSoon('2026-06-03', '2026-05-26')).toBe(false);
    expect(isMedicationEndingSoon('2026-05-20', '2026-05-26')).toBe(true);
  });
});
