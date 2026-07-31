import { describe, expect, it, vi } from 'vitest';
import { scheduleInventoryIntelligenceRecompute } from '../../src/lib/inventory-intelligence/triggers';

describe('inventory intelligence recompute triggers', () => {
  it('runs recompute immediately when no waitUntil scheduler is provided', async () => {
    const recompute = vi.fn().mockResolvedValue({ recomputedItems: 1 });

    scheduleInventoryIntelligenceRecompute({
      dbClient: {} as any,
      tenantId: 'tenant-1',
      recompute,
    });

    await vi.waitFor(() => expect(recompute).toHaveBeenCalledWith({}, 'tenant-1'));
  });

  it('uses waitUntil when a scheduler is available so stock workflow is not blocked', async () => {
    const recompute = vi.fn().mockResolvedValue({ recomputedItems: 1 });
    const waitUntil = vi.fn();

    scheduleInventoryIntelligenceRecompute({
      dbClient: { marker: 'db' } as any,
      tenantId: 'tenant-1',
      waitUntil,
      recompute,
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(recompute).toHaveBeenCalledWith({ marker: 'db' }, 'tenant-1'));
  });

  it('logs recompute failures instead of throwing into stock workflows', async () => {
    const error = new Error('snapshot table missing');
    const recompute = vi.fn().mockRejectedValue(error);
    const logger = { error: vi.fn() };

    expect(() => scheduleInventoryIntelligenceRecompute({
      dbClient: {} as any,
      tenantId: 'tenant-1',
      recompute,
      logger,
    })).not.toThrow();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(
      '[inventory-intelligence] background recompute failed:',
      error,
    ));
  });

  it('also logs synchronous recompute errors instead of throwing into stock workflows', async () => {
    const error = new Error('sync setup failure');
    const recompute = vi.fn(() => {
      throw error;
    });
    const logger = { error: vi.fn() };

    expect(() => scheduleInventoryIntelligenceRecompute({
      dbClient: {} as any,
      tenantId: 'tenant-1',
      recompute: recompute as any,
      logger,
    })).not.toThrow();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(
      '[inventory-intelligence] background recompute failed:',
      error,
    ));
  });

});
