# Browser Processing Rules

Use the browser/device for performance-enhancing preprocessing, not authoritative business truth.

## Allowed browser-side tasks

- image compression
- crop, resize, rotate
- PDF preview generation
- thumbnail generation
- chart rendering
- OCR pre-cleaning
- local draft autosave
- optimistic UI
- upload preparation
- offline queueing where appropriate

## Do not trust browser for

- final booking confirmation
- payment truth
- authorization decisions
- audit truth
- lock state
- sensitive policy enforcement

## File handling

- upload directly to R2 when possible
- do not proxy large files through Workers unless necessary
- heavy client-side processing should use background-safe methods when possible
