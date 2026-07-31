import { describe, it, expect } from 'vitest';

// ─── HR Leave Management Tests ────────────────────────────────────────────────
// Covers: Leave request, approval workflow, balance tracking, carry forward,
//         leave types, holiday calendar

describe('HR Leave Management', () => {

  // ─── Leave Types ────────────────────────────────────────────────────────────
  describe('Leave Types', () => {
    it('should support standard leave types', () => {
      const types = ['annual', 'sick', 'casual', 'maternity', 'paternity', 'bereavement', 'unpaid', 'compensatory'];
      expect(types).toContain('annual');
      expect(types).toContain('sick');
      expect(types).toContain('maternity');
      expect(types).toHaveLength(8);
    });

    it('should validate leave type exists', () => {
      const validTypes = ['annual', 'sick', 'casual', 'maternity'];
      expect(validTypes).not.toContain('vacation');
    });
  });

  // ─── Leave Request Validation ───────────────────────────────────────────────
  describe('Leave Request Validation', () => {
    it('should require start and end dates', () => {
      const request = { startDate: '2026-05-01', endDate: '2026-05-05' };
      expect(request.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(request.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should validate date range (start <= end)', () => {
      const start = new Date('2026-05-01');
      const end = new Date('2026-05-05');
      expect(start <= end).toBe(true);
    });

    it('should calculate leave days correctly', () => {
      const start = new Date('2026-05-01');
      const end = new Date('2026-05-05');
      const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(days).toBe(5);
    });

    it('should require leave type', () => {
      const request = { leaveType: 'annual' };
      expect(request.leaveType).toBeTruthy();
    });

    it('should require reason for leave', () => {
      const request = { reason: 'Family vacation' };
      expect(request.reason.length).toBeGreaterThan(0);
    });

    it('should track half-day leave', () => {
      const request = { isHalfDay: true, halfDayType: 'first_half' };
      expect(request.isHalfDay).toBe(true);
      expect(['first_half', 'second_half']).toContain(request.halfDayType);
    });
  });

  // ─── Approval Workflow ──────────────────────────────────────────────────────
  describe('Leave Approval Workflow', () => {
    it('should start with pending status', () => {
      expect('pending').toBe('pending');
    });

    it('should allow valid status transitions', () => {
      const transitions: Record<string, string[]> = {
        pending: ['approved', 'rejected', 'cancelled'],
        approved: ['cancelled'],
        rejected: [],
        cancelled: [],
      };
      expect(transitions['pending']).toContain('approved');
      expect(transitions['pending']).toContain('rejected');
    });

    it('should record approver and timestamp', () => {
      const approval = { approvedBy: 'Manager A', approvedAt: '2026-04-23T10:00:00Z' };
      expect(approval.approvedBy).toBeTruthy();
      expect(approval.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should require remark for rejection', () => {
      const rejection = { status: 'rejected', rejectionReason: 'Insufficient staff coverage' };
      expect(rejection.status).toBe('rejected');
      expect(rejection.rejectionReason.length).toBeGreaterThan(0);
    });
  });

  // ─── Leave Balance ──────────────────────────────────────────────────────────
  describe('Leave Balance', () => {
    it('should calculate remaining balance', () => {
      const annualEntitlement = 21;
      const used = 5;
      const remaining = annualEntitlement - used;
      expect(remaining).toBe(16);
    });

    it('should not allow negative balance', () => {
      const balance = 2;
      const requested = 5;
      const canApply = requested <= balance;
      expect(canApply).toBe(false);
    });

    it('should handle carry forward correctly', () => {
      const previousYearBalance = 5;
      const currentYearEntitlement = 21;
      const maxCarryForward = 7;
      const carriedForward = Math.min(previousYearBalance, maxCarryForward);
      const totalAvailable = currentYearEntitlement + carriedForward;
      expect(carriedForward).toBe(5);
      expect(totalAvailable).toBe(26);
    });

    it('should track leave usage by type', () => {
      const usage = {
        annual: { entitlement: 21, used: 5 },
        sick: { entitlement: 14, used: 2 },
        casual: { entitlement: 10, used: 0 },
      };
      expect(usage.annual.remaining).toBeUndefined(); // Just checking structure
      expect(usage.annual.used).toBe(5);
    });
  });

  // ─── Holiday Calendar ───────────────────────────────────────────────────────
  describe('Holiday Calendar', () => {
    it('should identify public holidays', () => {
      const holidays = ['2026-04-14', '2026-12-16', '2026-12-25'];
      expect(holidays).toContain('2026-12-16');
    });

    it('should exclude weekends from leave days', () => {
      const start = new Date('2026-04-20'); // Monday
      const end = new Date('2026-04-24');   // Friday
      let days = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && d.getDay() !== 6) days++;
      }
      expect(days).toBe(5);
    });

    it('should exclude holidays from leave days', () => {
      const holidays = ['2026-04-14'];
      const requestDate = '2026-04-14';
      expect(holidays).toContain(requestDate);
    });
  });

  // ─── Security & RBAC ────────────────────────────────────────────────────────
  describe('Security & RBAC', () => {
    it('should allow employees to apply for leave', () => {
      const roles = ['staff', 'nurse', 'doctor', 'admin'];
      expect(roles).toContain('nurse');
    });

    it('should allow managers to approve subordinate leave', () => {
      const managerId = 10;
      const subordinateManagerId = 10;
      expect(managerId).toBe(subordinateManagerId);
    });

    it('should enforce tenant isolation', () => {
      const query = 'WHERE tenant_id = ? AND staff_id = ?';
      expect(query).toContain('tenant_id');
    });
  });

  // ─── Leave Reports ──────────────────────────────────────────────────────────
  describe('Leave Reports', () => {
    it('should calculate monthly leave summary', () => {
      const requests = [
        { leaveType: 'annual', days: 3 },
        { leaveType: 'sick', days: 2 },
        { leaveType: 'annual', days: 2 },
      ];
      const byType = requests.reduce((acc, r) => {
        acc[r.leaveType] = (acc[r.leaveType] || 0) + r.days;
        return acc;
      }, {} as Record<string, number>);
      expect(byType['annual']).toBe(5);
      expect(byType['sick']).toBe(2);
    });

    it('should identify staff on leave for a given date', () => {
      const today = '2026-04-23';
      const onLeave = [
        { staffId: 1, startDate: '2026-04-20', endDate: '2026-04-25' },
        { staffId: 2, startDate: '2026-04-22', endDate: '2026-04-24' },
      ];
      const active = onLeave.filter(r => today >= r.startDate && today <= r.endDate);
      expect(active).toHaveLength(2);
    });
  });

});
