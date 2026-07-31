import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(resolve(__dirname, './App.tsx'), 'utf8');

describe('workspace route permission alignment', () => {
  it('reuses the shared workspace permission source of truth for every switchable dashboard', () => {
    const src = source();
    expect(src).toContain("import { getWorkspaceAccessDefinition, type WorkspaceId } from '@shared/workspaceAccess';");
    expect(src).toContain('function workspacePermissions(workspaceId: WorkspaceId)');

    const workspaceIds = [
      'reception-dashboard',
      'manager-dashboard',
      'inventory-dashboard',
      'inventory-entry',
      'inventory-reports',
      'inventory-supervisor',
      'reagent-control',
      'pharmacy-dashboard',
      'lab-dashboard',
      'doctor-dashboard',
      'nursing-dashboard',
      'accounting-dashboard',
      'reports-dashboard',
      'md-dashboard',
      'director-dashboard',
      'access-control',
    ];

    for (const workspaceId of workspaceIds) {
      expect(src).toContain(`requiredAnyPermissions={workspacePermissions('${workspaceId}')}`);
    }
  });

  it('makes reports and executive dashboard switch targets permission-driven instead of role-only', () => {
    const src = source();
    expect(src).toMatch(/requiredAnyPermissions=\{workspacePermissions\('reports-dashboard'\)\}[\s\S]*?<Route path="reports"/);
    expect(src).toMatch(/requiredAnyPermissions=\{workspacePermissions\('md-dashboard'\)\}[\s\S]*?<Route path="md\/dashboard"/);
    expect(src).toMatch(/requiredAnyPermissions=\{workspacePermissions\('director-dashboard'\)\}[\s\S]*?<Route path="director\/dashboard"/);
  });

  it('allows staff invitation UI through explicit staff management permission', () => {
    const src = source();
    expect(src).toContain("<ProtectedRoute requiredAnyPermissions={['staff:write']} />");
    expect(src).toContain('<Route path="invitations" element={<InviteStaff />} />');
  });
});
