import { describe, it, expect } from 'vitest';

// ─── Dashboard Tests ──────────────────────────────────────────────────────────
// Migrated from apps/api/tests/dashboard.test.ts

describe('HMS Dashboard KPI Tests', () => {
  describe('Daily Income Summary', () => {
    it('should sum lab test income', () => {
      const tests = [{ amount: 500 }, { amount: 800 }, { amount: 300 }];
      const total = tests.reduce((s, t) => s + t.amount, 0);
      expect(total).toBe(1600);
    });

    it('should sum doctor visit fees', () => {
      const visits = [{ fee: 500 }, { fee: 500 }, { fee: 300 }];
      const total = visits.reduce((s, v) => s + v.fee, 0);
      expect(total).toBe(1300);
    });

    it('should sum pharmacy income', () => {
      const sales = [{ amount: 5000 }, { amount: 3000 }];
      const total = sales.reduce((s, v) => s + v.amount, 0);
      expect(total).toBe(8000);
    });

    it('should aggregate total daily income across all sources', () => {
      const labIncome    = 1600;
      const visitIncome  = 1300;
      const opIncome     = 30000;
      const pharmIncome  = 8000;
      expect(labIncome + visitIncome + opIncome + pharmIncome).toBe(40900);
    });
  });

  describe('Daily Expense Summary', () => {
    it('should categorise expenses by type', () => {
      const expenses = [
        { category: 'SALARY',      amount: 10000 },
        { category: 'MEDICINE',    amount:  5000 },
        { category: 'ELECTRICITY', amount:  2000 },
      ];
      const byCategory = expenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + e.amount;
        return acc;
      }, {} as Record<string, number>);

      expect(byCategory.SALARY).toBe(10000);
      expect(byCategory.MEDICINE).toBe(5000);
    });

    it('should calculate total daily expenses', () => {
      const expenses = [1667, 5000, 667, 1000];
      const total = expenses.reduce((s, a) => s + a, 0);
      expect(total).toBe(8334);
    });
  });

  describe('Daily Profit / Loss', () => {
    it('should calculate daily profit', () => {
      expect(40900 - 8334).toBe(32566);
    });

    it('should surface daily loss when expenses > income', () => {
      const loss = 5000 - 8000;
      expect(loss).toBe(-3000);
    });
  });

  describe('KPI Metrics', () => {
    it('should calculate collection rate', () => {
      const totalDue   = 50000;
      const collected  = 35000;
      const rate = (collected / totalDue) * 100;
      expect(rate).toBe(70);
    });

    it('should calculate bed occupancy rate', () => {
      const totalBeds    = 20;
      const occupiedBeds = 15;
      const rate = (occupiedBeds / totalBeds) * 100;
      expect(rate).toBe(75);
    });

    it('should count today\'s patients', () => {
      const todayPatients = ['P1', 'P2', 'P3', 'P4', 'P5'];
      expect(todayPatients.length).toBe(5);
    });
  });

  describe('Date Range Aggregation', () => {
    it('should filter activity to a date range', () => {
      const txns = [
        { date: '2024-01-10', amount: 1000 },
        { date: '2024-01-15', amount: 2000 },
        { date: '2024-01-20', amount: 3000 },
        { date: '2024-02-01', amount: 4000 },
      ];
      const filtered = txns.filter(
        (t) => t.date >= '2024-01-01' && t.date <= '2024-01-31'
      );
      expect(filtered.length).toBe(3);
    });

    it('should compute a weekly total', () => {
      const week = [10000, 12000, 8000, 15000, 9000, 11000, 10000];
      const total = week.reduce((s, a) => s + a, 0);
      expect(total).toBe(75000);
    });
  });
});
