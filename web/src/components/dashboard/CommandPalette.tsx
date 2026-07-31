import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search, ArrowRight, Command, X } from 'lucide-react';
import { normalizeRole } from '@shared/authz';

interface NavEntry {
  labelKey: string;
  path: string;
  groupKey?: string;
  requiredPermission?: string;
}

/**
 * Flat nav index for search.
 * Paths are relative to /h/:slug/ (same as Sidebar).
 * Add new items here when adding sidebar nav items.
 */
const NAV_INDEX: Record<string, NavEntry[]> = {
  super_admin: [
    { labelKey: 'dashboard', path: 'dashboard', groupKey: 'groupPlatform' },
    { labelKey: 'hospitals', path: 'hospitals', groupKey: 'groupPlatform' },
    { labelKey: 'onboarding', path: 'onboarding', groupKey: 'groupPlatform' },
    { labelKey: 'audit', path: 'audit', groupKey: 'groupPlatform' },
    { labelKey: 'health', path: 'health', groupKey: 'groupPlatform' },
    { labelKey: 'settings', path: 'settings', groupKey: 'groupPlatform' },
  ],
  hospital_admin: [
    // Operations
    { labelKey: 'dashboard', path: 'dashboard', groupKey: 'groupOperations' },
    { labelKey: 'patientsOverview', path: 'patients', groupKey: 'groupPatientFlow', requiredPermission: 'patients:read' },
    { labelKey: 'appointments', path: 'appointments', groupKey: 'groupPatientFlow', requiredPermission: 'appointments:read' },
    { labelKey: 'opdQueue', path: 'queue-management', groupKey: 'groupPatientFlow', requiredPermission: 'appointments:read' },
    { labelKey: 'emergency', path: 'emergency', groupKey: 'groupPatientFlow', requiredPermission: 'emergency:read' },
    { labelKey: 'mlc', path: 'mlc', groupKey: 'groupPatientFlow', requiredPermission: 'emergency:read' },
    { labelKey: 'ot', path: 'ot', groupKey: 'groupWardsOt', requiredPermission: 'ot:read' },
    { labelKey: 'cssd', path: 'cssd', groupKey: 'groupWardsOt', requiredPermission: 'ot:read' },
    { labelKey: 'admissionsOverview', path: 'admissions', groupKey: 'groupWardsOt', requiredPermission: 'admissions:read' },
    { labelKey: 'beds', path: 'beds', groupKey: 'groupWardsOt', requiredPermission: 'beds:read' },
    { labelKey: 'nurseStation', path: 'nurse-station', groupKey: 'groupWardsOt', requiredPermission: 'nursing:read' },
    { labelKey: 'nursing', path: 'nursing', groupKey: 'groupWardsOt', requiredPermission: 'nursing:read' },
    { labelKey: 'doctorSchedule', path: 'doctor-schedule', groupKey: 'groupDoctorServices', requiredPermission: 'schedule:read' },
    { labelKey: 'doctors', path: 'doctors', groupKey: 'groupDoctorServices', requiredPermission: 'doctor:read' },
    { labelKey: 'telemedicine', path: 'telemedicine', groupKey: 'groupDoctorServices', requiredPermission: 'telemedicine:read' },
    { labelKey: 'maternity', path: 'maternity', groupKey: 'groupDoctorServices', requiredPermission: 'clinical:read' },
    { labelKey: 'kitchen', path: 'kitchen', groupKey: 'groupSupportServices', requiredPermission: 'admissions:read' },
    { labelKey: 'laundry', path: 'laundry', groupKey: 'groupSupportServices', requiredPermission: 'admissions:read' },
    { labelKey: 'housekeeping', path: 'housekeeping', groupKey: 'groupSupportServices', requiredPermission: 'admissions:read' },
    { labelKey: 'ambulance', path: 'ambulance', groupKey: 'groupSupportServices', requiredPermission: 'emergency:read' },
    { labelKey: 'mortuary', path: 'mortuary', groupKey: 'groupSupportServices', requiredPermission: 'admissions:read' },
    { labelKey: 'bioWaste', path: 'biomedical-waste', groupKey: 'groupSupportServices', requiredPermission: 'admissions:read' },
    { labelKey: 'wardSupply', path: 'ward-supply', groupKey: 'groupSupportServices', requiredPermission: 'inventory:read' },
    { labelKey: 'helpdesk', path: 'helpdesk', groupKey: 'groupSupportServices', requiredPermission: 'helpdesk:read' },
    // Clinical
    { labelKey: 'labOverview', path: 'tests', groupKey: 'labMenu', requiredPermission: 'tests:read' },
    { labelKey: 'labSettings', path: 'lab-settings', groupKey: 'labMenu', requiredPermission: 'lab-settings:read' },
    { labelKey: 'radiology', path: 'radiology', groupKey: 'labMenu', requiredPermission: 'radiology:read' },
    { labelKey: 'labMachines', path: 'lab-machines', groupKey: 'labMenu', requiredPermission: 'lab-settings:read' },
    { labelKey: 'pharmacyOverview', path: 'pharmacy', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'invoices', path: 'pharmacy/invoices', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'prescriptions', path: 'pharmacy/prescriptions', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'stock', path: 'pharmacy/stock', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'purchaseOrders', path: 'pharmacy/po', groupKey: 'pharmacy', requiredPermission: 'pharmacy:write' },
    { labelKey: 'items', path: 'pharmacy/items', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'suppliers', path: 'pharmacy/suppliers', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'narcoticRegister', path: 'pharmacy/narcotics', groupKey: 'pharmacy', requiredPermission: 'pharmacy:read' },
    { labelKey: 'inventory', path: 'inventory', groupKey: 'groupInventory', requiredPermission: 'inventory:read' },
    { labelKey: 'inventoryIssues', path: 'inventory/issues', groupKey: 'groupInventory', requiredPermission: 'inventory:consume' },
    { labelKey: 'inventoryConsumptionRules', path: 'inventory/consumption-rules', groupKey: 'groupInventory', requiredPermission: 'inventory:write' },
    { labelKey: 'inventoryConsumptionQueue', path: 'inventory/consumption-queue', groupKey: 'groupInventory', requiredPermission: 'inventory:consume' },
    { labelKey: 'inventoryConsumptionExceptions', path: 'inventory/consumption-exceptions', groupKey: 'groupInventory', requiredPermission: 'inventory:consume' },
    { labelKey: 'inventoryTransfers', path: 'inventory/transfers', groupKey: 'groupInventory', requiredPermission: 'inventory:transfer' },
    { labelKey: 'inventoryReturns', path: 'inventory/returns', groupKey: 'groupInventory', requiredPermission: 'inventory:consume' },
    { labelKey: 'stockCounts', path: 'inventory/counts', groupKey: 'groupInventory', requiredPermission: 'inventory:write' },
    { labelKey: 'inventoryReports', path: 'inventory/reports', groupKey: 'groupInventory', requiredPermission: 'inventory:reports' },
    { labelKey: 'writeOffs', path: 'inventory/write-off', groupKey: 'groupInventory', requiredPermission: 'inventory:write' },
    { labelKey: 'masterData', path: 'inventory/master-data', groupKey: 'groupInventory', requiredPermission: 'inventory:write' },
    { labelKey: 'medicalRecords', path: 'medical-records', groupKey: 'groupPatientRecords', requiredPermission: 'medicalrecords:read' },
    { labelKey: 'vitals', path: 'vitals', groupKey: 'groupPatientRecords', requiredPermission: 'vitals:read' },
    { labelKey: 'allergies', path: 'allergies', groupKey: 'groupPatientRecords', requiredPermission: 'allergies:read' },
    { labelKey: 'clinicalAssessments', path: 'clinical', groupKey: 'groupClinicalAssessments', requiredPermission: 'clinical:read' },
    { labelKey: 'carePlans', path: 'care-plans', groupKey: 'groupClinicalAssessments', requiredPermission: 'clinical:read' },
    { labelKey: 'trackAnything', path: 'track-anything', groupKey: 'groupClinicalAssessments', requiredPermission: 'clinical:read' },
    { labelKey: 'questionnaires', path: 'questionnaires', groupKey: 'groupClinicalAssessments', requiredPermission: 'clinical:read' },
    { labelKey: 'dictation', path: 'dictation', groupKey: 'groupClinicalAssessments', requiredPermission: 'clinical:read' },
    { labelKey: 'surgery', path: 'surgery', groupKey: 'groupProcedures', requiredPermission: 'clinical:read' },
    { labelKey: 'procedureOrders', path: 'procedure-orders', groupKey: 'groupProcedures', requiredPermission: 'clinical:read' },
    { labelKey: 'ePrescribing', path: 'e-prescribing', groupKey: 'groupProcedures', requiredPermission: 'eprescribing:read' },
    { labelKey: 'bloodBank', path: 'blood-bank', groupKey: 'groupProcedures', requiredPermission: 'admissions:read' },
    { labelKey: 'dental', path: 'dental', groupKey: 'groupSpecialty', requiredPermission: 'dental:read' },
    { labelKey: 'psychiatry', path: 'psychiatry', groupKey: 'groupSpecialty', requiredPermission: 'psychiatry:read' },
    { labelKey: 'eyeExam', path: 'eye-exam', groupKey: 'groupSpecialty', requiredPermission: 'clinical:read' },
    { labelKey: 'physicalExam', path: 'physical-exam', groupKey: 'groupSpecialty', requiredPermission: 'clinical:read' },
    { labelKey: 'vaccination', path: 'vaccination', groupKey: 'groupSpecialty', requiredPermission: 'vaccination:read' },
    // Finance
    { labelKey: 'billingOverview', path: 'billing', groupKey: 'billing', requiredPermission: 'billing:read' },
    { labelKey: 'billingCounter', path: 'billing-counter', groupKey: 'billing', requiredPermission: 'billing:read' },
    { labelKey: 'billingMaster', path: 'billing-master', groupKey: 'billing', requiredPermission: 'billing-master:read' },
    { labelKey: 'provisionalBilling', path: 'billing-provisional', groupKey: 'billing', requiredPermission: 'provisional-billing:read' },
    { labelKey: 'deposits', path: 'deposits', groupKey: 'billing', requiredPermission: 'deposits:read' },
    { labelKey: 'creditNotes', path: 'credit-notes', groupKey: 'billing', requiredPermission: 'credit-notes:read' },
    { labelKey: 'billHandover', path: 'billing-handover', groupKey: 'billing', requiredPermission: 'handover:read' },
    { labelKey: 'billCancellation', path: 'billing-cancellation', groupKey: 'billing', requiredPermission: 'cancellation:read' },
    { labelKey: 'settlements', path: 'settlements', groupKey: 'billing', requiredPermission: 'settlements:read' },
    { labelKey: 'insurance', path: 'insurance-claims', groupKey: 'billing', requiredPermission: 'insurance:read' },
    { labelKey: 'insuranceBilling', path: 'insurance-billing', groupKey: 'billing', requiredPermission: 'insurance:read' },
    { labelKey: 'ipBilling', path: 'ip-billing', groupKey: 'billing', requiredPermission: 'ip-billing:read' },
    { labelKey: 'payments', path: 'payments', groupKey: 'billing', requiredPermission: 'payments:read' },
    { labelKey: 'doctorCommissions', path: 'commissions', groupKey: 'billing', requiredPermission: 'commissions:read' },
    { labelKey: 'accountingOverview', path: 'accounting', groupKey: 'accountsMenu', requiredPermission: 'accounting:read' },
    { labelKey: 'cashBankBook', path: 'cash-bank-book', groupKey: 'accountsMenu', requiredPermission: 'accounting:read' },
    { labelKey: 'income', path: 'income', groupKey: 'accountsMenu', requiredPermission: 'income:read' },
    { labelKey: 'expenses', path: 'expenses', groupKey: 'accountsMenu', requiredPermission: 'expenses:read' },
    { labelKey: 'accounts', path: 'accounts', groupKey: 'accountsMenu', requiredPermission: 'accounting:read' },
    { labelKey: 'journal', path: 'journal', groupKey: 'accountsMenu', requiredPermission: 'accounting:read' },
    { labelKey: 'profit', path: 'profit-loss', groupKey: 'accountsMenu', requiredPermission: 'profit:calculate' },
    // Admin
    { labelKey: 'staffOverview', path: 'staff', groupKey: 'groupHRStaff', requiredPermission: 'staff:read' },
    { labelKey: 'hrPayroll', path: 'hr', groupKey: 'groupHRStaff', requiredPermission: 'hr:read' },
    { labelKey: 'leaveManagement', path: 'hr/leave', groupKey: 'groupHRStaff', requiredPermission: 'hr:read' },
    { labelKey: 'dutyRoster', path: 'duty-roster', groupKey: 'groupHRStaff', requiredPermission: 'hr:read' },
    { labelKey: 'attendance', path: 'attendance-punch', groupKey: 'groupHRStaff', requiredPermission: 'hr:read' },
    { labelKey: 'shareholders', path: 'shareholders', groupKey: 'groupHRStaff', requiredPermission: 'shareholders:read' },
    { labelKey: 'reportsOverview', path: 'reports', groupKey: 'groupReportsAudit', requiredPermission: 'reports:read' },
    { labelKey: 'pdfGeneration', path: 'reports/pdf', groupKey: 'groupReportsAudit', requiredPermission: 'reports:read' },
    { labelKey: 'labReports', path: 'reports/lab', groupKey: 'groupReportsAudit', requiredPermission: 'reports:read' },
    { labelKey: 'pharmacyReports', path: 'reports/pharmacy', groupKey: 'groupReportsAudit', requiredPermission: 'reports:read' },
    { labelKey: 'appointmentReports', path: 'reports/appointments', groupKey: 'groupReportsAudit', requiredPermission: 'reports:read' },
    { labelKey: 'systemAudit', path: 'system-audit', groupKey: 'groupReportsAudit', requiredPermission: 'audit:read' },
    { labelKey: 'patientDuplicates', path: 'patient-duplicates', groupKey: 'groupReportsAudit', requiredPermission: 'patients:read' },
    { labelKey: 'inbox', path: 'inbox', groupKey: 'groupSystem', requiredPermission: 'inbox:read' },
    { labelKey: 'formBuilder', path: 'form-builder', groupKey: 'groupSystem', requiredPermission: 'settings:write' },
    { labelKey: 'multiBranch', path: 'multi-branch', groupKey: 'groupSystem', requiredPermission: 'multi-branch:read' },
    { labelKey: 'assetManagement', path: 'asset-management', groupKey: 'groupSystem', requiredPermission: 'inventory:read' },
    { labelKey: 'setupWizard', path: 'setup', groupKey: 'groupSystem', requiredPermission: 'settings:read' },
    { labelKey: 'whatsapp', path: 'whatsapp', groupKey: 'groupSystem', requiredPermission: 'settings:read' },
    { labelKey: 'website', path: 'website', groupKey: 'groupSystem', requiredPermission: 'website:read' },
    { labelKey: 'printTemplates', path: 'print-templates', groupKey: 'groupSystem', requiredPermission: 'settings:read' },
    { labelKey: 'settings', path: 'settings', groupKey: 'groupSystem', requiredPermission: 'settings:read' },
    { labelKey: 'marketingReferral', path: 'marketing-referral', groupKey: 'groupMarketing', requiredPermission: 'marketing-referral:read' },
    { labelKey: 'referrals', path: 'referrals', groupKey: 'groupMarketing', requiredPermission: 'patients:read' },
    { labelKey: 'reviewModeration', path: 'review-moderation', groupKey: 'groupMarketing', requiredPermission: 'settings:read' },
    { labelKey: 'marketplaceBookings', path: 'marketplace-bookings', groupKey: 'groupMarketing', requiredPermission: 'settings:read' },
    { labelKey: 'helpCenter', path: 'help', groupKey: 'groupAdmin' },
  ],
  // Simplified entries for other roles
  doctor: [
    { labelKey: 'dashboard', path: 'doctor/dashboard', groupKey: 'groupOperations' },
    { labelKey: 'patients', path: 'patients', groupKey: 'groupClinical', requiredPermission: 'patients:read' },
    { labelKey: 'prescriptions', path: 'prescriptions/new', groupKey: 'groupClinical', requiredPermission: 'prescriptions:write' },
    { labelKey: 'telemedicine', path: 'telemedicine', groupKey: 'groupClinical', requiredPermission: 'telemedicine:read' },
    { labelKey: 'helpCenter', path: 'help', groupKey: 'groupSupport' },
  ],
  nurse: [
    { labelKey: 'nurseStation', path: 'nurse-station' },
    { labelKey: 'nursing', path: 'nursing', requiredPermission: 'nursing:read' },
    { labelKey: 'vitals', path: 'vitals', requiredPermission: 'vitals:read' },
    { labelKey: 'patients', path: 'patients', requiredPermission: 'patients:read' },
    { labelKey: 'helpCenter', path: 'help' },
  ],
  reception: [
    { labelKey: 'dailyDesk', path: 'reception/dashboard', groupKey: 'groupOperations' },
    { labelKey: 'opdSerial', path: 'reception/appointments', groupKey: 'groupOperations', requiredPermission: 'appointments:read' },
    { labelKey: 'billingCounter', path: 'reception/billing-counter', groupKey: 'groupOperations', requiredPermission: 'billing:read' },
    { labelKey: 'admissions', path: 'reception/admissions', groupKey: 'groupOperations', requiredPermission: 'admissions:read' },
    { labelKey: 'patients', path: 'reception/patients', requiredPermission: 'patients:read' },
    { labelKey: 'billing', path: 'reception/billing', requiredPermission: 'billing:read' },
    { labelKey: 'settlements', path: 'reception/settlements', requiredPermission: 'billing:read' },
    { labelKey: 'helpCenter', path: 'reception/help' },
  ],
  manager: [
    { labelKey: 'managerOverview', path: 'manager/dashboard', groupKey: 'groupOperations', requiredPermission: 'dashboard:read' },
    { labelKey: 'patients', path: 'reception/patients', groupKey: 'groupOperations', requiredPermission: 'patients:read' },
    { labelKey: 'opdSerial', path: 'reception/appointments', groupKey: 'groupOperations', requiredPermission: 'appointments:read' },
    { labelKey: 'billingCounter', path: 'reception/billing-counter', groupKey: 'groupOperations', requiredPermission: 'billing:read' },
    { labelKey: 'cashOperations', path: 'reception/cash-operations', groupKey: 'groupOperations', requiredPermission: 'billing:read' },
    { labelKey: 'labDashboard', path: 'lab/dashboard', groupKey: 'groupLaboratory', requiredPermission: 'tests:read' },
    { labelKey: 'labOrders', path: 'lab/orders', groupKey: 'groupLaboratory', requiredPermission: 'tests:write' },
    { labelKey: 'reportDelivery', path: 'reception/reports', groupKey: 'groupReportsAnalytics', requiredPermission: 'billing:read' },
  ],
  laboratory: [
    { labelKey: 'dashboard', path: 'lab/dashboard' },
    { labelKey: 'tests', path: 'lab/tests', requiredPermission: 'tests:read' },
    { labelKey: 'monitoring', path: 'lab/monitoring', requiredPermission: 'tests:read' },
  ],
  pharmacist: [
    { labelKey: 'dashboard', path: 'pharmacy/dashboard' },
    { labelKey: 'invoices', path: 'pharmacy/invoices', requiredPermission: 'pharmacy:read' },
    { labelKey: 'prescriptions', path: 'pharmacy/prescriptions', requiredPermission: 'pharmacy:read' },
    { labelKey: 'stock', path: 'pharmacy/stock', requiredPermission: 'pharmacy:read' },
    { labelKey: 'purchaseOrders', path: 'pharmacy/po', requiredPermission: 'pharmacy:write' },
    { labelKey: 'items', path: 'pharmacy/items', requiredPermission: 'pharmacy:read' },
    { labelKey: 'suppliers', path: 'pharmacy/suppliers', requiredPermission: 'pharmacy:read' },
    { labelKey: 'helpCenter', path: 'pharmacy/help' },
  ],
  accountant: [
    { labelKey: 'dashboard', path: 'accountant/dashboard' },
    { labelKey: 'accounting', path: 'accountant/accounting', requiredPermission: 'accounting:read' },
    { labelKey: 'billingCounter', path: 'accountant/billing-counter', requiredPermission: 'billing:read' },
    { labelKey: 'cashBankBook', path: 'accountant/cash-bank-book', requiredPermission: 'accounting:read' },
    { labelKey: 'income', path: 'accountant/income', requiredPermission: 'income:read' },
    { labelKey: 'expenses', path: 'accountant/expenses', requiredPermission: 'expenses:read' },
    { labelKey: 'reports', path: 'accountant/reports', requiredPermission: 'reports:read' },
    { labelKey: 'helpCenter', path: 'help' },
  ],
  md: [
    { labelKey: 'dashboard', path: 'md/dashboard' },
    { labelKey: 'accounting', path: 'md/accounting', requiredPermission: 'accounting:read' },
    { labelKey: 'income', path: 'md/income', requiredPermission: 'income:read' },
    { labelKey: 'expenses', path: 'md/expenses', requiredPermission: 'expenses:read' },
    { labelKey: 'reports', path: 'md/reports', requiredPermission: 'reports:read' },
    { labelKey: 'staff', path: 'md/staff', requiredPermission: 'staff:read' },
    { labelKey: 'hrPayroll', path: 'md/hr', requiredPermission: 'hr:read' },
    { labelKey: 'profit', path: 'md/profit', requiredPermission: 'profit:calculate' },
    { labelKey: 'helpCenter', path: 'md/help' },
  ],
  director: [
    { labelKey: 'dashboard', path: 'director/dashboard' },
    { labelKey: 'accounting', path: 'director/accounting', requiredPermission: 'accounting:read' },
    { labelKey: 'reports', path: 'director/reports', requiredPermission: 'reports:read' },
    { labelKey: 'shareholders', path: 'director/shareholders', requiredPermission: 'shareholders:read' },
    { labelKey: 'profit', path: 'director/profit', requiredPermission: 'profit:calculate' },
    { labelKey: 'settings', path: 'director/settings', requiredPermission: 'settings:read' },
    { labelKey: 'helpCenter', path: 'director/help' },
  ],
};

// Additional aliases for better search matching
const SEARCH_ALIASES: Record<string, string[]> = {
  'patients': ['patient', 'opd', 'ipd', 'admit'],
  'billing': ['bill', 'invoice', 'payment', 'cash', 'money'],
  'pharmacy': ['medicine', 'drug', 'tablet', 'capsule'],
  'inventory': ['stock', 'item', 'warehouse', 'supply'],
  'appointments': ['appointment', 'booking', 'schedule', 'serial'],
  'admissions': ['admission', 'ipd', 'bed', 'indoor'],
  'laboratory': ['lab', 'test', 'report', 'pathology'],
  'accounting': ['account', 'finance', 'ledger', 'journal'],
  'settings': ['setting', 'config', 'configuration'],
  'reports': ['report', 'analytics', 'summary'],
  'staff': ['employee', 'staff', 'worker'],
  'doctors': ['doctor', 'physician', 'consultant'],
  'emergency': ['emergency', 'er', 'casualty'],
  'ot': ['operation', 'theatre', 'surgery', 'ot'],
  'beds': ['bed', 'ward', 'room'],
  'nurseStation': ['nurse', 'nursing', 'station'],
  'telemedicine': ['tele', 'video', 'call', 'online'],
  'helpCenter': ['help', 'support', 'faq'],
};

interface CommandPaletteProps {
  role: string;
  permissions: string[];
}

export default function CommandPalette({ role, permissions }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation('sidebar');
  const normalizedRole = normalizeRole(role) || role;

  const base = slug ? `/h/${slug}` : normalizedRole === 'super_admin' ? '/super-admin' : '';
  const entryLabel = useCallback((labelKey: string) => t(labelKey, {
    defaultValue: labelKey === 'cashBankBook' ? 'Cash & Bank Book' : labelKey,
  }), [t]);

  // Permission check (same logic as Sidebar)
  const hasPermission = useCallback((perm?: string): boolean => {
    if (!perm) return true;
    if (normalizedRole === 'hospital_admin' || normalizedRole === 'super_admin') return true;
    if (permissions.includes('*')) return true;
    return permissions.includes(perm);
  }, [normalizedRole, permissions]);

  // Flatten and filter nav items
  const results = useMemo(() => {
    const entries = NAV_INDEX[normalizedRole] ?? (slug ? NAV_INDEX.hospital_admin : []) ?? [];
    const filtered = entries.filter((entry) => {
      if (!hasPermission(entry.requiredPermission)) return false;
      if (!query.trim()) return true;

      const label = entryLabel(entry.labelKey).toLowerCase();
      const q = query.toLowerCase().trim();

      // Direct match
      if (label.includes(q)) return true;

      // Path match
      if (entry.path.toLowerCase().includes(q)) return true;

      // Alias match
      const aliases = SEARCH_ALIASES[entry.labelKey] || [];
      if (aliases.some((a) => a.includes(q))) return true;

      // Group match
      if (entry.groupKey) {
        const groupLabel = t(entry.groupKey, { defaultValue: entry.groupKey }).toLowerCase();
        if (groupLabel.includes(q)) return true;
      }

      return false;
    });

    return filtered.slice(0, 15); // Limit results
  }, [normalizedRole, query, hasPermission, t, slug, entryLabel]);

  // Keyboard shortcut: ⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to allow the modal to render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((path: string) => {
    const fullPath = path.startsWith('/')
      ? path
      : `${base}/${path}`.replace(/\/+/g, '/');
    navigate(fullPath);
    setOpen(false);
  }, [navigate, base]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex].path);
        }
        break;
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg mx-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search navigation"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-5 h-5 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, modules, actions..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            aria-label="Search navigation"
            aria-expanded={true}
            aria-controls="command-palette-results"
            aria-activedescendant={results[selectedIndex] ? `cmd-result-${selectedIndex}` : undefined}
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded">
            ESC
          </kbd>
          <button
            onClick={() => setOpen(false)}
            className="sm:hidden p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-80 overflow-y-auto overscroll-contain py-2"
        >
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
              {query.trim() ? 'No results found' : 'Type to search...'}
            </div>
          ) : (
            results.map((entry, index) => {
              const label = entryLabel(entry.labelKey);
              const groupLabel = entry.groupKey
                ? t(entry.groupKey, { defaultValue: entry.groupKey })
                : null;

              return (
                <button
                  key={`${entry.path}-${index}`}
                  id={`cmd-result-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onClick={() => handleSelect(entry.path)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset
                    ${index === selectedIndex
                      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)]'
                    }
                  `}
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{label}</span>
                    {groupLabel && (
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        {groupLabel}
                      </span>
                    )}
                  </div>
                  {index === selectedIndex && (
                    <ArrowRight className="w-4 h-4 shrink-0 text-[var(--color-primary)]" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded">esc</kbd>
              close
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3" />K to open
          </span>
        </div>
      </div>
    </div>
  );
}
