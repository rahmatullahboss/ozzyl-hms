import { describe, expect, it } from 'vitest';

describe('LabMonitoringDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LabMonitoringDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('identifies canonical inventory-backed stock lots and allowed action classes', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const inventoryLot = { ledger_type: 'inventory' };
    const legacyLot = { ledger_type: 'lab' };

    expect(mod.isInventoryBackedStockLot(inventoryLot)).toBe(true);
    expect(mod.isInventoryBackedStockLot(legacyLot)).toBe(false);
    expect(mod.isInventoryBackedStockLot({})).toBe(false);

    expect(mod.canUseLabMonitoringLotMetadataAction(inventoryLot)).toBe(true);
    expect(mod.canUseLabMonitoringLotMetadataAction(legacyLot)).toBe(true);
    expect(mod.canUseLegacyLabStockOnlyAction(inventoryLot)).toBe(false);
    expect(mod.canUseLegacyLabStockOnlyAction(legacyLot)).toBe(true);
  });

  it('builds canonical inventory action routes from the hospital base path', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.inventoryRoute('/h/demo', 'transfers')).toBe('/h/demo/inventory/transfers');
    expect(mod.inventoryRoute('/h/demo/', 'write-off')).toBe('/h/demo/inventory/write-off');
  });

  it('marks only QC-passed or not-required stock lots as production usable', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.isProductionUsableStockLot({ qc_status: 'passed' })).toBe(true);
    expect(mod.isProductionUsableStockLot({ qc_status: 'accepted' })).toBe(true);
    expect(mod.isProductionUsableStockLot({ qc_status: 'not_required' })).toBe(true);
    expect(mod.isProductionUsableStockLot({ qc_status: 'pending' })).toBe(false);
    expect(mod.isProductionUsableStockLot({ qc_status: 'failed' })).toBe(false);
    expect(mod.stockLotProductionLockLabel({ qc_status: 'pending' })).toBe('Production locked until QC Pass');
    expect(mod.stockLotProductionLockLabel({ qc_status: 'failed' })).toBe('Production blocked: QC failed');
    expect(text).toContain('Only QC Pass or not-required lots can be deducted. Failed and blocked lots stay visible for review.');
  });

  it('labels open-vial expiry monitoring states for reagent lots', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.stockLotOpenVialStatus({ opened_at: null, onboard_expires_at: null }, '2026-07-09')).toEqual({
      label: 'Not opened',
      tone: 'neutral',
    });
    expect(mod.stockLotOpenVialStatus({ opened_at: '2026-07-01', onboard_expires_at: '2026-07-08' }, '2026-07-09')).toEqual({
      label: 'Open-vial expired 2026-07-08',
      tone: 'danger',
    });
    expect(mod.stockLotOpenVialStatus({ opened_at: '2026-07-01', onboard_expires_at: '2026-07-09' }, '2026-07-09')).toEqual({
      label: 'Open-vial expires today',
      tone: 'warning',
    });
    expect(mod.stockLotOpenVialStatus({ opened_at: '2026-07-01', onboard_expires_at: '2026-07-31' }, '2026-07-09')).toEqual({
      label: 'Open-vial valid until 2026-07-31',
      tone: 'success',
    });
    expect(mod.bangladeshDateString(new Date('2026-07-08T18:30:00.000Z'))).toBe('2026-07-09');
    expect(text).toContain('data-testid="open-vial-expiry-status"');
    expect(text).toContain('Open vial → Days → Remarks → Open');
  });

  it('keeps open-vial form validation aligned with backend limits', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.isOpenVialFormReady({ stock_id: '44', onboard_expiry_days: '30', remarks: '', ledger_type: 'inventory' })).toBe(true);
    expect(mod.isOpenVialFormReady({ stock_id: '44', onboard_expiry_days: '366', remarks: '', ledger_type: 'inventory' })).toBe(false);
    expect(mod.isOpenVialFormReady({ stock_id: '44', onboard_expiry_days: '30', remarks: 'x'.repeat(501), ledger_type: 'inventory' })).toBe(false);
    expect(mod.isOpenVialFormReady({ stock_id: '44', onboard_expiry_days: '30', remarks: '', ledger_type: '' })).toBe(false);
    expect(text).toContain('max="365"');
    expect(text).toContain('maxLength={500}');
    expect(text).toContain('Ledger');
  });

  it('keeps analyzer assignment canonical-only with backend-aligned validation and operator guidance', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.isMachineAssignmentFormReady({ stock_id: '55', machine_id: '501', location_id: '', remarks: '' })).toBe(true);
    expect(mod.isMachineAssignmentFormReady({ stock_id: '55', machine_id: '', location_id: '7', remarks: '' })).toBe(true);
    expect(mod.isMachineAssignmentFormReady({ stock_id: '55', machine_id: '', location_id: '', remarks: '' })).toBe(false);
    expect(mod.isMachineAssignmentFormReady({ stock_id: 'abc', machine_id: '501', location_id: '', remarks: '' })).toBe(false);
    expect(mod.isMachineAssignmentFormReady({ stock_id: '55', machine_id: '501', location_id: '', remarks: 'x'.repeat(501) })).toBe(false);

    expect(text).toContain('Only canonical InventoryStock reagent lots can be assigned.');
    expect(text).toContain('Machine assignment is only for canonical InventoryStock reagent lots.');
    expect(text).toContain('InventoryStock lot ID');
    expect(text).toContain('CBC reagent loaded on Hematology Analyzer');
  });

  it('normalizes mandatory mapping values from API responses', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.isMandatoryMapping(true)).toBe(true);
    expect(mod.isMandatoryMapping(1)).toBe(true);
    expect(mod.isMandatoryMapping('1')).toBe(true);
    expect(mod.isMandatoryMapping('true')).toBe(true);
    expect(mod.isMandatoryMapping(false)).toBe(false);
    expect(mod.isMandatoryMapping(0)).toBe(false);
    expect(mod.isMandatoryMapping(null)).toBe(false);
  });

  it('flags analyzer health attention states', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.analyzerHealthNeedsAttention({ open_unmatched_results: 1, unassigned_inventory_lots: 0 })).toBe(true);
    expect(mod.analyzerHealthNeedsAttention({ open_unmatched_results: 0, unassigned_inventory_lots: 2 })).toBe(true);
    expect(mod.analyzerHealthNeedsAttention({ open_unmatched_results: 0, unassigned_inventory_lots: 0 })).toBe(false);
    expect(mod.analyzerHealthNeedsAttention(null)).toBe(false);
  });

  it('flags machine-wise analyzer attention states', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.analyzerMachineNeedsAttention({ open_unmatched_results: 1, active_assignments: 1 })).toBe(true);
    expect(mod.analyzerMachineNeedsAttention({ open_unmatched_results: 0, active_assignments: 0 })).toBe(true);
    expect(mod.analyzerMachineNeedsAttention({ open_unmatched_results: 0, active_assignments: 1 })).toBe(false);
    expect(mod.analyzerHealthNeedsAttention({ open_unmatched_results: 0, unassigned_inventory_lots: 0, machine_breakdown: [{ open_unmatched_results: 0, active_assignments: 0 }] })).toBe(true);
  });

  it('formats LIS go-live readiness and deployment checklist UI guidance', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.lisGoLiveStatusLabel('ready')).toBe('Ready for go-live');
    expect(mod.lisGoLiveStatusLabel('blocked')).toBe('Blocked');
    expect(mod.lisGoLiveStatusLabel('warning')).toBe('Needs review');
    expect(mod.lisGoLiveStatusClass('ready')).toContain('emerald');
    expect(mod.lisGoLiveStatusClass('blocked')).toContain('red');
    expect(mod.lisGoLivePrimaryAction({ checks: [{ id: 'test-mapping', status: 'blocked' }] })).toEqual({ label: 'Fix test mappings', target: 'mappings' });
    expect(mod.lisGoLivePrimaryAction({ checks: [{ id: 'reagent-readiness', status: 'warning' }] })).toEqual({ label: 'Review reagent readiness', target: 'stock' });
    expect(mod.lisDeploymentChecklistProgress([{ id: 'stage-1', title: 'Stage', purpose: 'Test', items: [{ id: 'a' }, { id: 'b' }] }])).toEqual({ stages: 1, items: 2 });
    expect(text).toContain('data-testid="lis-go-live-readiness-card"');
    expect(text).toContain('/api/lab-monitoring/lis-go-live-readiness');
    expect(text).toContain('/api/lab-monitoring/lis-bridge-deployment-checklist');
    expect(text).toContain('OpenELIS-style bridge deployment readiness using existing HMS checks');
    expect(text).toContain('First deployment next step');
  });

  it('labels lab reagent timing modes and first-hospital go-live policy', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.labInventoryConsumptionPolicyLabel('billing')).toBe('Billing-time semi-auto recommended now');
    expect(mod.labInventoryConsumptionPolicyLabel('result')).toBe('Result/LIS auto finalization (future)');
    expect(mod.labInventoryConsumptionPolicyLabel(null)).toBe('Billing-time semi-auto recommended now');
    expect(mod.labInventoryModeLabel('soft')).toBe('Soft setup mode');
    expect(mod.labInventoryModeLabel('strict')).toBe('Strict production mode');
    expect(mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY).toEqual({
      lab_inventory_mode: 'soft',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: true,
      require_test_mapping_for_completion: false,
    });
    expect(mod.STRICT_PRODUCTION_LAB_INVENTORY_POLICY).toEqual({
      lab_inventory_mode: 'strict',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: false,
      require_test_mapping_for_completion: true,
    });
    expect(mod.labInventoryPolicyMatchesFirstHospitalPreset(mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY)).toBe(true);
    expect(mod.labInventoryPolicyMatchesFirstHospitalPreset({ ...mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY, require_test_mapping_for_completion: true })).toBe(false);
    expect(text).toContain('data-testid="apply-first-hospital-lab-policy"');
    expect(text).toContain('data-testid="enable-strict-production-lab-policy"');
    expect(text).toContain('disabled={strictProductionPolicyActive || loadingMappingCoverage || !strictProductionReady}');
    expect(text).toContain('Why soft mode now?');
    expect(text).toContain('Recommended first-hospital go-live preset');
    expect(text).toContain('Strict production preset after clean readiness');
    expect(text).toContain('Allow result without stock:</span> OFF');
    expect(text).toContain('Require mappings:</span> ON');
    expect(text).toContain('stock deduction failure must not block billing or result entry');
    expect(text).toContain('the API returns a 409 blocker instead of saving strict mode');
  });

  it('keeps first-hospital go-live policy non-blocking until strict readiness is clean', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY,
      mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY,
      { total_tests: 10, missing_tests: 4, strict_mode_ready: false },
    )).toBeNull();

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { lab_inventory_mode: 'strict' },
      mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY,
      { total_tests: 10, missing_tests: 4, strict_mode_ready: false },
    )).toBe('4 active billing lab tests still need reagent mappings before strict reagent controls.');

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { require_test_mapping_for_completion: true },
      mod.FIRST_HOSPITAL_LAB_INVENTORY_POLICY,
      null,
    )).toBe('Run mapping coverage before enabling strict reagent controls.');
  });

  it('labels and styles lab inventory exceptions', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.labInventoryExceptionReasonLabel('insufficient_stock')).toBe('Stock shortage');
    expect(mod.labInventoryExceptionReasonLabel('missing_test_mapping')).toBe('Missing reagent mapping');
    expect(mod.labInventoryExceptionReasonLabel('qc_failed_usable_lot')).toBe('QC failed usable lot');
    expect(mod.labInventoryExceptionReasonLabel('custom_reason')).toBe('custom reason');
    expect(mod.labInventoryExceptionSeverityClass('warning')).toContain('amber');
    expect(mod.labInventoryExceptionSeverityClass('error')).toContain('red');
  });

  it('guides exception cleanup by root cause before retry', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.labInventoryExceptionResolutionGuide('missing_test_mapping')).toMatchObject({
      tab: 'mappings',
      title: 'Add the missing test-to-reagent mapping first.',
    });
    expect(mod.labInventoryExceptionResolutionGuide('insufficient_stock').action).toContain('GRN/opening stock');
    expect(mod.labInventoryExceptionResolutionGuide('qc_failed_usable_lot').retry).toContain('usable lot');
    expect(mod.labInventoryExceptionResolutionGuide('unknown_reason')).toMatchObject({
      tab: 'exceptions',
      title: 'Review the operational cause before closing.',
    });
  });

  it('builds mapping update payloads and rejects invalid quantities', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.mappingUpdatePayload('1.25', false, '  kit override  ')).toEqual({
      qty_per_test: 1.25,
      is_mandatory: false,
      notes: 'kit override',
    });
    expect(mod.mappingUpdatePayload(2, true, '')).toEqual({
      qty_per_test: 2,
      is_mandatory: true,
      notes: null,
    });
    expect(() => mod.mappingUpdatePayload('0', true, null)).toThrow(/greater than zero/);
  });

  it('builds professional manual usage payloads for all supported rerun/control/QC cases', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.MANUAL_USAGE_TYPE_OPTIONS.map((option: { value: string }) => option.value)).toEqual([
      'rerun', 'control', 'qc', 'calibration', 'manual', 'other',
    ]);
    expect(mod.manualUsageReferenceType('rerun')).toBe('manual_rerun');
    expect(mod.manualUsageReferenceType('control')).toBe('manual_control');
    expect(mod.manualUsageReferenceType('qc')).toBe('manual_qc');
    expect(mod.manualUsageReferenceType('calibration')).toBe('manual_calibration');
    expect(mod.manualUsageReferenceType('unsafe custom')).toBe('manual_other');
    expect(mod.manualUsageReferenceType(null)).toBe('manual_manual');

    expect(mod.manualUsageRecordPayload({
      consumable_id: '5',
      quantity: '2',
      usage_type: 'control',
      location_id: '3',
      reference_id: '9001',
      remarks: '  Daily control run  ',
    })).toEqual({
      consumableId: 5,
      body: {
        quantity: 2,
        usage_type: 'control',
        reference_type: 'manual_control',
        reference_id: 9001,
        location_id: 3,
        remarks: 'Daily control run',
      },
    });
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '', quantity: '2', usage_type: 'control', location_id: '', reference_id: '', remarks: 'Daily control run' })).toThrow(/Select consumable/);
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '5', quantity: '0', usage_type: 'control', location_id: '', reference_id: '', remarks: 'Daily control run' })).toThrow(/valid quantity/);
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '5', quantity: '2', usage_type: 'control', location_id: '', reference_id: '', remarks: '' })).toThrow(/remarks/);
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '5abc', quantity: '2', usage_type: 'control', location_id: '', reference_id: '', remarks: 'Daily control run' })).toThrow(/Select consumable/);
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '5', quantity: '2', usage_type: 'control', location_id: '', reference_id: '9001abc', remarks: 'Daily control run' })).toThrow(/Reference ID/);
    expect(() => mod.manualUsageRecordPayload({ consumable_id: '5', quantity: '2', usage_type: 'control', location_id: '3abc', reference_id: '', remarks: 'Daily control run' })).toThrow(/Location/);

    expect(text).toContain('data-testid="manual-reagent-usage-card"');
    expect(text).toContain("t('manualUsageTitle')");
    expect(text).toContain("t('manualUsageSubtitle')");
    expect(text).toContain("t('manualUsageExample')");
  });

  it('builds professional waste request payloads for expired/broken/QC failed/spillage/temperature breach cases', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.WASTE_REASON_OPTIONS.map((option: { value: string }) => option.value)).toEqual([
      'expired', 'broken', 'qc_failed', 'spillage', 'temperature_breach', 'other',
    ]);
    expect(mod.wasteReasonLabel('qc_failed')).toBe('QC failed');
    expect(mod.wasteReasonLabel('temperature_breach')).toBe('Temperature breach');
    expect(mod.wasteReasonLabel('unsafe custom')).toBe('Other');
    expect(mod.isWasteRequestFormReady({ stock_id: '44', quantity: '2', reason: 'spillage', remarks: '' })).toBe(true);
    expect(mod.isWasteRequestFormReady({ stock_id: '44', quantity: '2', reason: 'other', remarks: '' })).toBe(false);
    expect(mod.isWasteRequestFormReady({ stock_id: '44', quantity: '2', reason: 'other', remarks: 'Analyzer room incident' })).toBe(true);
    expect(mod.isWasteRequestFormReady({ stock_id: '44abc', quantity: '2', reason: 'expired', remarks: '' })).toBe(false);
    expect(mod.isWasteRequestFormReady({ stock_id: '44', quantity: '2.5', reason: 'expired', remarks: '' })).toBe(false);

    expect(mod.wasteRequestPayload({ stock_id: '44', quantity: '2', reason: 'qc_failed', remarks: '  QC failed lot quarantined  ' })).toEqual({
      stock_id: 44,
      quantity: 2,
      reason: 'qc_failed',
      remarks: 'QC failed lot quarantined',
    });
    expect(() => mod.wasteRequestPayload({ stock_id: '', quantity: '2', reason: 'expired', remarks: '' })).toThrow(/stock lot ID/);
    expect(() => mod.wasteRequestPayload({ stock_id: '44', quantity: '0', reason: 'expired', remarks: '' })).toThrow(/waste quantity/);
    expect(() => mod.wasteRequestPayload({ stock_id: '44', quantity: '2', reason: 'other', remarks: '' })).toThrow(/other waste reason/);

    expect(text).toContain('data-testid="waste-request-card"');
    expect(text).toContain('Stock is deducted only after manager/admin approval.');
    expect(text).toContain('Approval/rejection stays pending for manager/admin review');
    expect(text).toContain('maxLength={500}');
  });

  it('styles mapping coverage and reconciliation statuses for readiness UI', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.mappingCoverageStatusClass('mapped')).toContain('emerald');
    expect(mod.mappingCoverageStatusClass('missing')).toContain('amber');
    expect(mod.reagentReconciliationStatusClass('ok')).toContain('emerald');
    expect(mod.reagentReconciliationStatusClass('missing')).toContain('amber');
    expect(mod.reagentReconciliationStatusClass('exception')).toContain('red');
  });

  it('builds hospital-grade strict mode readiness messages and checks from mapping coverage summary', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.strictModeReadinessMessage(null)).toBe('No active billing lab tests found for mapping coverage.');
    expect(mod.strictModeReadinessMessage({ total_tests: 3, missing_tests: 0, coverage_percent: 100, qc_failed_usable_lots: 0, open_stock_shortage_exceptions: 0, strict_mode_ready: true })).toBe('Strict mode ready: coverage is 100%, active billing tests have 0 missing maps, QC-failed usable lots are 0, and stock shortage exceptions are resolved.');
    expect(mod.strictModeReadinessMessage({ total_tests: 3, missing_tests: 1, coverage_percent: 66.67, strict_mode_ready: false })).toBe('1 active billing lab test still needs reagent mapping before strict mode.');
    expect(mod.strictModeReadinessMessage({ total_tests: 5, missing_tests: 2, coverage_percent: 60, strict_mode_ready: false })).toBe('2 active billing lab tests still need reagent mappings before strict mode.');
    expect(mod.strictModeReadinessMessage({ total_tests: 5, missing_tests: 0, coverage_percent: 100, qc_failed_usable_lots: 1, strict_mode_ready: false })).toBe('1 QC-failed usable stock lot must be quarantined, transferred out, or written off before strict mode.');
    expect(mod.strictModeReadinessMessage({ total_tests: 5, missing_tests: 0, coverage_percent: 100, open_stock_shortage_exceptions: 2, strict_mode_ready: false })).toBe('2 open stock shortage exceptions must be resolved before strict mode.');

    const checks = mod.buildStrictModeReadinessChecks({ total_tests: 10, mapped_tests: 9, missing_tests: 1, coverage_percent: 90, expected_quantity: 14, qc_failed_usable_lots: 1, open_stock_shortage_exceptions: 1, strict_mode_ready: false });
    expect(checks.map((check: any) => check.id)).toEqual(['coverage', 'missing-maps', 'qc-failed-lots', 'stock-shortage-exceptions']);
    expect(checks.map((check: any) => check.ready)).toEqual([false, false, false, false]);
  });

  it('marks every strict readiness check ready when coverage is perfect and blockers are zero', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    const checks = mod.buildStrictModeReadinessChecks({
      total_tests: 4,
      mapped_tests: 4,
      missing_tests: 0,
      coverage_percent: 100,
      expected_quantity: 12,
      qc_failed_usable_lots: 0,
      open_stock_shortage_exceptions: 0,
      strict_mode_ready: true,
    });

    expect(checks.every((check: any) => check.ready)).toBe(true);
    expect(checks.map((check: any) => check.target)).toEqual(['95–100%', '0 for active billing tests', '0', 'Resolved / 0 open']);
    expect(text).toContain('data-testid="strict-readiness-checks"');
    expect(text).toContain('QC-failed usable lots');
    expect(text).toContain('shortage exceptions');
  });

  it('builds a first-time reagent setup checklist', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    const steps = mod.buildReagentSetupChecklist({
      consumableCount: 0,
      locationCount: 0,
      mappingSummary: { mapped_tests: 0, missing_tests: 3, strict_mode_ready: false },
      policy: { lab_inventory_mode: 'soft', reagent_consumption_timing: 'billing' },
    });
    expect(steps.map((step: any) => step.id)).toEqual(['catalog', 'locations', 'mappings', 'policy', 'reconcile']);
    expect(steps.find((step: any) => step.id === 'policy')?.done).toBe(true);
    expect(steps.find((step: any) => step.id === 'catalog')?.done).toBe(false);
    expect(text).toContain('data-testid="reagent-setup-checklist"');
    expect(text).toContain('Reagent setup checklist');
  });

  it('formats default reagent catalog seed summaries and exposes the load action', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(mod.defaultReagentCatalogSeedToast({ tests: 20, consumables: 25, mappings: 30 })).toContain('30 new mappings added');
    expect(text).toContain('data-testid="seed-default-reagent-catalog"');
    expect(text).toContain('/api/lab-monitoring/default-reagent-catalog/seed');
  });

  it('parses bulk reagent mapping csv rows', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.parseBulkMappingCsvInput('101, 5, 1.5, true, CBC reagent\n102,8,1,false,EDTA tube')).toEqual([
      { lab_test_id: 101, consumable_id: 5, qty_per_test: 1.5, is_mandatory: true, notes: 'CBC reagent' },
      { lab_test_id: 102, consumable_id: 8, qty_per_test: 1, is_mandatory: false, notes: 'EDTA tube' },
    ]);
    expect(() => mod.parseBulkMappingCsvInput('bad, 5, 1')).toThrow(/invalid lab test id/);
  });

  it('parses hospital bulk mapping templates with headers and quoted notes', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const template = `lab_test_id, consumable_id, qty_per_test, mandatory(true/false), notes
101, 5, 1, true, CBC reagent pack
101, 8, 1, true, "EDTA tube, lavender cap"
102, 9, 1, yes, Glucose reagent`;

    expect(mod.parseBulkMappingCsvInput(template)).toEqual([
      { lab_test_id: 101, consumable_id: 5, qty_per_test: 1, is_mandatory: true, notes: 'CBC reagent pack' },
      { lab_test_id: 101, consumable_id: 8, qty_per_test: 1, is_mandatory: true, notes: 'EDTA tube, lavender cap' },
      { lab_test_id: 102, consumable_id: 9, qty_per_test: 1, is_mandatory: true, notes: 'Glucose reagent' },
    ]);
  });

  it('blocks strict reagent controls until mapping coverage is ready', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const softBillingPolicy = {
      lab_inventory_mode: 'soft',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: true,
      require_test_mapping_for_completion: false,
    };

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { lab_inventory_mode: 'strict' },
      softBillingPolicy,
      { total_tests: 5, missing_tests: 2, strict_mode_ready: false },
    )).toBe('2 active billing lab tests still need reagent mappings before strict reagent controls.');

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { require_test_mapping_for_completion: true },
      softBillingPolicy,
      null,
    )).toBe('Run mapping coverage before enabling strict reagent controls.');

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { lab_inventory_mode: 'strict' },
      softBillingPolicy,
      { total_tests: 5, missing_tests: 0, strict_mode_ready: true },
    )).toBeNull();

    expect(mod.labInventoryPolicyStrictReadinessWarning(
      { reagent_consumption_timing: 'result' },
      softBillingPolicy,
      { total_tests: 5, missing_tests: 2, strict_mode_ready: false },
    )).toBeNull();
  });

  it('builds operator-friendly billing-first starter command center copy and quick actions', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const state = mod.reagentStarterCommandState({
      policyTiming: 'billing',
      inventoryMode: 'soft',
      mappedTests: 18,
      missingTests: 2,
      openExceptions: 1,
      reconciliationMissing: 3,
      reconciliationExceptions: 0,
    });

    expect(state.headline).toBe('Billing-time reagent deduction is running in soft mode');
    expect(state.tone).toBe('warning');
    expect(state.statusTitle).toBe('2 test mappings need setup');
    expect(state.statusHint).toContain('Map missing lab tests first');
    expect(state.summary).toContain('18 tests mapped');
    expect(state.summary).toContain('2 need mapping');
    expect(state.actions.map((action: { tab: string }) => action.tab)).toEqual(['mappings', 'readiness', 'exceptions']);
    expect(state.actions[0].label).toBe('Fix 2 missing mappings');
    expect(state.actions[0].description).toBe('Open test-to-reagent recipes →');
  });

  it('shows a clear success state when soft rollout has no reagent setup risks', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const state = mod.reagentStarterCommandState({
      policyTiming: 'billing',
      inventoryMode: 'soft',
      mappedTests: 30,
      missingTests: 0,
      openExceptions: 0,
      reconciliationMissing: 0,
      reconciliationExceptions: 0,
    });

    expect(state.tone).toBe('success');
    expect(state.statusTitle).toBe('Ready for pilot control');
    expect(state.statusHint).toContain('Soft mode is safe for rollout');
    expect(state.actions[0].label).toBe('Review mappings');
  });

  it('exposes the starter reagent command center in the page shell', async () => {
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('data-testid="reagent-starter-command-center"');
    expect(text).toContain('Starter HIS reagent control');
    expect(text).toContain('LIS machine automation can stay secondary');
    expect(text).toContain('setTab(action.tab)');
  });

  it('defines four task-oriented reagent control sections in operational order', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.REAGENT_CONTROL_MAIN_TABS.map((tab: { id: string }) => tab.id)).toEqual([
      'overview',
      'stock',
      'recipes',
      'issues',
    ]);
    expect(mod.REAGENT_CONTROL_MAIN_TABS.map((tab: { label: string }) => tab.label)).toEqual([
      'Overview',
      'Stock',
      'Test Recipes',
      'Issues',
    ]);
  });

  it('builds the dedicated reagent-control navigation without setup-only tabs', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const tabs = mod.labMonitoringTabsForMode('reagent-control');

    expect(tabs.map((tab: { id: string }) => tab.id)).toEqual([
      'overview',
      'stock',
      'recipes',
      'issues',
    ]);
    expect(tabs.map((tab: { id: string }) => tab.id)).not.toContain('mappings');
    expect(tabs.map((tab: { id: string }) => tab.id)).not.toContain('readiness');
    expect(tabs.map((tab: { id: string }) => tab.id)).not.toContain('logs');
  });

  it('keeps billing-time reagent reconciliation status wording professional', async () => {
    const mod = await import('./LabMonitoringDashboard');

    expect(mod.reagentReconciliationStatusLabel('ok')).toBe('OK');
    expect(mod.reagentReconciliationStatusMeaning('ok')).toBe('Expected reagent deducted');
    expect(mod.reagentReconciliationStatusMeaning('missing')).toBe('Mapping/stock missing');
    expect(mod.reagentReconciliationStatusMeaning('exception')).toBe('Deduction failed/needs review');
    expect(mod.REAGENT_RECONCILIATION_STATUS_OPTIONS.map((option: { value: string }) => option.value)).toEqual(['all', 'ok', 'missing', 'exception']);
  });

  it('keeps normal lab-monitoring mode backward compatible with overview, i18n labels, and alerts', async () => {
    const mod = await import('./LabMonitoringDashboard');

    const tabs = mod.labMonitoringTabsForMode('lab-monitoring', {
      overview: 'Overview',
      consumables: 'Consumables translated',
      stock: 'Stock Controls',
      mappings: 'Test Mapping',
      logs: 'Operation Logs translated',
      alerts: 'Alerts',
    });

    expect(mod.initialLabMonitoringTab('lab-monitoring')).toBe('overview');
    expect(tabs[0]).toEqual({ id: 'overview', label: 'Overview' });
    expect(tabs.find((tab: { id: string }) => tab.id === 'consumables')?.label).toBe('Consumables translated');
    expect(tabs.find((tab: { id: string }) => tab.id === 'mappings')?.label).toBe('Test Mapping');
    expect(tabs.find((tab: { id: string }) => tab.id === 'logs')?.label).toBe('Operation Logs translated');
    expect(tabs.at(-1)).toEqual({ id: 'alerts', label: 'Alerts' });
  });

  it('syncs new and legacy reagent stock with canonical Inventory queries', async () => {
    const source = await import('./LabMonitoringDashboard?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('/api/lab-monitoring/stock/backfill-canonical');
    expect(text).toContain("const canManageLabInventory = ['laboratory', 'lab', 'hospital_admin', 'director'].includes(role)");
    expect(text).toContain('onSyncLegacyStock={canManageLabInventory ? () => syncLegacyStockMutation.mutate({}) : undefined}');
    expect(text).toContain('queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })');
    expect(text).toContain('idempotency_key: `reagent-stock-${crypto.randomUUID()}`');
  });

  it('uses reagent-control mode as the dedicated route shell', async () => {
    const mod = await import('./LabMonitoringDashboard');
    const pageSource = await import('./LabMonitoringDashboard?raw');
    const appSource = await import('../App?raw');
    const pageText = String(pageSource.default ?? '');
    const appText = String(appSource.default ?? '');

    expect(mod.initialLabMonitoringTab('reagent-control')).toBe('overview');
    expect(pageText).toContain('mode?: LabMonitoringMode');
    expect(pageText).toContain('ReagentControlTabs');
    expect(pageText).toContain('ReagentControlOverview');
    expect(pageText).toContain('ReagentRecipeManager');
    expect(pageText).toContain('ReagentControlIssues');
    expect(pageText).toContain('ReagentControlAdvancedPanel');
    expect(pageText).toContain('reagentControlQueryState');
    expect(appText).toContain('path="reagent-control" element={<LabMonitoringDashboard role="hospital_admin" mode="reagent-control" />}');
  });
});
