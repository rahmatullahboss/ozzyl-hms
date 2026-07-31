import type { D1Database } from '@cloudflare/workers-types';
import { resolveReceivableAuthority } from './authority';
import { getCanonicalReceivable } from './canonicalAdapter';
import { getLegacyReceivable } from './legacyAdapter';
import type {
  ReceivableAuthorityMode,
  ReceivableRecord,
  ReceivableSourceRef,
} from './types';

interface NameRow {
  name: string;
}

interface MappingRow {
  canonicalPublicId: string;
}

export interface LiveReceivable {
  authorityMode: ReceivableAuthorityMode;
  record: ReceivableRecord;
}

export class ReceivableSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableSourceValidationError';
  }
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

function validateSource(source: ReceivableSourceRef): void {
  if (source.sourceType !== 'invoice') {
    throw new ReceivableSourceValidationError('Only invoice receivable sources are supported.');
  }
  if (
    source.legacyBillId !== undefined
    && (!Number.isSafeInteger(source.legacyBillId) || source.legacyBillId <= 0)
  ) {
    throw new ReceivableSourceValidationError('Legacy bill ID must be a positive safe integer.');
  }
  if (
    source.canonicalInvoicePublicId !== undefined
    && !source.canonicalInvoicePublicId.trim()
  ) {
    throw new ReceivableSourceValidationError('Canonical invoice public ID cannot be empty.');
  }
  if (source.legacyBillId === undefined && source.canonicalInvoicePublicId === undefined) {
    throw new ReceivableSourceValidationError('An invoice source identity is required.');
  }
}

async function mappedCanonicalInvoiceId(input: {
  db: D1Database;
  tenantId: string;
  legacyBillId: number;
}): Promise<string | null> {
  if (!await tableExists(input.db, 'canonical_source_mappings')) return null;

  const row = await input.db.prepare(`
    SELECT canonical_public_id AS "canonicalPublicId"
    FROM canonical_source_mappings
    WHERE tenant_id = ?
      AND entity_type = 'invoice'
      AND source_table = 'bills'
      AND source_public_id = ?
      AND mapping_status = 'mapped'
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, String(input.legacyBillId)).first<MappingRow>();

  return row?.canonicalPublicId?.trim() || null;
}

export async function getLiveReceivable(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
}): Promise<LiveReceivable | null> {
  validateSource(input.source);
  const authority = await resolveReceivableAuthority({
    db: input.db,
    tenantId: input.tenantId,
  });

  if (authority.mode === 'canonical') {
    let canonicalInvoicePublicId = input.source.canonicalInvoicePublicId?.trim() || null;
    if (!canonicalInvoicePublicId && input.source.legacyBillId !== undefined) {
      canonicalInvoicePublicId = await mappedCanonicalInvoiceId({
        db: input.db,
        tenantId: input.tenantId,
        legacyBillId: input.source.legacyBillId,
      });
    }
    if (!canonicalInvoicePublicId) return null;

    const record = await getCanonicalReceivable({
      db: input.db,
      tenantId: input.tenantId,
      canonicalInvoicePublicId,
    });
    if (!record) return null;

    if (
      input.source.legacyBillId !== undefined
      && record.source.legacyBillId !== input.source.legacyBillId
    ) {
      return null;
    }

    return { authorityMode: 'canonical', record };
  }

  const legacyBillId = input.source.legacyBillId;
  if (legacyBillId === undefined) return null;
  const record = await getLegacyReceivable({
    db: input.db,
    tenantId: input.tenantId,
    legacyBillId,
  });
  if (!record) return null;

  if (input.source.canonicalInvoicePublicId) {
    const mapped = await mappedCanonicalInvoiceId({
      db: input.db,
      tenantId: input.tenantId,
      legacyBillId,
    });
    if (mapped !== input.source.canonicalInvoicePublicId.trim()) return null;
    record.source.canonicalInvoicePublicId = mapped;
  }

  return { authorityMode: authority.mode, record };
}
