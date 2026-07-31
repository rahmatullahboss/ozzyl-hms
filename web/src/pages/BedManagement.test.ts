import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'BedManagement.tsx');
const source = readFileSync(sourcePath, 'utf8');

describe('BedManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BedManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps the command center wired to enriched APIs', () => {
    expect(source).toContain('/api/admissions/ward-bed-overview');
    expect(source).toContain('command-detail');
    expect(source).toContain('bed-equipment');
    expect(source).toContain('/api/inventory/assets?status=active');
  });

  it('provides operational filters and an equipment-issue KPI', () => {
    expect(source).toContain('searchTerm');
    expect(source).toContain('floorFilter');
    expect(source).toContain('typeFilter');
    expect(source).toContain('featureFilter');
    expect(source).toContain('Equipment Issues');
    expect(source).toContain('equipment_issues');
    expect(source).toContain('equipment_issue_count');
  });

  it('shows a drawer with patient context, timeline and bedside equipment controls', () => {
    expect(source).toContain('fixed inset-0 z-50 flex justify-end');
    expect(source).toContain('patient_age');
    expect(source).toContain('patient_mobile');
    expect(source).toContain('doctor_name');
    expect(source).toContain('Bed Timeline');
    expect(source).toContain('Room Assets / Bedside Equipment');
    expect(source).toContain('Save Equipment');
  });

  it('supports asset linking, maintenance logging and bed maintenance suggestion', () => {
    expect(source).toContain('applyAssetToEquipmentRow');
    expect(source).toContain('asset_barcode');
    expect(source).toContain('Log maintenance ticket');
    expect(source).toContain('/api/inventory/assets/maintenance');
    expect(source).toContain('Equipment issue detected');
    expect(source).toContain('Mark bed maintenance');
  });

  it('deep-links maintenance timeline items to Asset Management', () => {
    expect(source).toContain('Open maintenance');
    expect(source).toContain('asset-management?tab=maintenance');
  });
});
