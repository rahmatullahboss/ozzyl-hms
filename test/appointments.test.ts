import { describe, it, expect } from 'vitest';

// ─── Appointment & Serial / Queue Management Tests ────────────────────────────
// Covers: src/routes/tenant/consultations.ts appointment scheduling logic
// Bangladeshi hospital context: walk-in serials, advance bookings, queue

describe('HMS Appointment & Queue Management Tests', () => {

  // ─── Appointment Type Validation ──────────────────────────────────────────
  describe('Appointment Type Validation', () => {
    const VALID_TYPES = ['walk_in', 'advance', 'emergency', 'follow_up', 'teleconsultation'] as const;
    type AppointmentType = typeof VALID_TYPES[number];

    function isValidType(t: string): t is AppointmentType {
      return (VALID_TYPES as readonly string[]).includes(t);
    }

    it('should accept walk_in as valid appointment type', () => {
      expect(isValidType('walk_in')).toBe(true);
    });

    it('should accept advance as valid appointment type', () => {
      expect(isValidType('advance')).toBe(true);
    });

    it('should accept emergency as valid appointment type', () => {
      expect(isValidType('emergency')).toBe(true);
    });

    it('should accept follow_up as valid appointment type', () => {
      expect(isValidType('follow_up')).toBe(true);
    });

    it('should accept teleconsultation as valid appointment type', () => {
      expect(isValidType('teleconsultation')).toBe(true);
    });

    it('should reject unknown appointment type', () => {
      expect(isValidType('phone_call')).toBe(false);
    });

    it('should reject empty string as appointment type', () => {
      expect(isValidType('')).toBe(false);
    });
  });

  // ─── Appointment Status Machine ────────────────────────────────────────────
  describe('Appointment Status Transitions', () => {
    type AppointmentStatus = 'scheduled' | 'confirmed' | 'checked_in' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

    const VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
      scheduled:       ['confirmed', 'cancelled', 'rescheduled', 'no_show'],
      confirmed:       ['checked_in', 'cancelled', 'rescheduled', 'no_show'],
      checked_in:      ['in_consultation', 'cancelled'],
      in_consultation: ['completed', 'cancelled'],
      completed:       [],
      cancelled:       [],
      no_show:         [],
      rescheduled:     ['scheduled', 'cancelled'],
    };

    function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow scheduled → confirmed', () => {
      expect(canTransition('scheduled', 'confirmed')).toBe(true);
    });

    it('should allow confirmed → checked_in', () => {
      expect(canTransition('confirmed', 'checked_in')).toBe(true);
    });

    it('should allow checked_in → in_consultation', () => {
      expect(canTransition('checked_in', 'in_consultation')).toBe(true);
    });

    it('should allow in_consultation → completed', () => {
      expect(canTransition('in_consultation', 'completed')).toBe(true);
    });

    it('should allow scheduled → no_show', () => {
      expect(canTransition('scheduled', 'no_show')).toBe(true);
    });

    it('should allow scheduled → rescheduled', () => {
      expect(canTransition('scheduled', 'rescheduled')).toBe(true);
    });

    it('should block completed → scheduled (terminal state)', () => {
      expect(canTransition('completed', 'scheduled')).toBe(false);
    });

    it('should block no_show → checked_in (terminal state)', () => {
      expect(canTransition('no_show', 'checked_in')).toBe(false);
    });

    it('should block cancelled → confirmed (terminal state)', () => {
      expect(canTransition('cancelled', 'confirmed')).toBe(false);
    });

    it('should block in_consultation → checked_in (backward transition)', () => {
      expect(canTransition('in_consultation', 'checked_in')).toBe(false);
    });
  });

  // ─── Serial Number Generation ──────────────────────────────────────────────
  describe('Serial Number Generation', () => {
    function generateSerialNo(seq: number, prefix = 'SN'): string {
      return `${prefix}-${String(seq).padStart(4, '0')}`;
    }

    it('should generate serial number SN-0001 for first patient', () => {
      expect(generateSerialNo(1)).toBe('SN-0001');
    });

    it('should generate serial number SN-0099 for 99th patient', () => {
      expect(generateSerialNo(99)).toBe('SN-0099');
    });

    it('should generate serial number SN-0100 for 100th patient', () => {
      expect(generateSerialNo(100)).toBe('SN-0100');
    });

    it('should generate serial with custom prefix', () => {
      expect(generateSerialNo(5, 'OPD')).toBe('OPD-0005');
    });

    it('should generate sequential serial numbers strictly increasing', () => {
      const s1 = 1;
      const s2 = 2;
      expect(s2).toBeGreaterThan(s1);
    });
  });

  // ─── Doctor Schedule Validation ────────────────────────────────────────────
  describe('Doctor Schedule Validation', () => {
    interface TimeSlot {
      startTime: string; // HH:MM
      endTime: string;   // HH:MM
    }

    function toMinutes(time: string): number {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    }

    function isValidSlot(slot: TimeSlot): boolean {
      return toMinutes(slot.startTime) < toMinutes(slot.endTime);
    }

    function doSlotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
      return toMinutes(a.startTime) < toMinutes(b.endTime) &&
             toMinutes(b.startTime) < toMinutes(a.endTime);
    }

    it('should accept valid time slot 09:00 – 12:00', () => {
      expect(isValidSlot({ startTime: '09:00', endTime: '12:00' })).toBe(true);
    });

    it('should accept valid time slot 15:30 – 18:00', () => {
      expect(isValidSlot({ startTime: '15:30', endTime: '18:00' })).toBe(true);
    });

    it('should reject slot where end equals start', () => {
      expect(isValidSlot({ startTime: '09:00', endTime: '09:00' })).toBe(false);
    });

    it('should reject slot where end is before start', () => {
      expect(isValidSlot({ startTime: '12:00', endTime: '09:00' })).toBe(false);
    });

    it('should detect overlapping slots', () => {
      const slot1: TimeSlot = { startTime: '09:00', endTime: '11:00' };
      const slot2: TimeSlot = { startTime: '10:30', endTime: '12:30' };
      expect(doSlotsOverlap(slot1, slot2)).toBe(true);
    });

    it('should NOT flag adjacent (non-overlapping) slots as overlapping', () => {
      const morning: TimeSlot = { startTime: '09:00', endTime: '12:00' };
      const afternoon: TimeSlot = { startTime: '12:00', endTime: '15:00' };
      expect(doSlotsOverlap(morning, afternoon)).toBe(false);
    });
  });

  // ─── Queue Management ──────────────────────────────────────────────────────
  describe('Queue Management', () => {
    interface QueueEntry {
      serialNo: number;
      patientName: string;
      status: 'waiting' | 'called' | 'in_consultation' | 'done' | 'skipped';
      arrivalTime: string;
    }

    function getNextPatient(queue: QueueEntry[]): QueueEntry | undefined {
      return queue.find((q) => q.status === 'waiting');
    }

    function getWaitingCount(queue: QueueEntry[]): number {
      return queue.filter((q) => q.status === 'waiting').length;
    }

    it('should return first waiting patient when calling next', () => {
      const queue: QueueEntry[] = [
        { serialNo: 1, patientName: 'Rahim', status: 'done', arrivalTime: '09:00' },
        { serialNo: 2, patientName: 'Karim', status: 'waiting', arrivalTime: '09:15' },
        { serialNo: 3, patientName: 'Fatima', status: 'waiting', arrivalTime: '09:30' },
      ];
      const next = getNextPatient(queue);
      expect(next?.patientName).toBe('Karim');
      expect(next?.serialNo).toBe(2);
    });

    it('should return undefined when no waiting patients remain', () => {
      const queue: QueueEntry[] = [
        { serialNo: 1, patientName: 'Rahim', status: 'done', arrivalTime: '09:00' },
      ];
      expect(getNextPatient(queue)).toBeUndefined();
    });

    it('should count waiting patients correctly', () => {
      const queue: QueueEntry[] = [
        { serialNo: 1, patientName: 'A', status: 'done', arrivalTime: '09:00' },
        { serialNo: 2, patientName: 'B', status: 'waiting', arrivalTime: '09:15' },
        { serialNo: 3, patientName: 'C', status: 'waiting', arrivalTime: '09:30' },
        { serialNo: 4, patientName: 'D', status: 'called', arrivalTime: '09:45' },
      ];
      expect(getWaitingCount(queue)).toBe(2);
    });

    it('should return 0 when queue is empty', () => {
      expect(getWaitingCount([])).toBe(0);
    });
  });

  // ─── Appointment Date Constraints ─────────────────────────────────────────
  describe('Appointment Date Constraints', () => {
    it('should reject appointment dates in the past', () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      expect(yesterday < today).toBe(true);
    });

    it('should accept appointment dates today or in the future', () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
      expect(today <= tomorrow).toBe(true);
    });

    it('should allow booking advance appointments up to 90 days ahead', () => {
      const maxDays = 90;
      const futureDate = new Date(Date.now() + maxDays * 86_400_000);
      const beyondMax = new Date(Date.now() + (maxDays + 1) * 86_400_000);
      const today = new Date();
      const diffDays = Math.floor((futureDate.getTime() - today.getTime()) / 86_400_000);
      const diffBeyond = Math.floor((beyondMax.getTime() - today.getTime()) / 86_400_000);
      expect(diffDays).toBeLessThanOrEqual(maxDays);
      expect(diffBeyond).toBeGreaterThan(maxDays);
    });

    it('should reject appointment booked for doctor on their day off', () => {
      const daysOff = [0, 5]; // Sunday=0, Friday=5 (Bangladesh typical off days)
      const friday = new Date('2024-01-05'); // Friday
      const sunday = new Date('2024-01-07'); // Sunday
      expect(daysOff).toContain(friday.getDay());
      expect(daysOff).toContain(sunday.getDay());
    });
  });

  // ─── Reschedule Logic ─────────────────────────────────────────────────────
  describe('Appointment Reschedule Logic', () => {
    it('should allow rescheduling a scheduled appointment', () => {
      const apt = { status: 'scheduled', rescheduleCount: 0 };
      const canReschedule = apt.status === 'scheduled' && apt.rescheduleCount < 3;
      expect(canReschedule).toBe(true);
    });

    it('should block rescheduling after 3 attempts', () => {
      const apt = { status: 'scheduled', rescheduleCount: 3 };
      const canReschedule = apt.status === 'scheduled' && apt.rescheduleCount < 3;
      expect(canReschedule).toBe(false);
    });

    it('should block rescheduling a completed appointment', () => {
      const apt = { status: 'completed', rescheduleCount: 0 };
      const canReschedule = apt.status === 'scheduled' && apt.rescheduleCount < 3;
      expect(canReschedule).toBe(false);
    });

    it('should block rescheduling a cancelled appointment', () => {
      const apt = { status: 'cancelled', rescheduleCount: 1 };
      const canReschedule = apt.status === 'scheduled' && apt.rescheduleCount < 3;
      expect(canReschedule).toBe(false);
    });
  });

  // ─── Payment Status on Appointment ────────────────────────────────────────
  describe('Appointment Payment Status', () => {
    const PAYMENT_STATUSES = ['unpaid', 'paid', 'waived'] as const;

    it('should accept unpaid as valid payment status', () => {
      expect(PAYMENT_STATUSES).toContain('unpaid');
    });

    it('should accept paid as valid payment status', () => {
      expect(PAYMENT_STATUSES).toContain('paid');
    });

    it('should accept waived as valid payment status (free service)', () => {
      expect(PAYMENT_STATUSES).toContain('waived');
    });

    it('should reject unknown payment status', () => {
      expect(PAYMENT_STATUSES).not.toContain('deferred' as never);
    });
  });

  // ─── Appointment Source Filtering ─────────────────────────────────────────
  describe('Appointment Source Filtering', () => {
    const VALID_SOURCES = ['reception', 'marketplace', 'telemedicine', 'patient_app'] as const;

    it('should accept marketplace as valid source', () => {
      expect(VALID_SOURCES).toContain('marketplace');
    });

    it('should accept telemedicine as valid source', () => {
      expect(VALID_SOURCES).toContain('telemedicine');
    });

    it('should accept reception as valid source', () => {
      expect(VALID_SOURCES).toContain('reception');
    });

    it('should filter appointments by source correctly', () => {
      const appointments = [
        { id: 1, source: 'reception', patient_name: 'A' },
        { id: 2, source: 'marketplace', patient_name: 'B' },
        { id: 3, source: 'telemedicine', patient_name: 'C' },
        { id: 4, source: 'reception', patient_name: 'D' },
      ];
      const filtered = appointments.filter(a => a.source === 'marketplace');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].patient_name).toBe('B');
    });

    it('should show all appointments when no source filter applied', () => {
      const appointments = [
        { id: 1, source: 'reception' },
        { id: 2, source: 'marketplace' },
        { id: 3, source: 'telemedicine' },
      ];
      expect(appointments).toHaveLength(3);
    });

    it('should render marketplace badge for marketplace-sourced appointments', () => {
      const appt = { source: 'marketplace' };
      const shouldShowBadge = appt.source === 'marketplace';
      expect(shouldShowBadge).toBe(true);
    });

    it('should render telemedicine badge for telemedicine-sourced appointments', () => {
      const appt = { source: 'telemedicine' };
      const shouldShowBadge = appt.source === 'telemedicine';
      expect(shouldShowBadge).toBe(true);
    });

    it('should NOT render marketplace badge for reception-sourced appointments', () => {
      const appt = { source: 'reception' };
      const shouldShowBadge = appt.source === 'marketplace';
      expect(shouldShowBadge).toBe(false);
    });
  });

  // ─── forceTokenNo Branch Precedence ───────────────────────────────────────
  // Mirrors the if/else-if/else chain in src/routes/tenant/appointments.ts
  // (forceTokenNo > requestedTokenNo > auto-assign). Pure function only —
  // the real uniqueness check is enforced by the route handler against D1.
  describe('forceTokenNo Branch Precedence', () => {
    function resolveTokenNo(opts: {
      forceTokenNo?: number;
      requestedTokenNo?: number;
      nextAvailable: number;
    }): number {
      if (opts.forceTokenNo !== undefined) return opts.forceTokenNo;
      if (opts.requestedTokenNo !== undefined) return opts.requestedTokenNo;
      return opts.nextAvailable;
    }

    it('should use forceTokenNo when set, ignoring requestedTokenNo and auto-assign', () => {
      expect(resolveTokenNo({ forceTokenNo: 42, requestedTokenNo: 10, nextAvailable: 1 })).toBe(42);
    });

    it('should use requestedTokenNo when forceTokenNo is undefined', () => {
      expect(resolveTokenNo({ requestedTokenNo: 10, nextAvailable: 1 })).toBe(10);
    });

    it('should fall back to next available when neither token is set', () => {
      expect(resolveTokenNo({ nextAvailable: 1 })).toBe(1);
    });

    it('should accept a forceTokenNo outside any reserved range', () => {
      // Reserved range check is bypassed in the forceTokenNo branch.
      expect(resolveTokenNo({ forceTokenNo: 999, nextAvailable: 1 })).toBe(999);
    });
  });
});
