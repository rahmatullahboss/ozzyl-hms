import { describe, it, expect } from 'vitest';
import { sign } from 'hono/jwt';
import { validateBarcode, normalizeBarcode, detectBarcodeType } from '../src/lib/barcode-utils';
import foodRoutes from '../src/routes/food';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import * as barcodeData from '../data/barcode-foods.json';

const barcodeFoods = (barcodeData as any).default || barcodeData;
const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global', role: 'patient' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 2: Barcode Scanner (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 2.1 Barcode data file validation ───────────────────────────────────────

describe('barcode-foods.json data file', () => {
  it('has at least 20 barcode items', () => {
    expect(barcodeFoods.length).toBeGreaterThanOrEqual(20);
  });

  it('every item has required fields', () => {
    for (const item of barcodeFoods) {
      expect(item.barcode).toBeTruthy();
      expect(item.name_bn).toBeTruthy();
      expect(item.name_en).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.calories_per_100g).toBeGreaterThanOrEqual(0);
      expect(item.serving_size_g).toBeGreaterThan(0);
    }
  });

  it('all barcodes are unique', () => {
    const barcodes = barcodeFoods.map((f: any) => f.barcode);
    const uniqueBarcodes = new Set(barcodes);
    expect(uniqueBarcodes.size).toBe(barcodes.length);
  });

  it('all barcodes are valid EAN-13 or UPC-A', () => {
    for (const item of barcodeFoods) {
      expect(
        validateBarcode(item.barcode),
        `Barcode ${item.barcode} (${item.name_en}) should be valid`,
      ).toBe(true);
    }
  });

  it('covers multiple categories', () => {
    const categories = [...new Set(barcodeFoods.map((f: any) => f.category))];
    expect(categories.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── 2.2 Barcode validation utility ────────────────────────────────────────

describe('validateBarcode', () => {
  it('accepts valid EAN-13 barcodes', () => {
    // Standard EAN-13 used in test data
    expect(validateBarcode('4902105228531')).toBe(true);
  });

  it('rejects too short barcodes', () => {
    expect(validateBarcode('12345')).toBe(false);
  });

  it('rejects too long barcodes', () => {
    expect(validateBarcode('12345678901234')).toBe(false);
  });

  it('rejects non-numeric barcodes', () => {
    expect(validateBarcode('abcdefghijklm')).toBe(false);
  });

  it('rejects barcodes with invalid check digit', () => {
    // Take a valid barcode and change last digit
    expect(validateBarcode('4902105228530')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateBarcode('')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validateBarcode(null as any)).toBe(false);
    expect(validateBarcode(undefined as any)).toBe(false);
  });

  it('handles barcodes with whitespace (strips them)', () => {
    expect(validateBarcode(' 4902105228531 ')).toBe(true);
  });
});

// ─── 2.3 Barcode normalization ─────────────────────────────────────────────

describe('normalizeBarcode', () => {
  it('returns 13-digit EAN-13 as-is', () => {
    expect(normalizeBarcode('4902105228531')).toBe('4902105228531');
  });

  it('pads 12-digit UPC-A to 13-digit EAN-13', () => {
    expect(normalizeBarcode('012345678905')).toBe('0012345678905');
  });

  it('strips whitespace', () => {
    expect(normalizeBarcode(' 4902105228531 ')).toBe('4902105228531');
  });
});

// ─── 2.4 Barcode type detection ────────────────────────────────────────────

describe('detectBarcodeType', () => {
  it('detects EAN-13', () => {
    expect(detectBarcodeType('4902105228531')).toBe('ean13');
  });

  it('detects UPC-A (12 digits)', () => {
    expect(detectBarcodeType('012345678905')).toBe('upc_a');
  });

  it('returns unknown for invalid formats', () => {
    expect(detectBarcodeType('12345')).toBe('unknown');
    expect(detectBarcodeType('abcdefghijklm')).toBe('unknown');
  });
});

// ─── 2.5 GET /food/barcode/:code — Route integration tests ────────────────

describe('GET /food/barcode/:code', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
    });

    const res = await app.request('/food/barcode/4902105228531');
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid barcode format', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/food/barcode/invalid', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('barcode');
  });

  it('returns 404 when barcode not found in DB', async () => {
    const mockDB = createMockDB({
      tables: { food_items: [] },
    });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/food/barcode/4902105228531', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(404);
  });

  it('returns food item when barcode matches', async () => {
    const mockDB = createMockDB({
      tables: {
        food_items: [
          {
            id: 1,
            barcode: '4902105228531',
            name_bn: 'কিটক্যাট',
            name_en: 'KitKat Chocolate',
            category: 'sweets',
            calories_per_100g: 518,
          },
        ],
      },
    });
    const { app } = createTestApp({
      route: foodRoutes,
      routePath: '/food',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/food/barcode/4902105228531', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.item).toBeDefined();
    expect(body.item.name_en).toBe('KitKat Chocolate');
  });
});
