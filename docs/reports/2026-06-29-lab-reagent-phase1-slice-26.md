Lab Reagent Inventory Phase 1 Slice 26

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Seed default lab test to reagent/consumable mappings for new hospitals so no-LIS reagent deduction works without every hospital starting from zero.

Research / product decision
- Exact raw reagent volumes in microliters or milliliters are analyzer, method, and kit-IFU specific.
- Therefore the default system seed uses a safer test-equivalent model: stock is received as number of tests in a kit/pack, and each billed test deducts 1 test-equivalent for each mapped reagent/component.
- Hospitals can override/delete/recreate mappings from the existing Lab Monitoring test-consumable mapping UI when their kit/analyzer SOP requires different quantities.

Completed
- Added src/lib/lab-reagent-defaults.ts.
- Added DEFAULT_LAB_TEST_REAGENT_PROFILES covering common starter tests:
  - CBC
  - ESR
  - RBS/FBS glucose
  - HbA1c
  - Serum Creatinine
  - Lipid Profile
  - LFT
  - KFT/RFT
  - TSH
- Seed creates missing lab_test_catalog rows when needed.
- Seed reuses existing hospital test aliases, for example FBS/Fasting Blood Sugar maps to GLUCOSE-REAGENT-TEST instead of creating a duplicate RBS test.
- Seed creates default lab_consumables in test-equivalent units.
- Seed creates lab_test_consumable_map rows idempotently.
- New hospital registration now calls seedLabReagentDefaults after billing/accounting defaults.
- Added regression tests for default seeding and registration provisioning contract.

Verification
- pnpm exec vitest run test/lab-reagent-defaults.test.ts: 1 file passed, 2 tests passed.
- pnpm exec vitest run test/lab-reagent-defaults.test.ts test/registration-seeding-contract.test.ts test/lab-consumable-stock-lifecycle-db.test.ts: 3 files passed, 19 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run: 679 files passed, 14,318 tests passed.

Default model examples
- CBC: CBC reagent pack test-equivalent + EDTA tube.
- RBS/FBS: glucose reagent test-equivalent.
- Lipid Profile: total cholesterol, triglycerides, HDL reagent test-equivalents.
- LFT: ALT, AST, ALP, bilirubin total/direct, total protein, albumin reagent test-equivalents.
- KFT/RFT: urea, creatinine, uric acid reagent test-equivalents.
- TSH/HbA1c: kit/cartridge test-equivalents.

Notes
- This intentionally avoids pretending that raw reagent volumes are universal. Real reagent volumes should be validated from analyzer/kit IFU or hospital SOP.
- Existing mapping management remains the override path. A future UX improvement should add inline edit for qty_per_test instead of delete/recreate.

Next
- Add tenant-level option to choose default deduction timing: billing-time for no-LIS, result-time for full LIS.
- Add inline edit support for qty_per_test in Lab Monitoring mapping UI.
