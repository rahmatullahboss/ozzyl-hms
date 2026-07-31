import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// Imaging Type
// ═══════════════════════════════════════════════════════════════════════════════

export const createImagingTypeSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().max(20).optional(),
  description: z.string().max(500).optional(),
});

export const updateImagingTypeSchema = createImagingTypeSchema.partial();

// ═══════════════════════════════════════════════════════════════════════════════
// Imaging Item
// ═══════════════════════════════════════════════════════════════════════════════

export const createImagingItemSchema = z.object({
  imaging_type_id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  procedure_code: z.string().max(50).optional(),
  template_id: z.number().int().positive().optional(),
  price_paisa: z.number().int().min(0).optional(),
  is_valid_reporting: z.boolean().optional().default(true),
});

// F-04 FIX: Omit imaging_type_id from update — can't change FK after creation
export const updateImagingItemSchema = createImagingItemSchema.partial().omit({ imaging_type_id: true });

// ═══════════════════════════════════════════════════════════════════════════════
// Report Template
// ═══════════════════════════════════════════════════════════════════════════════

export const createReportTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  // F-08 FIX: Strip <script> tags from template HTML to prevent stored XSS
  template_html: z.string().transform(v => v.replace(/<script[\s\S]*?<\/script>/gi, '')).optional(),
  footer_note: z.string().max(500).optional(),
});

export const updateReportTemplateSchema = createReportTemplateSchema.partial();

// ═══════════════════════════════════════════════════════════════════════════════
// Film Type
// ═══════════════════════════════════════════════════════════════════════════════

export const createFilmTypeSchema = z.object({
  film_type: z.string().min(1).max(100),
  display_name: z.string().max(100).optional(),
  imaging_type_id: z.number().int().positive().optional(),
});

export const updateFilmTypeSchema = createFilmTypeSchema.partial();

// ═══════════════════════════════════════════════════════════════════════════════
// Requisition (Imaging Order)
// ═══════════════════════════════════════════════════════════════════════════════

export const createRequisitionSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  imaging_type_id: z.number().int().positive().optional(),
  imaging_type_name: z.string().max(100).optional(),
  imaging_item_id: z.number().int().positive().optional(),
  imaging_item_name: z.string().max(200).optional(),
  procedure_code: z.string().max(50).optional(),
  prescriber_id: z.number().int().positive().optional(),
  prescriber_name: z.string().max(200).optional(),
  imaging_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  requisition_remarks: z.string().max(500).optional(),
  urgency: z.enum(['normal', 'urgent', 'stat']).optional().default('normal'),
  ward_name: z.string().max(100).optional(),
  has_insurance: z.boolean().optional().default(false),
  // P0-17: idempotency key (server-side fallback generated if absent).
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const updateRequisitionStatusSchema = z.object({
  order_status: z.enum(['pending', 'scanned', 'reported', 'cancelled']),
});

export const markScannedSchema = z.object({
  scan_remarks: z.string().max(500).optional(),
  film_type_id: z.number().int().positive().optional(),
  film_quantity: z.number().int().min(0).optional(),
});

export const cancelRequisitionSchema = z.object({
  cancel_remarks: z.string().max(500).optional(),
});

export const requisitionQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'scanned', 'reported', 'cancelled']).optional(),
  patient_id: z.coerce.number().int().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  urgency: z.enum(['normal', 'urgent', 'stat']).optional(),
  // F-12: Server-side search support
  search: z.string().max(200).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Radiology Report
// ═══════════════════════════════════════════════════════════════════════════════

export const createReportSchema = z.object({
  requisition_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  imaging_type_id: z.number().int().positive().optional(),
  imaging_type_name: z.string().max(100).optional(),
  imaging_item_id: z.number().int().positive().optional(),
  imaging_item_name: z.string().max(200).optional(),
  prescriber_id: z.number().int().positive().optional(),
  prescriber_name: z.string().max(200).optional(),
  performer_id: z.number().int().positive().optional(),
  performer_name: z.string().max(200).optional(),
  template_id: z.number().int().positive().optional(),
  report_text: z.string().optional(),
  indication: z.string().max(500).optional(),
  radiology_number: z.string().max(50).optional(),
  image_key: z.string().optional(),
  patient_study_id: z.number().int().positive().optional(),
  signatories: z.string().optional(),  // JSON string
  order_status: z.enum(['pending', 'final']).optional().default('pending'),
});

export const updateReportSchema = createReportSchema.partial().omit({
  requisition_id: true,
  patient_id: true,
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  patient_id: z.coerce.number().int().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  order_status: z.enum(['pending', 'final']).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PACS DICOM Study
// ═══════════════════════════════════════════════════════════════════════════════

export const createDicomStudySchema = z.object({
  patient_id: z.number().int().positive().optional(),
  patient_name: z.string().max(200).optional(),
  study_instance_uid: z.string().min(1),
  sop_class_uid: z.string().optional(),
  study_date: z.string().optional(),
  modality: z.string().max(10).optional(),
  study_description: z.string().max(500).optional(),
  requisition_id: z.number().int().positive().optional(),
});

export const pacsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  patient_id: z.coerce.number().int().optional(),
  modality: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

export const uploadUrlSchema = z.object({
  file_name: z.string().max(255).optional(),
  content_type: z.string().max(100).optional(),
});
