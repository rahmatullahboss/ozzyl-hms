import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('inventory consumption route registration', () => {
  const indexSource = readFileSync('src/routes/tenant/inventory/index.ts', 'utf8');

  it('registers consumption automation routes under existing inventory router', () => {
    expect(indexSource).toContain('import consumptionRuleRoutes from "./consumptionRules"');
    expect(indexSource).toContain('import consumptionEventRoutes from "./consumptionEvents"');
    expect(indexSource).toContain('import consumptionExceptionRoutes from "./consumptionExceptions"');
    expect(indexSource).toContain('inventory.route("/consumption-rules", consumptionRuleRoutes)');
    expect(indexSource).toContain('inventory.route("/consumption-events", consumptionEventRoutes)');
    expect(indexSource).toContain('inventory.route("/consumption-exceptions", consumptionExceptionRoutes)');
  });

  it('uses existing inventory permissions instead of introducing duplicate auth logic', () => {
    expect(indexSource).toContain('/consumption-rules');
    expect(indexSource).toContain('/consumption-events');
    expect(indexSource).toContain('/consumption-exceptions');
    expect(indexSource).toContain('inventory:consume');
    expect(indexSource).toContain('inventory:approve');
  });

  it('enforces inventory safety workflow permissions for normal operators', () => {
    expect(indexSource).toContain('function isInventoryDecisionPath(path: string): boolean');
    expect(indexSource).toContain('if (path.includes("/count-sessions"))');
    expect(indexSource).toContain('if (path.includes("/adjustment-requests"))');
    expect(indexSource).toContain('if (path.includes("/writeoff"))');
    expect(indexSource).toContain('return isInventoryDecisionPath(path) ? "inventory:approve" : "inventory:write"');
    expect(indexSource).toContain('if (path.includes("/stock/adjustment") || path.includes("/stock/adjustments") || path.includes("/adjustment")) return "inventory:adjust"');
    expect(indexSource).not.toContain('if (path.includes("/count-sessions")) return "inventory:adjust"');
    expect(indexSource).not.toContain('if (path.includes("/adjustment-requests") &&');
  });

  it('keeps route modules focused on services rather than creating a second stock engine', () => {
    const rules = readFileSync('src/routes/tenant/inventory/consumptionRules.ts', 'utf8');
    const events = readFileSync('src/routes/tenant/inventory/consumptionEvents.ts', 'utf8');
    const exceptions = readFileSync('src/routes/tenant/inventory/consumptionExceptions.ts', 'utf8');
    expect(rules).toContain('createConsumptionRule');
    expect(events).toContain('createExpectedConsumptionEvent');
    expect(events).toContain('confirmConsumptionEvent');
    expect(events).toContain('postConsumptionEvent');
    expect(events).toContain('consumption-event:${tenantId(c)}:${eventId}');
    expect(exceptions).toContain('createConsumptionException');
    expect(exceptions).toContain('reviewConsumptionException');
    expect(events).not.toContain('UPDATE InventoryStock');
  });
});
