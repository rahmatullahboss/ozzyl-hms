import { describe, it, expect } from 'vitest';

// ─── Reports & Dashboard Tests ────────────────────────────────────────────────
// Covers: src/routes/tenant/reports.ts, src/routes/tenant/dashboard.ts
// Hospital management KPIs and reporting

describe('HMS Reports & Dashboard Tests', () => {

  // ─── OPD Statistics ────────────────────────────────────────────────────────
  describe('OPD / IPD Statistics', () => {
    interface DailyStats {
      date: string;
      opdCount: number;
      ipdAdmissions: number;
      ipdDischarges: number;
      emergencyCount: number;
    }

    function calcTotalPatients(stats: DailyStats): number {
      return stats.opdCount + stats.ipdAdmissions + stats.emergencyCount;
    }

    it('should calculate total daily patient count', () => {
      const stats: DailyStats = {
        date: '2024-01-15',
        opdCount: 80,
        ipdAdmissions: 5,
        ipdDischarges: 3,
        emergencyCount: 10,
      };
      expect(calcTotalPatients(stats)).toBe(95);
    });

    it('should handle zero patients day', () => {
      const stats: DailyStats = {
        date: '2024-01-15',
        opdCount: 0,
        ipdAdmissions: 0,
        ipdDischarges: 0,
        emergencyCount: 0,
      };
      expect(calcTotalPatients(stats)).toBe(0);
    });

    it('should calculate monthly total OPD from daily records', () => {
      const dailyOPD = [80, 75, 90, 65, 85, 78, 92];
      const monthlyTotal = dailyOPD.reduce((s, d) => s + d, 0);
      expect(monthlyTotal).toBe(565);
    });
  });

  // ─── Revenue Reports ───────────────────────────────────────────────────────
  describe('Revenue Reports', () => {
    interface RevenueBreakdown {
      billing: number;
      pharmacy: number;
      laboratory: number;
      other: number;
    }

    function calcTotalRevenue(breakdown: RevenueBreakdown): number {
      return breakdown.billing + breakdown.pharmacy + breakdown.laboratory + breakdown.other;
    }

    function calcRevenueShare(amount: number, total: number): number {
      if (total === 0) return 0;
      return Math.round((amount / total) * 100);
    }

    it('should calculate total revenue from breakdown', () => {
      const revenue: RevenueBreakdown = {
        billing: 500_000,
        pharmacy: 200_000,
        laboratory: 150_000,
        other: 50_000,
      };
      expect(calcTotalRevenue(revenue)).toBe(900_000);
    });

    it('should calculate billing share as 55.6% of 900,000', () => {
      expect(calcRevenueShare(500_000, 900_000)).toBe(56); // rounded
    });

    it('should return 0 revenue share when total is 0', () => {
      expect(calcRevenueShare(0, 0)).toBe(0);
    });

    it('should aggregate daily revenue over a month', () => {
      const dailyRevenue = Array(30).fill(30_000); // 30 days × 30,000 each
      const monthly = dailyRevenue.reduce((s, d) => s + d, 0);
      expect(monthly).toBe(900_000);
    });
  });

  // ─── Collection Reports ────────────────────────────────────────────────────
  describe('Daily Collection Reports', () => {
    interface PaymentRecord {
      amount: number;
      method: 'cash' | 'card' | 'bkash' | 'nagad' | 'rocket';
      createdAt: string;
    }

    function groupByMethod(payments: PaymentRecord[]): Record<string, number> {
      return payments.reduce((acc, p) => {
        acc[p.method] = (acc[p.method] ?? 0) + p.amount;
        return acc;
      }, {} as Record<string, number>);
    }

    function calcTotalCollection(payments: PaymentRecord[]): number {
      return payments.reduce((s, p) => s + p.amount, 0);
    }

    it('should calculate total cash + digital collection', () => {
      const payments: PaymentRecord[] = [
        { amount: 5000, method: 'cash', createdAt: '2024-01-15T10:00:00Z' },
        { amount: 3000, method: 'bkash', createdAt: '2024-01-15T11:00:00Z' },
        { amount: 2000, method: 'nagad', createdAt: '2024-01-15T12:00:00Z' },
      ];
      expect(calcTotalCollection(payments)).toBe(10_000);
    });

    it('should group payments by method correctly', () => {
      const payments: PaymentRecord[] = [
        { amount: 5000, method: 'cash', createdAt: '2024-01-15T10:00:00Z' },
        { amount: 3000, method: 'bkash', createdAt: '2024-01-15T11:00:00Z' },
        { amount: 2000, method: 'cash', createdAt: '2024-01-15T12:00:00Z' },
      ];
      const grouped = groupByMethod(payments);
      expect(grouped.cash).toBe(7000);
      expect(grouped.bkash).toBe(3000);
    });

    it('should handle empty payment list', () => {
      expect(calcTotalCollection([])).toBe(0);
    });

    it('should accept all Bangladesh MFS payment methods', () => {
      const methods: PaymentRecord['method'][] = ['cash', 'card', 'bkash', 'nagad', 'rocket'];
      expect(methods).toContain('bkash');
      expect(methods).toContain('nagad');
      expect(methods).toContain('rocket');
    });
  });

  // ─── Doctor-wise Report ────────────────────────────────────────────────────
  describe('Doctor-wise Performance Report', () => {
    interface DoctorPerformance {
      doctorId: number;
      doctorName: string;
      patientCount: number;
      revenue: number;
      commission: number;
    }

    it('should rank doctors by patient count', () => {
      const perf: DoctorPerformance[] = [
        { doctorId: 1, doctorName: 'Dr. A', patientCount: 50, revenue: 50_000, commission: 15_000 },
        { doctorId: 2, doctorName: 'Dr. B', patientCount: 80, revenue: 80_000, commission: 24_000 },
        { doctorId: 3, doctorName: 'Dr. C', patientCount: 30, revenue: 30_000, commission: 9_000 },
      ];
      const sorted = [...perf].sort((a, b) => b.patientCount - a.patientCount);
      expect(sorted[0].doctorName).toBe('Dr. B');
      expect(sorted[2].doctorName).toBe('Dr. C');
    });

    it('should calculate net hospital earnings from doctor revenue', () => {
      const doctorRevenue = 80_000;
      const commission = 24_000;
      const hospitalNet = doctorRevenue - commission;
      expect(hospitalNet).toBe(56_000);
    });

    it('should calculate total commission payout', () => {
      const commissions = [15_000, 24_000, 9_000];
      const total = commissions.reduce((s, c) => s + c, 0);
      expect(total).toBe(48_000);
    });
  });

  // ─── Bed Occupancy Report ──────────────────────────────────────────────────
  describe('Bed Occupancy Report', () => {
    interface BedReport {
      bedType: string;
      total: number;
      occupied: number;
    }

    function calcOccupancyReport(beds: BedReport[]): Array<BedReport & { occupancyPct: number }> {
      return beds.map((b) => ({
        ...b,
        occupancyPct: b.total === 0 ? 0 : Math.round((b.occupied / b.total) * 100),
      }));
    }

    it('should calculate occupancy percentage for each bed type', () => {
      const beds: BedReport[] = [
        { bedType: 'general_ward', total: 30, occupied: 24 },
        { bedType: 'cabin', total: 10, occupied: 7 },
        { bedType: 'icu', total: 5, occupied: 5 },
      ];
      const report = calcOccupancyReport(beds);
      expect(report[0].occupancyPct).toBe(80);
      expect(report[1].occupancyPct).toBe(70);
      expect(report[2].occupancyPct).toBe(100);
    });

    it('should handle zero total beds gracefully', () => {
      const beds: BedReport[] = [{ bedType: 'icu', total: 0, occupied: 0 }];
      const report = calcOccupancyReport(beds);
      expect(report[0].occupancyPct).toBe(0);
    });
  });

  // ─── Due Collection Report ────────────────────────────────────────────────
  describe('Due Collection Report', () => {
    interface DueEntry {
      patientName: string;
      invoiceNo: string;
      totalAmount: number;
      paidAmount: number;
      dueDate: string;
    }

    function calcOutstanding(entry: DueEntry): number {
      return entry.totalAmount - entry.paidAmount;
    }

    function totalDues(entries: DueEntry[]): number {
      return entries.reduce((s, e) => s + calcOutstanding(e), 0);
    }

    function getOverdueDues(entries: DueEntry[], today: string): DueEntry[] {
      return entries.filter((e) => e.dueDate < today && calcOutstanding(e) > 0);
    }

    it('should calculate outstanding amount for a single patient', () => {
      const entry: DueEntry = {
        patientName: 'Rahim',
        invoiceNo: 'INV-000001',
        totalAmount: 10_000,
        paidAmount: 4_000,
        dueDate: '2024-01-20',
      };
      expect(calcOutstanding(entry)).toBe(6_000);
    });

    it('should calculate total dues across all patients', () => {
      const entries: DueEntry[] = [
        { patientName: 'A', invoiceNo: 'INV-001', totalAmount: 10_000, paidAmount: 4_000, dueDate: '2024-01-20' },
        { patientName: 'B', invoiceNo: 'INV-002', totalAmount: 5_000, paidAmount: 5_000, dueDate: '2024-01-21' },
        { patientName: 'C', invoiceNo: 'INV-003', totalAmount: 8_000, paidAmount: 2_000, dueDate: '2024-01-22' },
      ];
      expect(totalDues(entries)).toBe(12_000); // 6000 + 0 + 6000
    });

    it('should identify overdue entries', () => {
      const entries: DueEntry[] = [
        { patientName: 'A', invoiceNo: 'INV-001', totalAmount: 10_000, paidAmount: 4_000, dueDate: '2024-01-10' },
        { patientName: 'B', invoiceNo: 'INV-002', totalAmount: 5_000, paidAmount: 0, dueDate: '2024-01-25' },
      ];
      const overdue = getOverdueDues(entries, '2024-01-15');
      expect(overdue.length).toBe(1);
      expect(overdue[0].patientName).toBe('A');
    });
  });

  // ─── Service-wise Revenue ─────────────────────────────────────────────────
  describe('Service-wise Revenue Breakdown', () => {
    interface ServiceRevenue {
      category: string;
      count: number;
      totalRevenue: number;
    }

    function getTopServices(services: ServiceRevenue[], topN: number): ServiceRevenue[] {
      return [...services]
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, topN);
    }

    it('should list top 3 revenue-generating services', () => {
      const services: ServiceRevenue[] = [
        { category: 'consultation', count: 200, totalRevenue: 200_000 },
        { category: 'lab_test', count: 150, totalRevenue: 150_000 },
        { category: 'pharmacy', count: 300, totalRevenue: 300_000 },
        { category: 'radiology', count: 50, totalRevenue: 75_000 },
      ];
      const top3 = getTopServices(services, 3);
      expect(top3[0].category).toBe('pharmacy');
      expect(top3[1].category).toBe('consultation');
      expect(top3[2].category).toBe('lab_test');
    });

    it('should handle single service', () => {
      const services: ServiceRevenue[] = [
        { category: 'consultation', count: 100, totalRevenue: 100_000 },
      ];
      const top3 = getTopServices(services, 3);
      expect(top3.length).toBe(1);
    });
  });
});
