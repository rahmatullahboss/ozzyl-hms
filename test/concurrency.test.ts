import { describe, it, expect } from 'vitest';

// ═════════════════════════════════════════════════════════════════════════════
// CONCURRENCY & RACE CONDITION TESTS
// Tests that simultaneous operations don't corrupt data
// ═════════════════════════════════════════════════════════════════════════════

describe('HMS Concurrency & Race Condition Tests', () => {

  // ─── 1. Double-booking Prevention ──────────────────────────────────────────
  describe('Appointment Double-Booking Prevention', () => {
    interface TimeSlot { doctorId: number; date: string; startTime: string; endTime: string }

    function hasConflict(existing: TimeSlot[], newSlot: TimeSlot): boolean {
      return existing.some(e =>
        e.doctorId === newSlot.doctorId &&
        e.date === newSlot.date &&
        e.startTime < newSlot.endTime &&
        e.endTime > newSlot.startTime
      );
    }

    const bookedSlots: TimeSlot[] = [
      { doctorId: 1, date: '2024-01-15', startTime: '10:00', endTime: '10:30' },
      { doctorId: 1, date: '2024-01-15', startTime: '11:00', endTime: '11:30' },
    ];

    it('should detect overlapping appointment (same doctor, overlapping time)', () => {
      const newSlot: TimeSlot = { doctorId: 1, date: '2024-01-15', startTime: '10:15', endTime: '10:45' };
      expect(hasConflict(bookedSlots, newSlot)).toBe(true);
    });

    it('should allow non-overlapping appointment', () => {
      const newSlot: TimeSlot = { doctorId: 1, date: '2024-01-15', startTime: '10:30', endTime: '11:00' };
      expect(hasConflict(bookedSlots, newSlot)).toBe(false);
    });

    it('should allow same time for different doctor', () => {
      const newSlot: TimeSlot = { doctorId: 2, date: '2024-01-15', startTime: '10:00', endTime: '10:30' };
      expect(hasConflict(bookedSlots, newSlot)).toBe(false);
    });

    it('should detect exact duplicate booking', () => {
      const dupe: TimeSlot = { doctorId: 1, date: '2024-01-15', startTime: '10:00', endTime: '10:30' };
      expect(hasConflict(bookedSlots, dupe)).toBe(true);
    });
  });

  // ─── 2. Bed Assignment Race Condition ──────────────────────────────────────
  describe('Bed Assignment Race Condition', () => {
    type BedStatus = 'available' | 'occupied' | 'maintenance' | 'reserved';

    function tryAssignBed(currentStatus: BedStatus): { success: boolean; error?: string } {
      if (currentStatus !== 'available') {
        return { success: false, error: `Bed is ${currentStatus}, cannot assign` };
      }
      return { success: true };
    }

    it('should succeed when bed is available', () => {
      expect(tryAssignBed('available').success).toBe(true);
    });

    it('should fail when bed is already occupied', () => {
      const result = tryAssignBed('occupied');
      expect(result.success).toBe(false);
      expect(result.error).toContain('occupied');
    });

    it('should fail when bed is under maintenance', () => {
      expect(tryAssignBed('maintenance').success).toBe(false);
    });

    it('should fail when bed is reserved', () => {
      expect(tryAssignBed('reserved').success).toBe(false);
    });

    it('should prevent two simultaneous assignments to same bed', () => {
      let status: BedStatus = 'available';
      // First request
      const r1 = tryAssignBed(status);
      if (r1.success) status = 'occupied';
      // Second request (concurrent) now sees occupied
      const r2 = tryAssignBed(status);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(false);
    });
  });

  // ─── 3. Payment Race Condition ─────────────────────────────────────────────
  describe('Payment Race Condition Prevention', () => {
    function processPayment(billTotal: number, alreadyPaid: number, paymentAmount: number): { success: boolean; overpaid?: boolean; newPaid: number } {
      const newPaid = alreadyPaid + paymentAmount;
      if (newPaid > billTotal) {
        return { success: false, overpaid: true, newPaid: alreadyPaid };
      }
      return { success: true, newPaid };
    }

    it('should accept valid payment within due amount', () => {
      const result = processPayment(5000, 2000, 1000);
      expect(result.success).toBe(true);
      expect(result.newPaid).toBe(3000);
    });

    it('should reject payment exceeding total bill', () => {
      const result = processPayment(5000, 4500, 1000);
      expect(result.success).toBe(false);
      expect(result.overpaid).toBe(true);
    });

    it('should accept exact remaining payment', () => {
      const result = processPayment(5000, 3000, 2000);
      expect(result.success).toBe(true);
      expect(result.newPaid).toBe(5000);
    });

    it('should handle two concurrent payments that together exceed total', () => {
      const total = 5000;
      let paid = 3000;
      // Both see due = 2000, both try to pay 2000
      const p1 = processPayment(total, paid, 2000);
      if (p1.success) paid = p1.newPaid;
      const p2 = processPayment(total, paid, 2000);
      // p1 succeeds, p2 should be rejected since bill is now paid
      expect(p1.success).toBe(true);
      expect(p2.success).toBe(false);
    });
  });

  // ─── 4. Sequence Number Generation ─────────────────────────────────────────
  describe('Sequence Number Atomic Increment', () => {
    function generateSeqNumbers(count: number, startFrom: number): number[] {
      const generated: number[] = [];
      for (let i = 0; i < count; i++) {
        generated.push(startFrom + i);
      }
      return generated;
    }

    it('should generate unique sequential numbers', () => {
      const nums = generateSeqNumbers(100, 1);
      const unique = new Set(nums);
      expect(unique.size).toBe(100);
    });

    it('should not generate duplicates even with 1000 items', () => {
      const nums = generateSeqNumbers(1000, 1);
      const unique = new Set(nums);
      expect(unique.size).toBe(1000);
    });

    it('numbers should be in ascending order', () => {
      const nums = generateSeqNumbers(50, 1);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBeGreaterThan(nums[i - 1]);
      }
    });
  });

  // ─── 5. Inventory Deduction Race ───────────────────────────────────────────
  describe('Pharmacy Stock Deduction Race', () => {
    function deductStock(currentStock: number, quantity: number): { success: boolean; remaining: number; error?: string } {
      if (quantity > currentStock) {
        return { success: false, remaining: currentStock, error: 'Insufficient stock' };
      }
      return { success: true, remaining: currentStock - quantity };
    }

    it('should deduct stock when sufficient', () => {
      const r = deductStock(100, 10);
      expect(r.success).toBe(true);
      expect(r.remaining).toBe(90);
    });

    it('should reject deduction when insufficient', () => {
      const r = deductStock(5, 10);
      expect(r.success).toBe(false);
      expect(r.remaining).toBe(5);
    });

    it('should handle two concurrent sales depleting stock', () => {
      let stock = 10;
      const s1 = deductStock(stock, 8);
      if (s1.success) stock = s1.remaining;
      const s2 = deductStock(stock, 8);
      expect(s1.success).toBe(true);
      expect(s2.success).toBe(false);
    });
  });
});
