/**
 * Food Routes (tenant-agnostic, global)
 *
 * Endpoints:
 *   GET  /api/food/search     — search food items by name (bn/en)
 *   GET  /api/food/categories — list food categories
 *   POST /api/food/log        — log a food entry
 *   GET  /api/food/logs       — get food logs for a date
 *   POST /api/food/seed       — seed food_items from bd-foods.json (admin)
 *   POST /api/food/identify   — AI photo food identification
 *   GET  /api/food/barcode/:code — barcode food lookup
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../types';
import { parseAIFoodResponse } from '../lib/food-ai-parser';
import { validateBarcode, normalizeBarcode } from '../lib/barcode-utils';

const foodRoutes = new Hono<{ Bindings: Env }>();

// ─── Auth helper ──────────────────────────────────────────────────────
async function getPatientId(c: any): Promise<number> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) throw new HTTPException(401, { message: 'Authentication required' });
  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
  if (decoded.scope !== 'global') throw new HTTPException(403, { message: 'Invalid token scope' });
  return parseInt(decoded.userId, 10);
}

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

const foodLogSchema = z.object({
  meal_type: z.enum(VALID_MEAL_TYPES),
  food_item_id: z.number().int().positive().optional(),
  custom_name: z.string().max(200).optional(),
  calories: z.number().min(0),
  protein_g: z.number().min(0).default(0),
  carbs_g: z.number().min(0).default(0),
  fat_g: z.number().min(0).default(0),
  quantity: z.number().min(0.1).default(1),
  unit: z.string().max(50).default('serving'),
});

// ─── GET /search ──────────────────────────────────────────────────────
foodRoutes.get('/search', async (c) => {
  const db = c.env.DB;
  const q = c.req.query('q')?.trim();
  const category = c.req.query('category');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 50);

  if (!q && !category) {
    return c.json({ items: [] });
  }

  let sql = 'SELECT * FROM food_items WHERE 1=1';
  const params: any[] = [];

  if (q) {
    sql += ' AND (name_bn LIKE ? OR name_en LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY name_en ASC LIMIT ?';
  params.push(limit);

  const rows = await db.prepare(sql).bind(...params).all();
  return c.json({ items: rows.results || [] });
});

// ─── GET /categories ──────────────────────────────────────────────────
foodRoutes.get('/categories', async (c) => {
  const categories = [
    { key: 'rice', name_bn: 'ভাত', name_en: 'Rice' },
    { key: 'bread', name_bn: 'রুটি', name_en: 'Bread' },
    { key: 'lentils', name_bn: 'ডাল', name_en: 'Lentils' },
    { key: 'fish', name_bn: 'মাছ', name_en: 'Fish' },
    { key: 'meat', name_bn: 'মাংস', name_en: 'Meat' },
    { key: 'vegetables', name_bn: 'সবজি', name_en: 'Vegetables' },
    { key: 'bhorta', name_bn: 'ভর্তা', name_en: 'Bhorta' },
    { key: 'eggs', name_bn: 'ডিম', name_en: 'Eggs' },
    { key: 'snacks', name_bn: 'নাস্তা', name_en: 'Snacks' },
    { key: 'sweets', name_bn: 'মিষ্টি', name_en: 'Sweets' },
    { key: 'drinks', name_bn: 'পানীয়', name_en: 'Drinks' },
    { key: 'fruits', name_bn: 'ফল', name_en: 'Fruits' },
    { key: 'fast_food', name_bn: 'ফাস্ট ফুড', name_en: 'Fast Food' },
  ];
  return c.json({ categories });
});

// ─── POST /log ────────────────────────────────────────────────────────
foodRoutes.post('/log', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = foodLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid food log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;

  // If food_item_id provided, calculate calories from item
  let calories = d.calories;
  let protein = d.protein_g;
  let carbs = d.carbs_g;
  let fat = d.fat_g;

  if (d.food_item_id) {
    const item = await db.prepare('SELECT * FROM food_items WHERE id = ?').bind(d.food_item_id).first() as any;
    if (item) {
      const multiplier = (d.quantity * (item.serving_size_g || 100)) / 100;
      calories = item.calories_per_100g * multiplier;
      protein = (item.protein_g || 0) * multiplier;
      carbs = (item.carbs_g || 0) * multiplier;
      fat = (item.fat_g || 0) * multiplier;
    }
  }

  const result = await db.prepare(`
    INSERT INTO food_log (patient_id, meal_type, food_item_id, custom_name, calories, protein_g, carbs_g, fat_g, quantity, unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    patientId, d.meal_type, d.food_item_id ?? null, d.custom_name ?? null,
    Math.round(calories * 10) / 10, Math.round(protein * 10) / 10,
    Math.round(carbs * 10) / 10, Math.round(fat * 10) / 10,
    d.quantity, d.unit,
  ).run();

  // Log food streak
  const today = new Date().toISOString().slice(0, 10);
  try {
    const existing = await db.prepare(
      'SELECT current_count, longest_count, last_logged_date FROM streaks WHERE patient_id = ? AND streak_type = ?',
    ).bind(patientId, 'food_log').first() as any;

    if (existing) {
      if (existing.last_logged_date !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isConsecutive = existing.last_logged_date === yesterday.toISOString().slice(0, 10);
        const newCount = isConsecutive ? existing.current_count + 1 : 1;
        await db.prepare(
          'UPDATE streaks SET current_count = ?, longest_count = MAX(longest_count, ?), last_logged_date = ? WHERE patient_id = ? AND streak_type = ?',
        ).bind(newCount, newCount, today, patientId, 'food_log').run();
      }
    } else {
      await db.prepare(
        'INSERT INTO streaks (patient_id, streak_type, current_count, longest_count, last_logged_date) VALUES (?, ?, 1, 1, ?)',
      ).bind(patientId, 'food_log', today).run();
    }
  } catch {
    // Streak logging is best-effort
  }

  return c.json({ success: true, id: result.meta.last_row_id, calories: Math.round(calories * 10) / 10 }, 201);
});

// ─── GET /logs ────────────────────────────────────────────────────────
foodRoutes.get('/logs', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  const rows = await db.prepare(`
    SELECT fl.*, fi.name_bn, fi.name_en, fi.category, fi.serving_description
    FROM food_log fl
    LEFT JOIN food_items fi ON fl.food_item_id = fi.id
    WHERE fl.patient_id = ? AND DATE(fl.logged_at) = ?
    ORDER BY fl.logged_at DESC
  `).bind(patientId, date).all();

  // Calculate totals
  const logs = (rows.results || []) as any[];
  const totals = {
    calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
  };
  for (const log of logs) {
    totals.calories += log.calories || 0;
    totals.protein_g += log.protein_g || 0;
    totals.carbs_g += log.carbs_g || 0;
    totals.fat_g += log.fat_g || 0;
  }

  return c.json({
    logs,
    totals: {
      calories: Math.round(totals.calories),
      protein_g: Math.round(totals.protein_g),
      carbs_g: Math.round(totals.carbs_g),
      fat_g: Math.round(totals.fat_g),
    },
    date,
  });
});

// ─── POST /seed ───────────────────────────────────────────────────────
foodRoutes.post('/seed', async (c) => {
  const db = c.env.DB;

  // Check if already seeded
  const count = await db.prepare('SELECT COUNT(*) as c FROM food_items').first() as any;
  if (count?.c > 0) {
    return c.json({ message: `Already seeded with ${count.c} items` });
  }

  // Import food data
  const bdFoods = await import('../../data/bd-foods.json');
  const items = (bdFoods as any).default || bdFoods;

  let inserted = 0;
  for (const item of items) {
    try {
      await db.prepare(`
        INSERT INTO food_items (name_bn, name_en, category, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, serving_size_g, serving_description, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
        item.name_bn, item.name_en, item.category,
        item.calories_per_100g, item.protein_g, item.carbs_g,
        item.fat_g, item.fiber_g, item.serving_size_g,
        item.serving_description || null,
      ).run();
      inserted++;
    } catch {
      // Skip duplicates or errors
    }
  }

  return c.json({ success: true, inserted });
});

// ─── POST /identify — AI food photo identification ────────────────────
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

foodRoutes.post('/identify', async (c) => {
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'AI service unavailable' }, 503);
  }

  await getPatientId(c); // Auth check

  const contentType = c.req.header('Content-Type') || '';
  let imageBase64: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('photo') as File | null;
    if (!file) return c.json({ error: 'No photo provided' }, 400);
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return c.json({ error: 'Image size exceeds 5MB limit' }, 400);
    }
    const buffer = await file.arrayBuffer();
    imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  } else {
    const body = await c.req.json() as { image_base64?: string };
    imageBase64 = body.image_base64 || null;
  }

  if (!imageBase64) {
    return c.json({ error: 'No image data provided' }, 400);
  }

  // Check base64 size (~3/4 of base64 length = raw bytes)
  const estimatedBytes = Math.ceil(imageBase64.length * 0.75);
  if (estimatedBytes > MAX_IMAGE_SIZE_BYTES) {
    return c.json({ error: 'Image size exceeds 5MB limit' }, 400);
  }

  // Use OpenRouter vision model to identify food
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        {
          role: 'system',
          content: `You are a Bangladeshi food identification expert. Given a photo of food, identify the items and estimate nutritional values per serving.

Respond ONLY with valid JSON in this exact format:
{
  "items": [
    {
      "name_bn": "বাংলা নাম",
      "name_en": "English name",
      "category": "rice|bread|lentils|fish|meat|vegetables|bhorta|eggs|snacks|sweets|drinks|fruits|fast_food",
      "estimated_calories": 250,
      "protein_g": 5,
      "carbs_g": 40,
      "fat_g": 8,
      "serving_description": "1 plate"
    }
  ],
  "confidence": 0.85
}

If you cannot identify the food, return: {"items": [], "confidence": 0}
Focus on Bangladeshi/South Asian foods. Be specific (e.g., "পোলাও" not just "ভাত").`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify the food items in this photo and estimate nutrition per serving.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    return c.json({ error: 'AI identification failed' }, 502);
  }

  const aiResult = await response.json() as any;
  const content = aiResult?.choices?.[0]?.message?.content || '';

  // Parse using extracted, testable parser
  const parsed = parseAIFoodResponse(content);

  // Try to match identified items with our food database
  const db = c.env.DB;
  const enrichedItems = [];

  for (const item of parsed.items) {
    // Search for matching food in our database
    const match = await db.prepare(
      'SELECT * FROM food_items WHERE name_en LIKE ? OR name_bn LIKE ? LIMIT 1',
    ).bind(`%${item.name_en}%`, `%${item.name_bn}%`).first() as any;

    enrichedItems.push({
      ...item,
      food_item_id: match?.id || null,
      db_match: match ? {
        id: match.id,
        name_bn: match.name_bn,
        name_en: match.name_en,
        calories_per_100g: match.calories_per_100g,
        serving_size_g: match.serving_size_g,
      } : null,
    });
  }

  return c.json({
    items: enrichedItems,
    confidence: parsed.confidence,
  });
});

// ─── GET /barcode/:code — Barcode food lookup ─────────────────────────
foodRoutes.get('/barcode/:code', async (c) => {
  await getPatientId(c); // Auth check
  const rawCode = c.req.param('code');

  if (!rawCode || !validateBarcode(rawCode)) {
    return c.json({ error: 'Invalid barcode format. Expected EAN-13 or UPC-A.' }, 400);
  }

  const code = normalizeBarcode(rawCode);
  const db = c.env.DB;

  const item = await db.prepare(
    'SELECT * FROM food_items WHERE barcode = ? LIMIT 1',
  ).bind(code).first() as any;

  if (!item) {
    return c.json({ error: 'Product not found for this barcode' }, 404);
  }

  return c.json({ item });
});

// ─── POST /barcode/seed — Seed barcode foods into DB ──────────────────
foodRoutes.post('/barcode/seed', async (c) => {
  const db = c.env.DB;

  const barcodeData = await import('../../data/barcode-foods.json');
  const items = (barcodeData as any).default || barcodeData;

  let inserted = 0;
  for (const item of items) {
    try {
      await db.prepare(`
        INSERT INTO food_items (name_bn, name_en, category, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, serving_size_g, serving_description, barcode, barcode_type, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
        item.name_bn, item.name_en, item.category,
        item.calories_per_100g, item.protein_g ?? 0, item.carbs_g ?? 0,
        item.fat_g ?? 0, item.fiber_g ?? 0, item.serving_size_g ?? 100,
        item.serving_description ?? null, item.barcode, item.barcode_type ?? 'ean13',
      ).run();
      inserted++;
    } catch {
      // Skip duplicates
    }
  }

  return c.json({ success: true, inserted });
});

export default foodRoutes;
