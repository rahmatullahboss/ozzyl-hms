# Booking and Realtime Rules

## Booking

- slot truth belongs in relational storage
- slot locking and contention control should use Durable Objects
- confirmation, notifications, external sync, and retries should be async
- write paths must be idempotent

## Realtime

Use realtime only where it materially improves UX:

- booking status
- queue/token updates
- presence/chat where needed
- important live notifications

## Do not

- make every screen realtime
- allow concurrent booking writes without coordination
- block the user response on downstream sync
