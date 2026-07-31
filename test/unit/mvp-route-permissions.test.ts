import { describe, expect, it } from 'vitest';
import { canUseLabResultWorkflow, getRequiredMvpPermission } from '../../src/lib/mvp-route-permissions';

describe('MVP route permission mapping', () => {
  it('guards patient routes by method', () => {
    expect(getRequiredMvpPermission('/api/patients', 'GET')).toBe('patients:read');
    expect(getRequiredMvpPermission('/api/patients/123', 'GET')).toBe('patients:read');
    expect(getRequiredMvpPermission('/api/patients', 'POST')).toBe('patients:write');
    expect(getRequiredMvpPermission('/api/patients/123', 'PUT')).toBe('patients:write');
    expect(getRequiredMvpPermission('/api/patients/123', 'DELETE')).toBe('patients:delete');
  });

  it('guards visit routes including discharge', () => {
    expect(getRequiredMvpPermission('/api/visits', 'GET')).toBe('appointments:read');
    expect(getRequiredMvpPermission('/api/visits', 'POST')).toBe('appointments:write');
    expect(getRequiredMvpPermission('/api/visits/99', 'PUT')).toBe('appointments:write');
    expect(getRequiredMvpPermission('/api/visits/99/discharge', 'POST')).toBe('admissions:discharge');
  });

  it('guards billing and does not accidentally match billing-counter', () => {
    expect(getRequiredMvpPermission('/api/billing', 'GET')).toBe('billing:read');
    expect(getRequiredMvpPermission('/api/billing/due', 'GET')).toBe('billing:read');
    expect(getRequiredMvpPermission('/api/billing/pay', 'POST')).toBe('billing:write');
    expect(getRequiredMvpPermission('/api/billing-counter/sessions/active', 'GET')).toBeNull();
  });

  it('guards lab, pharmacy, and prescriptions', () => {
    expect(getRequiredMvpPermission('/api/lab/orders', 'GET')).toBe('tests:read');
    expect(getRequiredMvpPermission('/api/lab/items/1/result', 'PUT')).toBe('tests:write');
    expect(getRequiredMvpPermission('/api/lab/items/1/sample-status', 'PATCH')).toBe('tests:write');
    expect(getRequiredMvpPermission('/api/pharmacy/medicines', 'GET')).toBe('pharmacy:read');
    expect(getRequiredMvpPermission('/api/pharmacy/medicines', 'POST')).toBe('pharmacy:write');
    expect(getRequiredMvpPermission('/api/prescriptions/history', 'GET')).toBe('prescriptions:read');
    expect(getRequiredMvpPermission('/api/prescriptions', 'POST')).toBe('prescriptions:write');
  });

  it('restricts lab result workflow to laboratory roles', () => {
    expect(canUseLabResultWorkflow('laboratory')).toBe(true);
    expect(canUseLabResultWorkflow('lab')).toBe(true);
    expect(canUseLabResultWorkflow('lab_tech')).toBe(true);
    expect(canUseLabResultWorkflow('hospital_admin')).toBe(true);
    expect(canUseLabResultWorkflow('doctor')).toBe(false);
    expect(canUseLabResultWorkflow('reception')).toBe(false);
    expect(canUseLabResultWorkflow('pharmacist')).toBe(false);
    expect(canUseLabResultWorkflow('accountant')).toBe(false);
  });
});
