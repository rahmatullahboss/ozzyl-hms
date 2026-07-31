# Approval Center Info Request Specification

Date: 2026-06-30
Project: Hms connect

## Purpose

This phase makes the Request Info loop visible in Approval Center without a database migration. The approval remains pending, while the visible state is derived from approval event history.

## Workflow

Reviewer asks for more information, the system records a request info event, and the row shows Needs info. The requester submits notes or proof, the system records an info submitted event, and the row shows Info submitted. The reviewer then approves or rejects through the existing audited review flow.

## Derived fields

The list API should return info request status, requested time, requested by, request note, missing items, submitted time, submitted by, and response note.

Status rules: no request event is not requested; latest request with no later response is requested; later response is submitted; a newer request moves it back to requested.

## Endpoint

Add POST /api/approvals/:id/submit-info. It accepts notes and optional proof references. It requires an approval request role, works only for pending approvals, requires at least one note or proof reference, merges proof references into request data, and records an info submitted event.

## UI requirements

Add a Needs Info KPI, a Needs info quick filter, list badges for Needs info and Info submitted, and an Information Request section in the drawer. Quick approve is blocked while the row is waiting for information.

## Non-goals

No database migration, no persisted needs-info status, no file upload engine, no notification engine, and no multi-level approval engine in this phase.

## Acceptance criteria

Request info state is visible and filterable. Summary counts waiting and submitted info states. The submit-info endpoint records an audit event. Submitted proof references can satisfy evidence detection. Targeted backend and frontend tests pass.
