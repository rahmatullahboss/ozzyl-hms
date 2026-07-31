# Performance Rules

## Performance priorities

1. Remove unnecessary work
2. Cache where possible
3. Precompute where useful
4. Offload heavy work to async systems
5. Use browser-side preprocessing where safe
6. Keep hot paths tiny

## Hot path rules

- no OCR in request path
- no PDF rendering in request path
- no large fan-out in request path
- no full-history AI generation in request path
- no heavy external sync in request path

## Always prefer

- indexed queries
- small payloads
- precomputed dashboard summaries
- signed file URLs instead of file proxying
- cache-backed reads for common views

## Avoid

- full scans on hot routes
- large joins on latency-sensitive requests
- repeated queries in loops
- unnecessary realtime everywhere
