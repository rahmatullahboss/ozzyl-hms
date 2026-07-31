import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  consumptionDeductionModeLabel,
  consumptionEventStatusLabel,
  consumptionExceptionSeverityClass,
  buildConsumptionRulePayload,
  buildConsumptionConfirmationPayload,
  canPostConsumptionFromUiStatus,
  canReviewConsumptionVarianceFromUiStatus,
  buildConsumptionQueueEndpoint,
  buildConsumptionQueueEmptyStateMessage,
  buildConsumptionExceptionEmptyStateMessage,
  filterConsumptionExceptionsBySeverity,
  buildConsumptionExceptionsCsv,
  normalizeVarianceReviewNote,
  buildConsumptionReconciliationEndpoint,
  buildConsumptionReconciliationCsv,
  buildHighVarianceReconciliationRows,
  buildMissingTriggerRuleDraft,
  buildConsumptionRuleCoverageEndpoint,
  buildConsumptionRuleCoverageCsv,
  buildRuleCoverageEmptyStateMessage,
  formatConsumptionVarianceQty,
} from './InventoryConsumptionAutomation';

describe('InventoryConsumptionAutomation UI wiring', () => {
  it('labels deduction modes, statuses, and exception severities for staff-facing UI', () => {
    expect(consumptionDeductionModeLabel('auto')).toBe('Auto deduct');
    expect(consumptionDeductionModeLabel('suggest_confirm')).toBe('Suggest + confirm');
    expect(consumptionEventStatusLabel('pending_confirmation')).toBe('Pending confirmation');
    expect(consumptionEventStatusLabel('blocked_scan_required')).toBe('Scan required');
    expect(consumptionExceptionSeverityClass('critical')).toContain('red');
  });

  it('builds multi-item create-rule payloads from the setup form', () => {
    expect(buildConsumptionRulePayload({
      ruleName: ' Dressing Small ',
      triggerType: 'billing_item',
      triggerId: '45',
      department: 'Procedure',
      defaultStoreId: '3',
      deductionMode: 'suggest_confirm',
      items: [
        { itemId: '7', quantity: '2', unit: 'pcs', requiresScan: false, requiresApproval: true, highValueFlag: true, varianceToleranceQty: '1', varianceTolerancePercent: '20' },
        { itemId: '8', quantity: '1', unit: 'roll', requiresScan: true, requiresApproval: false, highValueFlag: false, varianceToleranceQty: '0', varianceTolerancePercent: '0' },
      ],
    })).toEqual({
      ruleName: 'Dressing Small',
      triggerType: 'billing_item',
      triggerId: 45,
      department: 'Procedure',
      defaultStoreId: 3,
      deductionMode: 'suggest_confirm',
      items: [
        { itemId: 7, quantity: 2, unit: 'pcs', requiresScan: false, requiresApproval: true, highValueFlag: true, varianceToleranceQty: 1, varianceTolerancePercent: 20 },
        { itemId: 8, quantity: 1, unit: 'roll', requiresScan: true, requiresApproval: false, highValueFlag: false, varianceToleranceQty: 0, varianceTolerancePercent: 0 },
      ],
    });
  });

  it('builds reconciliation endpoints from date and department filters', () => {
    expect(buildConsumptionReconciliationEndpoint({})).toBe('/api/inventory/consumption-reports/reconciliation');
    expect(buildConsumptionReconciliationEndpoint({ from: '2026-07-01', to: '2026-07-31', department: 'OT' })).toBe('/api/inventory/consumption-reports/reconciliation?from=2026-07-01&to=2026-07-31&department=OT');
    expect(buildConsumptionReconciliationEndpoint({ department: 'Emergency Ward' })).toBe('/api/inventory/consumption-reports/reconciliation?department=Emergency+Ward');
  });

  it('builds reconciliation CSV exports with escaped values', () => {
    expect(buildConsumptionReconciliationCsv([
      { Department: 'OT', Status: 'posted', EventCount: 2, ExpectedQty: 10, ActualQty: 12, VarianceQty: 2 },
      { Department: 'Ward, 2', Status: 'variance_review', EventCount: 1, ExpectedQty: 3, ActualQty: 5, VarianceQty: -2 },
    ])).toBe('Department,Status,Events,Expected,Actual,Difference\nOT,Posted,2,10,12,+2\n"Ward, 2",Variance review,1,3,5,-2');
  });

  it('formats variance quantities for reconciliation rows', () => {
    expect(formatConsumptionVarianceQty(4)).toBe('+4');
    expect(formatConsumptionVarianceQty(-2)).toBe('-2');
    expect(formatConsumptionVarianceQty(0)).toBe('0');
  });

  it('builds high variance alert rows sorted by absolute difference', () => {
    const rows = buildHighVarianceReconciliationRows([
      { Department: 'Ward', Status: 'posted', EventCount: 2, ExpectedQty: 10, ActualQty: 12, VarianceQty: 2 },
      { Department: 'OT', Status: 'variance_review', EventCount: 1, ExpectedQty: 3, ActualQty: 9, VarianceQty: 6 },
      { Department: 'OPD', Status: 'confirmed', EventCount: 1, ExpectedQty: 5, ActualQty: 5, VarianceQty: 0 },
    ]);
    expect(rows.map((row) => row.Department)).toEqual(['OT', 'Ward']);
  });

  it('builds queue endpoints from status filters', () => {
    expect(buildConsumptionQueueEndpoint('pending_confirmation')).toBe('/api/inventory/consumption-events?status=pending_confirmation&limit=100');
    expect(buildConsumptionQueueEndpoint('confirmed')).toBe('/api/inventory/consumption-events?status=confirmed&limit=100');
    expect(buildConsumptionQueueEndpoint('variance_review')).toBe('/api/inventory/consumption-events?status=variance_review&limit=100');
    expect(buildConsumptionQueueEndpoint('posted')).toBe('/api/inventory/consumption-events?status=posted&limit=100');
  });

  it('guides users when consumption queue filters have no events', () => {
    expect(buildConsumptionQueueEmptyStateMessage('pending_confirmation')).toContain('No pending consumption events');
    expect(buildConsumptionQueueEmptyStateMessage('confirmed')).toContain('No confirmed events ready to post');
    expect(buildConsumptionQueueEmptyStateMessage('variance_review')).toContain('No variance events pending review');
    expect(buildConsumptionQueueEmptyStateMessage('posted')).toContain('No posted consumption history');
  });

  it('guides admins when no consumption exceptions are open', () => {
    expect(buildConsumptionExceptionEmptyStateMessage()).toContain('No open consumption exceptions');
    expect(buildConsumptionExceptionEmptyStateMessage()).toContain('missing rules');
    expect(buildConsumptionExceptionEmptyStateMessage({ totalRows: 3, visibleRows: 0, severity: 'critical' })).toContain('No critical exceptions');
  });

  it('filters consumption exceptions by severity', () => {
    const rows = [
      { ExceptionId: 1, Reason: 'stock', Severity: 'critical', Status: 'open', Message: 'Stock shortage' },
      { ExceptionId: 2, Reason: 'rule', Severity: 'warning', Status: 'open', Message: 'Missing rule' },
    ];
    expect(filterConsumptionExceptionsBySeverity(rows, 'all')).toHaveLength(2);
    expect(filterConsumptionExceptionsBySeverity(rows, 'critical')).toEqual([rows[0]]);
  });

  it('builds consumption exception CSV exports with escaped messages', () => {
    expect(buildConsumptionExceptionsCsv([
      { ExceptionId: 1, EventId: 9, Reason: 'stock_shortage', Severity: 'critical', Status: 'open', Message: 'Need gauze, syringe' },
    ])).toBe('Exception ID,Event ID,Reason,Severity,Status,Message\n1,9,stock_shortage,critical,open,"Need gauze, syringe"');
  });

  it('builds rule coverage endpoints with filters', () => {
    expect(buildConsumptionRuleCoverageEndpoint()).toBe('/api/inventory/consumption-reports/rule-coverage');
    expect(buildConsumptionRuleCoverageEndpoint({ triggerType: 'procedure', department: 'OT' })).toBe('/api/inventory/consumption-reports/rule-coverage?department=OT&triggerType=procedure');
    expect(buildConsumptionRuleCoverageEndpoint({ from: '2026-07-01', to: '2026-07-31', department: 'Emergency Ward', triggerType: 'billing_item' })).toBe('/api/inventory/consumption-reports/rule-coverage?from=2026-07-01&to=2026-07-31&department=Emergency+Ward&triggerType=billing_item');
  });

  it('builds rule coverage CSV exports with missing counts', () => {
    expect(buildConsumptionRuleCoverageCsv([
      { TriggerType: 'procedure', TriggerId: 12, TriggerCode: null, Department: 'Procedure', EventCount: 2, MatchedRuleEvents: 1, MissingRuleEvents: 1, RuleCount: 1, HasActiveRule: 1 },
      { TriggerType: 'ot_procedure', TriggerId: null, TriggerCode: 'C-SEC', Department: 'OT, Major', EventCount: 3, MatchedRuleEvents: 0, MissingRuleEvents: 3, RuleCount: 0, HasActiveRule: 0 },
    ])).toBe('Trigger Type,Trigger ID,Trigger Code,Department,Events,Rules,Matched Events,Missing Events,Coverage\nprocedure,12,,Procedure,2,1,1,1,Covered\not_procedure,,C-SEC,"OT, Major",3,0,0,3,Missing');
  });

  it('prefills create-rule draft from a missing coverage trigger', () => {
    expect(buildMissingTriggerRuleDraft({ TriggerType: 'procedure', TriggerId: 12, TriggerCode: null, Department: 'Procedure', EventCount: 2, MatchedRuleEvents: 0, MissingRuleEvents: 2, RuleCount: 0, HasActiveRule: 0 })).toMatchObject({
      ruleName: 'Procedure rule 12',
      triggerType: 'procedure',
      triggerId: '12',
      department: 'Procedure',
      deductionMode: 'suggest_confirm',
    });
  });

  it('guides admins when rule coverage has no visible rows', () => {
    expect(buildRuleCoverageEmptyStateMessage({ totalRows: 0, visibleRows: 0, filtersActive: false, missingOnly: false })).toContain('No consumption triggers found yet');
    expect(buildRuleCoverageEmptyStateMessage({ totalRows: 4, visibleRows: 0, filtersActive: false, missingOnly: true })).toContain('No missing triggers');
    expect(buildRuleCoverageEmptyStateMessage({ totalRows: 0, visibleRows: 0, filtersActive: true, missingOnly: false })).toContain('No rule coverage rows match these filters');
  });

  it('review gate works for variance status', () => {
    expect(canReviewConsumptionVarianceFromUiStatus('variance_review')).toBe(true);
    expect(canReviewConsumptionVarianceFromUiStatus('confirmed')).toBe(false);
    expect(canReviewConsumptionVarianceFromUiStatus('posted')).toBe(false);
  });

  it('normalizes variance review notes without using browser prompts', () => {
    expect(normalizeVarianceReviewNote('  Reviewed by pharmacist  ')).toBe('Reviewed by pharmacist');
    expect(normalizeVarianceReviewNote('')).toBe('Accepted actual usage after review');
  });

  it('shows stock posting only after confirmed status', () => {
    expect(canPostConsumptionFromUiStatus('confirmed')).toBe(true);
    expect(canPostConsumptionFromUiStatus('pending_confirmation')).toBe(false);
    expect(canPostConsumptionFromUiStatus('variance_review')).toBe(false);
    expect(canPostConsumptionFromUiStatus('posted')).toBe(false);
  });

  it('builds confirm actual usage payloads with variance reasons', () => {
    expect(buildConsumptionConfirmationPayload([
      { eventItemId: 9, expectedQuantity: 2, actualQuantity: '3', varianceReason: 'Extra gauze used' },
    ])).toEqual({ items: [{ eventItemId: 9, expectedQuantity: 2, actualQuantity: 3, varianceReason: 'Extra gauze used' }] });
  });

  it('uses the new consumption automation API endpoints', () => {
    const source = readFileSync('src/pages/inventory/InventoryConsumptionAutomation.tsx', 'utf8');
    expect(source).toContain('/api/inventory/consumption-rules');
    expect(source).toContain('data-testid="create-consumption-rule-form"');
    expect(source).toContain('buildConsumptionRulePayload(ruleForm)');
    expect(source).toContain('addConsumptionRuleItem');
    expect(source).toContain('Remove item');
    expect(source).toContain('/api/inventory/items?page=1&limit=300');
    expect(source).toContain('/api/inventory/stores?page=1&limit=100');
    expect(source).toContain('Select inventory item');
    expect(source).toContain('Select default store');
    expect(source).toContain('seed-inventory-consumption-rules');
    expect(source).toContain('buildConsumptionQueueEndpoint(queueStatusFilter)');
    expect(source).toContain('data-testid="consumption-queue-status-filter"');
    expect(source).toContain('data-testid="consumption-queue-empty-state"');
    expect(source).toContain('buildConsumptionQueueEmptyStateMessage(queueStatusFilter)');
    expect(source).toContain('Confirmed ready to post');
    expect(source).toContain('/api/inventory/consumption-exceptions?status=open');
    expect(source).toContain('buildConsumptionReconciliationEndpoint(reconciliationFilters)');
    expect(source).toContain('data-testid="consumption-reconciliation-from"');
    expect(source).toContain('data-testid="consumption-reconciliation-to"');
    expect(source).toContain('data-testid="consumption-reconciliation-department"');
    expect(source).toContain('data-testid="export-reconciliation-csv"');
    expect(source).toContain('buildConsumptionReconciliationCsv(reconciliationRows)');
    expect(source).toContain('data-testid="high-variance-reconciliation-alerts"');
    expect(source).toContain('highVarianceRows.map');
    expect(source).toContain('data-testid="rule-coverage-missing-only"');
    expect(source).toContain('data-testid="create-rule-from-missing-trigger"');
    expect(source).toContain('data-testid="export-rule-coverage-csv"');
    expect(source).toContain('data-testid="rule-coverage-from"');
    expect(source).toContain('data-testid="rule-coverage-to"');
    expect(source).toContain('data-testid="rule-coverage-department"');
    expect(source).toContain('data-testid="rule-coverage-trigger-type"');
    expect(source).toContain('buildConsumptionRuleCoverageEndpoint(ruleCoverageFilters)');
    expect(source).toContain('buildConsumptionRuleCoverageCsv(visibleRuleCoverageRows)');
    expect(source).toContain('data-testid="rule-coverage-empty-state"');
    expect(source).toContain('data-testid="clear-rule-coverage-filters"');
    expect(source).toContain('buildRuleCoverageEmptyStateMessage');
    expect(source).toContain('buildMissingTriggerRuleDraft(row)');
    expect(source).toContain('/api/inventory/consumption-events/${eventId}');
    expect(source).toContain('/api/inventory/consumption-events/${eventId}/confirm');
    expect(source).toContain('/api/inventory/consumption-events/${eventId}/post');
    expect(source).toContain('data-testid="post-stock-deduction"');
    expect(source).toContain('canPostConsumptionFromUiStatus(selectedEventStatus)');
    expect(source).toContain('data-testid="confirm-actual-usage-form"');
    expect(source).toContain('buildConsumptionConfirmationPayload(confirmItems)');
    expect(source).toContain('data-testid="consumption-exceptions-empty-state"');
    expect(source).toContain('data-testid="consumption-exception-severity-filter"');
    expect(source).toContain('data-testid="export-consumption-exceptions-csv"');
    expect(source).toContain('data-testid="clear-consumption-exception-severity-filter"');
    expect(source).toContain('filterConsumptionExceptionsBySeverity(exceptions, exceptionSeverityFilter)');
    expect(source).toContain('buildConsumptionExceptionsCsv(visibleExceptions)');
    expect(source).toContain('buildConsumptionExceptionEmptyStateMessage({ totalRows: exceptions.length, visibleRows: visibleExceptions.length, severity: exceptionSeverityFilter })');
    expect(source).toContain('/api/inventory/consumption-exceptions/${exceptionId}/review');
  });

  it('registers inventory consumption pages in app routing', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("const InventoryConsumptionAutomation");
    expect(app).toContain('inventory/consumption-rules');
    expect(app).toContain('inventory/consumption-queue');
    expect(app).toContain('inventory/consumption-exceptions');
  });

  it('exposes inventory consumption navigation entries', () => {
    const commandPalette = readFileSync('src/components/dashboard/CommandPalette.tsx', 'utf8');
    const adminSidebar = readFileSync('src/components/dashboard/adminSidebarConfig.tsx', 'utf8');
    expect(commandPalette).toContain('inventoryConsumptionRules');
    expect(commandPalette).toContain('inventory/consumption-queue');
    expect(adminSidebar).toContain('inventoryConsumptionExceptions');
    expect(adminSidebar).toContain("requiredPermission: 'inventory:consume'");
  });
});
