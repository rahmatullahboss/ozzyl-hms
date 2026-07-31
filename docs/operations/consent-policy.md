# Consent Policy

Default rule: a hospital can access records it created for its own tenant. Other hospital or patient-app data requires patient consent, referral token, legal basis, or emergency break-glass access.

## Required Consent Types

- registration and data storage
- treatment data processing
- document upload/storage
- patient app claim
- cross-hospital sharing
- referral sharing
- emergency access notice

## Consent Record Requirements

- patient ID
- hospital/recipient
- purpose
- data scope
- start and end time
- status
- signed text/version snapshot
- patient or guardian signature metadata where applicable

## Withdrawal

Consent withdrawal must block future access. It must not delete historical audit logs or hospital-owned clinical records.
