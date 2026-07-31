import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  extractComponentCodes,
  substituteValues,
  safeEvaluate,
  roundResult,
  determineAbnormalFlag,
  calculateDelta,
  FormulaError,
} from '../src/lib/lab-formula-evaluator';

describe('Formula Evaluator', () => {
  describe('extractComponentCodes', () => {
    it('extracts codes from formula', () => {
      expect(extractComponentCodes('{HGB} / {PCV} * 100')).toEqual(['HGB', 'PCV']);
    });
    it('deduplicates repeated codes', () => {
      expect(extractComponentCodes('{A} + {A}')).toEqual(['A']);
    });
    it('returns empty for no codes', () => {
      expect(extractComponentCodes('1 + 2')).toEqual([]);
    });
  });

  describe('substituteValues', () => {
    it('replaces placeholders with values', () => {
      expect(substituteValues('{HGB} / {PCV} * 100', { HGB: 14, PCV: 42 })).toBe('14 / 42 * 100');
    });
  });

  describe('safeEvaluate', () => {
    it('evaluates simple arithmetic', () => {
      expect(safeEvaluate('14 / 42 * 100')).toBeCloseTo(33.333, 2);
    });
    it('handles parentheses', () => {
      expect(safeEvaluate('(100 - 40) / 5')).toBe(12);
    });
    it('throws on division by zero', () => {
      expect(() => safeEvaluate('1 / 0')).toThrow();
    });
    it('throws on invalid characters', () => {
      expect(() => safeEvaluate('alert(1)')).toThrow(FormulaError);
    });
  });

  describe('evaluateFormula', () => {
    it('evaluates MCHC formula', () => {
      const result = evaluateFormula('{HGB} / {PCV} * 100', { HGB: 14, PCV: 42 });
      expect(result).toBeCloseTo(33.333, 2);
    });
    it('evaluates LDL formula', () => {
      const result = evaluateFormula('{CHOL-T} - {HDL} - ({TRIG} / 5)', { 'CHOL-T': 200, HDL: 45, TRIG: 150 });
      expect(result).toBe(125);
    });
    it('throws on missing value', () => {
      expect(() => evaluateFormula('{A} + {B}', { A: 5 })).toThrow(FormulaError);
    });
  });

  describe('roundResult', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundResult(33.3333, 2)).toBe(33.33);
    });
    it('rounds to integer', () => {
      expect(roundResult(33.333, 0)).toBe(33);
    });
  });

  describe('determineAbnormalFlag', () => {
    it('returns high', () => {
      expect(determineAbnormalFlag(18, 13.5, 17.5, null, null)).toBe('high');
    });
    it('returns low', () => {
      expect(determineAbnormalFlag(10, 13.5, 17.5, null, null)).toBe('low');
    });
    it('returns normal', () => {
      expect(determineAbnormalFlag(15, 13.5, 17.5, null, null)).toBe('normal');
    });
    it('returns critical low', () => {
      expect(determineAbnormalFlag(5, 13.5, 17.5, 7, 20)).toBe('critical');
    });
    it('returns critical high', () => {
      expect(determineAbnormalFlag(22, 13.5, 17.5, 7, 20)).toBe('critical');
    });
  });

  describe('calculateDelta', () => {
    it('returns new for no previous', () => {
      expect(calculateDelta(15, null)).toBe('new');
    });
    it('returns stable within threshold', () => {
      expect(calculateDelta(15, 14.5)).toBe('stable');
    });
    it('returns increased', () => {
      expect(calculateDelta(20, 15)).toBe('increased');
    });
    it('returns decreased', () => {
      expect(calculateDelta(10, 15)).toBe('decreased');
    });
    it('uses custom threshold', () => {
      expect(calculateDelta(15.5, 15, 5)).toBe('stable');
    });
  });
});
