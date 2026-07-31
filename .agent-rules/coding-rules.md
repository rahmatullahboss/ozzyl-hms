# Coding Rules

## General

- prefer small, modular changes
- preserve existing architecture boundaries
- do not rewrite unrelated code
- explain architectural impact briefly when making non-trivial changes

## Organization

Use domain-oriented structure where possible:

- auth
- users
- providers
- hospitals
- appointments
- health-records
- reports
- pharmacy
- notifications
- ai-buddy
- audit

## Before coding

Ask internally:

- what is the source of truth?
- is this hot path or async?
- which Cloudflare service is the right fit?
- does this require coordination or simple CRUD?
- does this touch sensitive data?
- does this accidentally turn AI into a medical advisor?

If unclear, propose the design before implementing.
