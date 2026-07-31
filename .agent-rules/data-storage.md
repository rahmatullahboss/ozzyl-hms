# Data Storage Rules

## Use D1 for

- users
- providers
- hospitals
- appointments
- metadata for records, reports, prescriptions
- consent records
- access mappings
- audit references

## Use Durable Objects for

- slot locking
- write serialization on hot entities
- queue/session coordination
- realtime room state
- presence
- idempotency coordination where contention exists

## Use KV for

- cached provider directory
- hospital catalog snapshots
- feature flags
- region config
- read-heavy lookup tables

KV is not the source of truth for consistency-sensitive data.

## Use R2 for

- report PDFs
- prescription images
- uploads
- generated exports
- attachments
- thumbnails

## Do not

- store binary files in D1
- use KV as booking truth
- use Durable Objects as default CRUD storage
- mix authoritative state across layers without explicit ownership
