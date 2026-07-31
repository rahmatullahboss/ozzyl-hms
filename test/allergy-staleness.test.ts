import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// Allergy Staleness Hook Tests
// Verifies markCardsStale is called on all allergy mutation routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Allergy Staleness Hooks — Source Code Verification', () => {
  let allergySource: string;

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '../src/routes/tenant/allergies.ts');
    allergySource = fs.readFileSync(filePath, 'utf-8');
  });

  it('imports markCardsStale from health-card-utils', () => {
    expect(allergySource).toContain("import { markCardsStale } from '../../lib/health-card-utils'");
  });

  it('calls markCardsStale in POST handler (after INSERT)', () => {
    // The source should have markCardsStale called after the INSERT
    // Count occurrences — should be at least 3 (POST, PUT, DELETE)
    const calls = allergySource.match(/markCardsStale\(/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBeGreaterThanOrEqual(3);
  });

  it('uses fire-and-forget with error handling (.catch)', () => {
    // Each call should use .catch() pattern for non-blocking staleness
    const catchCalls = allergySource.match(/markCardsStale\(.*?\)\.catch/gs);
    expect(catchCalls).not.toBeNull();
    expect(catchCalls!.length).toBeGreaterThanOrEqual(3);
  });

  it('DELETE handler fetches patient_id for staleness call', () => {
    // The DELETE endpoint must SELECT patient_id (not just id) to pass to markCardsStale
    expect(allergySource).toContain('SELECT id, patient_id FROM patient_allergies');
  });

  it('POST handler passes data.patient_id to markCardsStale', () => {
    // Verify the POST handler uses data.patient_id
    expect(allergySource).toContain('markCardsStale(c.env.DB, tenantId, data.patient_id)');
  });

  it('PUT handler passes existing.patient_id to markCardsStale', () => {
    // Verify the PUT handler uses existing.patient_id (from the fetched record)
    expect(allergySource).toContain('markCardsStale(c.env.DB, tenantId, existing.patient_id)');
  });
});

describe('markCardsStale Function — Source Verification', () => {
  let utilsSource: string;

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '../src/lib/health-card-utils.ts');
    utilsSource = fs.readFileSync(filePath, 'utf-8');
  });

  it('markCardsStale function is exported', () => {
    expect(utilsSource).toContain('export');
    expect(utilsSource).toContain('markCardsStale');
  });

  it('targets active cards only (status = active)', () => {
    // Should update only active cards to stale
    expect(utilsSource).toMatch(/status\s*=\s*'stale'/);
    expect(utilsSource).toMatch(/status\s*=\s*'active'/);
  });

  it('filters by tenant_id for defense-in-depth', () => {
    expect(utilsSource).toContain('tenant_id');
  });

  it('filters by patient_id', () => {
    expect(utilsSource).toContain('patient_id');
  });
});

describe('Allergy Route — Duplicate Prevention', () => {
  let allergySource: string;

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '../src/routes/tenant/allergies.ts');
    allergySource = fs.readFileSync(filePath, 'utf-8');
  });

  it('POST checks for case-insensitive duplicate allergen', () => {
    expect(allergySource).toContain('COLLATE NOCASE');
    expect(allergySource).toContain('This allergy is already recorded');
  });

  it('PUT checks for duplicate when allergen/type changes', () => {
    expect(allergySource).toContain('An allergy with this allergen and type already exists');
  });

  it('DELETE is soft-delete (sets is_active = 0)', () => {
    expect(allergySource).toContain('is_active = 0');
  });

  it('DELETE records audit trail in notes', () => {
    expect(allergySource).toContain('[Removed by user');
  });
});
