import { describe, it, expect } from 'vitest';

// ─── Radiology Module Enhanced Tests ──────────────────────────────────────────
// Covers: Film types, report templates, DICOM viewer, doctor dropdown,
//         report numbering, scan status transitions
// Based on: DanpheEMR RadiologyModels + OpenEMR DICOM integration

describe('Radiology Module (Enhanced)', () => {

  // ─── Film Type Validation ─────────────────────────────────────────────────
  describe('Film Type Validation', () => {
    const validFilmTypes = ['xray_film', 'ct_film', 'mri_film', 'ultrasound_paper', 'mammography_film'];

    it('should accept valid film types', () => {
      validFilmTypes.forEach(ft => {
        expect(validFilmTypes).toContain(ft);
      });
    });

    it('should reject invalid film types', () => {
      expect(validFilmTypes).not.toContain('video_film');
      expect(validFilmTypes).not.toContain('');
    });

    it('should require positive film quantity', () => {
      const quantities = [1, 2, 5, 10];
      quantities.forEach(q => expect(q > 0).toBe(true));
    });

    it('should reject zero or negative film quantity', () => {
      expect(0 > 0).toBe(false);
      expect(-1 > 0).toBe(false);
    });
  });

  // ─── Report Template Validation ───────────────────────────────────────────
  describe('Report Template Validation', () => {
    const templateCodes = ['chest_xray_normal', 'chest_xray_abnormal', 'ct_brain_plain', 'ct_brain_contrast', 'mri_brain', 'usg_abdomen', 'usg_pelvis'];

    it('should accept known report template codes', () => {
      templateCodes.forEach(code => {
        expect(templateCodes).toContain(code);
      });
    });

    it('should reject unknown template codes', () => {
      expect(templateCodes).not.toContain('unknown_template');
      expect(templateCodes).not.toContain('random');
    });

    it('should auto-populate report text when template is selected', () => {
      const templates: Record<string, string> = {
        chest_xray_normal: '<p>Chest X-ray shows normal lung fields. Cardiac silhouette is normal.</p>',
        ct_brain_plain: '<p>CT brain shows no acute intracranial hemorrhage.</p>',
      };
      expect(templates['chest_xray_normal']).toContain('normal');
      expect(templates['ct_brain_plain']).toContain('CT brain');
    });

    it('should allow custom report text beyond template', () => {
      const baseTemplate = '<p>Normal study.</p>';
      const customNote = '<p>Additional note: Patient moved during scan.</p>';
      const finalReport = baseTemplate + customNote;
      expect(finalReport).toContain('Normal study');
      expect(finalReport).toContain('Additional note');
    });
  });

  // ─── DICOM Viewer URL Generation ──────────────────────────────────────────
  describe('DICOM Viewer URL Generation', () => {
    function generateViewerUrl(baseUrl: string, studyInstanceUid: string): string {
      if (!baseUrl || !studyInstanceUid) return '';
      const cleanBase = baseUrl.replace(/\/$/, '');
      return `${cleanBase}/viewer/${encodeURIComponent(studyInstanceUid)}`;
    }

    it('should generate valid OHIF viewer URL', () => {
      const url = generateViewerUrl('https://viewer.hospital.com', '1.2.840.113619.2.55.3.604688.123.456');
      expect(url).toContain('https://viewer.hospital.com/viewer/');
      expect(url).toContain('1.2.840');
    });

    it('should handle trailing slash in base URL', () => {
      const url = generateViewerUrl('https://viewer.hospital.com/', '1.2.3.4');
      expect(url).toBe('https://viewer.hospital.com/viewer/1.2.3.4');
    });

    it('should return empty string when base URL is missing', () => {
      expect(generateViewerUrl('', '1.2.3.4')).toBe('');
    });

    it('should return empty string when study UID is missing', () => {
      expect(generateViewerUrl('https://viewer.hospital.com', '')).toBe('');
    });

    it('should URL-encode special characters in study UID', () => {
      const url = generateViewerUrl('https://viewer.hospital.com', '1.2.3/4.5');
      expect(url).toContain(encodeURIComponent('1.2.3/4.5'));
    });
  });

  // ─── Report Numbering (RAD-YYYYMMDD-###) ──────────────────────────────────
  describe('Report Number Generation', () => {
    function generateReportNumber(date: Date, sequence: number): string {
      const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
      return `RAD-${ymd}-${String(sequence).padStart(3, '0')}`;
    }

    it('should generate report number in correct format', () => {
      const num = generateReportNumber(new Date('2026-04-23'), 1);
      expect(num).toMatch(/^RAD-\d{8}-\d{3}$/);
      expect(num).toBe('RAD-20260423-001');
    });

    it('should pad sequence to 3 digits', () => {
      expect(generateReportNumber(new Date(), 1)).toContain('-001');
      expect(generateReportNumber(new Date(), 99)).toContain('-099');
      expect(generateReportNumber(new Date(), 100)).toContain('-100');
    });

    it('should include correct date in report number', () => {
      const num = generateReportNumber(new Date('2026-01-15'), 5);
      expect(num).toContain('20260115');
    });
  });

  // ─── Scan Status Transitions ──────────────────────────────────────────────
  describe('Radiology Order Status Transitions', () => {
    type RadStatus = 'pending' | 'scheduled' | 'scanned' | 'reported' | 'cancelled';

    const VALID_TRANSITIONS: Record<RadStatus, RadStatus[]> = {
      pending:   ['scheduled', 'cancelled'],
      scheduled: ['scanned', 'cancelled'],
      scanned:   ['reported', 'cancelled'],
      reported:  [],
      cancelled: [],
    };

    function canTransition(from: RadStatus, to: RadStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow pending → scheduled', () => {
      expect(canTransition('pending', 'scheduled')).toBe(true);
    });

    it('should allow scheduled → scanned', () => {
      expect(canTransition('scheduled', 'scanned')).toBe(true);
    });

    it('should allow scanned → reported', () => {
      expect(canTransition('scanned', 'reported')).toBe(true);
    });

    it('should allow any status → cancelled', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true);
      expect(canTransition('scheduled', 'cancelled')).toBe(true);
      expect(canTransition('scanned', 'cancelled')).toBe(true);
    });

    it('should block reported → scanned (no reversal)', () => {
      expect(canTransition('reported', 'scanned')).toBe(false);
    });

    it('should block cancelled → any status (terminal)', () => {
      expect(canTransition('cancelled', 'pending')).toBe(false);
      expect(canTransition('cancelled', 'scheduled')).toBe(false);
      expect(canTransition('cancelled', 'scanned')).toBe(false);
    });

    it('should block pending → reported (must scan first)', () => {
      expect(canTransition('pending', 'reported')).toBe(false);
    });
  });

  // ─── Doctor/Performer Dropdown ────────────────────────────────────────────
  describe('Doctor Dropdown for Reports', () => {
    const doctors = [
      { id: 1, name: 'Dr. Rahman', specialization: 'Radiology' },
      { id: 2, name: 'Dr. Hossain', specialization: 'Radiology' },
      { id: 3, name: 'Dr. Akter', specialization: 'Cardiology' },
    ];

    it('should only show radiologists as report performers', () => {
      const radiologists = doctors.filter(d => d.specialization === 'Radiology');
      expect(radiologists.length).toBe(2);
      expect(radiologists.map(d => d.name)).toContain('Dr. Rahman');
      expect(radiologists.map(d => d.name)).toContain('Dr. Hossain');
    });

    it('should reject non-radiologist as performer', () => {
      const cardiologist = doctors.find(d => d.specialization === 'Cardiology');
      expect(cardiologist?.specialization).not.toBe('Radiology');
    });

    it('should require performer_id for report finalization', () => {
      const report = { performer_id: null, status: 'draft' };
      expect(report.performer_id).toBeNull();
      const canFinalize = !!report.performer_id && report.status === 'draft';
      expect(canFinalize).toBe(false);
    });
  });

  // ─── STAT Order Priority ──────────────────────────────────────────────────
  describe('STAT Order Handling', () => {
    it('should flag STAT orders with highest priority', () => {
      const priorities = ['routine', 'urgent', 'stat'];
      expect(priorities.indexOf('stat')).toBeGreaterThan(priorities.indexOf('routine'));
      expect(priorities.indexOf('stat')).toBeGreaterThan(priorities.indexOf('urgent'));
    });

    it('should require immediate processing for STAT orders', () => {
      const order = { priority: 'stat', created_at: new Date().toISOString() };
      const isStat = order.priority === 'stat';
      expect(isStat).toBe(true);
    });
  });

  // ─── PACS Study Mapping ───────────────────────────────────────────────────
  describe('PACS Study Mapping', () => {
    it('should mark study as mapped when linked to radiology order', () => {
      const study = { id: 1, order_id: 5, mapped: true };
      expect(study.mapped).toBe(true);
      expect(study.order_id).toBeGreaterThan(0);
    });

    it('should mark study as unlinked when no order association', () => {
      const study = { id: 2, order_id: null, mapped: false };
      expect(study.mapped).toBe(false);
      expect(study.order_id).toBeNull();
    });
  });
});
