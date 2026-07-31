# First Hospital Go-Live Checklist

Use this checklist before onboarding the first real hospital.

## Tenant Setup

- hospital tenant created
- hospital code finalized
- local MRN prefix finalized
- departments configured
- branches configured if needed
- print templates configured
- SMS/email sender configured or explicitly disabled

## Staff Setup

- hospital admin account
- reception accounts
- doctor accounts
- nurse accounts
- lab accounts
- pharmacist accounts
- billing/accounts accounts
- director/MD account
- no shared admin login for daily operation

## Workflow Rehearsal

- create 10 demo patients
- search before create
- duplicate patient warning
- local MRN generation
- appointment and queue
- encounter
- prescription draft and finalization
- lab order and report
- bill and payment
- deposit and refund
- document upload/download
- audit log review
- emergency access with reason

## Launch Policy

Enable for Phase 1:

- registration
- patient search
- appointment/queue
- encounter
- prescription
- lab
- billing/payment
- audit
- basic consent
- patient card/QR

Keep limited/off until separately approved:

- cross-hospital sharing
- automatic merge
- large-scale patient app claiming
- external API
- AI medical recommendation
- marketplace/referral sharing
