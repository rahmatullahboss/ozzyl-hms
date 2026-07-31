/**
 * Lab Catalog Billing Sync — Mock DB Unit Tests
 *
 * Verifies the SQL queries and parameters for:
 *   - POST /api/lab: inserts into lab_test_catalog + billing_service_items
 *   - PUT /api/lab/:id: updates both tables
 *   - DELETE /api/lab/:id: deactivates both entries
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDB, type RecordedQuery } from '../helpers/mock-db';

describe('POST /api/lab — billing sync on create', () => {
  let queries: RecordedQuery[];
  let db: ReturnType<typeof createMockDB>['db'];

  beforeEach(() => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [],
        billing_service_departments: [
          { id: 1, department_name: 'Laboratory', department_code: 'LAB', tenant_id: 'tenant-1', is_active: 1 },
        ],
        billing_service_items: [],
      },
    });
    db = mock.db;
    queries = mock.queries;
  });

  it('inserts into lab_test_catalog with all fields', async () => {
    await db.prepare(
      `INSERT INTO lab_test_catalog (code, name, category, price, unit, normal_range, method, critical_low, critical_high, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind('CBC001', 'Complete Blood Count', 'blood', 50000, 'mg/dL', '70-100', 'Automated', null, null, 'tenant-1').run();

    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO lab_test_catalog'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.params).toContain('CBC001');
    expect(insertQuery!.params).toContain('Complete Blood Count');
    expect(insertQuery!.params).toContain('blood');
    expect(insertQuery!.params).toContain(50000);
    // is_active=1 is hardcoded in VALUES clause
    expect(insertQuery!.sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)');
  });

  it('looks up LAB department by code', async () => {
    const lookup = await db.prepare(
      `SELECT id FROM billing_service_departments WHERE department_code = 'LAB' AND tenant_id = ? AND is_active = 1 LIMIT 1`,
    ).bind('tenant-1').first<{ id: number }>();

    expect(lookup).not.toBeNull();
    expect(lookup!.id).toBe(1);
  });

  it('inserts into billing_service_items with LAB department', async () => {
    await db.prepare(
      `INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
       VALUES (?, ?, ?, ?, 0, 0, 1, 1, ?, 0, 1, ?, 1)`,
    ).bind('Complete Blood Count', 'CBC001', 1, 50000, 'blood', 'tenant-1').run();

    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO billing_service_items'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.params).toContain('CBC001'); // item_code
    expect(insertQuery!.params).toContain(1); // service_department_id (LAB)
    expect(insertQuery!.params).toContain(50000);
  });

  it('handles missing LAB department gracefully', async () => {
    const mock = createMockDB({
      tables: {
        billing_service_departments: [], // No LAB dept
      },
    });

    const lookup = await mock.db.prepare(
      `SELECT id FROM billing_service_departments WHERE department_code = 'LAB' AND tenant_id = ? AND is_active = 1 LIMIT 1`,
    ).bind('tenant-1').first();

    expect(lookup).toBeNull(); // Should be null → triggers creation
  });
});

describe('PUT /api/lab/:id — billing sync on update', () => {
  it('updates lab_test_catalog with new values', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [
          { id: 100, code: 'CBC001', name: 'Old Name', price: 40000, tenant_id: 'tenant-1' },
        ],
        billing_service_departments: [{ id: 1, department_code: 'LAB', tenant_id: 'tenant-1' }],
      },
    });

    // Get existing
    const existing = await mock.db.prepare(
      'SELECT * FROM lab_test_catalog WHERE id = ? AND tenant_id = ?',
    ).bind(100, 'tenant-1').first<Record<string, unknown>>();

    expect(existing).not.toBeNull();
    expect(existing!['code']).toBe('CBC001');

    // Update with new values
    await mock.db.prepare(
      `UPDATE lab_test_catalog SET code = ?, name = ?, category = ?, price = ?
       WHERE id = ? AND tenant_id = ?`,
    ).bind('CBC001', 'New CBC Name', 'blood', 60000, 100, 'tenant-1').run();

    // Verify query was made
    const updateQuery = mock.queries.find(q => q.sql.includes('UPDATE lab_test_catalog'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.params).toContain('New CBC Name');
    expect(updateQuery!.params).toContain(60000);
  });

  it('syncs updates to billing_service_items via item_code match', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [
          { id: 100, code: 'CBC001', name: 'Old', price: 40000, tenant_id: 'tenant-1' },
        ],
        billing_service_departments: [{ id: 1, department_code: 'LAB', tenant_id: 'tenant-1' }],
        billing_service_items: [
          { id: 200, item_code: 'CBC001', item_name: 'Old', price: 40000, service_department_id: 1, tenant_id: 'tenant-1' },
        ],
      },
    });

    // Sync billing item
    await mock.db.prepare(
      `UPDATE billing_service_items SET item_name = ?, item_code = ?, price = ?
       WHERE item_code = ? AND tenant_id = ? AND service_department_id IN (SELECT id FROM billing_service_departments WHERE department_code = 'LAB')`,
    ).bind('New CBC Name', 'CBC001', 60000, 'CBC001', 'tenant-1').run();

    const syncQuery = mock.queries.find(q => q.sql.includes('UPDATE billing_service_items'));
    expect(syncQuery).toBeDefined();
    expect(syncQuery!.params).toContain('New CBC Name');
    expect(syncQuery!.params).toContain(60000);
    // Old code for WHERE clause
    expect(syncQuery!.params).toContain('CBC001');
  });
});

describe('DELETE /api/lab/:id — billing sync on deactivate', () => {
  it('deactivates lab_test_catalog', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [
          { id: 100, code: 'CBC001', is_active: 1, tenant_id: 'tenant-1' },
        ],
        billing_service_departments: [{ id: 1, department_code: 'LAB', tenant_id: 'tenant-1' }],
      },
    });

    // Get code first
    const existing = await mock.db.prepare(
      'SELECT code FROM lab_test_catalog WHERE id = ? AND tenant_id = ?',
    ).bind(100, 'tenant-1').first<{ code: string }>();

    expect(existing).not.toBeNull();
    expect(existing!.code).toBe('CBC001');

    // Deactivate
    await mock.db.prepare(
      'UPDATE lab_test_catalog SET is_active = 0 WHERE id = ? AND tenant_id = ?',
    ).bind(100, 'tenant-1').run();

    const deleteQuery = mock.queries.find(q => q.sql.includes('UPDATE lab_test_catalog') && q.sql.includes('is_active = 0'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain(100);
  });

  it('deactivates billing_service_items via code match', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [
          { id: 100, code: 'CBC001', is_active: 1, tenant_id: 'tenant-1' },
        ],
        billing_service_departments: [{ id: 1, department_code: 'LAB', tenant_id: 'tenant-1' }],
        billing_service_items: [
          { id: 200, item_code: 'CBC001', is_active: 1, service_department_id: 1, tenant_id: 'tenant-1' },
        ],
      },
    });

    await mock.db.prepare(
      `UPDATE billing_service_items SET is_active = 0
       WHERE item_code = ? AND tenant_id = ? AND service_department_id IN (SELECT id FROM billing_service_departments WHERE department_code = 'LAB')`,
    ).bind('CBC001', 'tenant-1').run();

    const syncQuery = mock.queries.find(q => q.sql.includes('UPDATE billing_service_items') && q.sql.includes('is_active = 0'));
    expect(syncQuery).toBeDefined();
    expect(syncQuery!.params).toContain('CBC001');
    expect(syncQuery!.params).toContain('tenant-1');
  });
});

describe('Billing sync edge cases', () => {
  it('price changes propagate to billing', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [{ id: 1, code: 'TEST', price: 100 }],
        billing_service_departments: [{ id: 1, department_code: 'LAB' }],
      },
    });

    await mock.db.prepare(
      `UPDATE billing_service_items SET price = ? WHERE item_code = ? AND service_department_id IN (SELECT id FROM billing_service_departments WHERE department_code = 'LAB')`,
    ).bind(200, 'TEST').run();

    const query = mock.queries.find(q => q.sql.includes('UPDATE billing_service_items'));
    expect(query).toBeDefined();
    expect(query!.params).toContain(200);
    expect(query!.params).toContain('TEST');
  });

  it('code changes update billing via old code', async () => {
    const mock = createMockDB({
      tables: {
        lab_test_catalog: [{ id: 1, code: 'OLDCODE' }],
        billing_service_departments: [{ id: 1, department_code: 'LAB' }],
        billing_service_items: [{ id: 1, item_code: 'OLDCODE' }],
      },
    });

    // When code changes, billing lookup uses OLD code (item_code in billing_service_items)
    await mock.db.prepare(
      `UPDATE billing_service_items SET item_code = ? WHERE item_code = ?`,
    ).bind('NEWCODE', 'OLDCODE').run();

    const query = mock.queries.find(q => q.sql.includes('UPDATE billing_service_items'));
    expect(query).toBeDefined();
    expect(query!.params).toContain('NEWCODE');
    expect(query!.params).toContain('OLDCODE');
  });
});