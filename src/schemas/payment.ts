import { z } from 'zod';

export const initiatePaymentSchema = z.object({
  billId:      z.number().int().positive('Bill ID required'),
  amount:      z.number().positive('Amount must be positive'),
  gateway:     z.enum(['bkash', 'nagad'], { message: 'Gateway must be bkash or nagad' }),
  callbackUrl: z.string().url('Invalid callback URL'),
});
