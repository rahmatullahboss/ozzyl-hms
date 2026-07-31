import { z } from 'zod';

const imageTypes = ['xray', 'ct', 'mri', 'ultrasound', 'photo', 'wound', 'eye', 'dental', 'ecg', 'pathology', 'other'] as const;

export const createImageSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  imageType: z.enum(imageTypes).default('other'),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  fileKey: z.string().min(1).max(1000),
  fileName: z.string().max(500).optional(),
  fileSize: z.number().int().min(0).optional(),
  mimeType: z.string().max(100).optional(),
  bodyPart: z.string().max(200).optional(),
});

export const updateImageSchema = z.object({
  imageType: z.enum(imageTypes).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  bodyPart: z.string().max(200).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
