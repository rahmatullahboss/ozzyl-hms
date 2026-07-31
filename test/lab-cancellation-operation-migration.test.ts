import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0411_lab_cancellation_operation_saga.sql', 'utf8');

describe('lab cancellation operation migration', () => {
  it('defines a durable tenant-scoped cancellation operation lifecycle', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lab_cancellation_operations');
    expect(migration).toContain("CHECK(status IN ('processing', 'core_completed', 'completed', 'failed'))");
    expect(migration).toContain('UNIQUE(tenant_id, lab_order_item_id)');
    expect(migration).toContain('idx_lab_cancellation_operation_status');
  });

  it('applies cleanly and enforces one operation per tenant and lab item', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(migration);

    sqlite.prepare(`
      INSERT INTO lab_cancellation_operations
        (tenant_id, lab_order_item_id, request_hash, lab_order_id, reason)
      VALUES ('tenant-a', 77, 'hash-a', 12, 'Patient refused')
    `).run();

    expect(() => sqlite.prepare(`
      INSERT INTO lab_cancellation_operations
        (tenant_id, lab_order_item_id, request_hash, lab_order_id, reason)
      VALUES ('tenant-a', 77, 'hash-b', 12, 'Changed reason')
    `).run()).toThrow();

    expect(() => sqlite.prepare(`
      UPDATE lab_cancellation_operations SET status = 'unknown'
      WHERE tenant_id = 'tenant-a' AND lab_order_item_id = 77
    `).run()).toThrow();
  });
});
