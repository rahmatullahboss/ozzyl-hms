import { z } from 'zod';

/** Website config schema for admin CRUD */
export const websiteConfigSchema = z.object({
  is_enabled: z.number().min(0).max(1).optional(),
  theme: z.enum(['arogyaseva', 'medtrust', 'carefirst', 'sunrise', 'oceanic', 'heritage', 'minimal', 'nature']).optional(),
  tagline: z.string().max(200).optional().nullable(),
  tagline_bn: z.string().max(200).optional().nullable(),
  about_text: z.string().max(5000).optional().nullable(),
  about_text_bn: z.string().max(5000).optional().nullable(),
  mission_text: z.string().max(2000).optional().nullable(),
  mission_text_bn: z.string().max(2000).optional().nullable(),
  founded_year: z.number().min(1800).max(2100).optional().nullable(),
  bed_count: z.number().min(0).max(10000).optional().nullable(),
  operating_hours: z.string().max(500).optional().nullable(),
  google_maps_embed: z.string().max(1000).optional().nullable(),
  whatsapp_number: z.string().max(20).optional().nullable(),
  facebook_url: z.string().url().max(500).optional().nullable(),
  emergency_number: z.string().max(20).optional().nullable(),
  ambulance_number: z.string().max(20).optional().nullable(),
  emergency_hours: z.string().max(100).optional().nullable(),
  seo_title: z.string().max(120).optional().nullable(),
  seo_description: z.string().max(300).optional().nullable(),
  seo_keywords: z.string().max(500).optional().nullable(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export type WebsiteConfigInput = z.infer<typeof websiteConfigSchema>;

/** Website service schema */
export const websiteServiceSchema = z.object({
  name: z.string().min(1).max(200),
  name_bn: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  icon: z.string().max(10).optional(),
  category: z.enum(['general', 'opd', 'ipd', 'lab', 'pharmacy', 'telemedicine', 'emergency']).optional(),
  is_active: z.number().min(0).max(1).optional(),
  sort_order: z.number().min(0).optional(),
});

export type WebsiteServiceInput = z.infer<typeof websiteServiceSchema>;

/** Blog post schema */
export const blogPostSchema = z.object({
  title: z.string().min(1).max(300),
  title_bn: z.string().max(300).optional().nullable(),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  content: z.string().min(1).max(50000),
  content_bn: z.string().max(50000).optional().nullable(),
  excerpt: z.string().max(500).optional().nullable(),
  excerpt_bn: z.string().max(500).optional().nullable(),
  featured_image_key: z.string().max(500).optional().nullable(),
  author_name: z.string().max(200).optional().nullable(),
  is_published: z.number().min(0).max(1).optional(),
  published_at: z.string().max(30).optional().nullable(),
});

export type BlogPostInput = z.infer<typeof blogPostSchema>;

/** Department schema */
export const departmentSchema = z.object({
  name: z.string().min(1).max(200),
  name_bn: z.string().max(200).optional().nullable(),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(2000).optional().nullable(),
  description_bn: z.string().max(2000).optional().nullable(),
  icon: z.string().max(10).optional(),
  image_key: z.string().max(500).optional().nullable(),
  is_active: z.number().min(0).max(1).optional(),
  sort_order: z.number().min(0).optional(),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;

/** Patient review schema (submission) */
export const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  review_text: z.string().max(2000).optional().nullable(),
});

export type ReviewInput = z.infer<typeof reviewSchema>;
