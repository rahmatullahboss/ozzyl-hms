import { describe, it, expect } from 'vitest';
import { detectCrisis, CRISIS_SAFETY_PROMPT } from '../src/lib/crisis-detection';

describe('Crisis Detection', () => {
  it('detects English crisis keywords', () => {
    expect(detectCrisis('I want to kill myself')).not.toBeNull();
    expect(detectCrisis('I want to die')).not.toBeNull();
    expect(detectCrisis('thinking about suicide')).not.toBeNull();
    expect(detectCrisis('I have been cutting myself')).not.toBeNull();
  });

  it('detects Bangla crisis keywords', () => {
    expect(detectCrisis('আমি আত্মহত্যা করতে চাই')).not.toBeNull();
    expect(detectCrisis('মরে যেতে চাই')).not.toBeNull();
    expect(detectCrisis('বাঁচতে চাই না')).not.toBeNull();
  });

  it('returns null for normal messages', () => {
    expect(detectCrisis('I feel tired today')).toBeNull();
    expect(detectCrisis('আমি ক্লান্ত')).toBeNull();
    expect(detectCrisis('How can I sleep better?')).toBeNull();
    expect(detectCrisis('আজ মুড ভালো না')).toBeNull();
  });

  it('includes Kaan Pete Roi helpline', () => {
    const result = detectCrisis('I want to end my life');
    expect(result).not.toBeNull();
    expect(result!.helplines.some(h => h.number === '01779-554391')).toBe(true);
    expect(result!.helplines.some(h => h.number === '999')).toBe(true);
  });

  it('includes both bn and en messages', () => {
    const result = detectCrisis('suicide');
    expect(result!.message_bn).toBeTruthy();
    expect(result!.message_en).toBeTruthy();
  });

  it('CRISIS_SAFETY_PROMPT contains helpline number', () => {
    expect(CRISIS_SAFETY_PROMPT).toContain('01779-554391');
    expect(CRISIS_SAFETY_PROMPT).toContain('999');
  });
});
