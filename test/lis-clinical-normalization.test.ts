import { describe, expect, it } from 'vitest';
import {
  interpretNumericLisResult,
  normalizeAnalyzerAbnormalFlag,
  parseLisReferenceInterval,
} from '../src/lib/lis-clinical-mapping';

describe('LIS abnormal interpretation normalization', () => {
  it('normalizes generic analyzer flags without treating all abnormal values as critical', () => {
    expect(normalizeAnalyzerAbnormalFlag('N')).toBe('normal');
    expect(normalizeAnalyzerAbnormalFlag('A')).toBe('abnormal');
    expect(normalizeAnalyzerAbnormalFlag('H')).toBe('high');
    expect(normalizeAnalyzerAbnormalFlag('L')).toBe('low');
    expect(normalizeAnalyzerAbnormalFlag('HH')).toBe('critical');
    expect(normalizeAnalyzerAbnormalFlag('LL')).toBe('critical');
    expect(normalizeAnalyzerAbnormalFlag('unknown')).toBe('pending');
  });

  it('parses signed and scientific two-sided reference intervals', () => {
    expect(parseLisReferenceInterval('-5.5-2.5')).toEqual({ kind: 'between', low: -5.5, high: 2.5 });
    expect(parseLisReferenceInterval('1e-3 - 2.5E+2')).toEqual({ kind: 'between', low: 0.001, high: 250 });
  });

  it('parses one-sided inequality reference intervals', () => {
    expect(parseLisReferenceInterval('< 5')).toEqual({ kind: 'upper', high: 5, inclusive: false });
    expect(parseLisReferenceInterval('<=5')).toEqual({ kind: 'upper', high: 5, inclusive: true });
    expect(parseLisReferenceInterval('> -2.5')).toEqual({ kind: 'lower', low: -2.5, inclusive: false });
    expect(parseLisReferenceInterval('>=-2.5')).toEqual({ kind: 'lower', low: -2.5, inclusive: true });
  });

  it('never invents critical limits from a normal interval', () => {
    expect(interpretNumericLisResult(30, '10-20', null, null)).toBe('high');
    expect(interpretNumericLisResult(-10, '-5-5', null, null)).toBe('low');
  });

  it('uses only explicitly configured critical limits', () => {
    expect(interpretNumericLisResult(30, '10-20', null, 25)).toBe('critical');
    expect(interpretNumericLisResult(5, '10-20', 6, null)).toBe('critical');
    expect(interpretNumericLisResult(22, '10-20', null, 25)).toBe('high');
  });

  it('evaluates one-sided ranges without guessing the missing side', () => {
    expect(interpretNumericLisResult(4, '<5', null, null)).toBe('normal');
    expect(interpretNumericLisResult(5, '<5', null, null)).toBe('high');
    expect(interpretNumericLisResult(5, '<=5', null, null)).toBe('normal');
    expect(interpretNumericLisResult(-3, '>-2.5', null, null)).toBe('low');
  });

  it('returns pending when the value or range cannot be interpreted', () => {
    expect(interpretNumericLisResult(Number.NaN, '10-20', null, null)).toBe('pending');
    expect(interpretNumericLisResult(15, 'adult normal', null, null)).toBe('pending');
  });
});
