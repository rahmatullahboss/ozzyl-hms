# Doctor Performance Visit Collection Design

## Goal

Show each doctor's visit collection amount in the Doctor Performance table for the selected dashboard reporting period.

## Current State

The executive doctor-performance API and frontend type contract already expose `visitCollection` per doctor and already support server sorting with `sortBy=visitCollection`. The Doctor Performance table renders visit count and test collection but omits the visit collection field.

## Design

Add a sortable `Visit Collection` column immediately after `Visits`. Render `doctor.visitCollection` using the existing BDT money formatter. Selecting the header calls `onSortChange('visitCollection')`, so the current server-side sorting and pagination flow remains unchanged.

The table minimum width will be increased slightly to preserve readable spacing. No API, database, canonical authority, migration, or calculation changes are required.

## Verification

Update the component test to require the new column, its formatted value, and the `visitCollection` sort callback. Run the focused component suite, TypeScript validation, and the relevant dashboard tests.
