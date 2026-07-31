import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkspaceAccessDefinition, type WorkspaceId } from '@shared/workspaceAccess';

const appSource = () => readFileSync(resolve(__dirname, './App.tsx'), 'utf8');

function expectRouteBehindGate(app: string, routePath: string, gateExpression: string) {
  const routeIndex = app.indexOf(`path="${routePath}"`);
  expect(routeIndex, `Route ${routePath} should exist`).toBeGreaterThan(-1);

  const expectedRouteGate = `<Route element={<ProtectedRoute requiredAnyPermissions={${gateExpression}} />}>`;
  const lastProtectedRouteBeforePath = app.lastIndexOf('<Route element={<ProtectedRoute', routeIndex);
  const lastExpectedGateBeforePath = app.lastIndexOf(expectedRouteGate, routeIndex);

  expect(lastExpectedGateBeforePath, `${routePath} should be behind ${gateExpression}`).toBeGreaterThan(-1);
  expect(lastProtectedRouteBeforePath, `${routePath} should not be only role-gated`).toBe(lastExpectedGateBeforePath);
}

function expectWorkspaceRoute(app: string, routePath: string, workspaceId: WorkspaceId, permission: string) {
  expectRouteBehindGate(app, routePath, `workspacePermissions('${workspaceId}')`);
  expect(getWorkspaceAccessDefinition(workspaceId)?.requiredPermissions).toContain(permission);
}

describe('App inventory permission route gates', () => {
  it('blocks manual Goods Receipt create URL unless inventory entry permission is present', () => {
    expectWorkspaceRoute(appSource(), 'inventory/gr/new', 'inventory-entry', 'inventory:write');
  });

  it('blocks manual stock transfer URL unless inventory:transfer is present', () => {
    expectRouteBehindGate(appSource(), 'inventory/transfers', "['inventory:transfer']");
  });

  it('blocks manual direct stock adjustment URL unless inventory:adjust is present', () => {
    expectRouteBehindGate(appSource(), 'inventory/stock/adjust', "['inventory:adjust']");
  });

  it('keeps access control behind the centralized roles:manage workspace', () => {
    expectWorkspaceRoute(appSource(), 'permissions', 'access-control', 'roles:manage');
  });

  it('blocks reagent control behind the centralized inventory-consumption workspace', () => {
    expectWorkspaceRoute(appSource(), 'reagent-control', 'reagent-control', 'inventory:consume');
  });
});
