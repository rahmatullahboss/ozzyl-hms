import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/0551_workforce_roster_integrity.sql', 'utf8');

describe('workforce roster integrity migration', () => {
  it('adds only additive integrity structures', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hr_roster_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workforce_mutation_idempotency');
    expect(sql).toContain('source_event_key');
    expect(sql).toContain('request_hash');
    expect(sql).toContain('projection_version');
    expect(sql).toContain('UNIQUE(tenant_id, mutation_type, idempotency_key)');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|ALTER TABLE\s+\w+\s+RENAME/i);
  });

  it('records immutable roster lifecycle event constraints', () => {
    expect(sql).toContain("CHECK(event_type IN ('assigned','reassigned','reactivated','swapped','cancelled','generated'))");
    expect(sql).toContain('uq_hr_roster_events_public_id');
    expect(sql).toContain('uq_hr_roster_events_idempotency');
  });

  it('deduplicates attendance punches by tenant, source, and source event key', () => {
    expect(sql).toContain('uq_hr_attendance_punch_source_event');
    expect(sql).toContain('ON hr_attendance_punches(tenant_id, source, source_event_key)');
  });
});
