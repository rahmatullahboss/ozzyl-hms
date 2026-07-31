/**
 * Print Audit Helper
 *
 * Lightweight wrapper around `createAuditLog` for tracking PDF / document
 * prints across the reception module. Each call writes a row to the existing
 * `audit_logs` table with:
 *
 *   action     = 'print'
 *   table_name = 'print_audit'
 *   record_id  = documentId
 *   new_value  = JSON { documentType, copyNumber, watermark, documentId, printedAt }
 *
 * Soft audit policy: every print is logged but never blocks. Use this for
 * traceability and reporting — not for hard rate limits.
 */

import { createAuditLog } from './accounting-helpers';

export type PrintAuditInput = {
  env: { DB: D1Database };
  tenantId: string;
  userId: number;
  documentType: string;
  documentId: number | string;
  copyNumber?: number;
  watermark?: string | null;
  ipAddress?: string;
  userAgent?: string;
};

export async function recordPrint(input: PrintAuditInput): Promise<void> {
  const numericId = typeof input.documentId === 'string' ? Number(input.documentId) || 0 : input.documentId;
  const newValue = {
    documentType: input.documentType,
    documentId: input.documentId,
    copyNumber: input.copyNumber ?? 1,
    watermark: input.watermark ?? null,
    printedAt: new Date().toISOString(),
  };
  await createAuditLog(
    input.env,
    input.tenantId,
    String(input.userId),
    'print',
    'print_audit',
    numericId,
    null,
    newValue,
    input.ipAddress,
    input.userAgent,
  );
}

/** Convenience: extract IP and user-agent from a Hono Context. */
export function getRequestMeta(c: { req: { header: (k: string) => string | undefined } }): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: c.req.header('user-agent') || undefined,
  };
}
