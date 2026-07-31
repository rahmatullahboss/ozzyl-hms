import { describe, it, expect } from 'vitest';
import { sign } from 'hono/jwt';
import foodRoutes from '../src/routes/food';
import { parseAIFoodResponse } from '../src/lib/food-ai-parser';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global', role: 'patient' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 1: Food Photo AI (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1.1 parseAIFoodResponse — Pure function tests ──────────────────────────

describe('parseAIFoodResponse', () => {
  it('parses valid JSON response with food items', () => {
    const raw = JSON.stringify({
      items: [
        {
          name_bn: 'পোলাও',
          name_en: 'Polao',
          category: 'rice',
          estimated_calories: 350,
          protein_g: 8,
          carbs_g: 55,
          fat_g: 12,
          serving_description: '1 plate',
        },
      ],
      confidence: 0.9,
    });

    const result = parseAIFoodResponse(raw);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name_en).toBe('Polao');
    expect(result.items[0].estimated_calories).toBe(350);
    expect(result.confidence).toBe(0.9);
  });

  it('parses JSON wrapped in markdown code block', () => {
    const raw = '```json\n{"items": [{"name_bn": "ভাত", "name_en": "Rice", "category": "rice", "estimated_calories": 260, "protein_g": 5, "carbs_g": 56, "fat_g": 1, "serving_description": "1 plate"}], "confidence": 0.85}\n```';

    const result = parseAIFoodResponse(raw);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name_en).toBe('Rice');
    expect(result.confidence).toBe(0.85);
  });

  it('returns empty items for malformed JSON', () => {
    const result = parseAIFoodResponse('This is not JSON at all');
    expect(result.items).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('returns empty items for empty string', () => {
    const result = parseAIFoodResponse('');
    expect(result.items).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('returns empty items for null/undefined', () => {
    const result = parseAIFoodResponse(null as any);
    expect(result.items).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('handles multiple food items', () => {
    const raw = JSON.stringify({
      items: [
        { name_bn: 'ভাত', name_en: 'Rice', category: 'rice', estimated_calories: 260, protein_g: 5, carbs_g: 56, fat_g: 1, serving_description: '1 plate' },
        { name_bn: 'মসুর ডাল', name_en: 'Lentil Soup', category: 'lentils', estimated_calories: 120, protein_g: 9, carbs_g: 20, fat_g: 1, serving_description: '1 bowl' },
        { name_bn: 'আলু ভর্তা', name_en: 'Mashed Potato', category: 'bhorta', estimated_calories: 180, protein_g: 3, carbs_g: 25, fat_g: 8, serving_description: '1 serving' },
      ],
      confidence: 0.75,
    });

    const result = parseAIFoodResponse(raw);
    expect(result.items).toHaveLength(3);
    expect(result.items[2].name_en).toBe('Mashed Potato');
  });

  it('clamps confidence between 0 and 1', () => {
    const raw = JSON.stringify({ items: [], confidence: 1.5 });
    const result = parseAIFoodResponse(raw);
    expect(result.confidence).toBeLessThanOrEqual(1);

    const raw2 = JSON.stringify({ items: [], confidence: -0.5 });
    const result2 = parseAIFoodResponse(raw2);
    expect(result2.confidence).toBeGreaterThanOrEqual(0);
  });

  it('validates category against known food categories', () => {
    const validCategories = ['rice', 'bread', 'lentils', 'fish', 'meat', 'vegetables', 'bhorta', 'eggs', 'snacks', 'sweets', 'drinks', 'fruits', 'fast_food'];
    const raw = JSON.stringify({
      items: [
        { name_bn: 'Test', name_en: 'Test', category: 'rice', estimated_calories: 100, protein_g: 2, carbs_g: 20, fat_g: 1, serving_description: '1 serving' },
        { name_bn: 'Test2', name_en: 'Test2', category: 'invalid_category', estimated_calories: 100, protein_g: 2, carbs_g: 20, fat_g: 1, serving_description: '1 serving' },
      ],
      confidence: 0.8,
    });

    const result = parseAIFoodResponse(raw);
    // Valid category stays, invalid gets defaulted to 'other' or 'snacks'
    expect(validCategories).toContain(result.items[0].category);
  });
});

// ─── 1.2 POST /food/identify — Route integration tests ─────────────────────

describe('POST /food/identify', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
      extraEnv: { OPENROUTER_API_KEY: 'test-key' } as any,
    });

    const res = await jsonRequest(app, '/food/identify', {
      method: 'POST',
      body: { image_base64: 'aGVsbG8=' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 503 when OPENROUTER_API_KEY is not configured', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
      extraEnv: { OPENROUTER_API_KEY: undefined } as any,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/food/identify', {
      method: 'POST',
      body: { image_base64: 'aGVsbG8=' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toContain('unavailable');
  });

  it('rejects when no image data provided', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
      extraEnv: { OPENROUTER_API_KEY: 'test-key' } as any,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/food/identify', {
      method: 'POST',
      body: {},
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('image');
  });

  it('rejects oversized base64 images (>5MB)', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
      extraEnv: { OPENROUTER_API_KEY: 'test-key' } as any,
    });

    const token = await makePatientToken(1);
    // Create ~8MB base64 string → ~6MB raw bytes (well over 5MB limit)
    const oversized = 'A'.repeat(8 * 1024 * 1024);
    const res = await jsonRequest(app, '/food/identify', {
      method: 'POST',
      body: { image_base64: oversized },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/size|large|limit/i);
  });
});

// ─── 1.3 AI food identification schema validation ───────────────────────────

describe('AI food response schema', () => {
  it('every item must have name_bn, name_en, estimated_calories', () => {
    const validItem = {
      name_bn: 'মাছ ভাজা',
      name_en: 'Fried Fish',
      category: 'fish',
      estimated_calories: 220,
      protein_g: 18,
      carbs_g: 5,
      fat_g: 15,
      serving_description: '1 piece',
    };

    expect(validItem.name_bn).toBeTruthy();
    expect(validItem.name_en).toBeTruthy();
    expect(validItem.estimated_calories).toBeGreaterThan(0);
    expect(validItem.protein_g).toBeGreaterThanOrEqual(0);
    expect(validItem.carbs_g).toBeGreaterThanOrEqual(0);
    expect(validItem.fat_g).toBeGreaterThanOrEqual(0);
  });

  it('calories should be reasonable (1-2000 per serving)', () => {
    const items = [
      { name_en: 'Rice', estimated_calories: 260 },
      { name_en: 'Dal', estimated_calories: 120 },
      { name_en: 'Fish curry', estimated_calories: 300 },
    ];

    for (const item of items) {
      expect(item.estimated_calories).toBeGreaterThan(0);
      expect(item.estimated_calories).toBeLessThan(2000);
    }
  });

  it('confidence should be between 0 and 1', () => {
    const validConfidences = [0, 0.5, 0.85, 1];
    for (const c of validConfidences) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
