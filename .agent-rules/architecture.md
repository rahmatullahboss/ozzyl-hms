# Architecture Rules

This system is Cloudflare-native and must remain edge-first, modular, and scalable.

## Core principles

- Keep the critical request path small and fast.
- Heavy work must not run in synchronous request handlers.
- Every storage layer must have a clear responsibility.
- Shared mutable state requires coordination-aware design.
- Serverless does not remove bottlenecks; design for scale explicitly.

## Default service mapping

- Workers: API/BFF, auth checks, validation, orchestration
- Durable Objects: coordination, locks, hot shared state, websocket session control
- D1: relational operational data
- KV: global read-heavy cache/config
- R2: file/object storage
- Queues: async, retryable, slow, bursty jobs
- Vectorize: semantic retrieval only where needed

## Do not

- build a monolithic Worker
- use one storage system for everything
- put heavy jobs in the request path
- assume edge runtime alone solves performance
