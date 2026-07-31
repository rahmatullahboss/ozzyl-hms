import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { requireTenantId } from '../../lib/context-helpers';
import { createTestSchema, updateTestResultSchema } from '../../schemas/clinical';
import { getDb } from '../../db';


const testRoutes = new Hono<{
  Bindings: { DB: D1Database };
  Variables: { tenantId?: string; userId?: string };
}>();

// Get all tests
testRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient');
  const status = c.req.query('status');
  
  try {
    let query = 'SELECT t.*, p.name as patient_name FROM tests t JOIN patients p ON t.patient_id = p.id WHERE t.tenant_id = ?';
    const params: string[] = [tenantId!];
    
    if (patientId) {
      query += ' AND t.patient_id = ?';
      params.push(patientId);
    }
    
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY t.date DESC';
    
    const tests = await db.$client.prepare(query).bind(...params).all();
    return c.json({ tests: tests.results });
  } catch (error) {
    return c.json({ error: 'Failed to fetch tests' }, 500);
  }
});

// Create test for patient
testRoutes.post('/', zValidator('json', createTestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, testName } = c.req.valid('json');
  
  try {
    const result = await db.$client.prepare(
      'INSERT INTO tests (patient_id, test_name, status, tenant_id, date, source) VALUES (?, ?, ?, ?, datetime("now"), ?)'
    ).bind(patientId, testName, 'pending', tenantId, 'lab').run();
    
    return c.json({ 
      message: 'Test created',
      testId: result.meta.last_row_id
    }, 201);
  } catch (error) {
    return c.json({ error: 'Failed to create test' }, 500);
  }
});

// Update test result
testRoutes.put('/:id/result', zValidator('json', updateTestResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const { result } = c.req.valid('json');
  
  try {
    // Update test result — income is created via billing, not here
    await db.$client.prepare(
      'UPDATE tests SET result = ?, status = ?, updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
    ).bind(result, 'completed', id, tenantId).run();
    
    return c.json({ message: 'Test result updated' });
  } catch (error) {
    return c.json({ error: 'Failed to update test result' }, 500);
  }
});

export default testRoutes;
