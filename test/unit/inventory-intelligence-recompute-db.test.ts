import { describe, expect, it } from 'vitest';
import { recomputeInventoryIntelligence } from '../../src/lib/inventory-intelligence/recompute';

type QueryCall = { sql: string; binds: unknown[]; method: 'all' | 'first' | 'run' };

class FakeStatement {
  constructor(private readonly db: FakeD1Client, private readonly sql: string) {}

  bind(...binds: unknown[]) {
    return {
      all: async <T>() => this.db.respondAll<T>(this.sql, binds),
      first: async <T>() => this.db.respondFirst<T>(this.sql, binds),
      run: async () => this.db.respondRun(this.sql, binds),
    };
  }
}

class FakeD1Client {
  calls: QueryCall[] = [];
  existingRecommendationId: number | null = null;

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async respondAll<T>(sql: string, binds: unknown[]): Promise<{ results: T[] }> {
    this.calls.push({ sql, binds, method: 'all' });

    if (sql.includes('FROM InventoryItem')) {
      return { results: [{ ItemId: 1, ItemName: 'CBC Diluent', ItemCode: 'CBC-DIL', ReOrderLevel: 10, MaxStockQuantity: 100 }] as T[] };
    }
    if (sql.includes('FROM InventoryStock')) {
      return { results: [{ ItemId: 1, AvailableQuantity: 5, ReservedQuantity: 0, DamagedQuantity: 0, BlockedQuantity: 0, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-08-01', IsActive: 1 }] as T[] };
    }
    if (sql.includes('FROM inventory_demand_daily')) {
      return { results: [{ ItemId: 1, demand_date: '2026-07-05', consumed_qty: 30 }] as T[] };
    }
    if (sql.includes('FROM InventoryPurchaseRequestItem')) {
      return { results: [{ ItemId: 1, open_pr_qty: 4 }] as T[] };
    }
    if (sql.includes('FROM InventoryPurchaseOrderItem')) {
      return { results: [{ ItemId: 1, open_po_qty: 6 }] as T[] };
    }

    return { results: [] };
  }

  async respondFirst<T>(sql: string, binds: unknown[]): Promise<T | null> {
    this.calls.push({ sql, binds, method: 'first' });
    if (sql.includes('FROM inventory_demand_source_event')) {
      return { event_count: 1 } as T;
    }
    if (sql.includes('FROM inventory_recommendation') && this.existingRecommendationId) {
      return { id: this.existingRecommendationId } as T;
    }
    return null;
  }

  async respondRun(sql: string, binds: unknown[]) {
    this.calls.push({ sql, binds, method: 'run' });
    return { success: true };
  }
}

describe('inventory intelligence DB recompute orchestration', () => {
  it('updates an existing open recommendation instead of resolving and recreating it', async () => {
    const db = new FakeD1Client();
    db.existingRecommendationId = 88;

    const result = await recomputeInventoryIntelligence(db, 'tenant-1', {
      today: '2026-07-05',
      now: '2026-07-05T09:00:00.000Z',
      leadTimeDays: 7,
      safetyStockDays: 7,
    });

    expect(result).toMatchObject({ recomputedItems: 1, generatedRecommendations: 1, status: 'ready' });
    expect(db.calls.some((call) => call.sql.includes('OrderedQuantity'))).toBe(false);
    expect(db.calls.some((call) => call.method === 'first' && call.sql.includes('FROM inventory_recommendation'))).toBe(true);
    expect(db.calls.some((call) => call.method === 'run' && call.sql.includes('UPDATE inventory_recommendation') && call.sql.includes('title = ?'))).toBe(true);
    expect(db.calls.some((call) => call.method === 'run' && call.sql.includes("SET status = 'resolved'"))).toBe(false);
    expect(db.calls.some((call) => call.method === 'run' && call.sql.includes('INSERT INTO inventory_recommendation'))).toBe(false);
  });

  it('inserts a new open recommendation when no matching open card exists', async () => {
    const db = new FakeD1Client();

    const result = await recomputeInventoryIntelligence(db, 'tenant-1', {
      today: '2026-07-05',
      now: '2026-07-05T09:00:00.000Z',
      leadTimeDays: 7,
      safetyStockDays: 7,
    });

    expect(result.generatedRecommendations).toBe(1);
    expect(db.calls.some((call) => call.method === 'run' && call.sql.includes('INSERT INTO inventory_recommendation'))).toBe(true);
    expect(db.calls.some((call) => call.method === 'run' && call.sql.includes("SET status = 'resolved'"))).toBe(false);
  });
});
