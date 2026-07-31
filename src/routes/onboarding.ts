import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { getDb } from '../db';


const onboardingRoutes = new Hono<{ Bindings: Env }>();

const applySchema = z.object({
  hospital_name: z.string().min(2, 'Hospital name must be at least 2 characters'),
  bed_count: z.enum(['10-25', '25-50', '50-100', '100+'], {
    message: 'Invalid bed count selection',
  }),
  whatsapp_number: z
    .string()
    .min(10, 'WhatsApp number must be at least 10 digits')
    .max(15, 'WhatsApp number too long')
    .regex(/^[0-9+]+$/, 'Invalid phone number format'),
  contact_name: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
});

// ─── POST /api/onboarding/apply — Public, no auth ──────────────────────
onboardingRoutes.post('/apply', zValidator('json', applySchema), async (c) => {
  const db = getDb(c.env.DB);
  const data = c.req.valid('json');

  try {
    // Check for duplicate recent submissions (same WhatsApp within 24h)
    const duplicate = await db.$client.prepare(
      `SELECT id FROM onboarding_requests
       WHERE whatsapp_number = ? AND created_at > datetime('now', '-24 hours')`
    ).bind(data.whatsapp_number).first();

    if (duplicate) {
      return c.json({
        message: 'আপনার আবেদন ইতিমধ্যে গ্রহণ করা হয়েছে। আমরা শীঘ্রই যোগাযোগ করবো।',
        requestId: (duplicate as Record<string, unknown>).id,
      }, 200);
    }

    const result = await db.$client.prepare(
      `INSERT INTO onboarding_requests (hospital_name, bed_count, contact_name, whatsapp_number, email, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
    ).bind(
      data.hospital_name,
      data.bed_count,
      data.contact_name || null,
      data.whatsapp_number,
      data.email || null
    ).run();

    return c.json({
      message: 'আবেদন সফলভাবে গ্রহণ হয়েছে! আমরা ২৪ ঘণ্টার মধ্যে WhatsApp-এ যোগাযোগ করবো।',
      requestId: result.meta.last_row_id,
    }, 201);
  } catch (error) {
    console.error('Onboarding apply error:', error);
    return c.json({ error: 'আবেদন জমা দেওয়া যায়নি। দয়া করে আবার চেষ্টা করুন।' }, 500);
  }
});

export default onboardingRoutes;
