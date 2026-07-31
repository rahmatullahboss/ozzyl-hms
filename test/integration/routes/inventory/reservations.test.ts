import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — stock reservations', () => {
  // ─── POST /inventory/reservations — create reservation ────────────────────

  it('creates a reservation and decrements available / increments reserved', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Atomic stock UPDATE — mock can't evaluate arithmetic WHERE, return changes=1
        if (sql.includes('UPDATE InventoryStock') && sql.includes('AvailableQuantity -')) {
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 42,
        ItemId: 10,
        StoreId: 1,
        Quantity: 5,
        ReservedForType: 'patient',
        ReservedForId: 'P-001',
        ExpiresAt: '2099-12-31T23:59:59Z',
        Remarks: 'Reserved for surgery',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ReservationId).toBeDefined();
    expect(body.Status).toBe('active');

    // Verify stock update: atomic decrement available, increment reserved
    const stockUpdate = mockDB.queries.find(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity') && q.sql.includes('ReservedQuantity'),
    );
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate!.params).toContain(5); // quantity delta
    expect(stockUpdate!.params).toContain(42); // StockId

    // Verify reservation insert
    const insertReservation = mockDB.queries.find(
      (q) => q.sql.includes('INSERT INTO InventoryStockReservation'),
    );
    expect(insertReservation).toBeDefined();
  });

  it('rejects reservation when usable stock is insufficient', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Atomic UPDATE returns 0 changes when insufficient stock (mock can't evaluate WHERE)
        if (sql.includes('UPDATE InventoryStock') && sql.includes('AvailableQuantity -')) {
          return { success: true, meta: { changes: 0, last_row_id: 0 } };
        }
        return null;
      },
    });

    // Usable = 20 - 10 - 5 - 0 = 5, requesting 10
    const res = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 42,
        ItemId: 10,
        StoreId: 1,
        Quantity: 10,
        ReservedForType: 'department',
        ExpiresAt: '2099-12-31T23:59:59Z',
      },
    });

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/insufficient/i);
  });

  it('rejects reservation when stock is not found', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Atomic UPDATE returns 0 changes when stock doesn't exist
        if (sql.includes('UPDATE InventoryStock') && sql.includes('AvailableQuantity -')) {
          return { success: true, meta: { changes: 0, last_row_id: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 999,
        ItemId: 10,
        StoreId: 1,
        Quantity: 5,
        ReservedForType: 'patient',
        ExpiresAt: '2099-12-31T23:59:59Z',
      },
    });

    expect(res.status).toBe(404);
  });

  // ─── POST /inventory/reservations/:id/release ────────────────────────────

  it('releases a reservation and reverses stock quantities', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 1,
              tenant_id: 'tenant-1',
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              Quantity: 5,
              Status: 'active',
              ReservedForType: 'patient',
              ReservedForId: 'P-001',
            },
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 95,
              ReservedQuantity: 15,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/1/release', {
      method: 'POST',
      body: { Remarks: 'Patient cancelled' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.Status).toBe('cancelled');

    // Verify atomic stock reversal uses reservation's Quantity (delta), not computed absolute
    const stockUpdate = mockDB.queries.find(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity') && q.sql.includes('ReservedQuantity'),
    );
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate!.params).toContain(5); // reservation Quantity (delta added/subtracted)

    // Verify reservation status updated
    const statusUpdate = mockDB.queries.find(
      (q) => q.sql.includes("Status = 'cancelled'") && q.sql.includes('InventoryStockReservation'),
    );
    expect(statusUpdate).toBeDefined();
  });

  it('rejects release of a non-active reservation', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 2,
              tenant_id: 'tenant-1',
              StockId: 42,
              Quantity: 5,
              Status: 'fulfilled',
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/2/release', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/only active/i);
  });

  // ─── POST /inventory/reservations/:id/fulfill ────────────────────────────

  it('marks a reservation as fulfilled', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 3,
              tenant_id: 'tenant-1',
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              Quantity: 5,
              Status: 'active',
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/3/fulfill', {
      method: 'POST',
      body: { Remarks: 'Dispatched to patient' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.Status).toBe('fulfilled');

    // Verify status update
    const statusUpdate = mockDB.queries.find(
      (q) => q.sql.includes("Status = 'fulfilled'") && q.sql.includes('InventoryStockReservation'),
    );
    expect(statusUpdate).toBeDefined();

    // Verify FulfilledAt is set
    expect(mockDB.queries.some(q => q.sql.includes('FulfilledAt'))).toBe(true);
  });

  // ─── POST /inventory/reservations/expire-check ───────────────────────────

  it('expires all past-due active reservations', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Return expired reservations for the expire-check
        if (sql.includes('FROM InventoryStockReservation') && sql.includes("Status = 'active'") && sql.includes('ExpiresAt')) {
          return {
            results: [
              { ReservationId: 10, StockId: 42, Quantity: 5, tenant_id: 'tenant-1' },
              { ReservationId: 11, StockId: 43, Quantity: 3, tenant_id: 'tenant-1' },
            ],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              AvailableQuantity: 90,
              ReservedQuantity: 15,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/expire-check', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.expired).toBeGreaterThanOrEqual(2);

    // Verify stock reversal for expired reservations
    const stockUpdates = mockDB.queries.filter(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('ReservedQuantity'),
    );
    expect(stockUpdates.length).toBeGreaterThanOrEqual(2);
  });

  // ─── GET /inventory/reservations — list with filters ─────────────────────

  it('lists reservations with status filter', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*)') && sql.includes('InventoryStockReservation')) {
          return { first: { total: 2 } };
        }
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('LIMIT')) {
          return {
            results: [
              { ReservationId: 1, StockId: 42, ItemId: 10, Quantity: 5, Status: 'active', ReservedForType: 'patient' },
              { ReservationId: 2, StockId: 43, ItemId: 11, Quantity: 3, Status: 'active', ReservedForType: 'department' },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations?Status=active');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
  });

  // ─── GET /inventory/reservations/:id — single detail ─────────────────────

  it('gets a single reservation by id', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 5,
              tenant_id: 'tenant-1',
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              Quantity: 8,
              ReservedForType: 'surgery',
              ReservedForId: 'S-001',
              ReservedBy: '12',
              Status: 'active',
              ExpiresAt: '2099-12-31T23:59:59Z',
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/5');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ReservationId).toBe(5);
    expect(body.ReservedForType).toBe('surgery');
  });

  it('returns 404 for non-existent reservation', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: () => null,
    });

    const res = await jsonRequest(app, '/inventory/reservations/999');
    expect(res.status).toBe(404);
  });

  // ─── GET /inventory/reservations/stats ───────────────────────────────────

  it('returns reservation stats by status', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*)') && sql.includes('InventoryStockReservation') && sql.includes('GROUP BY')) {
          return {
            results: [
              { Status: 'active', count: 5 },
              { Status: 'fulfilled', count: 3 },
              { Status: 'cancelled', count: 1 },
              { Status: 'expired', count: 2 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reservations/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.active).toBe(5);
    expect(body.fulfilled).toBe(3);
    expect(body.cancelled).toBe(1);
    expect(body.expired).toBe(2);
  });

  // ─── Permission checks ──────────────────────────────────────────────────

  it('blocks reservation creation from user without inventory:write permission', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 42,
        ItemId: 10,
        StoreId: 1,
        Quantity: 5,
        ReservedForType: 'patient',
        ExpiresAt: '2099-12-31T23:59:59Z',
      },
    });

    expect(res.status).toBe(403);
  });

  // ─── Full lifecycle: reserve → fulfill ──────────────────────────────────

  it('lifecycle: reserve then fulfill keeps ReservedQuantity unchanged', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Atomic stock UPDATE — mock can't evaluate arithmetic WHERE, return changes=1
        if (sql.includes('UPDATE InventoryStock') && sql.includes('AvailableQuantity -')) {
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }
        return null;
      },
    });

    // Step 1: Reserve
    const reserveRes = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 42, ItemId: 10, StoreId: 1, Quantity: 10,
        ReservedForType: 'patient', ReservedForId: 'P-100',
        ExpiresAt: '2099-12-31T23:59:59Z',
      },
    });
    expect(reserveRes.status).toBe(201);

    // Verify: Available -10, Reserved +10
    const reserveUpdate = mockDB.queries.find(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity') && q.sql.includes('ReservedQuantity'),
    );
    expect(reserveUpdate).toBeDefined();

    // Step 2: Fulfill (mock reservation lookup)
    mockDB.reset();
    const { app: app2, mockDB: mockDB2 } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 1,
              tenant_id: 'tenant-1',
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              Quantity: 10,
              Status: 'active',
            },
          };
        }
        return null;
      },
    });

    const fulfillRes = await jsonRequest(app2, '/inventory/reservations/1/fulfill', {
      method: 'POST',
      body: {},
    });
    expect(fulfillRes.status).toBe(200);

    // Fulfill should NOT modify stock (reservation stays reserved, actual issue handles qty)
    const stockUpdateAfterFulfill = mockDB2.queries.find(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity'),
    );
    expect(stockUpdateAfterFulfill).toBeUndefined();
  });

  // ─── Full lifecycle: reserve → release ──────────────────────────────────

  it('lifecycle: reserve then release restores stock', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // Atomic stock UPDATE — mock can't evaluate arithmetic WHERE, return changes=1
        if (sql.includes('UPDATE InventoryStock') && sql.includes('AvailableQuantity -')) {
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }
        return null;
      },
    });

    // Step 1: Reserve 10
    const reserveRes = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: {
        StockId: 42, ItemId: 10, StoreId: 1, Quantity: 10,
        ReservedForType: 'department', ExpiresAt: '2099-12-31T23:59:59Z',
      },
    });
    expect(reserveRes.status).toBe(201);

    // Step 2: Release (mock reservation and stock)
    mockDB.reset();
    const { app: app2, mockDB: mockDB2 } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockReservation') && sql.includes('ReservationId = ?')) {
          return {
            first: {
              ReservationId: 1,
              tenant_id: 'tenant-1',
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              Quantity: 10,
              Status: 'active',
            },
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              AvailableQuantity: 90,
              ReservedQuantity: 10,
            },
          };
        }
        return null;
      },
    });

    const releaseRes = await jsonRequest(app2, '/inventory/reservations/1/release', {
      method: 'POST',
      body: {},
    });
    expect(releaseRes.status).toBe(200);

    // Verify: Available +10, Reserved -10 (atomic delta, not absolute)
    const stockUpdate = mockDB2.queries.find(
      (q) => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity') && q.sql.includes('ReservedQuantity'),
    );
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate!.params).toContain(10); // reservation Quantity (delta)
  });

  // ─── Validation: missing required fields ────────────────────────────────

  it('rejects reservation with missing required fields', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
    });

    const res = await jsonRequest(app, '/inventory/reservations', {
      method: 'POST',
      body: { StockId: 42 }, // Missing required fields
    });

    expect(res.status).toBe(400);
  });
});
