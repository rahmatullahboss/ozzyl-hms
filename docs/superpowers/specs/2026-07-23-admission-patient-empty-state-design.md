# Admission Patient Empty-State Highlight Design

## Goal

Make the IPD admission patient-search empty state immediately noticeable and clearly actionable when no saved patient matches the entered name, mobile number, or patient ID.

## Current State

The admission modal shows a plain text button reading “No saved patient. Register new patient.” The registration flow and prefilled search value work correctly, but the action has weak visual hierarchy and can be overlooked.

## Design

Keep the existing search, patient-selection, return-modal, and new-patient prefilling behavior unchanged. Replace the plain empty-state content with an amber notice/action card inside the existing button:

- high-contrast amber border and background;
- `UserPlus` icon in a distinct circular container;
- bold “No saved patient found” headline;
- short instruction explaining that registration is required to continue admission;
- prominent “Register new patient” action label.

The whole highlighted card remains one keyboard-accessible button, preserving the current click handler and focus behavior. English and Bangla copy will use the existing reception translation namespace.

## Verification

Add a regression assertion covering the highlighted classes, translated headline/guidance/action keys, and icon. Run the Reception Dashboard test suite together with the Doctor Performance tests and TypeScript validation.
