import { describe, it, expect } from 'vitest';
import {
  createImagingTypeSchema,
  updateImagingTypeSchema,
  createImagingItemSchema,
  updateImagingItemSchema,
  createRequisitionSchema,
  markScannedSchema,
  cancelRequisitionSchema,
  createReportSchema,
  createReportTemplateSchema,
  createFilmTypeSchema,
  createDicomStudySchema,
  requisitionQuerySchema,
  reportQuerySchema,
  pacsQuerySchema,
  uploadUrlSchema,
} from '../../src/schemas/radiology';

// ─── Imaging Type ────────────────────────────────────────────────────────────

describe('createImagingTypeSchema', () => {
  it('accepts valid imaging type', () => {
    const r = createImagingTypeSchema.safeParse({ name: 'X-Ray', code: 'XR', description: 'X-ray imaging' });
    expect(r.success).toBe(true);
  });

  it('requires name', () => {
    const r = createImagingTypeSchema.safeParse({ code: 'XR' });
    expect(r.success).toBe(false);
  });

  it('rejects name shorter than 1 char', () => {
    const r = createImagingTypeSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('updateImagingTypeSchema', () => {
  it('accepts partial update', () => {
    const r = updateImagingTypeSchema.safeParse({ name: 'CT Scan' });
    expect(r.success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    const r = updateImagingTypeSchema.safeParse({});
    expect(r.success).toBe(true);
  });
});

// ─── Imaging Item ────────────────────────────────────────────────────────────

describe('createImagingItemSchema', () => {
  it('accepts valid item', () => {
    const r = createImagingItemSchema.safeParse({
      imaging_type_id: 1,
      name: 'Chest X-Ray PA View',
      procedure_code: 'CXR-PA',
      price_paisa: 50000,
    });
    expect(r.success).toBe(true);
  });

  it('requires imaging_type_id and name', () => {
    const r = createImagingItemSchema.safeParse({ name: 'Test' });
    expect(r.success).toBe(false);
  });

  it('rejects negative price', () => {
    const r = createImagingItemSchema.safeParse({
      imaging_type_id: 1, name: 'Test', price_paisa: -100,
    });
    expect(r.success).toBe(false);
  });
});

// ─── Requisition ─────────────────────────────────────────────────────────────

describe('createRequisitionSchema', () => {
  it('accepts minimal valid requisition', () => {
    const r = createRequisitionSchema.safeParse({ patient_id: 5 });
    expect(r.success).toBe(true);
  });

  it('accepts full requisition', () => {
    const r = createRequisitionSchema.safeParse({
      patient_id: 5,
      visit_id: 10,
      imaging_type_id: 1,
      imaging_item_id: 2,
      urgency: 'stat',
      imaging_date: '2025-03-18',
      prescriber_name: 'Dr. Rahman',
    });
    expect(r.success).toBe(true);
  });

  it('requires patient_id', () => {
    const r = createRequisitionSchema.safeParse({ imaging_type_id: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects invalid urgency', () => {
    const r = createRequisitionSchema.safeParse({ patient_id: 5, urgency: 'super-critical' });
    expect(r.success).toBe(false);
  });
});

describe('uploadUrlSchema', () => {
  it('accepts empty body (all optional)', () => {
    expect(uploadUrlSchema.safeParse({}).success).toBe(true);
  });

  it('accepts file_name and content_type', () => {
    const r = uploadUrlSchema.safeParse({ file_name: 'scan.dcm', content_type: 'application/dicom' });
    expect(r.success).toBe(true);
  });

  it('rejects file_name over 255 chars', () => {
    expect(uploadUrlSchema.safeParse({ file_name: 'x'.repeat(256) }).success).toBe(false);
  });
});

describe('markScannedSchema', () => {
  it('accepts empty body (all optional)', () => {
    expect(markScannedSchema.safeParse({}).success).toBe(true);
  });

  it('accepts scan data with film info', () => {
    const r = markScannedSchema.safeParse({
      film_type_id: 3,
      film_quantity: 2,
      scan_remarks: 'Good quality',
    });
    expect(r.success).toBe(true);
  });
});

// ─── Report ──────────────────────────────────────────────────────────────────

describe('createReportSchema', () => {
  it('accepts minimal report', () => {
    const r = createReportSchema.safeParse({ requisition_id: 1, patient_id: 5 });
    expect(r.success).toBe(true);
  });

  it('requires requisition_id and patient_id', () => {
    const r = createReportSchema.safeParse({ report_text: 'Normal' });
    expect(r.success).toBe(false);
  });

  it('accepts order_status pending or final', () => {
    expect(createReportSchema.safeParse({ requisition_id: 1, patient_id: 5, order_status: 'final' }).success).toBe(true);
    expect(createReportSchema.safeParse({ requisition_id: 1, patient_id: 5, order_status: 'pending' }).success).toBe(true);
  });

  it('rejects invalid order_status', () => {
    expect(createReportSchema.safeParse({ requisition_id: 1, patient_id: 5, order_status: 'draft' }).success).toBe(false);
  });
});

// ─── Report Template ──────────────────────────────────────────────────────────

describe('createReportTemplateSchema', () => {
  it('accepts valid template', () => {
    const r = createReportTemplateSchema.safeParse({
      name: 'CXR Template',
      template_html: '<p>{{findings}}</p>',
    });
    expect(r.success).toBe(true);
  });

  it('requires name', () => {
    expect(createReportTemplateSchema.safeParse({ template_html: '<p>' }).success).toBe(false);
  });
});

// ─── Film Type ────────────────────────────────────────────────────────────────

describe('createFilmTypeSchema', () => {
  it('accepts valid film type', () => {
    const r = createFilmTypeSchema.safeParse({ film_type: '8x10', display_name: '8×10 inches' });
    expect(r.success).toBe(true);
  });

  it('requires film_type', () => {
    expect(createFilmTypeSchema.safeParse({ display_name: 'Large' }).success).toBe(false);
  });
});

// ─── DICOM Study ─────────────────────────────────────────────────────────────

describe('createDicomStudySchema', () => {
  it('accepts valid study', () => {
    const r = createDicomStudySchema.safeParse({
      study_instance_uid: '1.2.840.10008.1.2.1',
      modality: 'CR',
      study_date: '2025-03-18',
    });
    expect(r.success).toBe(true);
  });

  it('requires study_instance_uid', () => {
    expect(createDicomStudySchema.safeParse({ modality: 'CT' }).success).toBe(false);
  });
});

// ─── Query Schemas ────────────────────────────────────────────────────────────

describe('requisitionQuerySchema', () => {
  it('applies defaults', () => {
    const r = requisitionQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(20);
    }
  });

  it('coerces page/limit strings', () => {
    const r = requisitionQuerySchema.safeParse({ page: '2', limit: '10' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(10);
    }
  });

  it('rejects page 0', () => {
    expect(requisitionQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('caps limit at 100', () => {
    expect(requisitionQuerySchema.safeParse({ limit: '200' }).success).toBe(false);
  });

  it('filters by valid status', () => {
    expect(requisitionQuerySchema.safeParse({ status: 'pending' }).success).toBe(true);
  });

  it('rejects invalid urgency', () => {
    expect(requisitionQuerySchema.safeParse({ urgency: 'flash' }).success).toBe(false);
  });
});

describe('reportQuerySchema', () => {
  it('applies defaults', () => {
    const r = reportQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(20);
    }
  });
});

describe('pacsQuerySchema', () => {
  it('applies defaults', () => {
    const r = pacsQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(20);
    }
  });

  it('accepts modality filter', () => {
    const r = pacsQuerySchema.safeParse({ modality: 'MRI' });
    expect(r.success).toBe(true);
  });
});
