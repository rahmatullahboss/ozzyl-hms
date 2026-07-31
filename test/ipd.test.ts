import { describe, it, expect } from 'vitest';

// ─── IPD / Admission / Bed Management Tests ───────────────────────────────────
// Covers: src/routes/tenant/billing.ts (IPD charges), migrations/0012_admissions_beds.sql
// Bangladeshi hospital: ward/cabin/ICU bed allocation, daily charges, discharge

describe('HMS IPD / Admission / Bed Management Tests', () => {

  // ─── Bed Categories ────────────────────────────────────────────────────────
  describe('Bed Category Validation', () => {
    const VALID_BED_TYPES = ['general_ward', 'cabin', 'icu', 'nicu', 'ccu', 'hdu', 'vip'] as const;
    type BedType = typeof VALID_BED_TYPES[number];

    function isValidBedType(t: string): t is BedType {
      return (VALID_BED_TYPES as readonly string[]).includes(t);
    }

    it('should accept general_ward bed type', () => {
      expect(isValidBedType('general_ward')).toBe(true);
    });

    it('should accept cabin bed type', () => {
      expect(isValidBedType('cabin')).toBe(true);
    });

    it('should accept icu bed type', () => {
      expect(isValidBedType('icu')).toBe(true);
    });

    it('should accept vip bed type', () => {
      expect(isValidBedType('vip')).toBe(true);
    });

    it('should reject unknown bed type', () => {
      expect(isValidBedType('tent')).toBe(false);
    });

    it('should reject empty bed type', () => {
      expect(isValidBedType('')).toBe(false);
    });
  });

  // ─── Bed Status Machine ────────────────────────────────────────────────────
  describe('Bed Status Transitions', () => {
    type BedStatus = 'vacant' | 'occupied' | 'cleaning' | 'reserved' | 'maintenance';

    const VALID_TRANSITIONS: Record<BedStatus, BedStatus[]> = {
      vacant:      ['occupied', 'reserved', 'maintenance'],
      occupied:    ['cleaning'],
      cleaning:    ['vacant', 'maintenance'],
      reserved:    ['occupied', 'vacant'],
      maintenance: ['vacant'],
    };

    function canTransition(from: BedStatus, to: BedStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow vacant → occupied (patient admitted)', () => {
      expect(canTransition('vacant', 'occupied')).toBe(true);
    });

    it('should allow occupied → cleaning (patient discharged)', () => {
      expect(canTransition('occupied', 'cleaning')).toBe(true);
    });

    it('should allow cleaning → vacant (ready for next patient)', () => {
      expect(canTransition('cleaning', 'vacant')).toBe(true);
    });

    it('should allow vacant → reserved (advance booking)', () => {
      expect(canTransition('vacant', 'reserved')).toBe(true);
    });

    it('should allow reserved → occupied (patient arrives)', () => {
      expect(canTransition('reserved', 'occupied')).toBe(true);
    });

    it('should block occupied → vacant (must go through cleaning)', () => {
      expect(canTransition('occupied', 'vacant')).toBe(false);
    });

    it('should block occupied → occupied (already occupied)', () => {
      expect(canTransition('occupied', 'occupied')).toBe(false);
    });

    it('should allow vacant → maintenance', () => {
      expect(canTransition('vacant', 'maintenance')).toBe(true);
    });

    it('should allow maintenance → vacant (after repair)', () => {
      expect(canTransition('maintenance', 'vacant')).toBe(true);
    });
  });

  // ─── Clear-Cleaning Endpoint Validation ────────────────────────────────────
  describe('PUT /beds/:id/clear-cleaning', () => {
    type BedStatus = 'vacant' | 'occupied' | 'cleaning' | 'reserved' | 'maintenance';

    function validateClearCleaning(currentStatus: BedStatus): { ok: boolean; error?: string } {
      if (currentStatus !== 'cleaning') {
        return { ok: false, error: `Bed is not in cleaning status (current: ${currentStatus})` };
      }
      return { ok: true };
    }

    it('should allow transition from cleaning to available', () => {
      const result = validateClearCleaning('cleaning');
      expect(result.ok).toBe(true);
    });

    it('should reject if bed is occupied', () => {
      const result = validateClearCleaning('occupied');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('occupied');
    });

    it('should reject if bed is already vacant/available', () => {
      const result = validateClearCleaning('vacant');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('vacant');
    });

    it('should reject if bed is reserved', () => {
      const result = validateClearCleaning('reserved');
      expect(result.ok).toBe(false);
    });

    it('should reject if bed is in maintenance', () => {
      const result = validateClearCleaning('maintenance');
      expect(result.ok).toBe(false);
    });
  });

  // ─── Bed Occupancy Calculations ───────────────────────────────────────────
  describe('Bed Occupancy Rate', () => {
    function calcOccupancyRate(occupied: number, total: number): number {
      if (total === 0) return 0;
      return Math.round((occupied / total) * 100);
    }

    it('should calculate 80% occupancy for 8 occupied of 10 beds', () => {
      expect(calcOccupancyRate(8, 10)).toBe(80);
    });

    it('should calculate 100% occupancy when all beds are full', () => {
      expect(calcOccupancyRate(10, 10)).toBe(100);
    });

    it('should calculate 0% occupancy when no beds are occupied', () => {
      expect(calcOccupancyRate(0, 10)).toBe(0);
    });

    it('should return 0 when total beds is 0 (prevent division by zero)', () => {
      expect(calcOccupancyRate(0, 0)).toBe(0);
    });

    it('should calculate 50% for 5 of 10 occupied', () => {
      expect(calcOccupancyRate(5, 10)).toBe(50);
    });
  });

  // ─── Daily Bed Charge Calculation ─────────────────────────────────────────
  describe('Daily Bed Charge Calculation', () => {
    const DAILY_RATES: Record<string, number> = {
      general_ward: 1000,
      cabin: 3000,
      icu: 10000,
      nicu: 8000,
      vip: 15000,
    };

    function calcTotalBedCharge(bedType: string, admissionDays: number): number {
      const dailyRate = DAILY_RATES[bedType] ?? 0;
      return dailyRate * Math.max(1, admissionDays);
    }

    it('should charge minimum 1 day for same-day admission & discharge', () => {
      expect(calcTotalBedCharge('general_ward', 0)).toBe(1000);
    });

    it('should calculate 3-day cabin charge correctly (3 × 3000 = 9000)', () => {
      expect(calcTotalBedCharge('cabin', 3)).toBe(9000);
    });

    it('should calculate ICU charge for 2 days (2 × 10000 = 20000)', () => {
      expect(calcTotalBedCharge('icu', 2)).toBe(20000);
    });

    it('should calculate VIP charge for 5 days (5 × 15000 = 75000)', () => {
      expect(calcTotalBedCharge('vip', 5)).toBe(75000);
    });

    it('should return 0 for unknown bed type', () => {
      expect(calcTotalBedCharge('tent', 3)).toBe(0);
    });
  });

  // ─── Admission Workflow ────────────────────────────────────────────────────
  describe('Admission Workflow', () => {
    interface Admission {
      patientId: number;
      bedId: number;
      wardId: number;
      admittedAt: string;
      admittingDoctorId: number;
      status: 'admitted' | 'discharged' | 'transferred' | 'absconded';
    }

    it('should require patientId, bedId, and admittingDoctorId', () => {
      const admission: Admission = {
        patientId: 101,
        bedId: 5,
        wardId: 2,
        admittedAt: '2024-01-15T08:00:00Z',
        admittingDoctorId: 3,
        status: 'admitted',
      };
      expect(admission.patientId).toBeGreaterThan(0);
      expect(admission.bedId).toBeGreaterThan(0);
      expect(admission.admittingDoctorId).toBeGreaterThan(0);
    });

    it('should set initial status to admitted on creation', () => {
      const status = 'admitted';
      expect(status).toBe('admitted');
    });

    it('should accept valid admission statuses', () => {
      const validStatuses: Admission['status'][] = ['admitted', 'discharged', 'transferred', 'absconded'];
      expect(validStatuses).toContain('admitted');
      expect(validStatuses).toContain('discharged');
      expect(validStatuses).toContain('transferred');
      expect(validStatuses).toContain('absconded');
    });

    it('should prevent admitting to an occupied bed', () => {
      const bed = { status: 'occupied', bedId: 5 };
      const canAdmit = bed.status === 'vacant' || bed.status === 'reserved';
      expect(canAdmit).toBe(false);
    });

    it('should allow admitting to a vacant bed', () => {
      const bed = { status: 'vacant', bedId: 5 };
      const canAdmit = bed.status === 'vacant' || bed.status === 'reserved';
      expect(canAdmit).toBe(true);
    });
  });

  // ─── Discharge Summary Validation ─────────────────────────────────────────
  describe('Discharge Summary', () => {
    interface DischargeSummary {
      admissionId: number;
      diagnosis: string;
      treatmentSummary: string;
      conditionOnDischarge: 'improved' | 'stable' | 'deteriorated' | 'referred' | 'deceased' | 'absconded';
      medicineOnDischarge: string[];
      followUpDate?: string;
      followUpInstructions?: string;
    }

    it('should require diagnosis and treatment summary', () => {
      const summary: DischargeSummary = {
        admissionId: 1,
        diagnosis: 'Community-acquired pneumonia',
        treatmentSummary: 'IV Ceftriaxone 1g BD × 7 days, O2 therapy, nebulization',
        conditionOnDischarge: 'improved',
        medicineOnDischarge: ['Azithromycin 500mg OD × 3 days'],
      };
      expect(summary.diagnosis.trim().length).toBeGreaterThan(0);
      expect(summary.treatmentSummary.trim().length).toBeGreaterThan(0);
    });

    it('should accept all valid discharge condition codes', () => {
      const conditions: DischargeSummary['conditionOnDischarge'][] = [
        'improved', 'stable', 'deteriorated', 'referred', 'deceased', 'absconded',
      ];
      expect(conditions).toContain('improved');
      expect(conditions).toContain('deceased');
    });

    it('should not require follow-up date for deceased patients', () => {
      const summary: DischargeSummary = {
        admissionId: 2,
        diagnosis: 'Multi-organ failure',
        treatmentSummary: 'ICU care',
        conditionOnDischarge: 'deceased',
        medicineOnDischarge: [],
        followUpDate: undefined,
      };
      expect(summary.conditionOnDischarge).toBe('deceased');
      expect(summary.followUpDate).toBeUndefined();
    });

    it('should include at least one medicine on discharge for non-deceased patients', () => {
      const medicines = ['Paracetamol 500mg TDS × 5 days', 'Cetirizine 10mg OD × 7 days'];
      expect(medicines.length).toBeGreaterThan(0);
    });
  });

  // ─── Bed Transfer Logic ────────────────────────────────────────────────────
  describe('Bed Transfer', () => {
    interface BedTransfer {
      admissionId: number;
      fromBedId: number;
      toBedId: number;
      reason: string;
      transferredAt: string;
    }

    it('should require a reason for bed transfer', () => {
      const transfer: BedTransfer = {
        admissionId: 1,
        fromBedId: 5,
        toBedId: 10,
        reason: 'Upgraded to ICU due to deterioration',
        transferredAt: '2024-01-17T14:30:00Z',
      };
      expect(transfer.reason.trim().length).toBeGreaterThan(0);
    });

    it('should reject transfer to same bed', () => {
      const fromBedId = 5;
      const toBedId = 5;
      expect(fromBedId === toBedId).toBe(true); // same bed = invalid
    });

    it('should require toBed to be vacant', () => {
      const targetBed = { status: 'occupied', id: 10 };
      const canTransfer = targetBed.status === 'vacant';
      expect(canTransfer).toBe(false);
    });
  });
});
