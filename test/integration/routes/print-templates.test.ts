import { describe, it, expect } from 'vitest';
import ptRoutes from '../../../src/routes/tenant/printTemplates';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TPL_1 = { id: 1, tenant_id: 'tenant-1', template_type: 'prescription', template_name: 'A4 Rx', hospital_name: 'Ozzyl Hospital', paper_size: 'a4', orientation: 'portrait', is_default: 1, is_active: 1, show_logo: 1, show_hospital_name: 1, font_size_px: 12 };
const TPL_2 = { ...TPL_1, id: 2, template_type: 'bill', template_name: 'Invoice A4', is_default: 0 };

describe('Print Template Routes', () => {

  describe('GET /', () => {
    it('returns 200 with templates', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [TPL_1, TPL_2] }, universalFallback: true });
      const res = await app.request('/pt');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
    it('filters by type', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [TPL_1] }, universalFallback: true });
      expect((await app.request('/pt?type=prescription')).status).toBe(200);
    });
  });

  describe('GET /default/:type', () => {
    it('returns custom default if exists', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [TPL_1] }, universalFallback: true });
      const res = await app.request('/pt/default/prescription');
      expect(res.status).toBe(200);
    });
    it('returns system default if no custom', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] } });
      const res = await app.request('/pt/default/bill');
      expect(res.status).toBe(200);
      const body = await res.json() as { is_system_default: boolean };
      expect(body.is_system_default).toBe(true);
    });
  });

  describe('GET /:id', () => {
    it('returns template', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [TPL_1] }, universalFallback: true });
      expect((await app.request('/pt/1')).status).toBe(200);
    });
    it('returns 404', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] } });
      expect((await app.request('/pt/999')).status).toBe(404);
    });
  });

  describe('POST /', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/pt', { method: 'POST', body: { template_type: 'prescription', template_name: 'My Rx', hospital_name: 'Test Hospital' } });
      expect(res.status).toBe(201);
    });
    it('rejects invalid template_type (400)', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/pt', { method: 'POST', body: { template_type: 'invoice', template_name: 'X' } })).status).toBe(400);
    });
    it('rejects missing template_name (400)', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/pt', { method: 'POST', body: { template_type: 'bill' } })).status).toBe(400);
    });
    it('rejects invalid paper_size (400)', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/pt', { method: 'POST', body: { template_type: 'bill', template_name: 'X', paper_size: 'tabloid' } })).status).toBe(400);
    });
    it('rejects font_size out of range (400)', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/pt', { method: 'POST', body: { template_type: 'bill', template_name: 'X', font_size_px: 50 } })).status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] } });
      expect((await app.request('/pt/999', { method: 'DELETE' })).status).toBe(404);
    });
  });

  describe('GET /:id/preview', () => {
    it('returns HTML for valid template', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [TPL_1] }, universalFallback: true });
      const res = await app.request('/pt/1/preview');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Ozzyl Hospital');
    });
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] } });
      expect((await app.request('/pt/999/preview')).status).toBe(404);
    });
  });

  describe('POST /render', () => {
    it('returns HTML with system default', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: { print_templates: [] }, universalFallback: false });
      const res = await jsonRequest(app, '/pt/render', { method: 'POST', body: { template_type: 'prescription', data: { patient_name: 'Test', rx_no: 'RX-001' } } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
    });
    it('rejects invalid template_type (400)', async () => {
      const { app } = createTestApp({ route: ptRoutes, routePath: '/pt', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/pt/render', { method: 'POST', body: { template_type: 'receipt', data: {} } })).status).toBe(400);
    });
  });
});
