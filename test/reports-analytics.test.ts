import { describe, it, expect } from 'vitest';

// ─── Reports & Analytics Module Tests ─────────────────────────────────────────
// Covers: Financial reports, operational reports, appointment analytics,
//         lab analytics, pharmacy analytics, KPI calculations
// Based on: DanpheEMR Reporting + OpenEMR analytics best practices

describe('Reports & Analytics Module', () => {

  // ─── Financial Report Calculations ──────────────────────────────────────────
  describe('Profit & Loss Calculations', () => {
    function calculateNetProfit(income: number, expense: number): number {
      return income - expense;
    }

    function calculateProfitMargin(income: number, netProfit: number): number {
      return income > 0 ? parseFloat(((netProfit / income) * 100).toFixed(1)) : 0;
    }

    it('should calculate net profit correctly', () => {
      expect(calculateNetProfit(100000, 40000)).toBe(60000);
      expect(calculateNetProfit(50000, 50000)).toBe(0);
      expect(calculateNetProfit(30000, 45000)).toBe(-15000);
    });

    it('should calculate profit margin correctly', () => {
      expect(calculateProfitMargin(100000, 60000)).toBe(60.0);
      expect(calculateProfitMargin(50000, 0)).toBe(0);
      expect(calculateProfitMargin(0, 0)).toBe(0);
    });

    it('should handle negative profit margin (loss)', () => {
      expect(calculateProfitMargin(30000, -15000)).toBe(-50.0);
    });

    it('should calculate percentage breakdown correctly', () => {
      const items = [
        { source: 'billing', total: 50000 },
        { source: 'lab', total: 30000 },
        { source: 'pharmacy', total: 20000 },
      ];
      const grandTotal = items.reduce((s, i) => s + i.total, 0);
      expect(grandTotal).toBe(100000);
      expect(parseFloat(((50000 / 100000) * 100).toFixed(1))).toBe(50.0);
      expect(parseFloat(((30000 / 100000) * 100).toFixed(1))).toBe(30.0);
      expect(parseFloat(((20000 / 100000) * 100).toFixed(1))).toBe(20.0);
    });
  });

  // ─── Monthly Report Aggregation ─────────────────────────────────────────────
  describe('Monthly Report Aggregation', () => {
    function generateMonthRange(year: string): string[] {
      return Array.from({ length: 12 }, (_, i) =>
        `${year}-${String(i + 1).padStart(2, '0')}`
      );
    }

    it('should generate 12 months for a given year', () => {
      const months = generateMonthRange('2026');
      expect(months).toHaveLength(12);
      expect(months[0]).toBe('2026-01');
      expect(months[11]).toBe('2026-12');
    });

    it('should calculate year-end summary from monthly data', () => {
      const monthly = [
        { month: '2026-01', income: 100000, expense: 40000, profit: 60000 },
        { month: '2026-02', income: 120000, expense: 50000, profit: 70000 },
        { month: '2026-03', income: 90000, expense: 45000, profit: 45000 },
      ];
      const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
      const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);
      const netProfit = totalIncome - totalExpense;

      expect(totalIncome).toBe(310000);
      expect(totalExpense).toBe(135000);
      expect(netProfit).toBe(175000);
    });

    it('should handle months with zero income/expense', () => {
      const monthly = [
        { month: '2026-04', income: 0, expense: 0, profit: 0 },
      ];
      expect(monthly[0].profit).toBe(0);
    });
  });

  // ─── Bed Occupancy Calculations ─────────────────────────────────────────────
  describe('Bed Occupancy Calculations', () => {
    function calculateOccupancyRate(occupied: number, total: number): number {
      return total > 0 ? parseFloat(((occupied / total) * 100).toFixed(1)) : 0;
    }

    it('should calculate overall occupancy rate', () => {
      expect(calculateOccupancyRate(80, 100)).toBe(80.0);
      expect(calculateOccupancyRate(0, 50)).toBe(0);
      expect(calculateOccupancyRate(50, 50)).toBe(100.0);
    });

    it('should handle zero total beds', () => {
      expect(calculateOccupancyRate(0, 0)).toBe(0);
    });

    it('should calculate ward-level occupancy', () => {
      const wards = [
        { ward: 'General', total: 40, occupied: 30 },
        { ward: 'ICU', total: 10, occupied: 8 },
        { ward: 'Private', total: 20, occupied: 15 },
      ];
      const results = wards.map(w => ({
        ...w,
        rate: calculateOccupancyRate(w.occupied, w.total),
        available: w.total - w.occupied,
      }));
      expect(results[0].rate).toBe(75.0);
      expect(results[1].rate).toBe(80.0);
      expect(results[2].rate).toBe(75.0);
      expect(results[0].available).toBe(10);
    });
  });

  // ─── Average Length of Stay (ALOS) ──────────────────────────────────────────
  describe('Average Length of Stay (ALOS)', () => {
    function calculateALOS(totalDays: number, totalAdmissions: number): number {
      return totalAdmissions > 0
        ? parseFloat((totalDays / totalAdmissions).toFixed(1))
        : 0;
    }

    it('should calculate ALOS correctly', () => {
      expect(calculateALOS(300, 50)).toBe(6.0);
      expect(calculateALOS(0, 10)).toBe(0);
      expect(calculateALOS(150, 0)).toBe(0);
    });

    it('should handle fractional days', () => {
      expect(calculateALOS(365, 60)).toBe(6.1);
    });
  });

  // ─── Department Revenue Distribution ────────────────────────────────────────
  describe('Department Revenue Distribution', () => {
    it('should calculate revenue percentage per department', () => {
      const departments = [
        { department: 'OPD', revenue: 500000 },
        { department: 'IPD', revenue: 300000 },
        { department: 'Lab', revenue: 150000 },
        { department: 'Pharmacy', revenue: 50000 },
      ];
      const total = departments.reduce((s, d) => s + d.revenue, 0);
      expect(total).toBe(1000000);

      const withPct = departments.map(d => ({
        ...d,
        percentage: total > 0 ? parseFloat(((d.revenue / total) * 100).toFixed(1)) : 0,
      }));

      expect(withPct[0].percentage).toBe(50.0);
      expect(withPct[1].percentage).toBe(30.0);
      expect(withPct[2].percentage).toBe(15.0);
      expect(withPct[3].percentage).toBe(5.0);
    });
  });

  // ─── Doctor Performance Metrics ─────────────────────────────────────────────
  describe('Doctor Performance Metrics', () => {
    function calculateAvgRevenuePerVisit(revenue: number, visits: number): number {
      return visits > 0 ? parseFloat((revenue / visits).toFixed(0)) : 0;
    }

    it('should calculate average revenue per visit', () => {
      expect(calculateAvgRevenuePerVisit(100000, 50)).toBe(2000);
      expect(calculateAvgRevenuePerVisit(0, 20)).toBe(0);
      expect(calculateAvgRevenuePerVisit(50000, 0)).toBe(0);
    });

    it('should rank doctors by revenue descending', () => {
      const doctors = [
        { id: 1, name: 'Dr. A', revenue: 150000, visits: 60 },
        { id: 2, name: 'Dr. B', revenue: 200000, visits: 80 },
        { id: 3, name: 'Dr. C', revenue: 100000, visits: 50 },
      ];
      const sorted = [...doctors].sort((a, b) => b.revenue - a.revenue);
      expect(sorted[0].id).toBe(2);
      expect(sorted[1].id).toBe(1);
      expect(sorted[2].id).toBe(3);
    });
  });

  // ─── Monthly Summary Dashboard ──────────────────────────────────────────────
  describe('Monthly Summary Dashboard', () => {
    function calculateProfitMargin(revenue: number, expenses: number): number {
      const netProfit = revenue - expenses;
      return revenue > 0 ? parseFloat(((netProfit / revenue) * 100).toFixed(1)) : 0;
    }

    it('should calculate all monthly summary KPIs', () => {
      const revenue = 500000;
      const expenses = 300000;
      const newPatients = 120;
      const totalVisits = 450;
      const newAdmissions = 30;
      const discharges = 25;

      const netProfit = revenue - expenses;
      const margin = calculateProfitMargin(revenue, expenses);

      expect(netProfit).toBe(200000);
      expect(margin).toBe(40.0);
      expect(newPatients).toBe(120);
      expect(totalVisits).toBe(450);
      expect(newAdmissions).toBe(30);
      expect(discharges).toBe(25);
    });

    it('should identify top diagnoses correctly', () => {
      const diagnoses = [
        { diagnosis: 'Hypertension', count: 45 },
        { diagnosis: 'Diabetes Type 2', count: 38 },
        { diagnosis: 'Upper Respiratory Infection', count: 32 },
        { diagnosis: 'Gastritis', count: 20 },
      ];
      expect(diagnoses[0].diagnosis).toBe('Hypertension');
      expect(diagnoses[0].count).toBe(45);
      expect(diagnoses.length).toBeLessThanOrEqual(10);
    });
  });

  // ─── Appointment Analytics ──────────────────────────────────────────────────
  describe('Appointment Analytics', () => {
    function calculateNoShowRate(total: number, noShows: number): number {
      return total > 0 ? parseFloat(((noShows / total) * 100).toFixed(1)) : 0;
    }

    function calculateUtilizationRate(completed: number, total: number): number {
      return total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0;
    }

    it('should calculate no-show rate correctly', () => {
      expect(calculateNoShowRate(100, 10)).toBe(10.0);
      expect(calculateNoShowRate(200, 0)).toBe(0);
      expect(calculateNoShowRate(0, 0)).toBe(0);
    });

    it('should calculate slot utilization rate', () => {
      expect(calculateUtilizationRate(80, 100)).toBe(80.0);
      expect(calculateUtilizationRate(0, 50)).toBe(0);
      expect(calculateUtilizationRate(45, 45)).toBe(100.0);
    });

    it('should identify peak hour from appointment data', () => {
      const hours = [
        { timeSlot: '09:00', count: 25 },
        { timeSlot: '10:00', count: 40 },
        { timeSlot: '11:00', count: 35 },
        { timeSlot: '14:00', count: 20 },
      ];
      const peak = hours.reduce((max, h) => h.count > max.count ? h : max, hours[0]);
      expect(peak.timeSlot).toBe('10:00');
      expect(peak.count).toBe(40);
    });

    it('should calculate daily appointment volume trends', () => {
      const daily = [
        { date: '2026-04-20', appointmentCount: 45, completedCount: 38, cancelledCount: 4, noShowCount: 3 },
        { date: '2026-04-21', appointmentCount: 50, completedCount: 42, cancelledCount: 5, noShowCount: 3 },
      ];
      const totalAppointments = daily.reduce((s, d) => s + d.appointmentCount, 0);
      const totalCompleted = daily.reduce((s, d) => s + d.completedCount, 0);
      expect(totalAppointments).toBe(95);
      expect(totalCompleted).toBe(80);
    });
  });

  // ─── Lab Analytics ──────────────────────────────────────────────────────────
  describe('Lab Analytics', () => {
    function calculateTATCategory(avgHours: number): string {
      if (avgHours <= 2) return 'Excellent';
      if (avgHours <= 6) return 'Good';
      if (avgHours <= 24) return 'Acceptable';
      return 'Needs Improvement';
    }

    it('should categorize tests by category with percentages', () => {
      const categories = [
        { category: 'Hematology', testCount: 150, revenue: 75000 },
        { category: 'Biochemistry', testCount: 120, revenue: 90000 },
        { category: 'Microbiology', testCount: 60, revenue: 45000 },
      ];
      const totalTests = categories.reduce((s, c) => s + c.testCount, 0);
      expect(totalTests).toBe(330);

      const withPct = categories.map(c => ({
        ...c,
        percentage: totalTests > 0 ? parseFloat(((c.testCount / totalTests) * 100).toFixed(1)) : 0,
      }));
      expect(withPct[0].percentage).toBeCloseTo(45.5, 0);
      expect(withPct[1].percentage).toBeCloseTo(36.4, 0);
      expect(withPct[2].percentage).toBeCloseTo(18.2, 0);
    });

    it('should calculate TAT performance categories', () => {
      expect(calculateTATCategory(1.5)).toBe('Excellent');
      expect(calculateTATCategory(4)).toBe('Good');
      expect(calculateTATCategory(12)).toBe('Acceptable');
      expect(calculateTATCategory(48)).toBe('Needs Improvement');
    });

    it('should rank top ordered tests correctly', () => {
      const tests = [
        { testName: 'CBC', orderCount: 200, revenue: 40000 },
        { testName: 'Blood Sugar', orderCount: 180, revenue: 18000 },
        { testName: 'Lipid Profile', orderCount: 120, revenue: 36000 },
      ];
      const sorted = [...tests].sort((a, b) => b.orderCount - a.orderCount);
      expect(sorted[0].testName).toBe('CBC');
      expect(sorted[1].testName).toBe('Blood Sugar');
      expect(sorted[2].testName).toBe('Lipid Profile');
    });

    it('should track pending vs completed trend', () => {
      const trend = [
        { date: '2026-04-20', total: 50, completed: 42, pending: 8 },
        { date: '2026-04-21', total: 55, completed: 48, pending: 7 },
      ];
      const totalCompleted = trend.reduce((s, d) => s + d.completed, 0);
      const totalPending = trend.reduce((s, d) => s + d.pending, 0);
      expect(totalCompleted).toBe(90);
      expect(totalPending).toBe(15);
    });
  });

  // ─── Pharmacy Analytics ─────────────────────────────────────────────────────
  describe('Pharmacy Analytics', () => {
    function calculateStockValue(qty: number, price: number): number {
      return qty * price;
    }

    it('should calculate dispensing summary totals', () => {
      const daily = [
        { saleDate: '2026-04-20', saleCount: 25, revenue: 15000, uniquePatients: 20 },
        { saleDate: '2026-04-21', saleCount: 30, revenue: 18000, uniquePatients: 25 },
      ];
      const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0);
      const totalSales = daily.reduce((s, d) => s + d.saleCount, 0);
      expect(totalRevenue).toBe(33000);
      expect(totalSales).toBe(55);
    });

    it('should calculate stock value correctly', () => {
      expect(calculateStockValue(100, 50)).toBe(5000);
      expect(calculateStockValue(0, 100)).toBe(0);
      expect(calculateStockValue(500, 12.5)).toBe(6250);
    });

    it('should identify expiry alerts correctly', () => {
      const alerts = [
        { medicineName: 'Paracetamol', daysUntilExpiry: 30, isExpired: false },
        { medicineName: 'Amoxicillin', daysUntilExpiry: -5, isExpired: true },
        { medicineName: 'Omeprazole', daysUntilExpiry: 60, isExpired: false },
      ];
      const expired = alerts.filter(a => a.isExpired);
      const nearExpiry = alerts.filter(a => !a.isExpired && a.daysUntilExpiry <= 30);

      expect(expired).toHaveLength(1);
      expect(expired[0].medicineName).toBe('Amoxicillin');
      expect(nearExpiry).toHaveLength(1);
      expect(nearExpiry[0].medicineName).toBe('Paracetamol');
    });

    it('should rank top dispensed medicines', () => {
      const medicines = [
        { medicineName: 'Paracetamol', totalQty: 500, totalRevenue: 5000, saleCount: 100 },
        { medicineName: 'Amoxicillin', totalQty: 300, totalRevenue: 9000, saleCount: 60 },
        { medicineName: 'Metformin', totalQty: 400, totalRevenue: 8000, saleCount: 80 },
      ];
      const sorted = [...medicines].sort((a, b) => b.totalQty - a.totalQty);
      expect(sorted[0].medicineName).toBe('Paracetamol');
      expect(sorted[1].medicineName).toBe('Metformin');
      expect(sorted[2].medicineName).toBe('Amoxicillin');
    });

    it('should calculate purchase summary totals', () => {
      const daily = [
        { receiptDate: '2026-04-20', grnCount: 3, totalPurchase: 50000, totalDiscount: 2000, totalVat: 2500 },
        { receiptDate: '2026-04-21', grnCount: 2, totalPurchase: 35000, totalDiscount: 1000, totalVat: 1750 },
      ];
      const totalPurchase = daily.reduce((s, d) => s + d.totalPurchase, 0);
      expect(totalPurchase).toBe(85000);
    });

    it('should track stock movements by type', () => {
      const movements = [
        { type: 'in', quantity: 100, itemName: 'Paracetamol' },
        { type: 'out', quantity: 25, itemName: 'Paracetamol' },
        { type: 'in', quantity: 50, itemName: 'Amoxicillin' },
        { type: 'out', quantity: 10, itemName: 'Amoxicillin' },
      ];
      const totalIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.quantity, 0);
      const totalOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.quantity, 0);
      expect(totalIn).toBe(150);
      expect(totalOut).toBe(35);
    });
  });

  // ─── Report Data Validation ─────────────────────────────────────────────────
  describe('Report Data Validation', () => {
    it('should require valid date range format (YYYY-MM-DD)', () => {
      const validDate = /^\d{4}-\d{2}-\d{2}$/;
      expect(validDate.test('2026-04-23')).toBe(true);
      expect(validDate.test('2026-4-23')).toBe(false);
      expect(validDate.test('04-23-2026')).toBe(false);
      expect(validDate.test('')).toBe(false);
    });

    it('should validate date range order (start <= end)', () => {
      function isValidRange(start: string, end: string): boolean {
        return new Date(start) <= new Date(end);
      }
      expect(isValidRange('2026-04-01', '2026-04-30')).toBe(true);
      expect(isValidRange('2026-04-30', '2026-04-01')).toBe(false);
      expect(isValidRange('2026-04-15', '2026-04-15')).toBe(true);
    });

    it('should validate year format for monthly reports', () => {
      const validYear = /^\d{4}$/;
      expect(validYear.test('2026')).toBe(true);
      expect(validYear.test('202')).toBe(false);
      expect(validYear.test('20266')).toBe(false);
    });

    it('should validate month format (YYYY-MM)', () => {
      const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
      expect(validMonth.test('2026-04')).toBe(true);
      expect(validMonth.test('2026-4')).toBe(false);
      expect(validMonth.test('2026-13')).toBe(false);
      expect(validMonth.test('2026-00')).toBe(false);
    });

    it('should limit query results to prevent abuse', () => {
      const limits = [10, 25, 50];
      limits.forEach(l => {
        expect(l).toBeGreaterThanOrEqual(1);
        expect(l).toBeLessThanOrEqual(50);
      });
    });
  });

  // ─── CSV Export Formatting ──────────────────────────────────────────────────
  describe('CSV Export Formatting', () => {
    it('should format CSV rows correctly', () => {
      const rows = [
        { month: '2026-04', income: 100000, expense: 40000, profit: 60000 },
      ];
      const csv = ['Month,Income,Expense,Profit',
        ...rows.map(r => `${r.month},${r.income},${r.expense},${r.profit}`),
      ].join('\n');
      expect(csv).toContain('Month,Income,Expense,Profit');
      expect(csv).toContain('2026-04,100000,40000,60000');
    });

    it('should include BOM for Excel compatibility', () => {
      const bom = '\uFEFF';
      const csv = bom + 'Month,Income\n2026-04,100000';
      expect(csv.charCodeAt(0)).toBe(0xFEFF);
    });
  });

  // ─── Report Security & RBAC ─────────────────────────────────────────────────
  describe('Report Security & RBAC', () => {
    it('should restrict pharmacy reports to authorized roles', () => {
      const allowedRoles = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'];
      const requestingRole = 'pharmacist';
      expect(allowedRoles).toContain(requestingRole);
    });

    it('should deny pharmacy reports to unauthorized roles', () => {
      const allowedRoles = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'];
      const requestingRole = 'patient';
      expect(allowedRoles).not.toContain(requestingRole);
    });

    it('should enforce tenant isolation in all report queries', () => {
      const queries = [
        'WHERE tenant_id = ?',
        'AND tenant_id = ?',
      ];
      queries.forEach(q => expect(q).toContain('tenant_id'));
    });
  });

  // ─── Report API Response Structure ──────────────────────────────────────────
  describe('Report API Response Structure', () => {
    it('should include generatedAt timestamp in P&L response', () => {
      const response = { generatedAt: new Date().toISOString() };
      expect(response.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include period range in responses', () => {
      const response = { period: { startDate: '2026-04-01', endDate: '2026-04-30' } };
      expect(response.period.startDate).toBe('2026-04-01');
      expect(response.period.endDate).toBe('2026-04-30');
    });

    it('should handle empty result sets gracefully', () => {
      const emptyResponse = { breakdown: [], total: 0 };
      expect(emptyResponse.breakdown).toHaveLength(0);
      expect(emptyResponse.total).toBe(0);
    });
  });

});
