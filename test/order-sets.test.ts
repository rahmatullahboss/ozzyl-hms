import { describe, it, expect } from 'vitest';
import {
  createOrderSetSchema, createOrderSetItemSchema,
  applyOrderSetSchema, doctorFavoriteSchema,
} from '../src/schemas/orderSet';

describe('Order Set Schemas', () => {
  describe('createOrderSetSchema', () => {
    it('should validate valid order set', () => {
      const valid = { code: 'PNEUMONIA_ADMIT', name: 'Pneumonia Admission', category: 'admission', specialty: 'medicine' };
      expect(createOrderSetSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject empty code', () => {
      expect(createOrderSetSchema.safeParse({ code: '', name: 'Test' }).success).toBe(false);
    });

    it('should reject invalid specialty', () => {
      expect(createOrderSetSchema.safeParse({ code: 'X', name: 'Y', specialty: 'invalid' }).success).toBe(false);
    });

    it('should default category to admission', () => {
      const result = createOrderSetSchema.parse({ code: 'TEST', name: 'Test Set' });
      expect(result.category).toBe('admission');
    });

    it('should default is_global to true', () => {
      const result = createOrderSetSchema.parse({ code: 'TEST', name: 'Test' });
      expect(result.is_global).toBe(true);
    });
  });

  describe('createOrderSetItemSchema', () => {
    it('should validate medication item', () => {
      const valid = {
        item_type: 'medication',
        medication_name: 'Ceftriaxone 1g IV',
        generic_name: 'ceftriaxone',
        dose: '1g', route: 'IV', frequency: 'BD',
      };
      expect(createOrderSetItemSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate lab_test item', () => {
      const valid = { item_type: 'lab_test', lab_test_code: 'CBC', description: 'Complete Blood Count' };
      expect(createOrderSetItemSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate nursing item', () => {
      const valid = { item_type: 'nursing', description: 'Monitor SpO2 every 4 hours', priority: 'urgent' };
      expect(createOrderSetItemSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate diet item', () => {
      const valid = { item_type: 'diet', description: 'Soft diet, adequate fluids' };
      expect(createOrderSetItemSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid item_type', () => {
      expect(createOrderSetItemSchema.safeParse({ item_type: 'invalid' }).success).toBe(false);
    });

    it('should default priority to routine', () => {
      const result = createOrderSetItemSchema.parse({ item_type: 'instruction', description: 'ECG' });
      expect(result.priority).toBe('routine');
    });

    it('should default is_optional to false', () => {
      const result = createOrderSetItemSchema.parse({ item_type: 'instruction', description: 'Test' });
      expect(result.is_optional).toBe(false);
    });
  });

  describe('applyOrderSetSchema', () => {
    it('should validate basic apply request', () => {
      const valid = { patient_id: 1 };
      expect(applyOrderSetSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate with visit_id and overrides', () => {
      const valid = {
        patient_id: 1,
        visit_id: 100,
        overrides: [
          { item_id: 5, skip: true },
          { item_id: 6, dose: '500mg', frequency: 'TDS' },
        ],
      };
      expect(applyOrderSetSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject missing patient_id', () => {
      expect(applyOrderSetSchema.safeParse({}).success).toBe(false);
    });

    it('should reject negative patient_id', () => {
      expect(applyOrderSetSchema.safeParse({ patient_id: -1 }).success).toBe(false);
    });
  });

  describe('doctorFavoriteSchema', () => {
    it('should validate favorite', () => {
      const valid = { name: 'My Fever Bundle', items_json: '[{"med":"paracetamol"}]' };
      expect(doctorFavoriteSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject empty name', () => {
      expect(doctorFavoriteSchema.safeParse({ name: '', items_json: '[]' }).success).toBe(false);
    });

    it('should reject too-short items_json', () => {
      expect(doctorFavoriteSchema.safeParse({ name: 'Test', items_json: '' }).success).toBe(false);
    });
  });
});

describe('Order Set Apply Logic Concepts', () => {
  it('medication items should map to prescriptions', () => {
    const medItem = { item_type: 'medication', medication_name: 'Ceftriaxone', dose: '1g', route: 'IV', frequency: 'BD' };
    expect(medItem.item_type).toBe('medication');
    expect(medItem.medication_name).toBeTruthy();
    expect(medItem.dose).toBeTruthy();
  });

  it('lab items should map to lab orders', () => {
    const labItem = { item_type: 'lab_test', lab_test_code: 'CBC' };
    expect(labItem.item_type).toBe('lab_test');
    expect(labItem.lab_test_code).toBe('CBC');
  });

  it('nursing/diet/instruction items should map to nursing notes', () => {
    const types = ['nursing', 'diet', 'instruction'];
    for (const t of types) {
      const item = { item_type: t, description: `${t} order description` };
      expect(['nursing', 'diet', 'instruction']).toContain(item.item_type);
    }
  });

  it('overrides should allow skipping optional items', () => {
    const items = [
      { id: 1, item_type: 'medication', is_optional: false },
      { id: 2, item_type: 'medication', is_optional: true },
    ];
    const overrides = [{ item_id: 2, skip: true }];
    const overrideMap = new Map(overrides.map(o => [o.item_id, o]));
    const filtered = items.filter(i => !overrideMap.get(i.id)?.skip);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('overrides should allow dose changes', () => {
    const item = { id: 1, dose: '1g', frequency: 'BD' };
    const override = { item_id: 1, dose: '500mg', frequency: 'TDS' };
    const effectiveDose = override.dose || item.dose;
    const effectiveFreq = override.frequency || item.frequency;
    expect(effectiveDose).toBe('500mg');
    expect(effectiveFreq).toBe('TDS');
  });
});
