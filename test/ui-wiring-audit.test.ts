import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const WEB_PAGES = join(ROOT, 'web/src/pages');
const APP_TSX = join(ROOT, 'web/src/App.tsx');
const INDEX_TS = join(ROOT, 'src/index.ts');

const appContent = readFileSync(APP_TSX, 'utf8');
const indexContent = readFileSync(INDEX_TS, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. All new pages exist as files
// ═══════════════════════════════════════════════════════════════════════════════

describe('UI Files Exist', () => {
  const requiredPages = [
    'LabMachineSettings.tsx',
    'PermissionManagement.tsx',
    'OrderSetManager.tsx',
    'ConsentManagement.tsx',
    'DocumentManager.tsx',
    'QualityKpiDashboard.tsx',
    'ClinicalRemindersPage.tsx',
  ];

  for (const page of requiredPages) {
    it(`${page} should exist`, () => {
      expect(existsSync(join(WEB_PAGES, page))).toBe(true);
    });
  }

  const existingCriticalPages = [
    'Login.tsx', 'admin/Dashboard.tsx', 'PatientList.tsx',
    'LaboratoryDashboard.tsx', 'PharmacyDashboard.tsx', 'BillingDashboard.tsx',
    'NursingDashboard.tsx', 'NurseStation.tsx', 'HRDashboard.tsx',
    'SettingsPage.tsx', 'EPrescribingDashboard.tsx', 'AppointmentScheduler.tsx',
    'EmergencyDashboard.tsx', 'OTDashboard.tsx', 'AdmissionIPD.tsx',
    'RadiologyDashboard.tsx', 'TelemedicineDashboard.tsx',
    'DoctorDashboard.tsx', 'MDDashboard.tsx', 'DirectorDashboard.tsx',
    'ReceptionDashboard.tsx', 'SuperAdminDashboard.tsx',
  ];

  for (const page of existingCriticalPages) {
    it(`core page ${page} should exist`, () => {
      expect(existsSync(join(WEB_PAGES, page))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. All new pages are imported in App.tsx
// ═══════════════════════════════════════════════════════════════════════════════

describe('UI Pages Imported in App.tsx', () => {
  const requiredImports = [
    'LabMachineSettings',
    'PermissionManagement',
    'OrderSetManager',
    'ConsentManagement',
    'DocumentManager',
    'QualityKpiDashboard',
    'ClinicalRemindersPage',
  ];

  for (const name of requiredImports) {
    it(`should import ${name}`, () => {
      // Accept both static imports and React.lazy() imports
      const hasStaticImport = appContent.includes(`import ${name}`);
      const hasLazyImport = appContent.includes(`const ${name} = lazy(`);
      expect(hasStaticImport || hasLazyImport).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. All new pages have routes in App.tsx
// ═══════════════════════════════════════════════════════════════════════════════

describe('UI Pages Have Routes in App.tsx', () => {
  const requiredRoutes = [
    { path: 'lab-machines', component: 'LabMachineSettings' },
    { path: 'permissions', component: 'PermissionManagement' },
    { path: 'order-sets', component: 'OrderSetManager' },
    { path: 'consents', component: 'ConsentManagement' },
    { path: 'documents', component: 'DocumentManager' },
    { path: 'quality-kpi', component: 'QualityKpiDashboard' },
    { path: 'clinical-reminders', component: 'ClinicalRemindersPage' },
  ];

  for (const route of requiredRoutes) {
    it(`should have route for "${route.path}" → ${route.component}`, () => {
      expect(appContent).toContain(`path="${route.path}"`);
      expect(appContent).toContain(route.component);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. All backend routes are mounted in index.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe('Backend Routes Mounted in index.ts', () => {
  const requiredMounts = [
    '/api/lab-machines',
    '/api/permissions',
    '/api/order-sets',
    '/api/consents',
    '/api/documents',
    '/api/quality-kpi',
    '/api/clinical-reminders',
    '/api/lab',
    '/api/lab-settings',
    '/api/fhir',
    '/api/nursing',
    '/api/nurse-station',
    '/api/pharmacy',
    '/api/e-prescribing',
    '/api/billing',
    '/api/appointments',
    '/api/patients',
    '/api/auth',
    '/api/settings',
    '/api/admissions',
    '/api/emergency',
  ];

  for (const route of requiredMounts) {
    it(`should mount ${route}`, () => {
      expect(indexContent).toContain(`'${route}'`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Backend route files exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('Backend Route Files Exist', () => {
  const requiredRouteFiles = [
    'src/routes/tenant/labMachines.ts',
    'src/routes/tenant/permissions.ts',
    'src/routes/tenant/orderSets.ts',
    'src/routes/tenant/consents.ts',
    'src/routes/tenant/documents.ts',
    'src/routes/tenant/qualityKpi.ts',
    'src/routes/tenant/clinicalReminders.ts',
    'src/routes/tenant/lab.ts',
    'src/routes/tenant/labSettings.ts',
    'src/routes/tenant/fhir.ts',
    'src/routes/tenant/nursing/index.ts',
    'src/routes/tenant/nurseStation.ts',
    'src/routes/tenant/pharmacy.ts',
    'src/routes/tenant/ePrescribing.ts',
  ];

  for (const file of requiredRouteFiles) {
    it(`${file} should exist`, () => {
      expect(existsSync(join(ROOT, file))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Migration files exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('Migration Files Exist', () => {
  const migrations = [
    '0143_lis_full_upgrade.sql',
    '0144_lab_signatories_delta.sql',
    '0145_clinical_reminders.sql',
    '0146_dynamic_rbac.sql',
    '0147_order_sets.sql',
    '0148_consent_documents_kpi.sql',
  ];

  for (const m of migrations) {
    it(`migration ${m} should exist`, () => {
      expect(existsSync(join(ROOT, 'migrations', m))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Schema files exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schema Files Exist', () => {
  const schemas = [
    'src/schemas/lab.ts',
    'src/schemas/labMachine.ts',
    'src/schemas/labSettings.ts',
    'src/schemas/orderSet.ts',
  ];

  for (const s of schemas) {
    it(`${s} should exist`, () => {
      expect(existsSync(join(ROOT, s))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Library files exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('Library Files Exist', () => {
  const libs = [
    'src/lib/hl7-parser.ts',
    'src/lib/astm-parser.ts',
    'src/lib/drug-safety.ts',
    'src/lib/authz.ts',
  ];

  for (const l of libs) {
    it(`${l} should exist`, () => {
      expect(existsSync(join(ROOT, l))).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Middleware updated
// ═══════════════════════════════════════════════════════════════════════════════

describe('Middleware Updates', () => {
  it('rbac.ts should export requirePermission', () => {
    const rbac = readFileSync(join(ROOT, 'src/middleware/rbac.ts'), 'utf8');
    expect(rbac).toContain('requirePermission');
    expect(rbac).toContain('resolveUserPermissions');
  });

  it('authz.ts should export ALL_PERMISSIONS', () => {
    const authz = readFileSync(join(ROOT, 'packages/shared/src/authz.ts'), 'utf8');
    expect(authz).toContain('ALL_PERMISSIONS');
    expect(authz).toContain('PERMISSION_GROUPS');
    expect(authz).toContain('ALL_MODULES');
  });

  it('auth.ts should use resolveUserPermissions for JWT', () => {
    const auth = readFileSync(join(ROOT, 'src/routes/tenant/auth.ts'), 'utf8');
    expect(auth).toContain('resolveUserPermissions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Middleware service exists
// ═══════════════════════════════════════════════════════════════════════════════

describe('Lab Middleware Service', () => {
  it('tools/lab-middleware/index.js should exist', () => {
    expect(existsSync(join(ROOT, 'tools/lab-middleware/index.js'))).toBe(true);
  });

  it('tools/lab-middleware/package.json should exist', () => {
    expect(existsSync(join(ROOT, 'tools/lab-middleware/package.json'))).toBe(true);
  });

  it('tools/lab-middleware/config.example.json should exist', () => {
    expect(existsSync(join(ROOT, 'tools/lab-middleware/config.example.json'))).toBe(true);
  });

  it('tools/hl7-agent/index.js should exist (legacy)', () => {
    expect(existsSync(join(ROOT, 'tools/hl7-agent/index.js'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Full Module Coverage — Every major hospital module has backend + frontend
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Hospital Module Coverage', () => {
  const modules = [
    { name: 'OPD/Appointments', backendRoute: '/api/appointments', frontendPage: 'AppointmentScheduler.tsx' },
    { name: 'IPD/Admissions', backendRoute: '/api/admissions', frontendPage: 'AdmissionIPD.tsx' },
    { name: 'Emergency', backendRoute: '/api/emergency', frontendPage: 'EmergencyDashboard.tsx' },
    { name: 'Laboratory', backendRoute: '/api/lab', frontendPage: 'LaboratoryDashboard.tsx' },
    { name: 'Lab Machines', backendRoute: '/api/lab-machines', frontendPage: 'LabMachineSettings.tsx' },
    { name: 'Pharmacy', backendRoute: '/api/pharmacy', frontendPage: 'PharmacyDashboard.tsx' },
    { name: 'Radiology', backendRoute: '/api/radiology', frontendPage: 'RadiologyDashboard.tsx' },
    { name: 'Nursing', backendRoute: '/api/nursing', frontendPage: 'NursingDashboard.tsx' },
    { name: 'Nurse Station', backendRoute: '/api/nurse-station', frontendPage: 'NurseStation.tsx' },
    { name: 'Billing', backendRoute: '/api/billing', frontendPage: 'BillingDashboard.tsx' },
    { name: 'E-Prescribing', backendRoute: '/api/e-prescribing', frontendPage: 'EPrescribingDashboard.tsx' },
    { name: 'HR', backendRoute: '/api/hr', frontendPage: 'HRDashboard.tsx' },
    { name: 'Operation Theatre', backendRoute: '/api/ot', frontendPage: 'OTDashboard.tsx' },
    { name: 'Telemedicine', backendRoute: '/api/telemedicine', frontendPage: 'TelemedicineDashboard.tsx' },
    { name: 'Settings', backendRoute: '/api/settings', frontendPage: 'SettingsPage.tsx' },
    { name: 'Order Sets', backendRoute: '/api/order-sets', frontendPage: 'OrderSetManager.tsx' },
    { name: 'Consent Management', backendRoute: '/api/consents', frontendPage: 'ConsentManagement.tsx' },
    { name: 'Document Management', backendRoute: '/api/documents', frontendPage: 'DocumentManager.tsx' },
    { name: 'Quality KPI', backendRoute: '/api/quality-kpi', frontendPage: 'QualityKpiDashboard.tsx' },
    { name: 'Clinical Reminders', backendRoute: '/api/clinical-reminders', frontendPage: 'ClinicalRemindersPage.tsx' },
    { name: 'Permissions/RBAC', backendRoute: '/api/permissions', frontendPage: 'PermissionManagement.tsx' },
  ];

  for (const mod of modules) {
    it(`${mod.name}: backend mounted + frontend exists + route wired`, () => {
      // Backend mounted
      expect(indexContent).toContain(`'${mod.backendRoute}'`);
      // Frontend file exists
      expect(existsSync(join(WEB_PAGES, mod.frontendPage))).toBe(true);
      // Router has route
      const componentName = mod.frontendPage.replace('.tsx', '');
      expect(appContent).toContain(componentName);
    });
  }
});
