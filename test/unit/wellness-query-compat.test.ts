import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('wellness query compatibility', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/routes/wellness.ts'), 'utf8');

  it('uses logged_at for wellness log date filters', () => {
    expect(source).toContain('DATE(logged_at) = ?');
    expect(source).not.toContain('water_log WHERE patient_id = ? AND date(created_at) = ?');
    expect(source).not.toContain('mood_log WHERE patient_id = ? AND DATE(created_at) = ?');
    expect(source).not.toContain('sleep_log WHERE patient_id = ? AND DATE(created_at) = ?');
    expect(source).not.toContain('activity_log WHERE patient_id = ? AND DATE(created_at) = ?');
  });
});
