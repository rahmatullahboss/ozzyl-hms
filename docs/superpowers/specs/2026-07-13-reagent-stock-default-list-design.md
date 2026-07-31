# Reagent Stock Default List Design

## Goal

Opening the Reagent Control **Stock** tab must immediately show every active reagent/consumable stock lot. The existing reagent selector becomes an optional filter instead of a prerequisite.

## Approved UX

- Default selector value: **All reagents and consumables**.
- Default table content: all active, non-expired lots across both supported ledgers.
- Selecting a reagent filters the table to that reagent only.
- Each row displays reagent name/code so an unfiltered list remains understandable.
- Existing lot actions remain available and continue to respect ledger-specific restrictions.
- Loading, empty, QC, expiry, open-vial, location, and machine-assignment states remain unchanged.

## API Design

Add `GET /api/lab-monitoring/stock/lots` with optional `consumable_id`.

Response:

```json
{
  "data": [
    {
      "id": 1,
      "consumable_id": 5,
      "consumable_name": "CBC Diluent",
      "consumable_code": "CBC-DIL",
      "consumable_unit": "mL",
      "ledger_type": "lab",
      "quantity_available": 10
    }
  ]
}
```

The endpoint combines legacy `lab_consumable_stock` lots and canonical `InventoryStock` lots. For consumables linked to canonical inventory, legacy shadow lots are excluded to match the existing consumable-detail behavior.

## Safety and Compatibility

- Tenant scoping is mandatory on every query.
- Only active consumables and positive-quantity, non-expired lots are returned.
- Failed/pending/blocked QC lots remain visible for review, matching the existing detail endpoint.
- Canonical-inventory queries retain fallbacks for installations with older inventory schemas.
- No database migration is required.

## Testing

- API integration test: unfiltered endpoint returns lots from multiple consumables and both ledgers, excludes canonical-linked shadow stock, and supports `consumable_id` filtering.
- UI render test: Stock tab shows all lots before any selection and uses the dropdown as a filter.
- Run the focused lab-monitoring UI and stock-lifecycle suites plus TypeScript/build verification.
