# Approval Center Info Request Implementation Plan

Date: 2026-06-30
Spec: `docs/admin-command-center/approval-center-info-request-spec-2026-06-30.md`

## Approach

Implement the info-request loop as an event-derived workflow. This avoids a database migration and keeps the existing pending, approved, and rejected status model intact.

## Backend changes

1. Add a submit-info validation schema.
2. Add `info_submitted` to approval event actions.
3. Add helpers to derive info request state from approval events.
4. Enrich `GET /api/approvals` rows with info request fields.
5. Add `infoRequested` and `infoSubmitted` to `GET /api/approvals/summary`.
6. Add `POST /api/approvals/:id/submit-info`.
7. Preserve existing review, bulk review, side-effect, and cash handover flows.

## Frontend changes

1. Add info request fields to approval models.
2. Add Needs Info KPI and quick filter.
3. Show Needs info and Info submitted badges in the worklist.
4. Show Information Request details in the drawer.
5. Block quick approve while an approval is waiting for information.

## Tests

Backend:

- list derives requested and submitted states from event history
- summary counts requested and submitted states
- submit-info records an event and merges proof references
- submit-info rejects invalid or closed requests

Frontend:

- Needs Info KPI/filter works
- worklist and drawer show information request state
- quick approve is blocked while waiting for information

## Rollout

This is safe to roll out before schema-backed policy tables because the state is derived from existing event history and does not alter the approval status constraint.
