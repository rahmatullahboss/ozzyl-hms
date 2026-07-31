import { describe, it, expect } from 'vitest';
import {
  getPregnancyInfo,
  getPregnancyNutritionTips,
} from '../apps/ozzyl-lifestyle/src/lib/pregnancy-utils';

describe('pregnancy-utils', () => {
  describe('getPregnancyInfo', () => {
    it('returns null for invalid LMP date', () => {
      expect(getPregnancyInfo('not-a-date')).toBeNull();
    });

    it('returns null for future LMP date', () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);
      expect(getPregnancyInfo(future.toISOString())).toBeNull();
    });

    it('calculates week 1 correctly', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 3); // 3 days ago
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.currentWeek).toBe(1);
      expect(info!.currentDay).toBe(3);
      expect(info!.trimester).toBe(1);
    });

    it('calculates trimester 2 correctly', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 100); // ~14 weeks
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.trimester).toBe(2);
      expect(info!.currentWeek).toBeGreaterThanOrEqual(13);
    });

    it('calculates trimester 3 correctly', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 200); // ~28 weeks
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.trimester).toBe(3);
      expect(info!.currentWeek).toBeGreaterThanOrEqual(28);
    });

    it('calculates due date using Naegele rule (LMP + 280 days)', () => {
      const lmp = '2026-01-01';
      const info = getPregnancyInfo(lmp, '2026-04-01');
      expect(info).not.toBeNull();
      expect(info!.dueDate).toBe('2026-10-08'); // Jan 1 + 280 = Oct 8
    });

    it('caps week at 40', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 290); // beyond 40 weeks
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.currentWeek).toBe(40);
    });

    it('returns progress percent', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 140); // 50% of 280 days
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.progressPercent).toBe(50);
    });

    it('includes baby size and development note', () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 140); // ~week 20
      const info = getPregnancyInfo(lmp.toISOString().slice(0, 10));
      expect(info).not.toBeNull();
      expect(info!.babySize).toBeTruthy();
      expect(info!.developmentNote).toBeTruthy();
    });

    it('returns null for dates way too old', () => {
      const info = getPregnancyInfo('2020-01-01');
      expect(info).toBeNull();
    });
  });

  describe('getPregnancyNutritionTips', () => {
    it('returns tips for trimester 1', () => {
      const tips = getPregnancyNutritionTips(1);
      expect(tips.length).toBeGreaterThan(0);
      expect(tips[0].title).toBeTruthy();
      expect(tips[0].title_bn).toBeTruthy();
    });

    it('returns tips for trimester 2', () => {
      const tips = getPregnancyNutritionTips(2);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('returns tips for trimester 3', () => {
      const tips = getPregnancyNutritionTips(3);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('all tips have bilingual titles', () => {
      for (const t of [1, 2, 3] as const) {
        for (const tip of getPregnancyNutritionTips(t)) {
          expect(tip.title_bn).toBeTruthy();
          expect(tip.body_bn).toBeTruthy();
        }
      }
    });
  });
});
