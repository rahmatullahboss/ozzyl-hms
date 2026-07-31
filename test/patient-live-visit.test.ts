import { describe, expect, it } from 'vitest';
import { derivePatientLiveVisit } from '../src/lib/patient-live-visit';

describe('derivePatientLiveVisit', () => {
  it('derives waiting queue context with arrival guidance', () => {
    const result = derivePatientLiveVisit({
      appointment: {
        id: 11,
        appt_date: '2026-04-11',
        appt_time: '10:30',
        doctor_name: 'Dr Ahmed',
        status: 'confirmed',
      },
      queueEntry: {
        id: 22,
        token_no: 'T012',
        token_number: 12,
        status: 'waiting',
        estimated_wait_minutes: 24,
        counter_no: 'Room 3',
        updated_at: '2026-04-11T10:05:00Z',
      },
      visit: {
        id: 44,
        status: 'checked-in',
        visit_date: '2026-04-11',
        updated_at: '2026-04-11T10:00:00Z',
      },
      currentServingTokenNo: 'T009',
      waitingAheadCount: 3,
    });

    expect(result.status).toBe('waiting');
    expect(result.patients_ahead).toBe(3);
    expect(result.estimated_wait_minutes).toBe(24);
    expect(result.arrival_guidance.action).toBe('arrive_soon');
    expect(result.last_updated_at).toBe('2026-04-11T10:05:00Z');
    expect(result.journey.find((step) => step.key === 'checked_in')?.state).toBe('current');
    expect(result.journey.find((step) => step.key === 'called')?.state).toBe('upcoming');
  });

  it('marks the visit as serving when queue status is serving', () => {
    const result = derivePatientLiveVisit({
      appointment: {
        id: 11,
        appt_date: '2026-04-11',
        appt_time: '10:30',
        status: 'checked_in',
      },
      queueEntry: {
        id: 22,
        token_no: 'T012',
        token_number: 12,
        status: 'serving',
        estimated_wait_minutes: 0,
        serve_start_time: '2026-04-11T10:32:00Z',
      },
      visit: {
        id: 44,
        status: 'engaged',
        visit_date: '2026-04-11',
      },
      currentServingTokenNo: 'T012',
      waitingAheadCount: 0,
    });

    expect(result.status).toBe('serving');
    expect(result.arrival_guidance.action).toBe('go_now');
    expect(result.journey.find((step) => step.key === 'serving')?.state).toBe('current');
  });

  it('shows checked-in when hospital has started the visit before queue activation', () => {
    const result = derivePatientLiveVisit({
      appointment: {
        id: 11,
        appt_date: '2026-04-11',
        appt_time: '10:30',
        status: 'confirmed',
      },
      queueEntry: null,
      visit: {
        id: 77,
        status: 'checked-in',
        visit_date: '2026-04-11',
        updated_at: '2026-04-11T09:55:00Z',
      },
      currentServingTokenNo: null,
      waitingAheadCount: 0,
    });

    expect(result.status).toBe('checked_in');
    expect(result.queue).toBeNull();
    expect(result.arrival_guidance.action).toBe('wait_for_hospital');
    expect(result.journey.find((step) => step.key === 'checked_in')?.state).toBe('current');
  });
});
