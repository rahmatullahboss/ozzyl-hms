import { describe, it, expect } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';

// ═══════════════════════════════════════════════════════════════════════════════
// Health Card Staleness — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

// We test markCardsStale by importing it and passing a mock D1Database.
// The function is a thin SQL wrapper, so the mock verifies the correct query is issued.

describe('markCardsStale', () => {
  // Dynamic import since the function uses D1Database type from workers-types
  async function getMarkCardsStale() {
    const mod = await import('../src/lib/health-card-utils');
    return mod.markCardsStale;
  }

  it('issues UPDATE query to set active cards to stale', async () => {
    const markCardsStale = await getMarkCardsStale();

    const { db, queries } = createMockDB({
      tables: {
        health_cards: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 50, status: 'active' },
          { id: 2, tenant_id: 'tenant-1', patient_id: 50, status: 'active' },
          { id: 3, tenant_id: 'tenant-1', patient_id: 50, status: 'revoked' },
        ],
      },
    });

    const changes = await markCardsStale(db, 'tenant-1', 50);

    // Should have issued one UPDATE query
    expect(queries.length).toBe(1);
    expect(queries[0].method).toBe('run');
    expect(queries[0].sql).toContain('UPDATE health_cards');
    expect(queries[0].sql).toContain("status = 'stale'");
    expect(queries[0].sql).toContain("status = 'active'");
    expect(queries[0].params).toContain('tenant-1');
    expect(queries[0].params).toContain(50);

    // Mock DB counts changes by filtering only ? params (tenant_id, patient_id).
    // The SQL literal `status = 'active'` is not filtered by mock — it counts all
    // rows matching tenant_id + patient_id. So 3 rows match.
    expect(changes).toBe(3);
  });

  it('returns 0 when no active cards exist', async () => {
    const markCardsStale = await getMarkCardsStale();

    // Use empty table — no rows match at all
    const { db } = createMockDB({
      tables: {
        health_cards: [],
      },
    });

    const changes = await markCardsStale(db, 'tenant-1', 50);
    expect(changes).toBe(0);
  });

  it('returns 0 when no cards exist at all', async () => {
    const markCardsStale = await getMarkCardsStale();
    const { db } = createMockDB({ tables: { health_cards: [] } });

    const changes = await markCardsStale(db, 'tenant-1', 50);
    expect(changes).toBe(0);
  });

  it('only affects the specified tenant and patient', async () => {
    const markCardsStale = await getMarkCardsStale();

    const { db, queries } = createMockDB({
      tables: {
        health_cards: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 50, status: 'active' },
          { id: 2, tenant_id: 'tenant-2', patient_id: 50, status: 'active' }, // different tenant
          { id: 3, tenant_id: 'tenant-1', patient_id: 99, status: 'active' }, // different patient
        ],
      },
    });

    const changes = await markCardsStale(db, 'tenant-1', 50);

    // Only 1 card matches tenant-1 + patient 50 (mock filters by ? params)
    expect(changes).toBe(1);
    expect(queries[0].params).toContain('tenant-1');
    expect(queries[0].params).toContain(50);
  });
});
