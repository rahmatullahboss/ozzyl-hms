import { describe, it, expect } from 'vitest';
import { calculateHealthScore, type SubScores } from '../src/lib/health-score';

const PERFECT: SubScores = {
  sleep: 100,
  activity: 100,
  nutrition: 100,
  mood: 100,
  medication: 100,
  vitals: 100,
};

const ZERO: SubScores = {
  sleep: 0,
  activity: 0,
  nutrition: 0,
  mood: 0,
  medication: 0,
  vitals: 0,
};

describe('calculateHealthScore', () => {
  it('returns 100 for perfect scores (connected)', () => {
    const result = calculateHealthScore(PERFECT, true);
    expect(result.total).toBe(100);
    expect(result.label).toBe('excellent');
    expect(result.color).toBe('green');
  });

  it('returns 100 for perfect scores (standalone)', () => {
    const result = calculateHealthScore(PERFECT, false);
    expect(result.total).toBe(100);
  });

  it('returns 0 for zero scores', () => {
    const result = calculateHealthScore(ZERO, false);
    expect(result.total).toBe(0);
    expect(result.label).toBe('attention');
    expect(result.color).toBe('red');
  });

  it('applies connected weights correctly', () => {
    // Only sleep = 100, rest 0 → 100 * 0.25 = 25
    const result = calculateHealthScore({ ...ZERO, sleep: 100 }, true);
    expect(result.total).toBe(25);
  });

  it('applies standalone weights correctly (medication ignored)', () => {
    // Only medication = 100, rest 0 → 0 in standalone
    const result = calculateHealthScore({ ...ZERO, medication: 100 }, false);
    expect(result.total).toBe(0);
  });

  it('standalone redistributes medication weight to sleep and nutrition', () => {
    // sleep=100 → 0.30 * 100 = 30 (standalone) vs 0.25 * 100 = 25 (connected)
    const standalone = calculateHealthScore({ ...ZERO, sleep: 100 }, false);
    const connected = calculateHealthScore({ ...ZERO, sleep: 100 }, true);
    expect(standalone.total).toBe(30);
    expect(connected.total).toBe(25);
  });

  it('clamps sub-scores to 0-100 range', () => {
    const result = calculateHealthScore({
      sleep: 150,
      activity: -20,
      nutrition: 100,
      mood: 100,
      medication: 100,
      vitals: 100,
    }, true);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.sleep).toBe(100);
    expect(result.breakdown.activity).toBe(0);
  });

  it('labels correctly across ranges', () => {
    // 90+ = excellent
    expect(calculateHealthScore({ ...PERFECT }, false).label).toBe('excellent');

    // ~80 = good
    const good = calculateHealthScore({
      sleep: 80, activity: 80, nutrition: 80, mood: 80, medication: 80, vitals: 80,
    }, false);
    expect(good.label).toBe('good');

    // ~70 = fair
    const fair = calculateHealthScore({
      sleep: 70, activity: 70, nutrition: 70, mood: 70, medication: 70, vitals: 70,
    }, false);
    expect(fair.label).toBe('fair');

    // ~50 = attention
    const attention = calculateHealthScore({
      sleep: 50, activity: 50, nutrition: 50, mood: 50, medication: 50, vitals: 50,
    }, false);
    expect(attention.label).toBe('attention');
  });

  it('colors correctly: green >= 80, yellow >= 60, red < 60', () => {
    expect(calculateHealthScore(PERFECT, false).color).toBe('green');

    const yellow = calculateHealthScore({
      sleep: 70, activity: 70, nutrition: 70, mood: 70, medication: 70, vitals: 70,
    }, false);
    expect(yellow.color).toBe('yellow');

    const red = calculateHealthScore({
      sleep: 40, activity: 40, nutrition: 40, mood: 40, medication: 40, vitals: 40,
    }, false);
    expect(red.color).toBe('red');
  });
});
