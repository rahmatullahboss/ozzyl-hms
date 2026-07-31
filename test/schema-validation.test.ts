import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// Schema Validation Tests for New Modules
// ═══════════════════════════════════════════════════════════════════════════════

describe('MPI Schemas', () => {
  let unmergeSchema: z.ZodType;

  beforeAll(async () => {
    const mod = await import('../src/schemas/mpi');
    unmergeSchema = mod.unmergeSchema;
  });

  describe('unmergeSchema', () => {
    it('accepts valid unmerge payload', () => {
      const result = unmergeSchema.safeParse({
        merge_log_id: 1,
        unmerge_reason: 'Incorrectly merged patients',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing merge_log_id', () => {
      const result = unmergeSchema.safeParse({
        unmerge_reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-positive merge_log_id', () => {
      expect(unmergeSchema.safeParse({ merge_log_id: 0, unmerge_reason: 'test' }).success).toBe(false);
      expect(unmergeSchema.safeParse({ merge_log_id: -1, unmerge_reason: 'test' }).success).toBe(false);
    });

    it('rejects non-integer merge_log_id', () => {
      const result = unmergeSchema.safeParse({
        merge_log_id: 1.5,
        unmerge_reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty unmerge_reason', () => {
      const result = unmergeSchema.safeParse({
        merge_log_id: 1,
        unmerge_reason: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing unmerge_reason', () => {
      const result = unmergeSchema.safeParse({
        merge_log_id: 1,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Health Card Schemas', () => {
  let issueCardSchema: z.ZodType;
  let revokeCardSchema: z.ZodType;

  beforeAll(async () => {
    const mod = await import('../src/schemas/healthCards');
    issueCardSchema = mod.issueCardSchema;
    revokeCardSchema = mod.revokeCardSchema;
  });

  describe('issueCardSchema', () => {
    it('accepts valid payload with all fields', () => {
      const result = issueCardSchema.safeParse({
        patient_id: 50,
        card_type: 'hospital',
        duration_hours: 24,
      });
      expect(result.success).toBe(true);
    });

    it('accepts global card type', () => {
      const result = issueCardSchema.safeParse({
        patient_id: 50,
        card_type: 'global',
        duration_hours: 48,
      });
      expect(result.success).toBe(true);
    });

    it('accepts emergency card type', () => {
      const result = issueCardSchema.safeParse({
        patient_id: 50,
        card_type: 'emergency',
        duration_hours: 24,
      });
      expect(result.success).toBe(true);
    });

    it('defaults card_type to hospital', () => {
      const result = issueCardSchema.safeParse({ patient_id: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.card_type).toBe('hospital');
      }
    });

    it('defaults duration_hours to 24', () => {
      const result = issueCardSchema.safeParse({ patient_id: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duration_hours).toBe(24);
      }
    });

    it('rejects invalid card_type', () => {
      const result = issueCardSchema.safeParse({
        patient_id: 50,
        card_type: 'portable',
      });
      expect(result.success).toBe(false);
    });

    it('rejects patient_id <= 0', () => {
      expect(issueCardSchema.safeParse({ patient_id: 0 }).success).toBe(false);
      expect(issueCardSchema.safeParse({ patient_id: -1 }).success).toBe(false);
    });

    it('rejects non-integer patient_id', () => {
      expect(issueCardSchema.safeParse({ patient_id: 1.5 }).success).toBe(false);
    });

    it('rejects duration_hours < 1', () => {
      expect(issueCardSchema.safeParse({ patient_id: 50, duration_hours: 0 }).success).toBe(false);
    });

    it('rejects duration_hours > 8760 (1 year)', () => {
      expect(issueCardSchema.safeParse({ patient_id: 50, duration_hours: 9000 }).success).toBe(false);
    });

    it('accepts boundary duration values', () => {
      expect(issueCardSchema.safeParse({ patient_id: 50, duration_hours: 1 }).success).toBe(true);
      expect(issueCardSchema.safeParse({ patient_id: 50, duration_hours: 8760 }).success).toBe(true);
    });
  });

  describe('revokeCardSchema', () => {
    it('accepts valid revocation', () => {
      const result = revokeCardSchema.safeParse({
        reason: 'Card lost',
        issue_replacement: true,
      });
      expect(result.success).toBe(true);
    });

    it('defaults issue_replacement to false', () => {
      const result = revokeCardSchema.safeParse({ reason: 'Expired' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.issue_replacement).toBe(false);
      }
    });

    it('rejects empty reason', () => {
      const result = revokeCardSchema.safeParse({ reason: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing reason', () => {
      const result = revokeCardSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

describe('Drizzle Schema tenant_id Type', () => {
  it('all tenantId columns in schema should use text type', async () => {
    // Read the schema source and verify no integer("tenant_id") remains
    const fs = await import('fs');
    const path = await import('path');
    const schemaPath = path.resolve(__dirname, '../src/db/schema/schema.ts');
    const content = fs.readFileSync(schemaPath, 'utf-8');

    // Should have zero integer("tenant_id") left
    const integerMatches = content.match(/integer\("tenant_id"\)/g);
    expect(integerMatches).toBeNull();

    // Should have many text("tenant_id")
    const textMatches = content.match(/text\("tenant_id"\)/g);
    expect(textMatches).not.toBeNull();
    expect(textMatches!.length).toBeGreaterThan(50);
  });

  it('healthCards schema uses text tenant_id', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cardsPath = path.resolve(__dirname, '../src/db/schema/healthCards.ts');
    const content = fs.readFileSync(cardsPath, 'utf-8');

    expect(content).toContain("text('tenant_id')");
    expect(content).not.toContain("integer('tenant_id')");
  });
});
