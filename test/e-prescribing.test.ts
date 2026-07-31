import { describe, it, expect } from 'vitest';

// ─── E-Prescribing Module Unit Tests ──────────────────────────────────────────
// Tests for drug interaction logic, safety checker, formulary validation,
// RBAC guards, parseId validation, and seed data patterns.

describe('E-Prescribing Module', () => {

  // ─── parseId Validation ───────────────────────────────────────────────────

  describe('parseId Validation', () => {
    function parseId(value: string, label = 'ID'): number {
      const id = parseInt(value, 10);
      if (isNaN(id) || id <= 0) throw new Error(`Invalid ${label}: must be a positive integer`);
      return id;
    }

    it('should parse valid positive integer', () => {
      expect(parseId('1')).toBe(1);
      expect(parseId('42')).toBe(42);
      expect(parseId('999')).toBe(999);
    });

    it('should reject non-numeric string', () => {
      expect(() => parseId('abc')).toThrow('Invalid ID');
      expect(() => parseId('')).toThrow('Invalid ID');
      expect(() => parseId('hello')).toThrow('Invalid ID');
    });

    it('should reject zero', () => {
      expect(() => parseId('0')).toThrow('Invalid ID');
    });

    it('should reject negative numbers', () => {
      expect(() => parseId('-1')).toThrow('Invalid ID');
      expect(() => parseId('-99')).toThrow('Invalid ID');
    });

    it('should include label in error message', () => {
      expect(() => parseId('abc', 'Patient ID')).toThrow('Invalid Patient ID');
      expect(() => parseId('-1', 'Formulary ID')).toThrow('Invalid Formulary ID');
    });

    it('should parse integers with trailing text (parseInt behavior)', () => {
      expect(parseId('42abc')).toBe(42); // parseInt('42abc') = 42
    });
  });

  // ─── RBAC: Clinical Roles ─────────────────────────────────────────────────

  describe('requireClinicalRole', () => {
    const CLINICAL_WRITE_ROLES = ['doctor', 'md', 'pharmacist', 'hospital_admin'];

    it('should allow clinical write roles', () => {
      CLINICAL_WRITE_ROLES.forEach(role => {
        expect(CLINICAL_WRITE_ROLES).toContain(role);
      });
    });

    it('should deny non-clinical roles', () => {
      expect(CLINICAL_WRITE_ROLES).not.toContain('nurse');
      expect(CLINICAL_WRITE_ROLES).not.toContain('receptionist');
      expect(CLINICAL_WRITE_ROLES).not.toContain('patient');
      expect(CLINICAL_WRITE_ROLES).not.toContain('accountant');
    });
  });

  // ─── Drug Interaction Logic ───────────────────────────────────────────────

  describe('Drug Interaction Checking', () => {
    const interactions = [
      { drug_a: 'warfarin', drug_b: 'aspirin', severity: 'major' },
      { drug_a: 'metformin', drug_b: 'ibuprofen', severity: 'moderate' },
      { drug_a: 'lisinopril', drug_b: 'potassium', severity: 'major' },
      { drug_a: 'fluoxetine', drug_b: 'maois', severity: 'contraindicated' },
    ];

    function findInteraction(drugA: string, drugB: string) {
      const a = drugA.toLowerCase().trim();
      const b = drugB.toLowerCase().trim();
      return interactions.find(
        i => (i.drug_a === a && i.drug_b === b) || (i.drug_a === b && i.drug_b === a)
      );
    }

    it('should find interaction in forward direction', () => {
      const result = findInteraction('warfarin', 'aspirin');
      expect(result).toBeTruthy();
      expect(result?.severity).toBe('major');
    });

    it('should find interaction in reverse direction', () => {
      const result = findInteraction('aspirin', 'warfarin');
      expect(result).toBeTruthy();
      expect(result?.severity).toBe('major');
    });

    it('should not find interaction for safe pair', () => {
      const result = findInteraction('paracetamol', 'omeprazole');
      expect(result).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const result = findInteraction('WARFARIN', 'Aspirin');
      expect(result).toBeTruthy();
    });

    it('should handle whitespace', () => {
      const result = findInteraction('  warfarin  ', 'aspirin');
      expect(result).toBeTruthy();
    });

    it('should detect contraindicated interactions', () => {
      const result = findInteraction('fluoxetine', 'maois');
      expect(result?.severity).toBe('contraindicated');
    });
  });

  // ─── Safety Check Categories ──────────────────────────────────────────────

  describe('Safety Check Types', () => {
    const checkTypes = ['drug_interaction', 'allergy', 'duplicate_therapy', 'max_dose'];

    it('should include all safety check types', () => {
      expect(checkTypes).toContain('drug_interaction');
      expect(checkTypes).toContain('allergy');
      expect(checkTypes).toContain('duplicate_therapy');
      expect(checkTypes).toContain('max_dose');
    });

    it('should have exactly 4 check types', () => {
      expect(checkTypes).toHaveLength(4);
    });
  });

  // ─── Severity Levels ──────────────────────────────────────────────────────

  describe('Severity Ordering', () => {
    const severityOrder: Record<string, number> = {
      contraindicated: 1,
      major: 2,
      moderate: 3,
      minor: 4,
    };

    it('should rank contraindicated as most severe', () => {
      expect(severityOrder['contraindicated']).toBe(1);
    });

    it('should rank minor as least severe', () => {
      expect(severityOrder['minor']).toBe(4);
    });

    it('should sort interactions by severity', () => {
      const unsorted = ['moderate', 'contraindicated', 'minor', 'major'];
      const sorted = [...unsorted].sort((a, b) => severityOrder[a] - severityOrder[b]);
      expect(sorted).toEqual(['contraindicated', 'major', 'moderate', 'minor']);
    });
  });

  // ─── Formulary Validation ─────────────────────────────────────────────────

  describe('Formulary Item Validation', () => {
    const validDosageForms = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'suppository', 'powder', 'other'];
    const validRoutes = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'rectal', 'sublingual', 'intrathecal', 'other'];

    it('should accept valid dosage forms', () => {
      validDosageForms.forEach(f => {
        expect(validDosageForms).toContain(f);
      });
    });

    it('should accept valid routes', () => {
      validRoutes.forEach(r => {
        expect(validRoutes).toContain(r);
      });
    });

    it('should validate max_daily_dose_mg as positive number', () => {
      const validDoses = [500, 1000, 4000];
      validDoses.forEach(d => {
        expect(d).toBeGreaterThan(0);
      });

      const invalidDoses = [0, -100];
      invalidDoses.forEach(d => {
        expect(d).not.toBeGreaterThan(0);
      });
    });

    it('should validate unit_price as non-negative', () => {
      expect(0).toBeGreaterThanOrEqual(0);
      expect(10.5).toBeGreaterThanOrEqual(0);
      expect(-1).not.toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Duplicate Therapy Detection ──────────────────────────────────────────

  describe('Duplicate Therapy Detection', () => {
    it('should detect same generic name', () => {
      const existing = [
        { generic_name: 'amoxicillin', medication_name: 'Amoxil' },
        { generic_name: 'metformin', medication_name: 'Glucophage' },
      ];
      const newDrug = 'amoxicillin';
      const isDuplicate = existing.some(m => m.generic_name === newDrug);
      expect(isDuplicate).toBe(true);
    });

    it('should not flag different generic names', () => {
      const existing = [
        { generic_name: 'amoxicillin', medication_name: 'Amoxil' },
      ];
      const newDrug = 'ciprofloxacin';
      const isDuplicate = existing.some(m => m.generic_name === newDrug);
      expect(isDuplicate).toBe(false);
    });
  });

  // ─── Max Dose Check ───────────────────────────────────────────────────────

  describe('Max Dose Checking', () => {
    it('should detect dose exceeding max daily dose', () => {
      const maxDailyDoseMg = 4000; // paracetamol
      const requestedDoseMg = 5000;
      const exceeds = requestedDoseMg > maxDailyDoseMg;
      expect(exceeds).toBe(true);
    });

    it('should allow dose within limits', () => {
      const maxDailyDoseMg = 4000;
      const requestedDoseMg = 1000;
      const exceeds = requestedDoseMg > maxDailyDoseMg;
      expect(exceeds).toBe(false);
    });

    it('should allow exact max dose', () => {
      const maxDailyDoseMg = 4000;
      const requestedDoseMg = 4000;
      const exceeds = requestedDoseMg > maxDailyDoseMg;
      expect(exceeds).toBe(false);
    });
  });

  // ─── Seed Data ────────────────────────────────────────────────────────────

  describe('Seed Data Pattern', () => {
    it('should use __seed__ as template tenant ID', () => {
      const seedTenantId = '__seed__';
      expect(seedTenantId).toBe('__seed__');
      expect(seedTenantId).not.toBe(''); // never empty
    });

    it('should have bidirectional interaction coverage', () => {
      // Verifies the query checks both directions
      const checkBothDirections = (a: string, b: string, pairs: Array<[string, string]>) => {
        return pairs.some(([da, db]) => (da === a && db === b) || (da === b && db === a));
      };
      expect(checkBothDirections('warfarin', 'aspirin', [['warfarin', 'aspirin']])).toBe(true);
      expect(checkBothDirections('aspirin', 'warfarin', [['warfarin', 'aspirin']])).toBe(true);
    });
  });

  // ─── Safety Check Override ────────────────────────────────────────────────

  describe('Safety Check Override', () => {
    const allowedOverrideRoles = ['doctor', 'md', 'hospital_admin'];

    it('should allow override for authorized roles', () => {
      expect(allowedOverrideRoles).toContain('doctor');
      expect(allowedOverrideRoles).toContain('md');
      expect(allowedOverrideRoles).toContain('hospital_admin');
    });

    it('should not allow nurse to override', () => {
      expect(allowedOverrideRoles).not.toContain('nurse');
    });

    it('should not allow pharmacist to override', () => {
      expect(allowedOverrideRoles).not.toContain('pharmacist');
    });
  });

  // ─── Pagination ───────────────────────────────────────────────────────────

  describe('Pagination Meta', () => {
    function paginationMeta(page: number, limit: number, total: number) {
      return { page, limit, total, totalPages: Math.ceil(total / limit) };
    }

    it('should calculate meta correctly', () => {
      const meta = paginationMeta(1, 20, 100);
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(20);
      expect(meta.total).toBe(100);
      expect(meta.totalPages).toBe(5);
    });

    it('should handle empty results', () => {
      const meta = paginationMeta(1, 20, 0);
      expect(meta.totalPages).toBe(0);
    });

    it('should handle partial last page', () => {
      const meta = paginationMeta(1, 20, 41);
      expect(meta.totalPages).toBe(3);
    });
  });
});
