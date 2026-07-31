-- Enforce discount referral capture for any bill with more than 20% discount.
-- Uses net total + discount - tax as a safe bill-level subtotal approximation so
-- direct SQL/API bypasses cannot silently save missing discount_by_name.

DROP TRIGGER IF EXISTS bills_high_discount_ref_required_insert;
CREATE TRIGGER bills_high_discount_ref_required_insert
BEFORE INSERT ON bills
WHEN COALESCE(NEW.discount, 0) > 0
  AND TRIM(COALESCE(NEW.discount_by_name, '')) = ''
  AND (
    COALESCE(NEW.discount, 0) * 100.0 /
    NULLIF(
      COALESCE(NEW.total, 0) + COALESCE(NEW.discount, 0) - COALESCE(NEW.tax_total, 0),
      0
    )
  ) > 20
BEGIN
  SELECT RAISE(ABORT, 'Discount referred by name is required when discount is above 20%');
END;

DROP TRIGGER IF EXISTS bills_high_discount_ref_required_update;
CREATE TRIGGER bills_high_discount_ref_required_update
BEFORE UPDATE OF total, discount, discount_by_name, tax_total ON bills
WHEN COALESCE(NEW.discount, 0) > 0
  AND TRIM(COALESCE(NEW.discount_by_name, '')) = ''
  AND (
    COALESCE(NEW.discount, 0) * 100.0 /
    NULLIF(
      COALESCE(NEW.total, 0) + COALESCE(NEW.discount, 0) - COALESCE(NEW.tax_total, 0),
      0
    )
  ) > 20
BEGIN
  SELECT RAISE(ABORT, 'Discount referred by name is required when discount is above 20%');
END;
