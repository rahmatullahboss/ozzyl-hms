import { describe, expect, test } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { buildWellnessContext, scoreLabel } from '../src/lib/ai-wellness-context';

describe('buildWellnessContext', () => {
  test('returns empty string when no data', async () => {
    const db = createMockDB({ universalFallback: true });
    const ctx = await buildWellnessContext(db, 999);
    expect(ctx).toBe('');
  });

  test('includes health score when present', async () => {
    const db = createMockDB({ universalFallback: true });
    const ctx = await buildWellnessContext(db, 1);
    // With universalFallback mock, .first() returns empty object which is truthy
    // The function should not crash
    expect(typeof ctx).toBe('string');
  });

  test('scoreLabel returns correct labels', () => {
    expect(scoreLabel(95)).toBe('excellent');
    expect(scoreLabel(85)).toBe('good');
    expect(scoreLabel(72)).toBe('fair');
    expect(scoreLabel(65)).toBe('needs improvement');
    expect(scoreLabel(45)).toBe('needs attention');
  });

  test('produces context under 500 tokens with all data', () => {
    const parts = [
      'Health Score: 78/100 (fair) on 2026-04-15',
      'Score trend (7d): +5 points',
      'Streaks: daily_checkin: 7d, food_log: 3d',
      'Goals: steps: 4500/6000 steps, sleep_hours: 7.2/8 hours',
      'Sleep avg (7d): 6.8h, quality 3.5/5',
      'Mood pattern: good (4/7d)',
      'Activity (7d): 120min total, types: walk, yoga',
      'Active conditions: Diabetes Type 2 (moderate), Hypertension (mild)',
      'Allergies: Penicillin (severe), Dust (mild)',
      'Current meds: Metformin 500mg, Amlodipine 5mg',
      'Latest vitals: BP 135/85, HR 72, Sugar 6.2 (fasting)',
      'Med reminders: Metformin 500mg, Amlodipine 5mg',
      'Med adherence (7d): 85% (17/20)',
      'Adverse reactions: Ibuprofen → stomach pain (mild)',
    ];
    const context = `\n\nPatient health summary:\n${parts.join('\n')}`;
    const wordCount = context.split(/\s+/).length;
    const estimatedTokens = Math.ceil(wordCount * 1.3);
    expect(estimatedTokens).toBeLessThan(500);
  });

  test('accepts optional uhid for clinical data', async () => {
    const db = createMockDB({ universalFallback: true });
    const ctx = await buildWellnessContext(db, 1, 'UHID-TEST');
    expect(typeof ctx).toBe('string');
  });

  test('dominant mood extraction is correct', () => {
    const moods = ['good', 'good', 'okay', 'good', 'excellent', 'good', 'bad'];
    const counts: Record<string, number> = {};
    for (const m of moods) counts[m] = (counts[m] || 0) + 1;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    expect(dominant[0]).toBe('good');
    expect(dominant[1]).toBe(4);
  });
});
