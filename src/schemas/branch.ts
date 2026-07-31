import { z } from 'zod';

export const createBranchSchema = z.object({
  name:    z.string().min(1, 'Branch name required').max(100),
  address: z.string().max(255).optional(),
  phone:   z.string().max(20).optional(),
  email:   z.string().email('Invalid email').optional(),
});

export const updateBranchSchema = createBranchSchema.partial();
