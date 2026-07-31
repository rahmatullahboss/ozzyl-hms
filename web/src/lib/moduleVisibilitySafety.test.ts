import { describe, expect, it } from 'vitest';

import {
  buildModuleVisibilityConfirmation,
  isProtectedModuleVisibilityRole,
} from './moduleVisibilitySafety';

describe('moduleVisibilitySafety', () => {
  it('protects hospital_admin module visibility from UI toggles', () => {
    expect(isProtectedModuleVisibilityRole('hospital_admin')).toBe(true);
    expect(isProtectedModuleVisibilityRole('manager')).toBe(false);
  });

  it('builds a clear warning for hiding a module because it changes real permissions', () => {
    const message = buildModuleVisibilityConfirmation({
      role: 'reception',
      moduleLabel: 'Billing & Finance',
      nextVisible: false,
      affectedPermissions: ['billing:read', 'billing:write'],
    });

    expect(message).toContain('Hide Billing & Finance for reception');
    expect(message).toContain('real role permissions');
    expect(message).toContain('billing:read');
    expect(message).toContain('billing:write');
  });
});
