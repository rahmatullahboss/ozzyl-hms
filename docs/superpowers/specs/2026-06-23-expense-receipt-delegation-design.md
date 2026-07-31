# Expense Receipt Delegation and WebP Upload Design

Date: 2026-06-23
Status: Approved for implementation

## Goal

Allow hospital admins to delegate voucher/receipt photo upload responsibility without giving full expense approval access, and make browser uploads compress images to WebP before they are sent to the API.

## Design

The backend will use a dedicated fine-grained permission, `expenses.receipts.upload`, instead of treating all expense writers as receipt uploaders. Admin, MD, and Director keep approval powers. Accountant receives default receipt-upload power. Any other staff member can receive the permission through existing user permission overrides.

A new receipt queue endpoint will expose only the fields needed for receipt work: id, date, category, amount, description, payee, created-by display name, receipt status, rejection reason, and timestamps. It is separate from the full expense list so delegated uploaders do not need broad finance visibility.

The frontend expense page will use the existing browser canvas compression utility through a receipt-specific helper that always returns a `.webp` `File`. The upload form will send that WebP file in `FormData`; authorization still remains server-side.

## Security rules

- Receipt upload permission does not allow approval, verification, cash execution, amount edit, or full audit visibility.
- Final expense approval stays limited to hospital admin, MD, and director.
- Verification/rejection stays limited to approval roles in this iteration.
- Server-side permission checks remain authoritative.
- Receipt file metadata stays in D1; binary data stays in R2.

## Tests

- API test for delegated manager/user permission upload.
- API test for receipt queue access and limited query purpose.
- API test that reception cannot upload by default.
- Frontend utility test that receipt upload preparation produces a WebP File.
