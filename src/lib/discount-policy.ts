import { HTTPException } from 'hono/http-exception';

export const HIGH_DISCOUNT_REFERRAL_THRESHOLD_PERCENT = 20;

export function calculateDiscountPercent(subtotal: number, discount: number): number {
  if (subtotal <= 0 || discount <= 0) return 0;
  return (discount / subtotal) * 100;
}

export function isHighDiscount(subtotal: number, discount: number): boolean {
  return calculateDiscountPercent(subtotal, discount) > HIGH_DISCOUNT_REFERRAL_THRESHOLD_PERCENT;
}

export function hasDiscountReferralName(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function assertDiscountReferralNameForHighDiscount(
  subtotal: number,
  discount: number,
  discountByName?: string | null,
): void {
  if (discount > 0 && !hasDiscountReferralName(discountByName)) {
    throw new HTTPException(400, { message: 'Discount referred by name is required when discount is applied.' });
  }
}

