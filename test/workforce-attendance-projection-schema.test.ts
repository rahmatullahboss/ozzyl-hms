import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/0552_attendance_projection_integrity.sql', 'utf8');

describe('attendance projection integrity migration', () => {
  it('adds authoritative projection fields without replacing legacy attendance columns', () => {
    expect(sql).toContain('projection_status');
    expect(sql).toContain('worked_minutes');
    expect(sql).toContain('business_date');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hr_attendance_projection_events');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|ALTER TABLE\s+\w+\s+RENAME/i);
  });

  it('supports every deterministic projection status', () => {
    expect(sql).toContain("CHECK(projection_status IN ('present','absent','late','leave','half_day','off_day','incomplete'))");
  });

  it('makes projection events immutable and replay identifiable', () => {
    expect(sql).toContain('source_event_key TEXT NOT NULL');
    expect(sql).toContain('request_hash TEXT NOT NULL');
    expect(sql).toContain('uq_hr_attendance_projection_events_source');
  });
});
