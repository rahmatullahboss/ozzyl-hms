import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_GENERAL_AUDIT_ACTIONS = new Set([
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'VERIFY',
  'PAYMENT',
  'CANCEL',
  'RESULT',
  'VIEW',
  'COLLECT',
  'RECEIVE',
  'VALIDATE',
  'DELIVER',
  'ACK_CRITICAL',
  'CORRECT',
  'UPDATE_STATUS',
  'RECOLLECT',
  'ROLE_CHANGE',
  'PASSWORD_CHANGE',
  'PRINT',
  'EXPORT',
  'BARCODE_SCAN',
  'PROCESS',
  'CHECK_IN',
  'DISCHARGE',
  'BACKUP_REQUEST',
  'ACCOUNTING_MAINTENANCE_RUN',
  'APPROVED_CANCEL',
  'APPROVED_PAYMENT_REVERSAL',
  'APPROVED_CONVERT_TO_CREDIT_NOTE',
  'UPLOAD_RECEIPT',
  'VERIFY_RECEIPT',
  'REJECT_RECEIPT',
  'ACK_RESULT',
  'PHARMACY_INVOICE_CREATE',
  'PHARMACY_INVOICE_REPAIR',
  'PHARMACY_INVOICE_REPAIR_CANCELLED',
  'PHARMACY_INVOICE_RETURN',
  'PHARMACY_GRN_CREATE',
  'STOCK_ADJUSTMENT_DIRECT',
  'STOCK_ADJUSTMENT_QUEUED',
  'STOCK_ADJUSTMENT_REJECTED',
  'STOCK_ADJUSTMENT_APPROVED',
  'PROFILE_UPDATE',
  'PROFILE_PHOTO_UPDATE',
  'BLOCKED_DELETE',
]);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('general audit log action allow-list', () => {
  it('uses canonical audit action values in source createAuditLog calls', () => {
    const sourceRoots = [
      path.join(process.cwd(), 'src/routes'),
      path.join(process.cwd(), 'src/lib'),
    ];
    const invalid: string[] = [];
    const actionPattern = /createAuditLog\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*['"]([A-Z_]+)['"]/g;

    for (const file of sourceRoots.flatMap(collectSourceFiles)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(actionPattern)) {
        const action = match[1];
        if (!ALLOWED_GENERAL_AUDIT_ACTIONS.has(action)) {
          invalid.push(`${path.relative(process.cwd(), file)}: ${action}`);
        }
      }
    }

    expect(invalid).toEqual([]);
  });

  it('schema.ts CHECK constraint includes all allowed audit actions', () => {
    const schemaPath = path.join(process.cwd(), 'src/db/schema/schema.ts');
    const schema = readFileSync(schemaPath, 'utf8');

    const checkMatch = schema.match(/audit_logs_action_check.*?action IN \(([^)]+)\)/);
    expect(checkMatch).not.toBeNull();

    const schemaActions = new Set(
      checkMatch![1].split(',').map((s) => s.trim().replace(/['`]/g, ''))
    );

    for (const action of ALLOWED_GENERAL_AUDIT_ACTIONS) {
      expect(schemaActions).toContain(action);
    }
  });
});
