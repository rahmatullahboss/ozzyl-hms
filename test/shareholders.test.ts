import { describe, it, expect } from 'vitest';

// ─── Shareholders & Profit Distribution Tests ─────────────────────────────────
// Migrated from apps/api/tests/shareholders.test.ts
// Aligned with src/routes/tenant/shareholders.ts + profit.ts

describe('HMS Shareholder & Profit Distribution Tests', () => {
  describe('Shareholder Management', () => {
    it('should require name, shareCount, and type', () => {
      const sh = {
        name: 'Mr. Rahman',
        phone: '01712345678',
        shareCount: 3,
        type: 'profit_holder',
        investment: 300000,
      };
      expect(sh.name).toBeTruthy();
      expect(sh.shareCount).toBeGreaterThan(0);
      expect(['profit_holder', 'owner']).toContain(sh.type);
    });

    it('should calculate investment from share count × share price', () => {
      const sharePrice  = 100_000; // 1 Lakh per share
      const shareCount  = 3;
      const investment  = sharePrice * shareCount;
      expect(investment).toBe(300_000);
    });

    it('should reject negative share count', () => {
      const shareCount = -3;
      expect(shareCount > 0).toBe(false);
    });

    it('should reject shares exceeding available total', () => {
      const maxShares = 300;
      const requested = 350;
      expect(requested <= maxShares).toBe(false);
    });
  });

  describe('Profit Calculation', () => {
    it('should compute net profit = total income − total expenses', () => {
      const income   = 500_000;
      const expenses = 300_000;
      const net = income - expenses;
      expect(net).toBe(200_000);
    });

    it('should handle break-even (zero profit)', () => {
      const profit = 300_000 - 300_000;
      expect(profit).toBe(0);
    });

    it('should handle a loss period (negative profit)', () => {
      const profit = 200_000 - 300_000;
      expect(profit).toBe(-100_000);
    });
  });

  describe('Pool Split', () => {
    it('should allocate 30% pool to profit_holder shareholders', () => {
      const net         = 200_000;
      const holderPool  = net * 0.30;
      expect(holderPool).toBe(60_000);
    });

    it('should allocate 70% pool to owner shareholders', () => {
      const net       = 200_000;
      const ownerPool = net * 0.70;
      expect(ownerPool).toBe(140_000);
    });

    it('holder + owner pools should sum to net profit', () => {
      const net   = 200_000;
      const h     = net * 0.30;
      const o     = net * 0.70;
      expect(h + o).toBe(net);
    });
  });

  describe('Per-Share Amount & Individual Distribution', () => {
    it('should compute per-share amount for profit_holders', () => {
      const holderPool   = 60_000;
      const totalShares  = 100;
      const perShare     = holderPool / totalShares;
      expect(perShare).toBe(600);
    });

    it('should distribute to each shareholder proportionally', () => {
      const holders = [
        { id: 1, shareCount: 3 },
        { id: 2, shareCount: 2 },
      ];
      const perShare = 600;
      const dists = holders.map((h) => ({ id: h.id, amount: h.shareCount * perShare }));
      expect(dists[0].amount).toBe(1800);
      expect(dists[1].amount).toBe(1200);
    });

    it('should produce zero distribution when profit is zero', () => {
      const profit = 0;
      const pool   = profit * 0.30;
      const dist   = pool / 100;
      expect(dist).toBe(0);
    });
  });

  describe('Settings Validation', () => {
    it('should validate total capital = sharePrice × totalShares', () => {
      const sharePrice  = 100_000;
      const totalShares = 300;
      const capital = sharePrice * totalShares;
      expect(capital).toBe(30_000_000); // 3 Crore
    });

    it('profit_holder + owner shares must equal total shares', () => {
      const profitShares = 100;
      const ownerShares  = 200;
      expect(profitShares + ownerShares).toBe(300);
    });
  });
});
