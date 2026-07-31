import { z } from 'zod';

// ─── Lab Test Categories ─────────────────────────────────────────────────────

export const createLabCategorySchema = z.object({
  category_name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});

export const updateLabCategorySchema = createLabCategorySchema.partial();

// ─── Lab Report Templates ───────────────────────────────────────────────────

export const createLabTemplateSchema = z.object({
  template_name: z.string().min(1).max(200),
  template_short_name: z.string().max(50).optional(),
  template_type: z.enum(['normal', 'culture', 'html']).default('normal'),
  template_html: z.string().optional(),
  header_text: z.string().optional(),
  footer_text: z.string().optional(),
  display_order: z.number().int().default(0),
});

export const updateLabTemplateSchema = createLabTemplateSchema.partial();

// ─── Lab Vendors ─────────────────────────────────────────────────────────────

export const createLabVendorSchema = z.object({
  vendor_code: z.string().max(50).optional(),
  vendor_name: z.string().min(1).max(200),
  is_external: z.boolean().default(false),
  contact_address: z.string().max(500).optional(),
  contact_no: z.string().max(20).optional(),
  email: z.string().email().optional(),
  remarks: z.string().max(500).optional(),
  is_default: z.boolean().default(false),
});

export const updateLabVendorSchema = createLabVendorSchema.partial();

// ─── Lab Run Number Settings ─────────────────────────────────────────────────

export const createRunNumberSettingsSchema = z.object({
  format_name: z.string().min(1).max(200),
  grouping_index: z.number().int().optional(),
  visit_type: z.string().max(50).optional(),
  run_number_type: z.string().max(50).optional(),
  reset_daily: z.boolean().default(false),
  reset_monthly: z.boolean().default(false),
  reset_yearly: z.boolean().default(false),
  starting_letter: z.string().max(10).optional(),
  format_initial_part: z.string().max(50).optional(),
  format_separator: z.string().max(5).default('-'),
  format_last_part: z.string().max(50).optional(),
  under_insurance: z.boolean().default(false),
});
