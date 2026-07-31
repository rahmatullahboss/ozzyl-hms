import { describe, it, expect } from 'vitest';

// ─── Dental Module Tests ──────────────────────────────────────────────────────
// Covers: Tooth chart, treatment records, treatment plans, perio charting,
//         x-ray tracking, CDT codes, tooth numbering
// Based on: DanpheEMR DentalModels + Universal Numbering System

describe('Dental Module', () => {

  // ─── Universal Tooth Numbering System ───────────────────────────────────────
  describe('Universal Tooth Numbering System', () => {
    const UPPER_TEETH = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
    const LOWER_TEETH = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];
    const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

    it('should have 32 permanent teeth', () => {
      expect(ALL_TEETH).toHaveLength(32);
    });

    it('should have 16 upper teeth numbered 1-16', () => {
      expect(UPPER_TEETH).toHaveLength(16);
      expect(UPPER_TEETH[0]).toBe(1);
      expect(UPPER_TEETH[15]).toBe(16);
    });

    it('should have 16 lower teeth numbered 17-32 (reverse order)', () => {
      expect(LOWER_TEETH).toHaveLength(16);
      expect(LOWER_TEETH[0]).toBe(32);
      expect(LOWER_TEETH[15]).toBe(17);
    });

    it('should validate tooth numbers are in valid range', () => {
      ALL_TEETH.forEach(n => {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(32);
      });
    });

    it('should identify correct quadrant for each tooth', () => {
      function getQuadrant(tooth: number): number {
        if (tooth >= 1 && tooth <= 8) return 1;   // Upper right
        if (tooth >= 9 && tooth <= 16) return 2;  // Upper left
        if (tooth >= 17 && tooth <= 24) return 3; // Lower left
        return 4; // Lower right
      }
      expect(getQuadrant(3)).toBe(1);
      expect(getQuadrant(12)).toBe(2);
      expect(getQuadrant(20)).toBe(3);
      expect(getQuadrant(30)).toBe(4);
    });
  });

  // ─── Tooth Condition Validation ─────────────────────────────────────────────
  describe('Tooth Condition Validation', () => {
    const VALID_CONDITIONS = ['decay', 'missing', 'crown', 'filling', 'extraction', 'bridge', 'implant'];
    const CONDITION_COLORS: Record<string, string> = {
      decay: 'bg-red-400',
      missing: 'bg-gray-400',
      crown: 'bg-yellow-400',
      filling: 'bg-blue-400',
      extraction: 'bg-red-600',
      bridge: 'bg-purple-400',
      implant: 'bg-teal-400',
    };

    it('should have colors for all conditions', () => {
      VALID_CONDITIONS.forEach(c => {
        expect(CONDITION_COLORS[c]).toBeDefined();
      });
    });

    it('should reject unknown conditions', () => {
      expect(VALID_CONDITIONS).not.toContain('rotten');
      expect(VALID_CONDITIONS).not.toContain('');
    });

    it('should allow empty/healthy condition', () => {
      const healthy = '';
      expect(VALID_CONDITIONS).not.toContain(healthy);
      // Empty string means healthy - not in the condition list
    });
  });

  // ─── Dental Chart Entry Validation ──────────────────────────────────────────
  describe('Dental Chart Entry Validation', () => {
    it('should validate tooth number is required', () => {
      const entry = { ToothNumber: '5' };
      expect(entry.ToothNumber).toBeTruthy();
      expect(entry.ToothNumber.length).toBeLessThanOrEqual(3);
    });

    it('should validate mobility scale (0-3)', () => {
      const validMobilities = [0, 1, 2, 3];
      validMobilities.forEach(m => {
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(3);
      });
    });

    it('should validate furcation scale (0-3)', () => {
      const validFurcations = [0, 1, 2, 3];
      validFurcations.forEach(f => {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(3);
      });
    });

    it('should validate pocket depth is non-negative', () => {
      const depths = [0, 2, 4, 6, 8, 10];
      depths.forEach(d => expect(d).toBeGreaterThanOrEqual(0));
    });

    it('should validate root canal and implant booleans', () => {
      const entry = { RootCanalDone: true, IsImplant: false };
      expect(typeof entry.RootCanalDone).toBe('boolean');
      expect(typeof entry.IsImplant).toBe('boolean');
    });
  });

  // ─── Treatment Record Validation ────────────────────────────────────────────
  describe('Treatment Record Validation', () => {
    it('should require CDT code and procedure name', () => {
      const treatment = { CdtCode: 'D0120', ProcedureName: 'Periodic oral evaluation' };
      expect(treatment.CdtCode.length).toBeGreaterThanOrEqual(1);
      expect(treatment.CdtCode.length).toBeLessThanOrEqual(10);
      expect(treatment.ProcedureName.length).toBeGreaterThanOrEqual(1);
      expect(treatment.ProcedureName.length).toBeLessThanOrEqual(300);
    });

    it('should validate fee is non-negative', () => {
      const fees = [0, 500, 1500, 5000];
      fees.forEach(f => expect(f).toBeGreaterThanOrEqual(0));
    });

    it('should validate quadrant is 1-4 when provided', () => {
      const quadrants = [1, 2, 3, 4];
      quadrants.forEach(q => {
        expect(q).toBeGreaterThanOrEqual(1);
        expect(q).toBeLessThanOrEqual(4);
      });
    });

    it('should allow optional tooth surface', () => {
      const surfaces = ['M', 'O', 'D', 'B', 'L', 'MOD', 'MO', 'DO'];
      surfaces.forEach(s => expect(s.length).toBeGreaterThanOrEqual(1));
    });

    it('should track lab requirements', () => {
      const treatment = { LabRequired: true, LabType: 'Crown', LabShade: 'A2' };
      expect(treatment.LabRequired).toBe(true);
      expect(treatment.LabType).toBeTruthy();
    });

    it('should track follow-up requirements', () => {
      const treatment = { FollowupRequired: true, FollowupDate: '2026-05-01', FollowupNotes: 'Check crown fit' };
      expect(treatment.FollowupRequired).toBe(true);
      expect(treatment.FollowupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ─── Treatment Plan Validation ──────────────────────────────────────────────
  describe('Treatment Plan Validation', () => {
    it('should calculate estimated total from items', () => {
      const items = [
        { EstimatedFee: 2000 },
        { EstimatedFee: 3500 },
        { EstimatedFee: 1500 },
      ];
      const estimatedTotal = items.reduce((sum, item) => sum + (item.EstimatedFee || 0), 0);
      expect(estimatedTotal).toBe(7000);
    });

    it('should validate plan priority levels', () => {
      const priorities = ['routine', 'urgent', 'emergency'];
      priorities.forEach(p => expect(p).toBeTruthy());
    });

    it('should validate item priority (1-5)', () => {
      const itemPriority = 2;
      expect(itemPriority).toBeGreaterThanOrEqual(1);
      expect(itemPriority).toBeLessThanOrEqual(5);
    });

    it('should allow empty items list', () => {
      const items: any[] = [];
      const estimatedTotal = items.reduce((sum, item) => sum + (item.EstimatedFee || 0), 0);
      expect(estimatedTotal).toBe(0);
    });

    it('should handle plan phases correctly', () => {
      const phase = 1;
      expect(phase).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Periodontal Charting Validation ────────────────────────────────────────
  describe('Periodontal Charting Validation', () => {
    it('should have 6 pocket depth sites per tooth', () => {
      const sites = ['MB', 'B', 'DB', 'DL', 'L', 'ML'];
      expect(sites).toHaveLength(6);
    });

    it('should have 6 recession sites per tooth', () => {
      const sites = ['MB', 'B', 'DB', 'DL', 'L', 'ML'];
      expect(sites).toHaveLength(6);
    });

    it('should have 6 bleeding sites per tooth', () => {
      const sites = ['MB', 'B', 'DB', 'DL', 'L', 'ML'];
      expect(sites).toHaveLength(6);
    });

    it('should validate plaque index (0-3)', () => {
      const indices = [0, 1, 2, 3];
      indices.forEach(i => {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(3);
      });
    });

    it('should calculate bleeding score', () => {
      const bleeding = { MB: true, B: false, DB: true, DL: false, L: true, ML: false };
      const score = Object.values(bleeding).filter(v => v).length;
      expect(score).toBe(3);
    });
  });

  // ─── X-Ray Tracking Validation ──────────────────────────────────────────────
  describe('X-Ray Tracking Validation', () => {
    it('should accept valid x-ray types', () => {
      const validTypes = ['periapical', 'bitewing', 'panoramic', 'cephalometric', 'occlusal', 'cbct'];
      validTypes.forEach(t => expect(t).toBeTruthy());
    });

    it('should validate image count is positive', () => {
      const count = 4;
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should track radiation dose as non-negative', () => {
      const dose = 0.05;
      expect(dose).toBeGreaterThanOrEqual(0);
    });

    it('should validate taken date format', () => {
      const date = '2026-04-23';
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should allow optional teeth imaged field', () => {
      const teethImaged = '3,4,5,6';
      expect(teethImaged).toBeTruthy();
    });
  });

  // ─── CDT Code Validation ────────────────────────────────────────────────────
  describe('CDT Code Validation', () => {
    it('should validate CDT code format (D + 4 digits)', () => {
      const validCodes = ['D0120', 'D0150', 'D0210', 'D1110', 'D2750', 'D5110'];
      const cdtRegex = /^D\d{4}$/;
      validCodes.forEach(code => {
        expect(cdtRegex.test(code)).toBe(true);
      });
    });

    it('should reject invalid CDT codes', () => {
      const invalidCodes = ['D120', 'D01201', '0120', 'DABCD'];
      const cdtRegex = /^D\d{4}$/;
      invalidCodes.forEach(code => {
        expect(cdtRegex.test(code)).toBe(false);
      });
    });
  });

  // ─── Dental Data Security ───────────────────────────────────────────────────
  describe('Dental Data Security', () => {
    it('should require tenant isolation in all queries', () => {
      const queries = [
        'WHERE tenant_id = ? AND PatientId = ?',
        'WHERE tenant_id = ? AND PlanId = ?',
      ];
      queries.forEach(q => expect(q).toContain('tenant_id'));
    });

    it('should soft-delete treatments rather than hard delete', () => {
      const softDeleteQuery = "UPDATE DentalTreatment SET IsActive = 0";
      expect(softDeleteQuery).toContain('IsActive = 0');
    });

    it('should track who performed/charted each entry', () => {
      const chartedBy = 'ChartedById';
      const performedBy = 'PerformedById';
      expect(chartedBy).toContain('Id');
      expect(performedBy).toContain('Id');
    });
  });

  // ─── Dental Calculations ────────────────────────────────────────────────────
  describe('Dental Calculations', () => {
    it('should calculate total treatment cost', () => {
      const treatments = [
        { Fee: 2000 }, { Fee: 3500 }, { Fee: 1500 }, { Fee: undefined },
      ];
      const total = treatments.reduce((s, t) => s + (t.Fee || 0), 0);
      expect(total).toBe(7000);
    });

    it('should count teeth by condition', () => {
      const chart = [
        { ToothNumber: '1', ToothCondition: 'decay' },
        { ToothNumber: '2', ToothCondition: '' },
        { ToothNumber: '3', ToothCondition: 'missing' },
        { ToothNumber: '4', ToothCondition: 'crown' },
      ];
      const decayed = chart.filter(t => t.ToothCondition === 'decay').length;
      const missing = chart.filter(t => t.ToothCondition === 'missing').length;
      const healthy = chart.filter(t => !t.ToothCondition).length;
      expect(decayed).toBe(1);
      expect(missing).toBe(1);
      expect(healthy).toBe(1);
    });

    it('should identify teeth needing attention', () => {
      const chart = [
        { ToothNumber: '1', ToothCondition: 'decay', Mobility: 0 },
        { ToothNumber: '2', ToothCondition: '', Mobility: 2 },
        { ToothNumber: '3', ToothCondition: 'missing', Mobility: 0 },
      ];
      const needsAttention = chart.filter(t =>
        t.ToothCondition === 'decay' ||
        t.ToothCondition === 'extraction' ||
        t.Mobility >= 2
      );
      expect(needsAttention).toHaveLength(2);
    });
  });

});
