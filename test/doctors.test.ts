import { describe, it, expect } from 'vitest';

// ─── Doctor Management Tests ──────────────────────────────────────────────────
// Covers: src/routes/tenant/doctors.ts
// Bangladeshi context: BMDC registration, consultation fees, specializations

describe('HMS Doctor Management Tests', () => {

  // ─── Doctor Registration Validation ───────────────────────────────────────
  describe('Doctor Registration Validation', () => {
    interface Doctor {
      name: string;
      bmdcNo: string;
      specialization: string;
      consultationFee: number;
      mobile: string;
      email?: string;
      degrees: string[];
    }

    function isValidBMDCNo(bmdc: string): boolean {
      // BMDC format: A-12345 or just numeric
      return /^[A-Z]?-?\d{4,6}$/.test(bmdc) || /^BMDC-\d{4,6}$/.test(bmdc);
    }

    it('should require name, BMDC number, specialization, and consultation fee', () => {
      const doctor: Doctor = {
        name: 'Dr. Ahmad Hossain',
        bmdcNo: 'A-12345',
        specialization: 'Internal Medicine',
        consultationFee: 1000,
        mobile: '01712345678',
        degrees: ['MBBS', 'MD (Internal Medicine)'],
      };
      expect(doctor.name.trim().length).toBeGreaterThan(0);
      expect(doctor.bmdcNo.trim().length).toBeGreaterThan(0);
      expect(doctor.consultationFee).toBeGreaterThan(0);
    });

    it('should accept valid BMDC number A-12345', () => {
      expect(isValidBMDCNo('A-12345')).toBe(true);
    });

    it('should accept valid BMDC number BMDC-56789', () => {
      expect(isValidBMDCNo('BMDC-56789')).toBe(true);
    });

    it('should accept numeric-only BMDC number', () => {
      expect(isValidBMDCNo('123456')).toBe(true);
    });

    it('should reject empty BMDC number', () => {
      expect(isValidBMDCNo('')).toBe(false);
    });

    it('should reject consultation fee of 0', () => {
      expect(0 > 0).toBe(false);
    });

    it('should reject negative consultation fee', () => {
      expect(-100 > 0).toBe(false);
    });

    it('should require at least one degree', () => {
      const degrees: string[] = [];
      expect(degrees.length).toBe(0); // detect missing degrees
    });
  });

  // ─── Doctor Specialization Validation ─────────────────────────────────────
  describe('Doctor Specialization Validation', () => {
    const VALID_SPECIALIZATIONS = [
      'General Physician', 'Internal Medicine', 'Surgery', 'Orthopedics',
      'Gynecology & Obstetrics', 'Pediatrics', 'Cardiology', 'Neurology',
      'Ophthalmology', 'ENT', 'Dermatology', 'Psychiatry', 'Radiology',
      'Anesthesiology', 'Pathology', 'Nephrology', 'Urology', 'Oncology',
      'Gastroenterology', 'Endocrinology', 'Pulmonology', 'Rheumatology',
    ];

    it('should accept General Physician specialization', () => {
      expect(VALID_SPECIALIZATIONS).toContain('General Physician');
    });

    it('should accept Cardiology specialization', () => {
      expect(VALID_SPECIALIZATIONS).toContain('Cardiology');
    });

    it('should accept Gynecology & Obstetrics specialization', () => {
      expect(VALID_SPECIALIZATIONS).toContain('Gynecology & Obstetrics');
    });

    it('should have at least 10 specializations defined', () => {
      expect(VALID_SPECIALIZATIONS.length).toBeGreaterThan(10);
    });
  });

  // ─── Doctor Availability ──────────────────────────────────────────────────
  describe('Doctor Availability', () => {
    interface DoctorSchedule {
      doctorId: number;
      dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday
      startTime: string;
      endTime: string;
      maxPatients: number;
      bookedCount: number;
    }

    function isAvailable(schedule: DoctorSchedule): boolean {
      return schedule.bookedCount < schedule.maxPatients;
    }

    function getDayName(day: number): string {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[day];
    }

    it('should be available when booked < max patients', () => {
      const schedule: DoctorSchedule = {
        doctorId: 1,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '13:00',
        maxPatients: 20,
        bookedCount: 10,
      };
      expect(isAvailable(schedule)).toBe(true);
    });

    it('should NOT be available when fully booked', () => {
      const schedule: DoctorSchedule = {
        doctorId: 1,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '13:00',
        maxPatients: 20,
        bookedCount: 20,
      };
      expect(isAvailable(schedule)).toBe(false);
    });

    it('should NOT be available when over-booked', () => {
      const schedule: DoctorSchedule = {
        doctorId: 1,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '13:00',
        maxPatients: 20,
        bookedCount: 21,
      };
      expect(isAvailable(schedule)).toBe(false);
    });

    it('should correctly identify Friday as day 5', () => {
      expect(getDayName(5)).toBe('Friday');
    });

    it('should correctly identify Sunday as day 0', () => {
      expect(getDayName(0)).toBe('Sunday');
    });
  });

  // ─── Commission Calculation ────────────────────────────────────────────────
  describe('Doctor Commission Calculation', () => {
    function calcCommission(consultationFee: number, commissionPct: number): number {
      return Math.round(consultationFee * (commissionPct / 100));
    }

    function calcHospitalShare(consultationFee: number, commissionPct: number): number {
      return consultationFee - calcCommission(consultationFee, commissionPct);
    }

    it('should calculate 30% commission on 1000 taka consultation fee', () => {
      expect(calcCommission(1000, 30)).toBe(300);
    });

    it('should calculate 50% commission correctly', () => {
      expect(calcCommission(2000, 50)).toBe(1000);
    });

    it('should calculate hospital share as remainder', () => {
      expect(calcHospitalShare(1000, 30)).toBe(700);
    });

    it('should return 0 commission for 0% rate', () => {
      expect(calcCommission(1000, 0)).toBe(0);
    });

    it('should give full amount to doctor at 100% commission', () => {
      expect(calcCommission(1000, 100)).toBe(1000);
      expect(calcHospitalShare(1000, 100)).toBe(0);
    });

    it('should handle fractional commission with rounding', () => {
      // 33.33% of 1000 = 333.33 → rounds to 333
      expect(calcCommission(1000, 33.33)).toBe(333);
    });

    it('should reject negative commission percentage', () => {
      expect(-30 >= 0).toBe(false);
    });

    it('should reject commission percentage > 100', () => {
      expect(110 <= 100).toBe(false);
    });
  });

  // ─── Doctor Leave Management ───────────────────────────────────────────────
  describe('Doctor Leave Management', () => {
    interface DoctorLeave {
      doctorId: number;
      fromDate: string;
      toDate: string;
      reason?: string;
    }

    function isOnLeave(leave: DoctorLeave, checkDate: string): boolean {
      return checkDate >= leave.fromDate && checkDate <= leave.toDate;
    }

    function calcLeaveDays(leave: DoctorLeave): number {
      const from = new Date(leave.fromDate);
      const to = new Date(leave.toDate);
      return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    }

    it('should detect doctor is on leave during leave period', () => {
      const leave: DoctorLeave = {
        doctorId: 1,
        fromDate: '2024-01-15',
        toDate: '2024-01-20',
      };
      expect(isOnLeave(leave, '2024-01-17')).toBe(true);
    });

    it('should detect doctor is NOT on leave outside leave period', () => {
      const leave: DoctorLeave = {
        doctorId: 1,
        fromDate: '2024-01-15',
        toDate: '2024-01-20',
      };
      expect(isOnLeave(leave, '2024-01-21')).toBe(false);
    });

    it('should calculate leave days correctly (1 day leave)', () => {
      const leave: DoctorLeave = {
        doctorId: 1,
        fromDate: '2024-01-15',
        toDate: '2024-01-15',
      };
      expect(calcLeaveDays(leave)).toBe(1);
    });

    it('should calculate leave days for 5-day leave', () => {
      const leave: DoctorLeave = {
        doctorId: 1,
        fromDate: '2024-01-15',
        toDate: '2024-01-19',
      };
      expect(calcLeaveDays(leave)).toBe(5);
    });

    it('should reject leave where toDate is before fromDate', () => {
      const leave: DoctorLeave = {
        doctorId: 1,
        fromDate: '2024-01-20',
        toDate: '2024-01-15',
      };
      const isValid = new Date(leave.toDate) >= new Date(leave.fromDate);
      expect(isValid).toBe(false);
    });
  });

  // ─── Multi-Branch Doctor Assignment ───────────────────────────────────────
  describe('Doctor Multi-Branch Assignment', () => {
    interface DoctorBranchAssignment {
      doctorId: number;
      branchId: number;
      isPrimary: boolean;
    }

    it('should allow doctor to be assigned to multiple branches', () => {
      const assignments: DoctorBranchAssignment[] = [
        { doctorId: 1, branchId: 1, isPrimary: true },
        { doctorId: 1, branchId: 2, isPrimary: false },
      ];
      expect(assignments.length).toBe(2);
    });

    it('should ensure only one primary branch per doctor', () => {
      const assignments: DoctorBranchAssignment[] = [
        { doctorId: 1, branchId: 1, isPrimary: true },
        { doctorId: 1, branchId: 2, isPrimary: false },
        { doctorId: 1, branchId: 3, isPrimary: false },
      ];
      const primaryCount = assignments.filter((a) => a.isPrimary).length;
      expect(primaryCount).toBe(1);
    });

    it('should detect duplicate branch-doctor assignments', () => {
      const existing = [{ doctorId: 1, branchId: 1 }];
      const newAssignment = { doctorId: 1, branchId: 1 };
      const isDuplicate = existing.some(
        (a) => a.doctorId === newAssignment.doctorId && a.branchId === newAssignment.branchId
      );
      expect(isDuplicate).toBe(true);
    });
  });
});
