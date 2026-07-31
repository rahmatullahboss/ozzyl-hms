import { describe, expect, it } from 'vitest';
import {
  appointmentStatusForDoctorAction,
  deriveDoctorDashboardStatus,
  doctorQueueSortRank,
  formatAppointmentTypeLabel,
  formatBillingStatusLabel,
  queueStatusForDoctorAction,
  resolveDoctorDashboardDate,
  summarizeDoctorQueue,
} from '../src/lib/doctor-dashboard';

describe('doctor dashboard contract', () => {
  it('uses requested dashboard date only when it is an ISO local date', () => {
    expect(resolveDoctorDashboardDate('2026-05-16', '2026-05-15')).toBe('2026-05-16');
    expect(resolveDoctorDashboardDate('2026/05/16', '2026-05-15')).toBe('2026-05-15');
    expect(resolveDoctorDashboardDate(undefined, '2026-05-15')).toBe('2026-05-15');
  });

  it('derives doctor queue status from appointment and queue state', () => {
    expect(deriveDoctorDashboardStatus('checked_in', 'serving')).toBe('in_progress');
    expect(deriveDoctorDashboardStatus('scheduled', 'in_room')).toBe('in_progress');
    expect(deriveDoctorDashboardStatus('in_progress', 'waiting')).toBe('in_progress');
    expect(deriveDoctorDashboardStatus('completed', 'serving')).toBe('completed');
    expect(deriveDoctorDashboardStatus('scheduled', 'waiting')).toBe('waiting');
    expect(deriveDoctorDashboardStatus('no_show', 'waiting')).toBe('no_show');
  });

  it('maps doctor UI actions to valid appointment and queue statuses', () => {
    expect(appointmentStatusForDoctorAction('in_progress')).toBe('checked_in');
    expect(queueStatusForDoctorAction('in_progress')).toBe('serving');
    expect(appointmentStatusForDoctorAction('completed')).toBe('completed');
    expect(queueStatusForDoctorAction('completed')).toBe('completed');
  });

  it('summarizes normalized dashboard queue statuses for KPI cards', () => {
    expect(summarizeDoctorQueue([
      { status: 'waiting' },
      { status: 'in_progress' },
      { status: 'completed' },
      { status: 'waiting' },
    ])).toEqual({ total: 4, completed: 1, waiting: 2, in_progress: 1 });
  });

  it('keeps in-room and emergency patients above normal waiting patients', () => {
    const queue = [
      { status: 'waiting', visit_type: 'opd', queue_priority: 'normal' },
      { status: 'waiting', visit_type: 'emergency', queue_priority: 'normal' },
      { status: 'in_progress', visit_type: 'opd', queue_priority: 'normal' },
      { status: 'waiting', visit_type: 'opd', queue_priority: 'urgent' },
    ].sort((a, b) => doctorQueueSortRank(a) - doctorQueueSortRank(b));

    expect(queue.map(item => item.status === 'in_progress' ? 'room' : item.visit_type === 'emergency' ? 'emergency' : item.queue_priority)).toEqual([
      'room',
      'emergency',
      'urgent',
      'normal',
    ]);
  });

  it('uses professional visit and payment labels instead of fraud wording', () => {
    expect(formatAppointmentTypeLabel('report_show')).toBe('Report show');
    expect(formatAppointmentTypeLabel('free_visit')).toBe('Free approved');
    expect(formatBillingStatusLabel('due_approved')).toBe('Due approved');
    expect(formatBillingStatusLabel('paid')).toBe('Paid');
  });
});
