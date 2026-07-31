# Category-Aware A5/A4 Invoice Redesign

**Date:** 2026-06-09
**Status:** Approved
**Scope:** Doctor consultation and diagnostic test invoices rendered by `BillPrint`

## Goal

Redesign the existing bill print page so doctor consultation invoices and
diagnostic test invoices follow the supplied hospital invoice references while
remaining tenant-branded, data-driven, bilingual, and suitable for both A5 and
A4 portrait printing.

The design must use each hospital's configured logo and profile information.
Missing hospital fields must be omitted without placeholder text. If an admin
adds a missing field later in Settings, subsequent invoice renders must show it
automatically.

## Confirmed Decisions

- Use two category-aware layouts:
  - doctor consultation invoices use an appointment-focused design;
  - diagnostic test invoices use a test-list-focused design.
- Keep a conservative generic layout for mixed or unsupported invoice types.
- Default paper size is A5 portrait.
- Users can select A5 or A4 from the print action bar.
- The last selected paper size is remembered in browser storage.
- Hospital identity and contact data come from `/api/settings`.
- Do not show fake values, empty labels, sample hospital data, or sample QR
  codes.
- QR code is out of scope until there is a real secure appointment/report URL.
- Preserve English/Bengali invoice language selection.

## Source of Truth

### Hospital branding

`GET /api/settings` remains the source of truth:

- `settings.hospital_logo_url`
- `hospital_info.name`
- `hospital_info.tagline`
- `hospital_info.address`
- `hospital_info.phone`
- `hospital_info.email`
- `hospital_info.website`
- `hospital_info.registration_number`
- `hospital_info.bin_tin`
- `hospital_info.footer_text`

The invoice renderer must conditionally render each optional value. The tenant
name/local session remains only the fallback for the hospital name.

### Bill and clinical context

`GET /api/billing/:id` remains the source of truth for:

- bill number, issue date, status, totals, discount, paid amount, and due;
- patient name, patient code, mobile, address, age, and gender;
- invoice items and categories;
- payment method, receipt, receiver, and payment date;
- visit serial and referral source.

For consultation invoices, extend the existing tenant-scoped bill query with
appointment and doctor display fields:

- appointment number;
- appointment date and time;
- doctor name;
- doctor specialty;
- doctor department.

These fields are read through the bill's existing `visit_id` relationship:
`bills -> visits -> appointments -> doctors`. No schema migration is required.

## Category Selection

Determine the layout from normalized invoice item categories:

- consultation layout: all meaningful items are `doctor_visit`,
  `consultation`, `opd`, or `visit`;
- diagnostic layout: all meaningful items are `test`, `lab`, `laboratory`,
  `radiology`, `scan`, or `imaging`;
- generic layout: mixed categories or categories outside those groups.

The category helper should expose a layout key as well as the existing
localized banner label so classification is tested independently of JSX.

## Shared Visual System

Both specialized layouts use the same restrained hospital visual language:

- white canvas with navy body text;
- teal accent derived from the supplied references;
- rounded teal invoice-number pill;
- thin teal separators;
- compact icon-and-label metadata blocks;
- teal table header with print-color preservation;
- pale teal payment and total panels;
- no decorative sample logo, watermark, or hardcoded hospital name;
- clear spacing that remains readable when reduced to A5.

Use `lucide-react` icons already available in the web app. Icons are supporting
decoration only; every value retains a visible text label.

## Shared Header

The header has two columns:

1. Hospital identity:
   - configured logo when present;
   - hospital name;
   - tagline when present;
   - compact address/contact line when space permits.
2. Invoice identity:
   - large `INVOICE` title;
   - invoice number in a teal pill;
   - issue date;
   - appointment number for consultation bills when present.

If the logo is missing, the hospital name aligns to the left edge without an
empty logo frame. If optional text is missing, the surrounding spacing
collapses.

## Doctor Consultation Layout

### Patient and appointment summary

Render a two-column section inspired by the supplied doctor invoice:

- `Bill To`
  - patient name;
  - address, mobile, and patient code when present;
  - age/gender when present.
- `Appointment Details`
  - doctor;
  - specialty;
  - department;
  - appointment date;
  - appointment time;
  - visit serial.

Do not invent a location field. Hospital address already appears in the
branding/footer and can serve as the location when configured.

### Consultation item table

Use a compact table with:

- serial;
- description;
- quantity when needed;
- amount.

The description comes from the invoice item. Doctor/specialty context can
appear as a secondary line only when it adds information not already present.

## Diagnostic Test Layout

### Patient/referral summary

Render a compact metadata strip inspired by the supplied test invoice:

- patient name;
- patient code;
- age/gender;
- referred by, when not self and a name exists;
- issue date.

Collection date and report delivery date are omitted because the current bill
payload does not guarantee those values. They must not be guessed from the
invoice date.

### Test table

Use a diagnostic-focused table with:

- serial;
- test name;
- description/category when a distinct value exists;
- amount.

Long test lists may continue onto additional printed pages. The table header
must repeat on each printed page, and rows must avoid splitting where the
browser supports `break-inside: avoid`.

## Totals and Payment

Both layouts share:

- subtotal;
- discount and discount metadata only when a discount exists;
- tax only when non-zero;
- total amount;
- paid amount;
- deposit adjustment when non-zero;
- due/outstanding amount when non-zero.

The payment section shows only available data:

- status;
- method;
- receipt/transaction number;
- payment date;
- received by;
- amount paid.

Paid invoices get a clear payment-success panel. Partial and unpaid invoices
get an equally prominent status panel with the actual due amount; they must not
use payment-success wording.

## Footer

The footer conditionally renders configured hospital information:

- phone;
- address;
- website;
- email;
- registration number and BIN/TIN;
- configured `footer_text`.

If none of these fields exists, render only the existing computer-generated
invoice note. Important-notes copy from the samples is not hardcoded because it
is hospital policy content, not invoice data.

## Paper Size and Pagination

Add a `paperSize` state with values `a5` and `a4`.

- Initial value: `localStorage.getItem('billPrintPaperSize')`, falling back to
  `a5`.
- Changing the toolbar selector updates state and local storage.
- Apply a root class such as `invoice-paper-a5` or `invoice-paper-a4`.
- Generate the active `@page` rule from component state:
  - A5: `size: A5 portrait; margin: 7mm`;
  - A4: `size: A4 portrait; margin: 12mm`.
- Screen preview width follows the selected sheet:
  - A5: approximately `148mm`;
  - A4: approximately `210mm`.

A5 is the compact baseline. A4 increases outer spacing and type scale slightly
without changing information order. It must not stretch the layout into a
sparse poster.

For print:

- hide dashboard chrome and action controls;
- remove card shadows and screen borders;
- preserve teal backgrounds with `print-color-adjust: exact`;
- repeat table headers;
- avoid breaking totals, payment, and footer panels across pages;
- let long diagnostic tables paginate naturally instead of shrinking text
  below readable size.

## Accessibility and Safety

- Keep semantic tables and visible labels.
- Use sufficient contrast in both color and monochrome printing.
- Status is communicated with text, not color alone.
- Existing tenant authorization on `/api/billing/:id` and `/api/settings`
  remains unchanged.
- Do not add patient data to logs, URLs, local storage, or QR payloads.
- Only the paper-size and language preferences are stored locally.

## Implementation Boundaries

Primary files:

- `web/src/pages/BillPrint.tsx`
- `web/src/pages/BillPrint.test.ts`
- `web/src/lib/print/invoiceCategory.ts`
- `web/src/lib/print/invoiceCategory.test.ts`
- `src/routes/tenant/billing.ts`
- focused billing route tests if an existing suitable test file is present

Small presentational components/helpers may be extracted from `BillPrint.tsx`
when they reduce duplication between the two specialized layouts. No database
migration and no print-template settings redesign are required.

## Test Strategy

Use test-first development for each behavior:

1. Category helper selects consultation, diagnostic, and generic layouts.
2. Paper-size preference defaults to A5 and accepts remembered A4.
3. Bill print exposes A5/A4 controls and active print-page CSS.
4. Hospital email, website, registration, BIN/TIN, and footer text are read
   from Settings and conditionally rendered.
5. Consultation response includes appointment and doctor display fields.
6. Consultation layout renders appointment details without placeholders.
7. Diagnostic layout renders referral/test metadata without fake collection or
   delivery dates.
8. Paid, partial, and unpaid status panels use accurate wording and amounts.

Verification:

- targeted web Vitest tests via `pnpm --dir web exec vitest ...`;
- targeted backend tests if the route contract is covered;
- `pnpm --filter web build`;
- browser preview of both category layouts at A5 and A4;
- print-preview inspection for a short consultation invoice and a long test
  invoice.

## Non-Goals

- QR code generation;
- report-result portal work;
- new collection/report-delivery scheduling fields;
- editing print templates from Settings;
- redesigning pharmacy, IPD, surgery, or mixed invoices;
- production deployment as part of this design phase.
