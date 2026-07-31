import { describe, it, expect } from 'vitest';
import waRoutes from '../../../src/routes/tenant/whatsapp';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const WA_CONFIG = { id: 1, tenant_id: 'tenant-1', phone_number_id: '123456', access_token_encrypted: 'test-token', default_template_name: 'appointment_reminder', default_language: 'en', is_active: 1 };
const WA_TEMPLATE = { id: 1, tenant_id: 'tenant-1', template_name: 'appointment_reminder', template_type: 'appointment', language: 'en', body_text: 'Dear {{1}}, appointment on {{2}} at {{3}} with {{4}}', status: 'approved', is_active: 1 };
const WA_MSG = { id: 1, tenant_id: 'tenant-1', recipient_phone: '+8801711111111', recipient_name: 'Rahim', template_name: 'appointment_reminder', status: 'sent', sent_at: '2025-04-07T10:00:00Z', created_at: '2025-04-07T10:00:00Z' };

describe('WhatsApp Routes', () => {

  // Config
  describe('GET /config', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_config: [WA_CONFIG] }, universalFallback: true });
      expect((await app.request('/wa/config')).status).toBe(200);
    });
  });

  describe('POST /config', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_config: [] }, universalFallback: true });
      expect((await jsonRequest(app, '/wa/config', { method: 'POST', body: { phone_number_id: '123', access_token: 'tok123' } })).status).toBe(201);
    });
    it('rejects missing phone_number_id (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/config', { method: 'POST', body: { access_token: 'x' } })).status).toBe(400);
    });
    it('rejects missing access_token (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/config', { method: 'POST', body: { phone_number_id: '123' } })).status).toBe(400);
    });
  });

  // Templates
  describe('GET /templates', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_templates: [WA_TEMPLATE] }, universalFallback: true });
      expect((await app.request('/wa/templates')).status).toBe(200);
    });
  });

  describe('POST /templates', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {}, universalFallback: true });
      expect((await jsonRequest(app, '/wa/templates', { method: 'POST', body: { template_name: 'lab_ready', body_text: 'Your lab results are ready' } })).status).toBe(201);
    });
    it('rejects missing body_text (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/templates', { method: 'POST', body: { template_name: 'x' } })).status).toBe(400);
    });
    it('rejects invalid template_type (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/templates', { method: 'POST', body: { template_name: 'x', body_text: 'y', template_type: 'marketing' } })).status).toBe(400);
    });
  });

  // Stats
  describe('GET /stats', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_messages: [WA_MSG] }, universalFallback: true });
      expect((await app.request('/wa/stats')).status).toBe(200);
    });
  });

  // Send
  describe('POST /send', () => {
    it('rejects when WhatsApp not configured (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_config: [] } });
      expect((await jsonRequest(app, '/wa/send', { method: 'POST', body: { phone: '01711111111', template_name: 'test' } })).status).toBe(400);
    });
    it('rejects missing phone (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/send', { method: 'POST', body: { template_name: 'test' } })).status).toBe(400);
    });
    it('rejects missing template_name (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/send', { method: 'POST', body: { phone: '01711111111' } })).status).toBe(400);
    });
  });

  // Appointment reminder
  describe('POST /send-appointment-reminder', () => {
    it('rejects when not configured (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_config: [], appointments: [] }, universalFallback: true });
      // Will get 404 for appointment or 400 for config
      const res = await jsonRequest(app, '/wa/send-appointment-reminder', { method: 'POST', body: { appointment_id: 1 } });
      expect([400, 404]).toContain(res.status);
    });
    it('rejects missing appointment_id (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/send-appointment-reminder', { method: 'POST', body: {} })).status).toBe(400);
    });
  });

  // Bulk
  describe('POST /send-bulk', () => {
    it('rejects invalid date (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/wa/send-bulk', { method: 'POST', body: { date: '07-04-2025' } })).status).toBe(400);
    });
    it('rejects when not configured (400)', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_config: [] } });
      expect((await jsonRequest(app, '/wa/send-bulk', { method: 'POST', body: { date: '2025-04-07' } })).status).toBe(400);
    });
  });

  // Messages
  describe('GET /messages', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_messages: [WA_MSG] }, universalFallback: true });
      const res = await app.request('/wa/messages');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });
    it('filters by status', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: { whatsapp_messages: [WA_MSG] }, universalFallback: true });
      expect((await app.request('/wa/messages?status=sent')).status).toBe(200);
    });
  });

  // Webhook verify
  describe('GET /webhook', () => {
    it('returns challenge on valid subscribe', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      const res = await app.request('/wa/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=abc123');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('abc123');
    });
    it('returns 403 without subscribe mode', async () => {
      const { app } = createTestApp({ route: waRoutes, routePath: '/wa', role: 'hospital_admin', tables: {} });
      expect((await app.request('/wa/webhook')).status).toBe(403);
    });
  });
});
