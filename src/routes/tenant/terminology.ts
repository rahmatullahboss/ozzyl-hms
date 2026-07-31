// ═══════════════════════════════════════════════════════════════════════════════
// Central Terminology Service Routes
// Global shared terminology: ICD-11, LOINC, SNOMED — no tenant_id filtering
// ═══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../../types';
import { icd11SearchSchema, loincSearchSchema, snomedSearchSchema } from '../../schemas/terminology';

type TermEnv = { Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } };

const terminologyRoutes = new Hono<TermEnv>();

// ─── ICD-11 MMS ─────────────────────────────────────────────────────────────

terminologyRoutes.get('/icd11/search', zValidator('query', icd11SearchSchema), async (c) => {
  const { q, limit } = c.req.valid('query');

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const { results } = await c.env.DB
    .prepare("SELECT id, code, title, icd11_uri, is_bd_subset FROM catalog_icd11_mms WHERE (code LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\') AND is_active = 1 ORDER BY is_bd_subset DESC, code ASC LIMIT ?2")
    .bind(pattern, limit)
    .all();

  return c.json({
    Results: results,
    system: 'http://id.who.int/icd/release/11/mms',
  });
});

terminologyRoutes.get('/icd11/:code', async (c) => {
  const code = c.req.param('code');
  const row = await c.env.DB
    .prepare('SELECT * FROM catalog_icd11_mms WHERE code = ? AND is_active = 1')
    .bind(code)
    .first();

  if (!row) return c.json({ error: 'ICD-11 code not found' }, 404);
  return c.json({ Result: row, system: 'http://id.who.int/icd/release/11/mms' });
});

// ─── LOINC ──────────────────────────────────────────────────────────────────

terminologyRoutes.get('/loinc/search', zValidator('query', loincSearchSchema), async (c) => {
  const { q, limit } = c.req.valid('query');
  const cls = c.req.query('class');

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  if (cls) {
    const { results } = await c.env.DB
      .prepare("SELECT id, loinc_num, component, long_common_name, short_name, class, units, status FROM catalog_loinc WHERE (loinc_num LIKE ?1 ESCAPE '\\' OR component LIKE ?1 ESCAPE '\\' OR long_common_name LIKE ?1 ESCAPE '\\') AND status = 'ACTIVE' AND class = ?2 ORDER BY component ASC LIMIT ?3")
      .bind(pattern, cls, limit)
      .all();

    return c.json({ Results: results, system: 'http://loinc.org' });
  }

  const { results } = await c.env.DB
    .prepare("SELECT id, loinc_num, component, long_common_name, short_name, class, units, status FROM catalog_loinc WHERE (loinc_num LIKE ?1 ESCAPE '\\' OR component LIKE ?1 ESCAPE '\\' OR long_common_name LIKE ?1 ESCAPE '\\') AND status = 'ACTIVE' ORDER BY component ASC LIMIT ?2")
    .bind(pattern, limit)
    .all();

  return c.json({ Results: results, system: 'http://loinc.org' });
});

terminologyRoutes.get('/loinc/:loincNum', async (c) => {
  const loincNum = c.req.param('loincNum');
  const row = await c.env.DB
    .prepare("SELECT * FROM catalog_loinc WHERE loinc_num = ? AND status = 'ACTIVE'")
    .bind(loincNum)
    .first();

  if (!row) return c.json({ error: 'LOINC code not found' }, 404);
  return c.json({ Result: row, system: 'http://loinc.org' });
});

// ─── SNOMED CT ──────────────────────────────────────────────────────────────

terminologyRoutes.get('/snomed/search', zValidator('query', snomedSearchSchema), async (c) => {
  const { q, limit } = c.req.valid('query');
  const tag = c.req.query('tag');

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  if (tag) {
    const { results } = await c.env.DB
      .prepare("SELECT id, sctid, term, semantic_tag FROM catalog_snomed WHERE (sctid LIKE ?1 ESCAPE '\\' OR term LIKE ?1 ESCAPE '\\') AND is_active = 1 AND semantic_tag = ?2 ORDER BY term ASC LIMIT ?3")
      .bind(pattern, tag, limit)
      .all();

    return c.json({ Results: results, system: 'http://snomed.info/sct' });
  }

  const { results } = await c.env.DB
    .prepare("SELECT id, sctid, term, semantic_tag FROM catalog_snomed WHERE (sctid LIKE ?1 ESCAPE '\\' OR term LIKE ?1 ESCAPE '\\') AND is_active = 1 ORDER BY term ASC LIMIT ?2")
    .bind(pattern, limit)
    .all();

  return c.json({ Results: results, system: 'http://snomed.info/sct' });
});

// ─── Cross-walk: ICD-10 → ICD-11 suggestion ─────────────────────────────────

terminologyRoutes.get('/crosswalk/icd10-to-icd11', async (c) => {
  const q = c.req.query('q');
  if (!q || q.length < 2) {
    return c.json({ error: 'Provide ICD-10 description to match' }, 400);
  }

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const { results } = await c.env.DB
    .prepare("SELECT id, code, title FROM catalog_icd11_mms WHERE title LIKE ? ESCAPE '\\' AND is_active = 1 ORDER BY is_bd_subset DESC LIMIT 10")
    .bind(pattern)
    .all();

  return c.json({ Results: results });
});

// ─── Version info ───────────────────────────────────────────────────────────

terminologyRoutes.get('/versions', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT code_system, version, loaded_at, record_count, notes FROM catalog_versions ORDER BY code_system')
    .all();

  return c.json({ Results: results });
});

export default terminologyRoutes;
