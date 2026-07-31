# Dashboard Modal and Drawer Accessibility Hardening

## Goal

Make dashboard overlays behave consistently for keyboard, screen-reader, mobile, and nested-overlay use without changing their business content or data flows.

## Scope

Harden these dashboard overlays:

- `DoctorPerformanceDrawer`
- `TestPerformanceDrawer`
- `KpiBreakdownDrawer`
- `DashboardKpiConfigurator`
- `PatientAgeDetailDrawer`

`InvoiceInspector` and `CommandPalette` remain separate higher-priority overlay layers. Their existing behavior is not redesigned.

## Chosen approach

Create one small shared dashboard-dialog layer utility instead of duplicating event listeners in every component or converting the application to native `<dialog>` elements.

The utility will provide:

1. Rendering through a body portal so dashboard overlays are not trapped by ancestor stacking contexts.
2. A stack-aware active-layer registry so only the topmost overlay handles Escape and Tab.
3. Initial focus inside the overlay and focus restoration to the opener after close.
4. Tab and Shift+Tab focus containment.
5. Reference-counted body scroll locking that remains correct when an invoice inspector opens above a dashboard drawer.
6. Shared overlay z-index constants: dashboard overlays below invoice inspection and command palette layers.

This is preferred over independent patches because independent listeners can conflict when overlays are nested. Native `<dialog>` is not selected because it would require a wider behavioral and styling migration unrelated to this bug.

## Component integration

Each overlay keeps its existing visual structure, close button, labels, tabs, queries, and callbacks. It receives:

- a dialog container ref,
- an initial-focus ref, normally the close button,
- the shared lifecycle behavior,
- the shared portal and dashboard overlay layer class.

Backdrop click will continue not to close the overlay, preserving current behavior and preventing accidental loss of unsaved configuration changes.

## Layering

- Standard dashboard modal/drawer: `z-[60]`
- Patient age detail drawer: `z-[68]` because it is already designed as a deeper dashboard detail view
- Invoice inspector: existing `z-[70]`
- Command palette: existing `z-[200]`

The portal removes ancestor stacking-context ambiguity while these values preserve intentional nested ordering.

## Error and edge-case behavior

- Escape closes only the topmost registered dashboard overlay.
- A parent drawer does not steal Tab focus while a nested higher overlay is active.
- When the nested overlay closes, focus returns to its opener inside the parent drawer.
- When the final overlay closes, the original body overflow style is restored exactly.
- If an overlay has no normally focusable element, its dialog container is temporarily focusable and receives focus.
- Disabled controls are excluded from the focus loop.

## Testing

Add focused tests for the shared utility and component integrations:

- Escape closes an open overlay.
- focus starts inside the dialog and returns to the trigger.
- Tab and Shift+Tab wrap within the dialog.
- body scroll is locked and restored.
- only the topmost nested overlay handles keyboard events.
- all scoped dashboard overlays use the shared portal/layer behavior and retain their accessible dialog labels.

Run focused component tests, relevant dashboard tests, TypeScript/Vite production build, then repeat verification after merging into `main`.
