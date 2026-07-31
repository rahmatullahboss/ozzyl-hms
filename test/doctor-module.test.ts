import { describe, it, expect } from 'vitest';
import {
  deriveDoctorDashboardStatus,
  doctorQueueSortRank,
  formatAppointmentTypeLabel,
  formatBillingStatusLabel,
  summarizeDoctorQueue,
  resolveDoctorDashboardDate,
  isAllowedDoctorDashboardAction,
  appointmentStatusForDoctorAction,
  queueStatusForDoctorAction,
  derivePatientMedicalSnapshot,
  deriveClinicalPriority,
  validatePrescriptionBeforeSave,
  getTestPackage,
  listTestPackages,
  applyPrescriptionTemplate,
  buildQuickPrescription,
  formatPrescriptionForPrint,
  generatePrescriptionQRData,
  formatPrescriptionItemsForPrint,
  type PatientSnapshotInput,
  type ClinicalPriorityInput,
  type PrescriptionTemplate,
} from '../src/lib/doctor-dashboard';

// ─── deriveDoctorDashboardStatus ─────────────────────────────────────────────

describe('deriveDoctorDashboardStatus', () => {
  it('returns cancelled for cancelled appointment', () => {
    expect(deriveDoctorDashboardStatus('cancelled', null)).toBe('cancelled');
    expect(deriveDoctorDashboardStatus(null, 'cancelled')).toBe('cancelled');
  });

  it('returns no_show for no_show appointment', () => {
    expect(deriveDoctorDashboardStatus('no_show', null)).toBe('no_show');
  });

  it('returns completed for completed appointment', () => {
    expect(deriveDoctorDashboardStatus('completed', null)).toBe('completed');
  });

  it('returns completed for completed queue status', () => {
    expect(deriveDoctorDashboardStatus(null, 'completed')).toBe('completed');
  });

  it('returns in_progress for in_progress appointment', () => {
    expect(deriveDoctorDashboardStatus('in_progress', null)).toBe('in_progress');
  });

  it('returns in_progress for serving queue status', () => {
    expect(deriveDoctorDashboardStatus(null, 'serving')).toBe('in_progress');
  });

  it('returns in_progress for called queue status', () => {
    expect(deriveDoctorDashboardStatus(null, 'called')).toBe('in_progress');
  });

  it('returns in_progress for in_room queue status', () => {
    expect(deriveDoctorDashboardStatus(null, 'in_room')).toBe('in_progress');
  });

  it('returns pending_approval for pending_approval appointment', () => {
    expect(deriveDoctorDashboardStatus('pending_approval', null)).toBe('pending_approval');
  });

  it('returns waiting as default', () => {
    expect(deriveDoctorDashboardStatus(null, null)).toBe('waiting');
    expect(deriveDoctorDashboardStatus('checked_in', 'waiting')).toBe('waiting');
  });

  it('is case insensitive', () => {
    expect(deriveDoctorDashboardStatus('CANCELLED', null)).toBe('cancelled');
    expect(deriveDoctorDashboardStatus(null, 'SERVING')).toBe('in_progress');
  });
});

// ─── doctorQueueSortRank ─────────────────────────────────────────────────────

describe('doctorQueueSortRank', () => {
  it('in_progress gets rank 0 (highest priority)', () => {
    expect(doctorQueueSortRank({ status: 'in_progress' })).toBe(0);
  });

  it('emergency gets rank 1', () => {
    expect(doctorQueueSortRank({ visit_type: 'emergency' })).toBe(1);
    expect(doctorQueueSortRank({ queue_priority: 'emergency' })).toBe(1);
  });

  it('urgent gets rank 2', () => {
    expect(doctorQueueSortRank({ queue_priority: 'urgent' })).toBe(2);
  });

  it('waiting gets rank 3', () => {
    expect(doctorQueueSortRank({ status: 'waiting' })).toBe(3);
  });

  it('completed gets rank 5', () => {
    expect(doctorQueueSortRank({ status: 'completed' })).toBe(5);
  });

  it('no_show gets rank 6', () => {
    expect(doctorQueueSortRank({ status: 'no_show' })).toBe(6);
  });

  it('unknown status gets rank 7', () => {
    expect(doctorQueueSortRank({ status: 'checked_in' })).toBe(7);
  });
});

// ─── formatAppointmentTypeLabel ──────────────────────────────────────────────

describe('formatAppointmentTypeLabel', () => {
  it('formats known types', () => {
    expect(formatAppointmentTypeLabel('new_patient')).toBe('New');
    expect(formatAppointmentTypeLabel('old_patient')).toBe('Follow up');
    expect(formatAppointmentTypeLabel('follow_up')).toBe('Follow up');
    expect(formatAppointmentTypeLabel('report_show')).toBe('Report show');
    expect(formatAppointmentTypeLabel('free_visit')).toBe('Free approved');
    expect(formatAppointmentTypeLabel('discounted_visit')).toBe('Discounted');
    expect(formatAppointmentTypeLabel('emergency')).toBe('Emergency');
  });

  it('handles null/undefined', () => {
    expect(formatAppointmentTypeLabel(null)).toBe('Visit');
    expect(formatAppointmentTypeLabel(undefined)).toBe('Visit');
    expect(formatAppointmentTypeLabel('')).toBe('Visit');
  });

  it('formats unknown types by replacing underscores', () => {
    expect(formatAppointmentTypeLabel('some_new_type')).toBe('some new type');
  });
});

// ─── formatBillingStatusLabel ────────────────────────────────────────────────

describe('formatBillingStatusLabel', () => {
  it('formats known statuses', () => {
    expect(formatBillingStatusLabel('paid')).toBe('Paid');
    expect(formatBillingStatusLabel('due_approved')).toBe('Due approved');
    expect(formatBillingStatusLabel('no_charge')).toBe('No charge');
    expect(formatBillingStatusLabel('pending')).toBe('Pending bill');
    expect(formatBillingStatusLabel('unpaid')).toBe('Unpaid');
    expect(formatBillingStatusLabel('partial_paid')).toBe('Partial paid');
  });

  it('handles null/undefined', () => {
    expect(formatBillingStatusLabel(null)).toBe('Billing');
    expect(formatBillingStatusLabel(undefined)).toBe('Billing');
  });
});

// ─── summarizeDoctorQueue ────────────────────────────────────────────────────

describe('summarizeDoctorQueue', () => {
  it('counts empty queue', () => {
    const result = summarizeDoctorQueue([]);
    expect(result).toEqual({ total: 0, completed: 0, waiting: 0, in_progress: 0 });
  });

  it('counts statuses correctly', () => {
    const queue = [
      { status: 'waiting' },
      { status: 'waiting' },
      { status: 'in_progress' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ];
    const result = summarizeDoctorQueue(queue);
    expect(result.total).toBe(6);
    expect(result.waiting).toBe(2);
    expect(result.in_progress).toBe(1);
    expect(result.completed).toBe(3);
  });

  it('handles null statuses', () => {
    const queue = [
      { status: null },
      { status: undefined },
      {},
    ];
    const result = summarizeDoctorQueue(queue);
    expect(result.total).toBe(3);
    expect(result.waiting).toBe(3); // null/undefined default to 'waiting'
  });
});

// ─── resolveDoctorDashboardDate ──────────────────────────────────────────────

describe('resolveDoctorDashboardDate', () => {
  it('returns valid date as-is', () => {
    expect(resolveDoctorDashboardDate('2026-01-15', '2026-05-30')).toBe('2026-01-15');
  });

  it('returns today for null/undefined', () => {
    expect(resolveDoctorDashboardDate(null, '2026-05-30')).toBe('2026-05-30');
    expect(resolveDoctorDashboardDate(undefined, '2026-05-30')).toBe('2026-05-30');
  });

  it('returns today for invalid format', () => {
    expect(resolveDoctorDashboardDate('invalid', '2026-05-30')).toBe('2026-05-30');
    expect(resolveDoctorDashboardDate('15-01-2026', '2026-05-30')).toBe('2026-05-30');
  });
});

// ─── isAllowedDoctorDashboardAction ──────────────────────────────────────────

describe('isAllowedDoctorDashboardAction', () => {
  it('accepts valid actions', () => {
    expect(isAllowedDoctorDashboardAction('waiting')).toBe(true);
    expect(isAllowedDoctorDashboardAction('in_progress')).toBe(true);
    expect(isAllowedDoctorDashboardAction('completed')).toBe(true);
    expect(isAllowedDoctorDashboardAction('no_show')).toBe(true);
  });

  it('rejects invalid actions', () => {
    expect(isAllowedDoctorDashboardAction('cancelled')).toBe(false);
    expect(isAllowedDoctorDashboardAction('pending_approval')).toBe(false);
    expect(isAllowedDoctorDashboardAction('unknown')).toBe(false);
  });
});

// ─── appointmentStatusForDoctorAction ────────────────────────────────────────

describe('appointmentStatusForDoctorAction', () => {
  it('maps completed to completed', () => {
    expect(appointmentStatusForDoctorAction('completed')).toBe('completed');
  });

  it('maps no_show to no_show', () => {
    expect(appointmentStatusForDoctorAction('no_show')).toBe('no_show');
  });

  it('maps everything else to checked_in', () => {
    expect(appointmentStatusForDoctorAction('waiting')).toBe('checked_in');
    expect(appointmentStatusForDoctorAction('in_progress')).toBe('checked_in');
  });
});

// ─── queueStatusForDoctorAction ──────────────────────────────────────────────

describe('queueStatusForDoctorAction', () => {
  it('maps completed to completed', () => {
    expect(queueStatusForDoctorAction('completed')).toBe('completed');
  });

  it('maps no_show to no_show', () => {
    expect(queueStatusForDoctorAction('no_show')).toBe('no_show');
  });

  it('maps in_progress to serving', () => {
    expect(queueStatusForDoctorAction('in_progress')).toBe('serving');
  });

  it('maps waiting to waiting', () => {
    expect(queueStatusForDoctorAction('waiting')).toBe('waiting');
  });
});

// ─── derivePatientMedicalSnapshot ─────────────────────────────────────────────

describe('derivePatientMedicalSnapshot', () => {
  it('returns empty snapshot for null input', () => {
    const result = derivePatientMedicalSnapshot(null as any);
    expect(result).toEqual({
      age: null,
      bloodGroup: null,
      chronicConditions: [],
      allergies: [],
      lastVisitDate: null,
      lastDiagnosis: null,
      lastHbA1c: null,
      currentVitals: null,
    });
  });

  it('calculates age from date of birth', () => {
    const result = derivePatientMedicalSnapshot({
      date_of_birth: '1968-05-15',
    } as PatientSnapshotInput);
    expect(result.age).toBe(58); // 2026 - 1968
  });

  it('returns null age when no DOB', () => {
    const result = derivePatientMedicalSnapshot({} as PatientSnapshotInput);
    expect(result.age).toBeNull();
  });

  it('extracts blood group', () => {
    const result = derivePatientMedicalSnapshot({
      blood_group: 'B+',
    } as PatientSnapshotInput);
    expect(result.bloodGroup).toBe('B+');
  });

  it('extracts chronic conditions from active problems', () => {
    const result = derivePatientMedicalSnapshot({
      active_problems: [
        { problem_name: 'Hypertension', status: 'active' },
        { problem_name: 'Diabetes Mellitus', status: 'active' },
        { problem_name: 'Appendicitis', status: 'resolved' },
      ],
    } as PatientSnapshotInput);
    expect(result.chronicConditions).toEqual(['Hypertension', 'Diabetes Mellitus']);
  });

  it('extracts allergies with severity', () => {
    const result = derivePatientMedicalSnapshot({
      allergies: [
        { allergen: 'Penicillin', severity: 'severe' },
        { allergen: 'Aspirin', severity: 'mild' },
      ],
    } as PatientSnapshotInput);
    expect(result.allergies).toEqual([
      { name: 'Penicillin', severity: 'severe' },
      { name: 'Aspirin', severity: 'mild' },
    ]);
  });

  it('extracts last visit info', () => {
    const result = derivePatientMedicalSnapshot({
      last_visit: {
        visit_date: '2026-01-12',
        diagnosis: 'Acute Bronchitis',
      },
    } as PatientSnapshotInput);
    expect(result.lastVisitDate).toBe('2026-01-12');
    expect(result.lastDiagnosis).toBe('Acute Bronchitis');
  });

  it('extracts last HbA1c from lab results', () => {
    const result = derivePatientMedicalSnapshot({
      recent_labs: [
        { test_name: 'HbA1c', result_value: '8.2', test_date: '2026-01-10' },
        { test_name: 'FBS', result_value: '120', test_date: '2026-01-10' },
      ],
    } as PatientSnapshotInput);
    expect(result.lastHbA1c).toBe('8.2');
  });

  it('returns null HbA1c when no matching lab', () => {
    const result = derivePatientMedicalSnapshot({
      recent_labs: [
        { test_name: 'FBS', result_value: '120', test_date: '2026-01-10' },
      ],
    } as PatientSnapshotInput);
    expect(result.lastHbA1c).toBeNull();
  });

  it('extracts current vitals', () => {
    const result = derivePatientMedicalSnapshot({
      vitals: {
        systolic: 160,
        diastolic: 100,
        heart_rate: 88,
        temperature: 98.6,
        spo2: 97,
      },
    } as PatientSnapshotInput);
    expect(result.currentVitals).toEqual({
      bp: '160/100',
      heartRate: 88,
      temperature: 98.6,
      spo2: 97,
    });
  });

  it('handles missing vitals gracefully', () => {
    const result = derivePatientMedicalSnapshot({} as PatientSnapshotInput);
    expect(result.currentVitals).toBeNull();
  });

  it('handles partial vitals', () => {
    const result = derivePatientMedicalSnapshot({
      vitals: { systolic: 140, diastolic: 90 },
    } as PatientSnapshotInput);
    expect(result.currentVitals).toEqual({
      bp: '140/90',
      heartRate: null,
      temperature: null,
      spo2: null,
    });
  });
});

// ─── deriveClinicalPriority ───────────────────────────────────────────────────

describe('deriveClinicalPriority', () => {
  it('returns normal for healthy adult', () => {
    const result = deriveClinicalPriority({ age: 35 } as ClinicalPriorityInput);
    expect(result).toEqual({ level: 'normal', label: null, color: null });
  });

  it('returns elderly for age 65+', () => {
    const result = deriveClinicalPriority({ age: 68 } as ClinicalPriorityInput);
    expect(result).toEqual({ level: 'elderly', label: 'বয়স্ক', color: 'amber' });
  });

  it('returns elderly for age exactly 65', () => {
    const result = deriveClinicalPriority({ age: 65 } as ClinicalPriorityInput);
    expect(result.level).toBe('elderly');
  });

  it('returns child for age under 12', () => {
    const result = deriveClinicalPriority({ age: 8 } as ClinicalPriorityInput);
    expect(result).toEqual({ level: 'child', label: 'শিশু', color: 'blue' });
  });

  it('returns child for age exactly 11', () => {
    const result = deriveClinicalPriority({ age: 11 } as ClinicalPriorityInput);
    expect(result.level).toBe('child');
  });

  it('returns normal for age 12', () => {
    const result = deriveClinicalPriority({ age: 12 } as ClinicalPriorityInput);
    expect(result.level).toBe('normal');
  });

  it('returns pregnant when pregnancy flag is set', () => {
    const result = deriveClinicalPriority({
      age: 30,
      is_pregnant: true,
    } as ClinicalPriorityInput);
    expect(result).toEqual({ level: 'pregnant', label: 'গর্ভবতী', color: 'pink' });
  });

  it('returns vitals_abnormal for critically high BP', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: { systolic: 185, diastolic: 115 },
    } as ClinicalPriorityInput);
    expect(result).toEqual({ level: 'vitals_abnormal', label: 'Vitals Alert', color: 'red' });
  });

  it('returns vitals_abnormal for critically low SpO2', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: { spo2: 88 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('vitals_abnormal');
  });

  it('returns vitals_abnormal for high fever', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: { temperature: 104.5 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('vitals_abnormal');
  });

  it('returns normal for borderline vitals', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: { systolic: 135, diastolic: 85, spo2: 96, temperature: 99.0 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('normal');
  });

  it('priority order: vitals_abnormal > pregnant > elderly > child > normal', () => {
    // elderly + vitals abnormal → vitals_abnormal wins
    const result = deriveClinicalPriority({
      age: 70,
      vitals: { systolic: 190, diastolic: 120 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('vitals_abnormal');
  });

  it('handles null age', () => {
    const result = deriveClinicalPriority({} as ClinicalPriorityInput);
    expect(result.level).toBe('normal');
  });
});

// ─── validatePrescriptionBeforeSave ──────────────────────────────────────────

describe('validatePrescriptionBeforeSave', () => {
  const validRx = {
    diagnosis: 'Fever',
    items: [{ medicine: 'Napa', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
    followUpDate: '2026-06-15',
    patientAllergies: [] as string[],
  };

  it('returns no warnings for valid prescription', () => {
    const result = validatePrescriptionBeforeSave(validRx);
    expect(result.warnings).toEqual([]);
    expect(result.canSave).toBe(true);
  });

  it('warns when diagnosis is empty', () => {
    const result = validatePrescriptionBeforeSave({ ...validRx, diagnosis: '' });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'diagnosis',
      severity: 'warning',
    }));
  });

  it('warns when no medicines', () => {
    const result = validatePrescriptionBeforeSave({ ...validRx, items: [] });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'items',
      severity: 'warning',
    }));
  });

  it('warns when medicine has no dose', () => {
    const result = validatePrescriptionBeforeSave({
      ...validRx,
      items: [{ medicine: 'Napa', dose: '', frequency: '1+0+1', duration: '5 days' }],
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'dose',
      severity: 'warning',
      message: expect.stringContaining('Napa'),
    }));
  });

  it('warns when medicine has no duration', () => {
    const result = validatePrescriptionBeforeSave({
      ...validRx,
      items: [{ medicine: 'Napa', dose: '500mg', frequency: '1+0+1', duration: '' }],
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'duration',
      severity: 'warning',
    }));
  });

  it('warns when no follow-up date', () => {
    const result = validatePrescriptionBeforeSave({ ...validRx, followUpDate: '' });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'followUpDate',
      severity: 'info',
    }));
  });

  it('blocks when patient has allergy to prescribed drug', () => {
    const result = validatePrescriptionBeforeSave({
      ...validRx,
      patientAllergies: ['Paracetamol'],
      items: [{ medicine: 'Paracetamol', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      field: 'allergy',
      severity: 'error',
    }));
    expect(result.canSave).toBe(false);
  });

  it('allows save when allergy warning is not blocking', () => {
    const result = validatePrescriptionBeforeSave({
      ...validRx,
      patientAllergies: ['Penicillin'],
      items: [{ medicine: 'Paracetamol', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
    });
    expect(result.canSave).toBe(true);
  });

  it('warns for multiple missing fields', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: '',
      items: [],
      followUpDate: '',
      patientAllergies: [],
    });
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Test Packages ───────────────────────────────────────────────────────────

describe('getTestPackage', () => {
  it('returns fever panel tests', () => {
    const result = getTestPackage('fever');
    expect(result).toContainEqual(expect.objectContaining({ name: 'CBC' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'CRP' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'Dengue NS1' }));
  });

  it('returns diabetes follow-up tests', () => {
    const result = getTestPackage('diabetes');
    expect(result).toContainEqual(expect.objectContaining({ name: 'FBS' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'HbA1c' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'Creatinine' }));
  });

  it('returns cardiac panel tests', () => {
    const result = getTestPackage('cardiac');
    expect(result).toContainEqual(expect.objectContaining({ name: 'ECG' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'Troponin-I' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'Lipid Profile' }));
  });

  it('returns empty array for unknown package', () => {
    const result = getTestPackage('unknown');
    expect(result).toEqual([]);
  });

  it('returns case-insensitive result', () => {
    const result = getTestPackage('FEVER');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('listTestPackages', () => {
  it('returns all available packages', () => {
    const result = listTestPackages();
    expect(result).toContainEqual(expect.objectContaining({ key: 'fever', name: expect.any(String) }));
    expect(result).toContainEqual(expect.objectContaining({ key: 'diabetes', name: expect.any(String) }));
    expect(result).toContainEqual(expect.objectContaining({ key: 'cardiac', name: expect.any(String) }));
  });

  it('each package has name and test count', () => {
    const result = listTestPackages();
    for (const pkg of result) {
      expect(pkg.name).toBeTruthy();
      expect(pkg.testCount).toBeGreaterThan(0);
    }
  });
});

// ─── applyPrescriptionTemplate ───────────────────────────────────────────────

describe('applyPrescriptionTemplate', () => {
  const template: PrescriptionTemplate = {
    name: 'Typhoid Treatment',
    diagnosis: 'Typhoid Fever',
    items: [
      { medicine: 'Cefixime 200mg', dose: '1', frequency: '1+0+1', duration: '7 days', instruction: 'খাবার পরে' },
      { medicine: 'Paracetamol 500mg', dose: '1', frequency: '1+0+1', duration: '5 days', instruction: 'জ্বর থাকলে' },
    ],
    advice: ['পর্যাপ্ত পানি পান করুন', 'বিশ্রাম নিন'],
    followUpDays: 7,
    tests: ['CBC', 'Widal Test'],
  };

  it('returns full prescription from template', () => {
    const result = applyPrescriptionTemplate(template);
    expect(result.diagnosis).toBe('Typhoid Fever');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].medicine).toBe('Cefixime 200mg');
    expect(result.advice).toContain('পর্যাপ্ত পানি পান করুন');
    expect(result.followUpDays).toBe(7);
    expect(result.tests).toEqual(['CBC', 'Widal Test']);
  });

  it('calculates follow-up date from today', () => {
    const result = applyPrescriptionTemplate(template, '2026-05-30');
    expect(result.followUpDate).toBe('2026-06-06');
  });

  it('handles template with no tests', () => {
    const result = applyPrescriptionTemplate({
      ...template,
      tests: undefined,
    });
    expect(result.tests).toEqual([]);
  });

  it('handles template with no advice', () => {
    const result = applyPrescriptionTemplate({
      ...template,
      advice: undefined,
    });
    expect(result.advice).toEqual([]);
  });

  it('handles empty items', () => {
    const result = applyPrescriptionTemplate({
      ...template,
      items: [],
    });
    expect(result.items).toEqual([]);
  });
});

// ─── buildQuickPrescription ──────────────────────────────────────────────────

describe('buildQuickPrescription', () => {
  it('builds prescription from minimal input', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever for 3 days',
      diagnosis: 'Viral Fever',
      medicineName: 'Paracetamol 500mg',
    });
    expect(result.chiefComplaint).toBe('Fever for 3 days');
    expect(result.diagnosis).toBe('Viral Fever');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].medicine).toBe('Paracetamol 500mg');
    expect(result.items[0].frequency).toBe('1+0+1');
    expect(result.items[0].duration).toBe('5 days');
  });

  it('uses default dose when not provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Headache',
      diagnosis: 'Tension Headache',
      medicineName: 'Napa 500mg',
    });
    expect(result.items[0].frequency).toBe('1+0+1');
    expect(result.items[0].duration).toBe('5 days');
    expect(result.items[0].instruction).toBe('খাবার পরে');
  });

  it('uses custom dose when provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Cough',
      diagnosis: 'URTI',
      medicineName: 'Azithromycin 500mg',
      frequency: '1+0+0',
      duration: '3 days',
      instruction: 'খাবার আগে',
    });
    expect(result.items[0].frequency).toBe('1+0+0');
    expect(result.items[0].duration).toBe('3 days');
    expect(result.items[0].instruction).toBe('খাবার আগে');
  });

  it('includes common tests for diagnosis', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Dengue',
      medicineName: 'Paracetamol',
      includeCommonTests: true,
    });
    expect(result.tests.length).toBeGreaterThan(0);
  });

  it('returns empty tests when not requested', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral Fever',
      medicineName: 'Paracetamol',
    });
    expect(result.tests).toEqual([]);
  });

  it('includes follow-up date', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral Fever',
      medicineName: 'Paracetamol',
      followUpDays: 3,
      today: '2026-05-30',
    });
    expect(result.followUpDate).toBe('2026-06-02');
  });

  it('handles multiple medicines', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever + Cough',
      diagnosis: 'URTI',
      medicineName: 'Paracetamol 500mg',
      additionalMedicines: [
        { medicine: 'Cetirizine 10mg', frequency: '0+0+1', duration: '5 days' },
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[1].medicine).toBe('Cetirizine 10mg');
  });
});

// ─── formatPrescriptionForPrint ──────────────────────────────────────────────

describe('formatPrescriptionForPrint', () => {
  const prescription = {
    rx_no: 'RX-2026-0042',
    patient_name: 'Karim Uddin',
    patient_code: 'P-10058',
    patient_age: 58,
    patient_gender: 'Male',
    patient_phone: '01712345678',
    doctor_name: 'Dr. Rahima Begum',
    doctor_degree: 'MBBS, FCPS (Medicine)',
    doctor_bmdc: 'BMDC-12345',
    doctor_specialty: 'Medicine',
    hospital_name: 'City Hospital',
    hospital_address: 'Dhaka, Bangladesh',
    diagnosis: 'Type 2 Diabetes Mellitus, Hypertension',
    items: [
      { medicine: 'Metformin 500mg', dose: '1', frequency: '1+0+1', duration: '30 days', instruction: 'খাবার পরে' },
      { medicine: 'Amlodipine 5mg', dose: '1', frequency: '1+0+0', duration: '30 days', instruction: 'সকালে' },
    ],
    advice: 'পর্যাপ্ত পানি পান করুন। নিয়মিত ব্যায়াম করুন।',
    follow_up_date: '2026-06-30',
    tests: ['FBS', 'HbA1c', 'Creatinine'],
    created_at: '2026-05-30T10:30:00Z',
  };

  it('formats prescription data for print', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.header.doctorName).toBe('Dr. Rahima Begum');
    expect(result.header.doctorDegree).toBe('MBBS, FCPS (Medicine)');
    expect(result.header.bmdc).toBe('BMDC-12345');
    expect(result.header.hospitalName).toBe('City Hospital');
  });

  it('includes patient info', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.patient.name).toBe('Karim Uddin');
    expect(result.patient.code).toBe('P-10058');
    expect(result.patient.age).toBe(58);
    expect(result.patient.gender).toBe('Male');
  });

  it('formats date in Bangladeshi format', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.date).toBeTruthy();
    expect(result.date).toContain('2026');
  });

  it('includes Rx items with numbered list', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].number).toBe(1);
    expect(result.items[0].medicine).toBe('Metformin 500mg');
    expect(result.items[0].doseInstruction).toContain('1+0+1');
    expect(result.items[0].doseInstruction).toContain('30 days');
  });

  it('includes diagnosis', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.diagnosis).toBe('Type 2 Diabetes Mellitus, Hypertension');
  });

  it('includes advice', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.advice).toBe('পর্যাপ্ত পানি পান করুন। নিয়মিত ব্যায়াম করুন।');
  });

  it('includes follow-up date', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.followUpDate).toBe('2026-06-30');
  });

  it('includes tests', () => {
    const result = formatPrescriptionForPrint(prescription);
    expect(result.tests).toEqual(['FBS', 'HbA1c', 'Creatinine']);
  });

  it('handles empty items', () => {
    const result = formatPrescriptionForPrint({ ...prescription, items: [] });
    expect(result.items).toEqual([]);
  });

  it('handles missing optional fields', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
    });
    expect(result.patient.name).toBe('Test');
    expect(result.header.doctorName).toBe('');
    expect(result.diagnosis).toBe('');
  });
});

// ─── generatePrescriptionQRData ──────────────────────────────────────────────

describe('generatePrescriptionQRData', () => {
  it('generates QR data with prescription URL', () => {
    const result = generatePrescriptionQRData({
      rxNo: 'RX-2026-0042',
      patientCode: 'P-10058',
      baseUrl: 'https://hms.example.com',
    });
    expect(result).toContain('RX-2026-0042');
    expect(result).toContain('P-10058');
    expect(result).toContain('https://');
  });

  it('includes verification hash', () => {
    const result = generatePrescriptionQRData({
      rxNo: 'RX-2026-0042',
      patientCode: 'P-10058',
      baseUrl: 'https://hms.example.com',
    });
    expect(result).toContain('verify=');
  });

  it('generates different hashes for different prescriptions', () => {
    const result1 = generatePrescriptionQRData({ rxNo: 'RX-001', patientCode: 'P-001', baseUrl: 'https://example.com' });
    const result2 = generatePrescriptionQRData({ rxNo: 'RX-002', patientCode: 'P-002', baseUrl: 'https://example.com' });
    expect(result1).not.toBe(result2);
  });
});

// ─── formatPrescriptionItemsForPrint ─────────────────────────────────────────

describe('formatPrescriptionItemsForPrint', () => {
  it('formats items with Bengali dose instructions', () => {
    const items = [
      { medicine: 'Napa 500mg', dose: '1', frequency: '1+0+1', duration: '5 days', instruction: 'খাবার পরে' },
    ];
    const result = formatPrescriptionItemsForPrint(items);
    expect(result[0].line).toContain('Napa 500mg');
    expect(result[0].line).toContain('১+০+১');
    expect(result[0].line).toContain('৫ দিন');
    expect(result[0].line).toContain('খাবার পরে');
  });

  it('converts numbers to Bengali', () => {
    const items = [
      { medicine: 'Test', dose: '2', frequency: '1+1+1', duration: '10 days', instruction: '' },
    ];
    const result = formatPrescriptionItemsForPrint(items);
    expect(result[0].line).toContain('২');
    expect(result[0].line).toContain('১+১+১');
    expect(result[0].line).toContain('১০ দিন');
  });

  it('handles empty instruction', () => {
    const items = [
      { medicine: 'Paracetamol', dose: '1', frequency: '1+0+1', duration: '3 days', instruction: '' },
    ];
    const result = formatPrescriptionItemsForPrint(items);
    expect(result[0].line).toContain('Paracetamol');
    expect(result[0].line).not.toContain('undefined');
  });

  it('numbers items sequentially', () => {
    const items = [
      { medicine: 'A', dose: '1', frequency: '1+0+0', duration: '3 days', instruction: '' },
      { medicine: 'B', dose: '1', frequency: '0+0+1', duration: '5 days', instruction: '' },
      { medicine: 'C', dose: '1', frequency: '1+1+1', duration: '7 days', instruction: '' },
    ];
    const result = formatPrescriptionItemsForPrint(items);
    expect(result[0].number).toBe(1);
    expect(result[1].number).toBe(2);
    expect(result[2].number).toBe(3);
  });
});

// ─── Branch Coverage: doctorQueueSortRank ─────────────────────────────────────

describe('doctorQueueSortRank — clinical priority branches', () => {
  it('vitals_abnormal gets rank 0.5', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'vitals_abnormal' })).toBe(0.5);
  });

  it('elderly gets rank 1.5', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'elderly' })).toBe(1.5);
  });

  it('child gets rank 1.5', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'child' })).toBe(1.5);
  });

  it('pregnant gets rank 1.5', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'pregnant' })).toBe(1.5);
  });

  it('normal clinical priority does not affect rank', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'normal', status: 'waiting' })).toBe(3);
  });

  it('cancelled gets rank 6', () => {
    expect(doctorQueueSortRank({ status: 'cancelled' })).toBe(6);
  });

  it('clinical_priority_level case insensitive', () => {
    expect(doctorQueueSortRank({ clinical_priority_level: 'VITALS_ABNORMAL' })).toBe(0.5);
    expect(doctorQueueSortRank({ clinical_priority_level: 'ELDERLY' })).toBe(1.5);
  });
});

// ─── Branch Coverage: formatAppointmentTypeLabel ─────────────────────────────

describe('formatAppointmentTypeLabel — additional branches', () => {
  it('formats followup (without underscore)', () => {
    expect(formatAppointmentTypeLabel('followup')).toBe('Follow up');
  });

  it('formats telemedicine', () => {
    expect(formatAppointmentTypeLabel('telemedicine')).toBe('telemedicine');
  });

  it('formats opd', () => {
    expect(formatAppointmentTypeLabel('opd')).toBe('opd');
  });
});

// ─── Branch Coverage: formatBillingStatusLabel ────────────────────────────────

describe('formatBillingStatusLabel — additional branches', () => {
  it('formats refunded', () => {
    expect(formatBillingStatusLabel('refunded')).toBe('Refunded');
  });

  it('formats cancelled', () => {
    expect(formatBillingStatusLabel('cancelled')).toBe('Cancelled');
  });

  it('formats unknown status by replacing underscores', () => {
    expect(formatBillingStatusLabel('some_custom_status')).toBe('some custom status');
  });

  it('returns Billing for empty string', () => {
    expect(formatBillingStatusLabel('')).toBe('Billing');
  });
});

// ─── Branch Coverage: derivePatientMedicalSnapshot ────────────────────────────

describe('derivePatientMedicalSnapshot — additional branches', () => {
  it('handles invalid date of birth gracefully', () => {
    const result = derivePatientMedicalSnapshot({
      date_of_birth: 'not-a-date',
    } as PatientSnapshotInput);
    expect(result.age).toBeNull();
  });

  it('handles date_of_birth with only year', () => {
    const result = derivePatientMedicalSnapshot({
      date_of_birth: 'not-a-valid-date',
    } as PatientSnapshotInput);
    expect(result.age).toBeNull();
  });

  it('filters out resolved problems', () => {
    const result = derivePatientMedicalSnapshot({
      active_problems: [
        { problem_name: 'HTN', status: 'active' },
        { problem_name: 'Appendicitis', status: 'resolved' },
        { problem_name: 'DM', status: 'active' },
      ],
    } as PatientSnapshotInput);
    expect(result.chronicConditions).toEqual(['HTN', 'DM']);
  });

  it('handles empty active_problems array', () => {
    const result = derivePatientMedicalSnapshot({
      active_problems: [],
    } as PatientSnapshotInput);
    expect(result.chronicConditions).toEqual([]);
  });

  it('handles empty allergies array', () => {
    const result = derivePatientMedicalSnapshot({
      allergies: [],
    } as PatientSnapshotInput);
    expect(result.allergies).toEqual([]);
  });

  it('handles vitals with only systolic (no diastolic)', () => {
    const result = derivePatientMedicalSnapshot({
      vitals: { systolic: 140 },
    } as PatientSnapshotInput);
    expect(result.currentVitals?.bp).toBe('-');
  });

  it('handles vitals with only diastolic (no systolic)', () => {
    const result = derivePatientMedicalSnapshot({
      vitals: { diastolic: 90 },
    } as PatientSnapshotInput);
    expect(result.currentVitals?.bp).toBe('-');
  });

  it('handles null vitals fields', () => {
    const result = derivePatientMedicalSnapshot({
      vitals: { systolic: null, diastolic: null, heart_rate: null, temperature: null, spo2: null },
    } as PatientSnapshotInput);
    expect(result.currentVitals?.bp).toBe('-');
    expect(result.currentVitals?.heartRate).toBeNull();
    expect(result.currentVitals?.temperature).toBeNull();
    expect(result.currentVitals?.spo2).toBeNull();
  });

  it('handles multiple HbA1c results (takes first)', () => {
    const result = derivePatientMedicalSnapshot({
      recent_labs: [
        { test_name: 'HbA1c', result_value: '7.5', test_date: '2026-01-01' },
        { test_name: 'HbA1c', result_value: '8.0', test_date: '2026-03-01' },
      ],
    } as PatientSnapshotInput);
    expect(result.lastHbA1c).toBe('7.5');
  });

  it('handles labs with no HbA1c', () => {
    const result = derivePatientMedicalSnapshot({
      recent_labs: [
        { test_name: 'FBS', result_value: '120', test_date: '2026-01-01' },
        { test_name: 'CBC', result_value: 'Normal', test_date: '2026-01-01' },
      ],
    } as PatientSnapshotInput);
    expect(result.lastHbA1c).toBeNull();
  });

  it('handles last_visit as null', () => {
    const result = derivePatientMedicalSnapshot({
      last_visit: null,
    } as PatientSnapshotInput);
    expect(result.lastVisitDate).toBeNull();
    expect(result.lastDiagnosis).toBeNull();
  });
});

// ─── Branch Coverage: deriveClinicalPriority ──────────────────────────────────

describe('deriveClinicalPriority — additional branches', () => {
  it('returns vitals_abnormal for critically low diastolic only', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: { diastolic: 125 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('vitals_abnormal');
  });

  it('returns normal for null vitals', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: null,
    } as ClinicalPriorityInput);
    expect(result.level).toBe('normal');
  });

  it('returns normal for empty vitals', () => {
    const result = deriveClinicalPriority({
      age: 35,
      vitals: {},
    } as ClinicalPriorityInput);
    expect(result.level).toBe('normal');
  });

  it('returns normal for age exactly 12', () => {
    const result = deriveClinicalPriority({ age: 12 });
    expect(result.level).toBe('normal');
  });

  it('returns elderly for age exactly 65', () => {
    const result = deriveClinicalPriority({ age: 65 });
    expect(result.level).toBe('elderly');
  });

  it('pregnant takes priority over elderly', () => {
    const result = deriveClinicalPriority({
      age: 70,
      is_pregnant: true,
    } as ClinicalPriorityInput);
    expect(result.level).toBe('pregnant');
  });

  it('vitals_abnormal takes priority over pregnant', () => {
    const result = deriveClinicalPriority({
      age: 30,
      is_pregnant: true,
      vitals: { spo2: 85 },
    } as ClinicalPriorityInput);
    expect(result.level).toBe('vitals_abnormal');
  });

  it('handles zero age', () => {
    const result = deriveClinicalPriority({ age: 0 });
    expect(result.level).toBe('child');
  });
});

// ─── Branch Coverage: validatePrescriptionBeforeSave ─────────────────────────

describe('validatePrescriptionBeforeSave — additional branches', () => {
  it('handles undefined items', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: 'Fever',
      items: undefined,
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ field: 'items' }));
  });

  it('handles null patientAllergies', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: 'Fever',
      items: [{ medicine: 'Paracetamol', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
      patientAllergies: null as any,
    });
    expect(result.canSave).toBe(true);
  });

  it('warns for both dose and duration missing', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: 'Fever',
      items: [{ medicine: 'Napa', dose: '', frequency: '1+0+1', duration: '' }],
    });
    const doseWarnings = result.warnings.filter(w => w.field === 'dose');
    const durationWarnings = result.warnings.filter(w => w.field === 'duration');
    expect(doseWarnings.length).toBe(1);
    expect(durationWarnings.length).toBe(1);
  });

  it('does not warn when followUpDate is provided', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: 'Fever',
      items: [{ medicine: 'Napa', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
      followUpDate: '2026-06-15',
    });
    expect(result.warnings.filter(w => w.field === 'followUpDate')).toHaveLength(0);
  });

  it('does not match allergy when medicine and allergy are completely different', () => {
    const result = validatePrescriptionBeforeSave({
      diagnosis: 'Fever',
      items: [{ medicine: 'Paracetamol', dose: '500mg', frequency: '1+0+1', duration: '5 days' }],
      patientAllergies: ['Penicillin'],
    });
    expect(result.warnings.filter(w => w.field === 'allergy')).toHaveLength(0);
  });
});

// ─── Branch Coverage: buildQuickPrescription ─────────────────────────────────

describe('buildQuickPrescription — additional branches', () => {
  it('suggests typhoid tests', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Typhoid Fever',
      medicineName: 'Cefixime',
      includeCommonTests: true,
    });
    expect(result.tests).toContain('Widal Test');
    expect(result.tests).toContain('Blood Culture');
  });

  it('suggests malaria tests', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever with chills',
      diagnosis: 'Malaria',
      medicineName: 'Chloroquine',
      includeCommonTests: true,
    });
    expect(result.tests).toContain('MP Slide');
    expect(result.tests).toContain('Rapid Malaria Test');
  });

  it('suggests diabetes tests for DM diagnosis', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Follow up',
      diagnosis: 'DM Type 2',
      medicineName: 'Metformin',
      includeCommonTests: true,
    });
    expect(result.tests).toContain('FBS');
    expect(result.tests).toContain('HbA1c');
  });

  it('suggests generic tests for unknown diagnosis', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Pain',
      diagnosis: 'Arthritis',
      medicineName: 'Ibuprofen',
      includeCommonTests: true,
    });
    expect(result.tests).toContain('CBC');
    expect(result.tests).toContain('CRP');
  });

  it('uses custom instruction when provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral',
      medicineName: 'Paracetamol',
      instruction: 'খালি পেটে',
    });
    expect(result.items[0].instruction).toBe('খালি পেটে');
  });

  it('uses custom frequency when provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral',
      medicineName: 'Paracetamol',
      frequency: '1+1+1',
    });
    expect(result.items[0].frequency).toBe('1+1+1');
  });

  it('uses custom duration when provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral',
      medicineName: 'Paracetamol',
      duration: '3 days',
    });
    expect(result.items[0].duration).toBe('3 days');
  });

  it('follow-up date defaults to null when not provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral',
      medicineName: 'Paracetamol',
    });
    expect(result.followUpDate).toBeNull();
  });

  it('additional medicines use defaults when not provided', () => {
    const result = buildQuickPrescription({
      chiefComplaint: 'Fever',
      diagnosis: 'Viral',
      medicineName: 'Paracetamol',
      additionalMedicines: [{ medicine: 'Cetirizine' }],
    });
    expect(result.items[1].frequency).toBe('1+0+1');
    expect(result.items[1].duration).toBe('5 days');
    expect(result.items[1].instruction).toBe('খাবার পরে');
  });
});

// ─── Branch Coverage: applyPrescriptionTemplate ──────────────────────────────

describe('applyPrescriptionTemplate — additional branches', () => {
  it('uses default today when not provided', () => {
    const result = applyPrescriptionTemplate({
      name: 'Test',
      diagnosis: 'Test',
      items: [],
      followUpDays: 7,
    });
    expect(result.followUpDate).toBeTruthy();
    expect(result.followUpDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('followUpDays 0 means no follow-up date', () => {
    const result = applyPrescriptionTemplate({
      name: 'Test',
      diagnosis: 'Test',
      items: [],
      followUpDays: 0,
    }, '2026-05-30');
    expect(result.followUpDate).toBeNull();
    expect(result.followUpDays).toBe(0);
  });

  it('items with instruction use provided instruction', () => {
    const result = applyPrescriptionTemplate({
      name: 'Test',
      diagnosis: 'Test',
      items: [{ medicine: 'Napa', dose: '1', frequency: '1+0+1', duration: '5 days', instruction: 'খাবার আগে' }],
    });
    expect(result.items[0].instruction).toBe('খাবার আগে');
  });

  it('items without instruction default to empty string', () => {
    const result = applyPrescriptionTemplate({
      name: 'Test',
      diagnosis: 'Test',
      items: [{ medicine: 'Napa', dose: '1', frequency: '1+0+1', duration: '5 days' }],
    });
    expect(result.items[0].instruction).toBe('');
  });
});

// ─── Branch Coverage: formatPrescriptionForPrint ─────────────────────────────

describe('formatPrescriptionForPrint — additional branches', () => {
  it('uses current date when created_at is not provided', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
    });
    expect(result.date).toBeTruthy();
    expect(result.date).toContain('2026');
  });

  it('formats created_at date', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
      created_at: '2026-01-15T10:00:00Z',
    });
    expect(result.date).toContain('2026');
  });

  it('handles items with only medicine name (no optional fields)', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [{ medicine: 'Paracetamol' }],
    });
    expect(result.items[0].medicine).toBe('Paracetamol');
    expect(result.items[0].number).toBe(1);
  });

  it('handles items with partial fields', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [{ medicine: 'Napa', dose: '500mg' }],
    });
    expect(result.items[0].doseInstruction).toContain('500mg');
  });

  it('handles null advice', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
      advice: null,
    });
    expect(result.advice).toBe('');
  });

  it('handles null follow_up_date', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
      follow_up_date: null,
    });
    expect(result.followUpDate).toBeNull();
  });

  it('handles null tests', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
      tests: undefined,
    });
    expect(result.tests).toEqual([]);
  });

  it('handles null patient fields', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      items: [],
    });
    expect(result.patient.name).toBe('');
    expect(result.patient.code).toBe('');
    expect(result.patient.age).toBeNull();
    expect(result.patient.gender).toBeNull();
    expect(result.patient.phone).toBeNull();
  });

  it('handles null doctor fields', () => {
    const result = formatPrescriptionForPrint({
      rx_no: 'RX-001',
      patient_name: 'Test',
      items: [],
    });
    expect(result.header.doctorName).toBe('');
    expect(result.header.doctorDegree).toBe('');
    expect(result.header.bmdc).toBe('');
    expect(result.header.specialty).toBe('');
    expect(result.header.hospitalName).toBe('');
    expect(result.header.hospitalAddress).toBe('');
  });
});

// ─── Branch Coverage: formatPrescriptionItemsForPrint ────────────────────────

describe('formatPrescriptionItemsForPrint — additional branches', () => {
  it('handles Bengali duration map entries', () => {
    const durations = ['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '21 days', '30 days', '1 month', '3 months', 'continue'];
    for (const dur of durations) {
      const result = formatPrescriptionItemsForPrint([{ medicine: 'Test', duration: dur }]);
      expect(result[0].line).toBeTruthy();
    }
  });

  it('handles unknown duration with Bengali number conversion', () => {
    const result = formatPrescriptionItemsForPrint([{ medicine: 'Test', duration: '45 days' }]);
    expect(result[0].line).toContain('৪৫');
    expect(result[0].line).toContain('days');
  });

  it('handles all fields empty', () => {
    const result = formatPrescriptionItemsForPrint([{ medicine: 'Test' }]);
    expect(result[0].line).toContain('Test');
    expect(result[0].number).toBe(1);
  });

  it('handles instruction field', () => {
    const result = formatPrescriptionItemsForPrint([{ medicine: 'Test', instruction: 'খাবার পরে' }]);
    expect(result[0].line).toContain('খাবার পরে');
  });

  it('converts multi-digit numbers to Bengali', () => {
    const result = formatPrescriptionItemsForPrint([{ medicine: 'Test', dose: '12', frequency: '1+1+1', duration: '15 days' }]);
    expect(result[0].line).toContain('১২');
    expect(result[0].line).toContain('১+১+১');
  });
});

// ─── Branch Coverage: summarizeDoctorQueue ────────────────────────────────────

describe('summarizeDoctorQueue — additional branches', () => {
  it('counts in_progress items', () => {
    const queue = [
      { status: 'in_progress' },
      { status: 'waiting' },
      { status: 'completed' },
    ];
    const result = summarizeDoctorQueue(queue);
    expect(result.in_progress).toBe(1);
    expect(result.waiting).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.total).toBe(3);
  });

  it('derives status from appointment status when queue status is not allowed', () => {
    const queue = [
      { status: 'checked_in' }, // not in allowed list, derives via deriveDoctorDashboardStatus
    ];
    const result = summarizeDoctorQueue(queue);
    expect(result.total).toBe(1);
    expect(result.waiting).toBe(1); // checked_in defaults to waiting
  });

  it('handles mixed statuses', () => {
    const queue = [
      { status: 'in_progress' },
      { status: 'in_progress' },
      { status: 'completed' },
      { status: 'no_show' },
      { status: null },          // waiting
    ];
    const result = summarizeDoctorQueue(queue);
    expect(result.total).toBe(5);
    expect(result.in_progress).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.waiting).toBe(1); // null → waiting
  });
});

// ─── Branch Coverage: resolveDoctorDashboardDate ─────────────────────────────

describe('resolveDoctorDashboardDate — additional branches', () => {
  it('returns today for empty string', () => {
    expect(resolveDoctorDashboardDate('', '2026-05-30')).toBe('2026-05-30');
  });

  it('returns today for date with wrong format', () => {
    expect(resolveDoctorDashboardDate('30/01/2026', '2026-05-30')).toBe('2026-05-30');
  });

  it('returns today for date with time component', () => {
    expect(resolveDoctorDashboardDate('2026-01-15T10:00:00', '2026-05-30')).toBe('2026-05-30');
  });

  it('accepts valid date at month boundary', () => {
    expect(resolveDoctorDashboardDate('2026-01-31', '2026-05-30')).toBe('2026-01-31');
  });

  it('accepts leap year date', () => {
    expect(resolveDoctorDashboardDate('2024-02-29', '2026-05-30')).toBe('2024-02-29');
  });
});

// ─── Branch Coverage: getTestPackage ──────────────────────────────────────────

describe('getTestPackage — additional branches', () => {
  it('returns renal panel', () => {
    const result = getTestPackage('renal');
    expect(result).toContainEqual(expect.objectContaining({ name: 'Creatinine' }));
    expect(result).toContainEqual(expect.objectContaining({ name: 'eGFR' }));
  });

  it('returns thyroid panel', () => {
    const result = getTestPackage('thyroid');
    expect(result).toContainEqual(expect.objectContaining({ name: 'TSH' }));
  });

  it('returns pregnancy panel', () => {
    const result = getTestPackage('pregnancy');
    expect(result).toContainEqual(expect.objectContaining({ name: 'Blood Group' }));
  });

  it('handles whitespace in key', () => {
    const result = getTestPackage('  fever  ');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty for empty string', () => {
    const result = getTestPackage('');
    expect(result).toEqual([]);
  });
});
