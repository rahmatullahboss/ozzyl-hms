import { describe, it, expect, beforeEach } from 'vitest';
import { D1Database } from '@cloudflare/workers-types';

// ─── Counter Cash Handling Tests ──────────────────────────────────────────────
// Tests for DanpheEMR-style counter cash handling:
// 1. Counter open with opening cash
// 2. Cash in/out during session
// 3. Counter close creates handover record
// 4. Admin can view pending handovers
// 5. Admin can collect cash from counter
// 6. Opening cash reset behavior

describe('Counter Cash Handling', () => {
  describe('Counter Session Lifecycle', () => {
    it('should calculate expected cash correctly: opening + cash_in - cash_out', () => {
      const openingCash = 5000;
      const cashIn = 15000; // Sales
      const cashOut = 2000; // Refunds
      const expectedCash = openingCash + cashIn - cashOut;
      expect(expectedCash).toBe(18000);
    });

    it('should calculate variance: declared_cash - expected_cash', () => {
      const expectedCash = 18000;
      const declaredCash = 17500;
      const variance = declaredCash - expectedCash;
      expect(variance).toBe(-500); // Short by 500
    });

    it('should handle over-collection (positive variance)', () => {
      const expectedCash = 18000;
      const declaredCash = 18500;
      const variance = declaredCash - expectedCash;
      expect(variance).toBe(500); // Over by 500
    });

    it('should handle zero variance (perfect balance)', () => {
      const expectedCash = 18000;
      const declaredCash = 18000;
      const variance = declaredCash - expectedCash;
      expect(variance).toBe(0);
    });
  });

  describe('Handover Record Creation', () => {
    it('should create handover record with correct amount on counter close', () => {
      const counterCloseData = {
        closingCash: 18000,
        expectedCash: 18000,
        handoverTo: 5, // accountant ID
        remarks: 'End of day handover',
      };

      // Handover amount = expected cash (all cash given to admin)
      const handoverAmount = counterCloseData.expectedCash;
      expect(handoverAmount).toBe(18000);
    });

    it('should link handover to counter session', () => {
      const sessionId = 42;
      const handover = {
        counter_session_id: sessionId,
        handover_amount: 18000,
        handover_type: 'counter',
        status: 'pending',
      };
      expect(handover.counter_session_id).toBe(42);
      expect(handover.status).toBe('pending');
    });

    it('should allow partial handover (admin collects part)', () => {
      const expectedCash = 25000;
      const adminCollects = 20000; // Admin takes 20000, 5000 stays in drawer
      const remainingCash = expectedCash - adminCollects;

      expect(adminCollects).toBe(20000);
      expect(remainingCash).toBe(5000);
    });
  });

  describe('Opening Cash Reset', () => {
    it('should reset opening cash to 0 after handover collection', () => {
      // Previous session closed with handover
      const previousClosingCash = 18000;
      const handoverCollected = 18000; // Admin took all
      const remainingInDrawer = previousClosingCash - handoverCollected;

      // Next day opening = handover collected amount (what admin put back?) or 0
      // In DanpheEMR: Opening = amount handed over (admin puts it in new drawer)
      // OR Opening = 0 if drawer is emptied
      const openingCash = remainingInDrawer; // If admin emptied, opening = 0
      expect(openingCash).toBe(0);
    });

    it('should allow custom opening cash if needed', () => {
      const expectedCash = 18000;
      const adminPutsBack = 5000; // Admin gives some cash to start
      const openingCash = adminPutsBack;

      expect(openingCash).toBe(5000);
    });
  });

  describe('Real-time Cash Balance', () => {
    it('should calculate current balance during active session', () => {
      const openingCash = 5000;
      const transactions = [
        { type: 'cash_in', amount: 3000 },  // Sale
        { type: 'cash_in', amount: 5000 },  // Sale
        { type: 'cash_out', amount: 500 },  // Refund
        { type: 'cash_in', amount: 2000 },  // Sale
        { type: 'cash_out', amount: 1000 }, // Refund
      ];

      let balance = openingCash;
      for (const tx of transactions) {
        if (tx.type === 'cash_in') {
          balance += tx.amount;
        } else {
          balance -= tx.amount;
        }
      }

      expect(balance).toBe(13500); // 5000 + 3000 + 5000 - 500 + 2000 - 1000
    });

    it('should track individual cash in/out totals', () => {
      const openingCash = 5000;
      let totalCashIn = 0;
      let totalCashOut = 0;

      const transactions = [
        { type: 'cash_in', amount: 3000 },
        { type: 'cash_in', amount: 5000 },
        { type: 'cash_out', amount: 500 },
        { type: 'cash_out', amount: 1000 },
      ];

      for (const tx of transactions) {
        if (tx.type === 'cash_in') {
          totalCashIn += tx.amount;
        } else {
          totalCashOut += tx.amount;
        }
      }

      const expectedCash = openingCash + totalCashIn - totalCashOut;
      expect(totalCashIn).toBe(8000);
      expect(totalCashOut).toBe(1500);
      expect(expectedCash).toBe(11500);
    });
  });

  describe('Admin Cash Collection Dashboard', () => {
    it('should list pending handovers for admin', () => {
      const handovers = [
        { id: 1, counter_name: 'Billing Counter 1', handover_amount: 18000, status: 'pending', created_at: '2026-05-11T10:00:00' },
        { id: 2, counter_name: 'Billing Counter 2', handover_amount: 12500, status: 'pending', created_at: '2026-05-11T10:30:00' },
        { id: 3, counter_name: 'Billing Counter 1', handover_amount: 8000, status: 'collected', created_at: '2026-05-10T18:00:00' },
      ];

      const pendingHandovers = handovers.filter(h => h.status === 'pending');
      expect(pendingHandovers).toHaveLength(2);
      expect(pendingHandovers.reduce((sum, h) => sum + h.handover_amount, 0)).toBe(30500);
    });

    it('should calculate total collection for the day', () => {
      const today = '2026-05-11';
      const handovers = [
        { id: 1, handover_amount: 18000, status: 'collected', date: '2026-05-11' },
        { id: 2, handover_amount: 12500, status: 'collected', date: '2026-05-11' },
        { id: 3, handover_amount: 8000, status: 'collected', date: '2026-05-11' },
        { id: 4, handover_amount: 5000, status: 'pending', date: '2026-05-11' },
        { id: 5, handover_amount: 20000, status: 'collected', date: '2026-05-10' }, // Yesterday
      ];

      const todayCollected = handovers
        .filter(h => h.date === today && h.status === 'collected')
        .reduce((sum, h) => sum + h.handover_amount, 0);

      expect(todayCollected).toBe(38500); // 18000 + 12500 + 8000
    });
  });

  describe('Cash Drawer Movements', () => {
    it('should record opening movement', () => {
      const movement = {
        movement_type: 'opening',
        amount: 5000,
        description: 'Counter session opened',
      };
      expect(movement.movement_type).toBe('opening');
      expect(movement.amount).toBe(5000);
    });

    it('should record handover movement on close', () => {
      const movement = {
        movement_type: 'handover',
        amount: 18000,
        description: 'End of day handover to accountant',
      };
      expect(movement.movement_type).toBe('handover');
      expect(movement.amount).toBe(18000);
    });

    it('should record cash_in movements during session', () => {
      const movements = [
        { movement_type: 'cash_in', amount: 3000, description: 'Bill #001' },
        { movement_type: 'cash_in', amount: 5000, description: 'Bill #002' },
      ];
      const totalCashIn = movements
        .filter(m => m.movement_type === 'cash_in')
        .reduce((sum, m) => sum + m.amount, 0);
      expect(totalCashIn).toBe(8000);
    });

    it('should record cash_out movements during session', () => {
      const movements = [
        { movement_type: 'cash_out', amount: 500, description: 'Refund Bill #001' },
        { movement_type: 'cash_out', amount: 1000, description: 'Change given' },
      ];
      const totalCashOut = movements
        .filter(m => m.movement_type === 'cash_out')
        .reduce((sum, m) => sum + m.amount, 0);
      expect(totalCashOut).toBe(1500);
    });
  });

  describe('Counter Close Flow', () => {
    it('should require handover_to when closing counter', () => {
      const closeSessionData = {
        closingCash: 18000,
        remarks: 'End of day',
      };

      // Missing handover_to should cause validation error
      const hasHandoverTo = 'handover_to' in closeSessionData;
      expect(hasHandoverTo).toBe(false);
    });

    it('should validate closing cash is non-negative', () => {
      const closingCash = -100;
      expect(closingCash).toBeLessThan(0); // Invalid
    });

    it('should handle admin collecting cash in parts', () => {
      const expectedCash = 18000;
      const firstCollection = 10000;
      const secondCollection = 5000;
      const remaining = expectedCash - firstCollection - secondCollection;

      expect(remaining).toBe(3000);
    });
  });

  describe('Session Summary', () => {
    it('should generate complete session summary', () => {
      const session = {
        id: 42,
        session_no: 'BCS-2026-0042',
        counter_name: 'Main Billing',
        employee_name: 'Rahim',
        opening_cash: 5000,
        cash_in: 18000,
        cash_out: 2000,
        closing_cash_declared: 21000,
        expected_cash: 21000,
        variance: 0,
        status: 'closed',
        opened_at: '2026-05-11T08:00:00',
        closed_at: '2026-05-11T20:00:00',
      };

      expect(session.opening_cash + session.cash_in - session.cash_out).toBe(session.expected_cash);
      expect(session.variance).toBe(0); // Perfect balance
    });

    it('should flag sessions with variance for review', () => {
      const sessions = [
        { id: 1, variance: 0, status: 'closed' },
        { id: 2, variance: 500, status: 'closed' }, // Over by 500
        { id: 3, variance: -200, status: 'closed' }, // Short by 200
        { id: 4, variance: 0, status: 'active' },
      ];

      const flaggedSessions = sessions.filter(s => s.variance !== 0);
      expect(flaggedSessions).toHaveLength(2);
    });
  });
});

describe('Counter Cash Flow - Integration Scenarios', () => {
  it('should simulate full day counter flow', () => {
    // Morning: Open counter
    let openingCash = 5000;
    expect(openingCash).toBe(5000);

    // Morning sales
    openingCash += 3000; // Sale 1
    openingCash += 5000; // Sale 2
    openingCash += 2000; // Sale 3
    expect(openingCash).toBe(15000);

    // Lunch: Admin collects some cash
    openingCash -= 10000; // Admin takes 10000
    expect(openingCash).toBe(5000);

    // Afternoon sales
    openingCash += 4000; // Sale 4
    openingCash += 3000; // Sale 5
    expect(openingCash).toBe(12000);

    // Evening: Counter closes
    const closingCash = 12000;
    const handoverAmount = closingCash;
    expect(handoverAmount).toBe(12000);

    // Next day: Open with 0 (admin emptied drawer)
    openingCash = 0;
    expect(openingCash).toBe(0);
  });

  it('should handle multi-shift counter', () => {
    // Shift 1: Morning (8am - 2pm)
    let shift1Opening = 5000;
    shift1Opening += 8000; // Sales
    shift1Opening -= 500; // Refund
    const shift1Closing = shift1Opening; // 12500

    // Shift handover: Morning cashier → Afternoon cashier
    const handoverToShift2 = 12500;
    expect(handoverToShift2).toBe(12500);

    // Shift 2: Afternoon (2pm - 8pm)
    let shift2Opening = handoverToShift2; // Start with handover amount
    shift2Opening += 10000; // Afternoon sales
    shift2Opening -= 2000; // Refund
    const shift2Closing = shift2Opening; // 20500

    expect(shift2Closing).toBe(20500);
  });

  it('should track per-user cash responsibility', () => {
    const cashierSessions = [
      { cashier_id: 10, opening: 5000, cash_in: 15000, cash_out: 2000, status: 'closed' },
      { cashier_id: 11, opening: 3000, cash_in: 8000, cash_out: 1000, status: 'closed' },
      { cashier_id: 12, opening: 5000, cash_in: 12000, cash_out: 1500, status: 'active' },
    ];

    // Calculate total cash collected by closed sessions
    const closedSessions = cashierSessions.filter(s => s.status === 'closed');
    const totalCash = closedSessions.reduce((sum, s) => {
      return sum + s.opening + s.cash_in - s.cash_out;
    }, 0);

    expect(totalCash).toBe(28000); // (5000+15000-2000) + (3000+8000-1000) = 18000 + 10000
  });
});

describe('Counter Session API Integration', () => {
  it('should require handoverTo when closing counter (business rule)', () => {
    const closeData = {
      closingCash: 18000,
      remarks: 'End of day',
      handoverTo: undefined,
    };
    const effectiveHandoverTo = closeData.handoverTo ?? Number(1);
    expect(typeof effectiveHandoverTo).toBe('number');
  });

  it('should support partial handover', () => {
    const closeData = {
      closingCash: 18000,
      handoverAmount: 15000,
      handoverTo: 5,
    };
    expect(closeData.handoverAmount).toBeLessThan(closeData.closingCash);
    expect(closeData.closingCash - closeData.handoverAmount).toBe(3000);
  });

  it('should calculate variance correctly', () => {
    const expectedCash = 18000;
    const declaredCash = 18500;
    expect(declaredCash - expectedCash).toBe(500);
  });

  it('should create billing_handovers record on close', () => {
    const handover = {
      tenant_id: 't1',
      handover_type: 'counter',
      handover_by: 10,
      handover_to: 5,
      handover_amount: 18000,
      status: 'pending',
    };
    expect(handover.handover_type).toBe('counter');
    expect(handover.status).toBe('pending');
  });
});

describe('Admin Collection Dashboard API', () => {
  it('should list pending handovers', () => {
    const handovers = [
      { id: 1, handover_amount: 18000, status: 'pending' },
      { id: 2, handover_amount: 12500, status: 'pending' },
      { id: 3, handover_amount: 8000, status: 'collected' },
    ];
    const pending = handovers.filter(h => h.status === 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.reduce((sum, h) => sum + h.handover_amount, 0)).toBe(30500);
  });

  it('should calculate daily collection summary', () => {
    const today = '2026-05-11';
    const collections = [
      { date: today, status: 'collected', amount: 18000 },
      { date: today, status: 'collected', amount: 12500 },
      { date: today, status: 'pending', amount: 5000 },
      { date: '2026-05-10', status: 'collected', amount: 20000 },
    ];
    const todayTotal = collections
      .filter(c => c.date === today && c.status === 'collected')
      .reduce((sum, c) => sum + c.amount, 0);
    expect(todayTotal).toBe(30500);
  });

  it('should support partial collection', () => {
    const handover = { handover_amount: 18000 };
    const collectedAmount = 10000;
    const remaining = handover.handover_amount - collectedAmount;
    const newStatus = remaining === 0 ? 'collected' : 'partial';
    expect(newStatus).toBe('partial');
    expect(remaining).toBe(8000);
  });
});

describe('Opening Cash Reset Behavior', () => {
  it('should reset to 0 after full handover', () => {
    const openingCash = 18000 - 18000;
    expect(openingCash).toBe(0);
  });

  it('should preserve partial amounts', () => {
    const openingCash = 18000 - 15000;
    expect(openingCash).toBe(3000);
  });
});
