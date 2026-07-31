# Admission Slip Invoice-Style Print Design

## Goal

After a patient is admitted, open a dedicated admission-slip print preview that follows the current invoice print experience and remains available from the admissions list.

## Approved behaviour

- A successful admission redirects to an admission-slip print preview using the returned `admission_id`.
- The existing admissions-list action opens the same preview instead of the legacy popup template.
- The preview loads authoritative data from `GET /api/admissions/:id/slip` and hospital branding from `GET /api/settings`.
- The preview uses the invoice visual language: branded header, coloured identity pill, A5/A4 paper selector, English/Bangla selector, isolated iframe printing, and branded footer.
- The admission slip includes patient identity, contact and demographic details; admission date/type/source; ward, bed and bed type; attending/referral doctor; guardian; reason and provisional diagnosis; and signature areas.
- Deposit receipt behaviour remains unchanged. If a deposit is collected during admission, that receipt may still open separately while the admission flow navigates to the admission-slip preview.
- No backend schema change is required because the admission create response already returns `admission_id` and the slip endpoint already returns the required fields.

## Architecture

Add an `AdmissionSlipPrint` route and page beside `BillPrint`. A small path helper keeps hospital-admin and reception routes consistent. The page reuses `InvoiceBrandHeader`, `InvoiceFooter`, invoice paper settings, and the hidden-iframe print approach while providing admission-specific body markup and styles. `AdmissionIPD` only changes navigation behaviour; existing admission creation and deposit logic remain intact.

## Error handling

- Missing admission id or an unavailable slip displays an inline error card with a back action.
- If iframe creation fails, printing falls back to `window.print()`.
- Existing API and mutation errors remain unchanged.

## Verification

- Unit/source tests cover route generation, route registration, invoice-component reuse, iframe printing, successful-admission navigation, and list-action navigation.
- Run the focused Vitest files, TypeScript build, and inspect the final diff.
