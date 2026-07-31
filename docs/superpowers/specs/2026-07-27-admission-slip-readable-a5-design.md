# Readable A5 Admission Slip Design

## Goal

Keep the complete admission slip on one A5 portrait page while making the printed text clearly readable and using the page height more evenly.

## Current problem

The current A5 density profile succeeds at one-page printing by reducing labels, values, headings, signatures, and footer text too aggressively. The result has a large unused area between signatures and footer, while important clinical and identity text is visually small.

## Approved design

### Typography

- Increase A5 label text from 7.5px to approximately 9px.
- Increase A5 detail values from 8.8px to approximately 10.5px with a readable line height.
- Increase section titles, patient summary values, signature labels, and footer text proportionally.
- Increase hospital identity, admission title, admission number, and admission metadata without changing the A4 profile.
- Preserve wrapping for long names, bed numbers, addresses, diagnoses, and doctor names. Do not truncate or hide content.

### Vertical layout

- Keep the A5 sheet fixed to 148mm × 210mm for print.
- Make the A5 body a vertical flex container.
- Keep patient summary and all information sections in normal document flow.
- Push the signature block toward the lower body area with adaptive auto spacing. When guardian or long-text sections consume more space, the auto gap collapses before content is allowed to overflow.
- Keep the footer at the bottom of the page without overlapping signatures.

### Information scope

Retain all current content:

- Hospital branding and admission metadata
- Patient summary: patient name, patient ID, ward/cabin, bed
- Patient information
- Admission details
- Optional guardian/care-of section
- Three signature lines
- Hospital footer and thank-you text

No fields will be removed, duplicated, clipped, or moved to a second page for the representative complete dataset.

### Paper-size isolation

- Apply the readability changes only to `.invoice-paper-a5`.
- Preserve the existing A4 styling and behavior.
- Preserve the existing print iframe and paper-size selection behavior.

## Verification requirements

1. Source contract test confirms the readable A5 typography and adaptive signature layout.
2. Playwright PDF regression with patient, admission, guardian, signatures, and full footer produces exactly one A5 page.
3. The same PDF regression verifies:
   - detail value font size is at least 10px;
   - detail label font size is at least 8.5px;
   - signature block does not overlap the footer;
   - footer stays inside the page;
   - content does not overflow the fixed A5 sheet.
4. Admission slip unit tests, TypeScript check, and production web build pass.
