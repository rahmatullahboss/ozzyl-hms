import { describe, it, expect, vi } from 'vitest';
import patientsRoute from '../../../src/routes/tenant/patients';
import { createTestApp } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';

const TENANT_ID = 'tenant-1';

function queryOverride(sql: string, params: unknown[] = []) {
  const s = sql.toLowerCase();

  if (s.includes('from patients') && s.includes('patient_code')) {
    return {
      first: {
        id: 1,
        patient_code: 'P001',
        uhid: 'OZ-SELF-001',
        name: 'Rahim Uddin',
        age: 52,
        gender: 'male',
        blood_group: 'B+',
        date_of_birth: '1974-05-12',
        mobile: '01700000000',
      },
    };
  }

  if (s.includes('select id, uhid, age, date_of_birth from patients where id = ? and tenant_id = ?')) {
    return {
      first: {
        id: 1,
        uhid: 'OZ-SELF-001',
        age: 52,
        date_of_birth: '1974-05-12',
      },
    };
  }

  if (s.includes('from lab_test_catalog') && (s.includes('where id = ?') || s.includes('where ltc.id = ?'))) {
    return {
      first: {
        id: 5,
        code: 'CBC',
        name: 'CBC',
        category: 'Hematology',
        price: 600,
        billing_service_item_id: 901,
      },
    };
  }

  if (s.includes('from radiology_imaging_items') && s.includes('lower(name) = lower(?)')) {
    return {
      first: {
        id: 8,
        imaging_type_id: 2,
        name: 'Chest X-Ray',
        procedure_code: 'CXR',
        price_paisa: 1200,
      },
    };
  }

  if (s.includes('from radiology_imaging_items') && s.includes('where i.id = ?')) {
    return {
      first: {
        id: 8,
        imaging_type_id: 2,
        imaging_type_name: 'X-Ray',
        name: 'Chest X-Ray',
        procedure_code: 'CXR',
        price: 12,
        billing_service_item_id: 902,
      },
    };
  }

  if (s.includes('from clinicaldiagnosis')) {
    if (params[1] === 3001) {
      return {
        results: [
          {
            description: 'Type 2 diabetes mellitus',
            icd10_code: 'E11',
          },
        ],
      };
    }
    return { results: [] };
  }

  if (s.includes('from global_patient_identity') && s.includes('where uhid = ?')) {
    return {
      first: {
        id: 1000,
        claim_status: 'claimed',
        claimed_auth_user_id: 55,
      },
    };
  }

  if (s.includes('from global_patient_auth') && s.includes('where identity_id = ?') && s.includes('is_active = 1')) {
    return {
      results: [{ id: 55 }],
    };
  }

  if (s.includes('from global_family_links gfl') && s.includes('join global_patient_identity gpi on gpi.id = gfl.patient_identity_id')) {
    return {
      results: [
        {
          patient_identity_id: 2000,
          relationship: 'parent',
          uhid: 'OZ-PARENT-001',
          primary_name: 'Father One',
        },
      ],
    };
  }

  if (s.includes('from final_diagnosis')) {
    return {
      results: [
        {
          id: 41,
          icd10_code: 'I10',
          description: 'Hypertension',
          diagnosis_type: 'primary',
          notes: 'BP elevated in repeated visits',
          created_at: '2026-03-29T09:00:00Z',
          review_status: 'verified',
          reviewed_at: '2026-03-29T10:00:00Z',
          reviewed_by: 7,
          review_notes: 'Confirmed during follow-up review',
        },
      ],
    };
  }

  if (s.includes('from consultations con') && s.includes('where con.id = ?')) {
    return {
      first: {
        id: 1,
        scheduled_at: '2026-03-30T10:30:00Z',
        status: 'completed',
        notes: 'Persistent cough and low-grade fever for 5 days.',
        prescription: 'Azithromycin 500mg OD for 3 days',
        chief_complaint: 'Cough with fever',
        followup_date: '2026-04-05',
        doctor_name: 'Dr Karim',
      },
    };
  }

  if (s.includes('from patients p') && s.includes('join tenants t on t.id = p.tenant_id') && s.includes('p.uhid = ?')) {
    if (params[0] === 'OZ-PARENT-001') {
      return {
        results: [
          {
            tenant_id: TENANT_ID,
            hospital_name: 'Demo Hospital',
            patient_id: 3001,
          },
        ],
      };
    }
    return { results: [] };
  }

  if (s.includes('from consultations con') && s.includes('order by con.scheduled_at desc') && s.includes('limit 10')) {
    return {
      results: [
        {
          id: 2,
          scheduled_at: '2026-04-01T09:00:00Z',
          status: 'in_progress',
          notes: 'Reviewing persistent fever and hyperglycemia.',
          prescription: '',
          chief_complaint: 'Fever with uncontrolled diabetes',
          followup_date: null,
          doctor_name: 'Dr Karim',
        },
        {
          id: 1,
          scheduled_at: '2026-03-30T10:30:00Z',
          status: 'completed',
          notes: 'Persistent cough and low-grade fever for 5 days.',
          prescription: 'Azithromycin 500mg OD for 3 days',
          chief_complaint: 'Cough with fever',
          followup_date: '2026-04-05',
          doctor_name: 'Dr Karim',
        },
      ],
    };
  }

  if (s.includes('from consultations') && s.includes("status in ('scheduled', 'in_progress')") && s.includes('limit 1')) {
    return {
      first: {
        id: 2,
        status: 'in_progress',
        notes: 'Reviewing persistent fever and hyperglycemia.',
        prescription: '',
        followup_date: null,
      },
    };
  }

  if (s.includes('from consultations') && s.includes("status in ('scheduled', 'in_progress')") && s.includes('where id = ?')) {
    return {
      first: {
        id: 2,
        status: 'in_progress',
        notes: 'Reviewing persistent fever and hyperglycemia.',
        prescription: '',
        followup_date: null,
      },
    };
  }

  if (s.includes('from radiology_reports rr') && s.includes('where rr.id = ?')) {
    return {
      first: {
        id: 7,
        created_at: '2026-03-28T08:00:00Z',
        imaging_type_name: 'X-Ray',
        imaging_item_name: 'Chest X-Ray',
        performer_name: 'Dr Tasnim',
        report_text: 'Mild bilateral basal infiltrates, no pleural effusion.',
        indication: 'Fever and cough',
        radiology_number: 'RAD-20260328-001',
        order_status: 'final',
      },
    };
  }

  if (s.includes('from radiology_reports rr') && s.includes('where rr.tenant_id = ? and rr.patient_id = ? and rr.is_active = 1')) {
    return {
      results: [
        {
          id: 7,
          requisition_id: 5,
          created_at: '2026-03-28T08:00:00Z',
          imaging_type_name: 'X-Ray',
          imaging_item_name: 'Chest X-Ray',
          performer_name: 'Dr Tasnim',
          report_text: 'Mild bilateral basal infiltrates, no pleural effusion.',
          indication: 'Fever and cough',
          radiology_number: 'RAD-20260328-001',
          order_status: 'final',
        },
      ],
    };
  }

  if (s.includes('from formsoap') && s.includes('order by createdat desc')) {
    return {
      results: [
        {
          SOAPId: 11,
          PatientId: 1,
          EncounterId: 101,
          ChiefComplaint: 'Fever for 3 days',
          Subjective: 'Patient reports fever, body ache, dry cough.',
          Objective: 'Temp 101F, pulse 98, SpO2 97%.',
          Assessment: 'Likely viral febrile illness.',
          Plan: 'CBC, CRP, hydration, paracetamol, 48h review.',
          CreatedAt: '2026-03-31T09:15:00Z',
        },
      ],
    };
  }

  if (s.includes('from formsoap') && s.includes('where soapid = ?')) {
    return {
      first: {
        SOAPId: 11,
        PatientId: 1,
        EncounterId: 101,
        ChiefComplaint: 'Fever for 3 days',
        Subjective: 'Patient reports fever, body ache, dry cough.',
        Objective: 'Temp 101F, pulse 98, SpO2 97%.',
        Assessment: 'Likely viral febrile illness.',
        Plan: 'CBC, CRP, hydration, paracetamol, 48h review.',
        CreatedAt: '2026-03-31T09:15:00Z',
      },
    };
  }

  if (s.includes('from cln_problemlist') && s.includes('where problemid = ?')) {
    return {
      first: {
        ProblemId: 21,
        ICD10Code: 'E11',
        Description: 'Type 2 diabetes mellitus',
        Severity: 'moderate',
        Status: 'active',
        BegDate: '2024-01-10',
        EndDate: null,
        Comments: 'On oral agents',
        ModifiedAt: '2026-03-30T07:00:00Z',
      },
    };
  }

  if (s.includes('from cln_problemlist')) {
    return {
      results: [
        {
          ProblemId: 21,
          icd10_code: 'E11',
          description: 'Type 2 diabetes mellitus',
          severity: 'moderate',
          status: 'active',
          onset_date: '2024-01-10',
          end_date: null,
          comments: 'On oral agents',
          updated_at: '2026-03-30T07:00:00Z',
        },
        {
          ProblemId: 22,
          icd10_code: 'J06',
          description: 'Upper respiratory infection',
          severity: 'mild',
          status: 'resolved',
          onset_date: '2026-03-01',
          end_date: '2026-03-05',
          comments: 'Recovered',
          updated_at: '2026-03-05T10:00:00Z',
        },
      ],
    };
  }

  if (s.includes('from patient_active_medications') && s.includes('where id = ?')) {
    return {
      first: {
        id: 31,
        medication_name: 'Metformin',
        generic_name: 'Metformin',
        dosage: '500mg',
        frequency: 'BID',
        duration: '30 days',
        instructions: 'After meals',
        start_date: '2026-03-01',
        end_date: null,
        status: 'active',
        status_reason: null,
        source: 'prescribed',
        review_status: 'verified',
        reviewed_at: '2026-03-02T09:00:00Z',
        reviewed_by: 7,
        review_notes: 'Continuing chronic medication',
      },
    };
  }

  if (s.includes('from patient_active_medications')) {
    return {
      results: [
        {
          id: 31,
          medication_name: 'Metformin',
          generic_name: 'Metformin',
          dosage: '500mg',
          frequency: 'BID',
          duration: '30 days',
          instructions: 'After meals',
          start_date: '2026-03-01',
          end_date: '2026-04-05',
          status: 'active',
          status_reason: null,
          source: 'prescribed',
          prescription_id: 90,
          review_status: 'verified',
          reviewed_at: '2026-03-02T09:00:00Z',
          reviewed_by: 7,
          review_notes: 'Continuing chronic medication',
        },
        {
          id: 33,
          medication_name: 'Salbutamol Inhaler',
          generic_name: 'Salbutamol',
          dosage: '2 puff',
          frequency: 'PRN',
          duration: '14 days',
          instructions: 'Use for wheeze',
          start_date: '2026-03-20',
          end_date: '2026-04-03',
          status: 'on_hold',
          status_reason: 'Hold pending reassessment',
          source: 'prescribed',
          prescription_id: 92,
          review_status: 'pending_review',
          reviewed_at: null,
          reviewed_by: null,
          review_notes: null,
        },
        {
          id: 32,
          medication_name: 'Azithromycin',
          generic_name: 'Azithromycin',
          dosage: '500mg',
          frequency: 'OD',
          duration: '3 days',
          instructions: 'Completed course',
          start_date: '2026-03-28',
          end_date: '2026-03-30',
          status: 'completed',
          status_reason: 'Course finished',
          source: 'prescribed',
          prescription_id: 91,
          review_status: 'rejected',
          reviewed_at: '2026-03-30T10:00:00Z',
          reviewed_by: 9,
          review_notes: 'Patient-reported completion noted after course end',
        },
      ],
    };
  }

  if (s.includes('from patient_allergies') && s.includes('where id = ?')) {
    return {
      first: {
        id: 41,
        allergy_type: 'drug',
        allergen: 'Penicillin',
        severity: 'severe',
        reaction: 'Rash and wheeze',
        onset_date: '2020-01-01',
        notes: 'Avoid beta-lactams if possible',
        verified_at: '2026-03-20T09:00:00Z',
        review_status: 'verified',
        reviewed_at: '2026-03-20T09:00:00Z',
        reviewed_by: 6,
        review_notes: 'Verified by clinician',
      },
    };
  }

  if (s.includes('from patient_allergies')) {
    return {
      results: [
        {
          id: 41,
          allergy_type: 'drug',
          allergen: 'Penicillin',
          severity: 'severe',
          reaction: 'Rash and wheeze',
          onset_date: '2020-01-01',
          verified_at: '2026-03-20T09:00:00Z',
          review_status: 'verified',
          reviewed_at: '2026-03-20T09:00:00Z',
          reviewed_by: 6,
          review_notes: 'Verified by clinician',
        },
      ],
    };
  }

  if (s.includes('from global_patient_adverse_reactions') && s.includes('where id = ?')) {
    return {
      first: {
        id: 501,
        uhid: 'UHID-0001',
        medication_name: 'Ibuprofen',
        generic_name: 'Ibuprofen',
        reaction: 'Facial swelling and rash',
        severity: 'severe',
        onset_date: '2026-03-27',
        outcome_status: 'recovering',
        notes: 'Started after self-medication at home',
        source: 'patient_reported',
        review_status: 'pending_review',
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        created_at: '2026-03-27T08:00:00Z',
        updated_at: '2026-03-27T08:00:00Z',
      },
    };
  }

  if (s.includes('from global_patient_adverse_reactions')) {
    return {
      results: [
        {
          id: 501,
          uhid: 'UHID-0001',
          medication_name: 'Ibuprofen',
          generic_name: 'Ibuprofen',
          reaction: 'Facial swelling and rash',
          severity: 'severe',
          onset_date: '2026-03-27',
          outcome_status: 'recovering',
          notes: 'Started after self-medication at home',
          source: 'patient_reported',
          review_status: 'pending_review',
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
          created_at: '2026-03-27T08:00:00Z',
          updated_at: '2026-03-27T08:00:00Z',
        },
      ],
    };
  }

  if (s.includes('from global_patient_lifestyle_logs') && s.includes('where id = ?')) {
    return {
      first: {
        id: 601,
        uhid: 'UHID-0001',
        logged_on: '2026-03-31',
        sleep_hours: 4.5,
        exercise_minutes: 10,
        mood: 'low',
        energy_level: 'low',
        symptom_score: 7,
        symptoms: 'Fatigue, poor appetite',
        diet_notes: 'Skipped dinner',
        notes: 'Sleep poor after fever',
        source: 'patient_reported',
        review_status: 'pending_review',
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        created_at: '2026-03-31T07:30:00Z',
        updated_at: '2026-03-31T07:30:00Z',
      },
    };
  }

  if (s.includes('from global_patient_lifestyle_logs')) {
    return {
      results: [
        {
          id: 601,
          uhid: 'UHID-0001',
          logged_on: '2026-03-31',
          sleep_hours: 4.5,
          exercise_minutes: 10,
          mood: 'low',
          energy_level: 'low',
          symptom_score: 7,
          symptoms: 'Fatigue, poor appetite',
          diet_notes: 'Skipped dinner',
          notes: 'Sleep poor after fever',
          source: 'patient_reported',
          review_status: 'pending_review',
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
          created_at: '2026-03-31T07:30:00Z',
          updated_at: '2026-03-31T07:30:00Z',
        },
        {
          id: 602,
          uhid: 'UHID-0001',
          logged_on: '2026-03-30',
          sleep_hours: 6,
          exercise_minutes: 20,
          mood: 'fair',
          energy_level: 'medium',
          symptom_score: 4,
          symptoms: 'Dry cough',
          diet_notes: 'Took soft diet',
          notes: null,
          source: 'patient_reported',
          review_status: 'verified',
          reviewed_by: 7,
          reviewed_at: '2026-03-30T09:00:00Z',
          review_notes: 'Discussed during consultation',
          created_at: '2026-03-30T08:00:00Z',
          updated_at: '2026-03-30T09:00:00Z',
        },
      ],
    };
  }

  if (s.includes('from lab_order_items loi') && s.includes('join lab_orders lo on loi.lab_order_id = lo.id') && s.includes('where loi.id = ?')) {
    return {
      first: {
        id: 51,
        completed_at: '2026-03-31T08:10:00Z',
        order_no: 'LAB-20260331-001',
        order_date: '2026-03-31',
        test_name: 'CRP',
        result: '18.5',
        result_numeric: 18.5,
        abnormal_flag: 'critical',
        status: 'completed',
        unit: 'mg/L',
        normal_range: '0-6',
      },
    };
  }

  if (s.includes('from lab_order_items loi') && s.includes('left join lab_test_catalog')) {
    return {
      results: [
        {
          id: 51,
          result: '18.5',
          result_numeric: 18.5,
          abnormal_flag: 'critical',
          status: 'completed',
          completed_at: '2026-03-31T08:10:00Z',
          order_no: 'LAB-20260331-001',
          order_date: '2026-03-31',
          test_name: 'CRP',
          unit: 'mg/L',
          normal_range: '0-6',
        },
      ],
    };
  }

  if (s.includes('from lab_orders lo') && s.includes('group by lo.id')) {
    return {
      results: [
        {
          id: 81,
          order_no: 'LAB-20260331-001',
          order_date: '2026-03-31',
          total_items: 1,
          pending_items: 0,
        },
      ],
    };
  }

  if (s.includes('from discharge_summaries ds') && s.includes('where ds.id = ?')) {
    return {
      first: {
        id: 91,
        admission_id: 15,
        final_diagnosis: 'Type 2 diabetes with chest infection',
        treatment_summary: 'IV fluids, insulin adjustment, antibiotics, discharge once stable.',
        follow_up_date: '2026-04-12',
        follow_up_instructions: 'Review blood sugar and respiratory symptoms in 5 days.',
        doctor_notes: 'Finalized after consultant review.',
        status: 'final',
        updated_at: '2026-04-02T11:00:00Z',
        admission_no: 'ADM-20260329-001',
      },
    };
  }

  if (s.includes('from discharge_summaries ds')) {
    return {
      results: [
        {
          id: 91,
          admission_id: 15,
          final_diagnosis: 'Type 2 diabetes with chest infection',
          treatment_summary: 'IV fluids, insulin adjustment, antibiotics, discharge once stable.',
          follow_up_date: '2026-04-12',
          follow_up_instructions: 'Review blood sugar and respiratory symptoms in 5 days.',
          doctor_notes: 'Finalized after consultant review.',
          status: 'final',
          updated_at: '2026-04-02T11:00:00Z',
          admission_no: 'ADM-20260329-001',
        },
      ],
    };
  }

  if (s.includes('from document_records') && s.includes('where id = ?')) {
    return {
      first: {
        id: 101,
        medical_record_id: 801,
        document_type: 'external_report',
        title: 'Outside Echo Report',
        description: 'Uploaded outside cardiology document',
        file_name: 'echo-march.pdf',
        created_at: '2026-03-26T09:30:00Z',
      },
    };
  }

  if (s.includes('from document_records')) {
    return {
      results: [
        {
          id: 101,
          medical_record_id: 801,
          document_type: 'external_report',
          title: 'Outside Echo Report',
          description: 'Uploaded outside cardiology document',
          file_name: 'echo-march.pdf',
          created_at: '2026-03-26T09:30:00Z',
        },
      ],
    };
  }

  if (s.includes('from medical_records') && s.includes('where id = ?')) {
    return {
      first: {
        id: 111,
        referred_to: 'National Heart Foundation',
        referred_date: '2026-03-27',
        referred_time: '11:15',
        referred_reason: 'Cardiology opinion for possible ischemic heart disease',
        file_number: 'MR-REF-22',
        remarks: 'Please assess for treadmill test.',
        created_at: '2026-03-27T11:15:00Z',
      },
    };
  }

  if (s.includes('from medical_records')) {
    return {
      results: [
        {
          id: 111,
          referred_to: 'National Heart Foundation',
          referred_date: '2026-03-27',
          referred_time: '11:15',
          referred_reason: 'Cardiology opinion for possible ischemic heart disease',
          file_number: 'MR-REF-22',
          remarks: 'Please assess for treadmill test.',
          created_at: '2026-03-27T11:15:00Z',
        },
      ],
    };
  }

  if (s.includes('from clinical_vitals')) {
    return {
      results: [
        {
          id: 51,
          recorded_at: '2026-03-31T08:00:00Z',
          temperature: 101.2,
          pulse: 104,
          systolic: 168,
          diastolic: 102,
          respiratory_rate: 20,
          spo2: 97,
          weight: 72,
          height: 168,
          bmi: 25.5,
          blood_sugar: 288,
          notes: 'Fever with high sugar',
        },
      ],
    };
  }

  if (s.includes('from radiology_reports') && s.includes('where id = ?') && s.includes('is_active = 1')) {
    return {
      first: {
        id: 7,
        order_status: 'final',
      },
    };
  }

  if (s.includes('from vital_alerts') && s.includes("status in ('active', 'acknowledged')")) {
    return {
      results: [
        {
          id: 71,
          vital_type: 'blood_pressure_systolic',
          recorded_value: 168,
          threshold_min: null,
          threshold_max: 160,
          severity: 'critical',
          status: 'active',
          acknowledged_at: null,
          created_at: '2026-03-31T08:05:00Z',
        },
      ],
    };
  }

  if (s.includes('from vital_alerts') && s.includes("status = 'active'")) {
    return {
      first: {
        id: 71,
        status: 'active',
      },
    };
  }

  if (s.includes('from audit_logs')) {
    return {
      results: [],
    };
  }

  if (s.includes('from appointments a')) {
    return {
      results: [
        {
          id: 61,
          appointment_date: '2026-04-10',
          time_slot: '10:30',
          status: 'scheduled',
          doctor_name: 'Dr Karim',
        },
        {
          id: 62,
          appointment_date: '2026-03-20',
          time_slot: '09:00',
          status: 'no_show',
          doctor_name: 'Dr Karim',
        },
      ],
    };
  }

  return null;
}

function makeAppWithMock(options: {
  policy?: 'legacy' | 'shadow' | 'strict';
  tenantId?: string;
  radiologyItem?: 'mapped' | 'missing';
} = {}) {
  const policy = options.policy ?? 'legacy';
  const tenantId = options.tenantId ?? TENANT_ID;
  const radiologyItem = options.radiologyItem ?? 'mapped';
  const mockDB = createMockDB({
    queryOverride: (sql, params) => {
      const normalizedSql = sql.toLowerCase();
      if (normalizedSql.includes('from canonical_feature_flags')) {
        if (policy === 'legacy') return { first: null };
        return {
          first: {
            tenant_id: tenantId,
            flag_key: 'canonical_financial_dual_write_v1',
            domain: 'financial',
            mode: 'shadow',
            is_enabled: 1,
            config_json: JSON.stringify({ writePolicy: policy, tenantScope: [tenantId] }),
          },
        };
      }
      if (
        radiologyItem === 'missing'
        && normalizedSql.includes('from radiology_imaging_items')
        && normalizedSql.includes('lower(name) = lower(?)')
      ) {
        return { first: null };
      }
      return queryOverride(sql, params);
    },
    universalFallback: true,
  });

  return createTestApp({
    route: patientsRoute,
    routePath: '/patients',
    role: 'doctor',
    tenantId,
    mockDB,
    extraEnv: {
      OPENROUTER_API_KEY: undefined as never,
    },
  });
}

function makeApp() {
  return makeAppWithMock().app;
}

describe('Patient chart workspace routes', () => {
  it('GET /patients/:id/chart falls back to final diagnosis records when clinical diagnosis is empty', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      diagnoses: Array<{ description: string; icd10_code?: string }>;
      soapNotes?: Array<{ ChiefComplaint?: string }>;
      problemSummary?: { active: Array<{ description: string }>; resolved: Array<{ description: string }> };
      medicationHistory?: { current: Array<{ medication_name: string }>; stopped: Array<{ medication_name: string }> };
      allergySummary?: { verifiedCount: number };
      careAlerts?: Array<{ code: string; severity: string; label: string }>;
      tasks?: {
        activeConsultation?: { id: number; status: string } | null;
        vitalAlerts?: Array<{ id: number; status: string }>;
        chronicCareReminders?: Array<{ code: string; severity: string; label: string }>;
      };
    };
    expect(body.diagnoses[0]?.description).toBe('Hypertension');
    expect(body.diagnoses[0]?.icd10_code).toBe('I10');
    expect(body.soapNotes?.[0]?.ChiefComplaint).toBe('Fever for 3 days');
    expect(body.problemSummary?.active[0]?.description).toBe('Type 2 diabetes mellitus');
    expect(body.problemSummary?.resolved[0]?.description).toBe('Upper respiratory infection');
    expect(body.medicationHistory?.current[0]?.medication_name).toBe('Metformin');
    expect(body.medicationHistory?.stopped[0]?.medication_name).toBe('Azithromycin');
    expect(body.allergySummary?.verifiedCount).toBe(1);
    expect(body.careAlerts?.some((item) => item.code === 'high-blood-pressure')).toBe(true);
    expect(body.careAlerts?.some((item) => item.code === 'high-blood-sugar')).toBe(true);
    expect(body.careAlerts?.some((item) => item.code === 'fever-alert')).toBe(true);
    expect(body.careAlerts?.some((item) => item.code === 'active-consultation')).toBe(true);
    expect(body.careAlerts?.some((item) => item.code === 'radiology-review-pending')).toBe(true);
    expect(body.careAlerts?.some((item) => item.code === 'chronic-follow-up-due')).toBe(false);
    expect(body.tasks?.activeConsultation?.id).toBe(2);
    expect(body.tasks?.vitalAlerts?.[0]?.id).toBe(71);
    expect(body.tasks?.chronicCareReminders?.some((item) => item.code === 'diabetes-a1c-missing')).toBe(true);
    expect(body.tasks?.chronicCareReminders?.some((item) => item.code === 'chronic-follow-up-booked')).toBe(true);
    expect(body.tasks?.chronicCareReminders?.some((item) => item.code === 'medication-refill-risk')).toBe(true);
    expect(body.tasks?.chronicCareReminders?.some((item) => item.code === 'medication-on-hold')).toBe(true);
    expect(body.tasks?.chronicCareReminders?.some((item) => item.code === 'missed-follow-up')).toBe(true);
  });

  it('GET /patients/:id/chart/source/consultation-1 returns full consultation detail for source panel', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/consultation-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { source: { type: string; title: string; summary: string; sections: Array<{ label: string; value: string }> } };
    expect(body.source.type).toBe('consultation');
    expect(body.source.title).toContain('Consultation');
    expect(body.source.summary).toContain('Persistent cough');
    expect(body.source.sections.some((item) => item.label === 'Prescription')).toBe(true);
  });

  it('GET /patients/:id/chart/source/radiology-report-7 returns radiology findings detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/radiology-report-7');
    expect(res.status).toBe(200);
    const body = await res.json() as { source: { type: string; summary: string; sections: Array<{ label: string; value: string }> } };
    expect(body.source.type).toBe('radiology_report');
    expect(body.source.summary).toContain('basal infiltrates');
    expect(body.source.sections.some((item) => item.label === 'Radiology No')).toBe(true);
  });

  it('GET /patients/:id/chart/source/lab-51 returns lab provenance detail for source panel', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/lab-51');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        provenance?: { category: string; badge_text: string; review_status: string };
      };
    };
    expect(body.source.type).toBe('lab');
    expect(body.source.sections.some((item) => item.label === 'Review Status')).toBe(true);
    expect(body.source.provenance?.category).toBe('clinician_entered');
  });

  it('GET /patients/:id/chart/source/discharge-91 returns discharge provenance detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/discharge-91');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        provenance?: { category: string; badge_text: string };
      };
    };
    expect(body.source.type).toBe('discharge');
    expect(body.source.sections.some((item) => item.label === 'Follow Up Instructions')).toBe(true);
    expect(body.source.provenance?.category).toBe('clinician_verified');
  });

  it('GET /patients/:id/chart/source/document-101 returns imported document provenance detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/document-101');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        provenance?: { category: string; badge_text: string };
      };
    };
    expect(body.source.type).toBe('document');
    expect(body.source.sections.some((item) => item.label === 'Document Type')).toBe(true);
    expect(body.source.provenance?.category).toBe('imported_record');
  });

  it('GET /patients/:id/chart/source/referral-111 returns referral provenance detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/referral-111');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        provenance?: { category: string; badge_text: string };
      };
    };
    expect(body.source.type).toBe('referral');
    expect(body.source.sections.some((item) => item.label === 'Referred To')).toBe(true);
    expect(body.source.provenance?.category).toBe('clinician_entered');
  });

  it('GET /patients/:id/chart/source/soap-11 returns full SOAP source detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/soap-11');
    expect(res.status).toBe(200);
    const body = await res.json() as { source: { type: string; sections: Array<{ label: string; value: string }> } };
    expect(body.source.type).toBe('soap');
    expect(body.source.sections.some((item) => item.label === 'Assessment')).toBe(true);
    expect(body.source.sections.some((item) => item.value.includes('viral febrile illness'))).toBe(true);
  });

  it('POST /patients/:id/chart/soap creates a SOAP note from doctor workspace flow', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/soap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chiefComplaint: 'Acute gastritis',
        subjective: 'Upper abdominal pain after meals',
        objective: 'Epigastric tenderness, pulse 88',
        assessment: 'Acute gastritis without red flags',
        plan: 'PPI for 2 weeks, diet advice, review if persistent',
        encounterId: 5001,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; message: string };
    expect(body.id).toBeTruthy();
    expect(body.message).toContain('SOAP');
  });

  it('GET /patients/:id/chart/source/problem-21 returns problem detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/problem-21');
    expect(res.status).toBe(200);
    const body = await res.json() as { source: { type: string; sections: Array<{ label: string; value: string }> } };
    expect(body.source.type).toBe('problem');
    expect(body.source.sections.some((item) => item.label === 'Comments')).toBe(true);
  });

  it('GET /patients/:id/chart/source/medication-31 returns medication detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/medication-31');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        review_actions?: { review_path: string; approve_method: string; reject_method: string };
      };
    };
    expect(body.source.type).toBe('medication');
    expect(body.source.sections.some((item) => item.label === 'Dose')).toBe(true);
    expect(body.source.sections.some((item) => item.label === 'Review Status' && item.value === 'verified')).toBe(true);
    expect(body.source.review_actions?.review_path).toBe('/api/e-prescribing/patient/1/medications/31/review');
  });

  it('GET /patients/:id/chart/source/allergy-41 returns allergy detail with verification', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/allergy-41');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        review_actions?: { review_path: string; approve_method: string; reject_method: string };
      };
    };
    expect(body.source.type).toBe('allergy');
    expect(body.source.sections.some((item) => item.label === 'Verified At')).toBe(true);
    expect(body.source.sections.some((item) => item.label === 'Review Status' && item.value === 'verified')).toBe(true);
    expect(body.source.review_actions?.review_path).toBe('/api/allergies/41/review');
  });

  it('GET /patients/:id/chart exposes provenance summary for diagnoses and medications', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      diagnoses: Array<{ review_status?: string }>;
      medicationHistory: { current: Array<{ review_status?: string }> };
      provenanceSummary?: { pendingReviewCount: number; verifiedCount: number; rejectedCount: number };
    };
    expect(body.diagnoses[0]?.review_status).toBe('verified');
    expect(body.medicationHistory.current[0]?.review_status).toBe('verified');
    expect(body.provenanceSummary?.pendingReviewCount).toBeGreaterThanOrEqual(1);
    expect(body.provenanceSummary?.verifiedCount).toBeGreaterThanOrEqual(1);
  });

  it('GET /patients/:id/chart exposes normalized provenance on timeline and remaining chart sections', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      timeline?: Array<{ id: string; provenance?: { category: string; badge_text: string } }>;
      recentLabs?: { abnormal: Array<{ provenance?: { category: string; review_status: string } }> };
      radiologyReports?: Array<{ provenance?: { category: string; review_status: string } }>;
      dischargeSummaries?: Array<{ provenance?: { category: string; badge_text: string } }>;
      documents?: Array<{ provenance?: { category: string; badge_text: string } }>;
      referrals?: Array<{ provenance?: { category: string; badge_text: string } }>;
    };

    expect(body.recentLabs?.abnormal[0]?.provenance?.category).toBe('clinician_entered');
    expect(body.radiologyReports?.[0]?.provenance?.review_status).toBe('pending_review');
    expect(body.dischargeSummaries?.[0]?.provenance?.category).toBe('clinician_verified');
    expect(body.documents?.[0]?.provenance?.badge_text).toBe('Imported record');
    expect(body.referrals?.[0]?.provenance?.category).toBe('clinician_entered');
    expect(body.timeline?.find((item) => item.id === 'document-101')?.provenance?.category).toBe('imported_record');
    expect(body.timeline?.find((item) => item.id === 'discharge-91')?.provenance?.badge_text).toBe('Doctor verified');
  });

  it('GET /patients/:id/chart surfaces patient-reported ADR and lifestyle summary for doctor workspace', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      timeline?: Array<{ id: string; type: string }>;
      patientReportedSummary?: {
        highlights: {
          average_sleep_hours: number | null;
          recent_exercise_minutes: number;
          pending_review_count: number;
          severe_adr_count: number;
        };
        adverse_reactions: Array<{ id: number; review_actions?: { review_path: string } }>;
        lifestyle_logs: Array<{ id: number; review_actions?: { review_path: string } }>;
      };
    };
    expect(body.patientReportedSummary?.highlights.average_sleep_hours).toBe(5.25);
    expect(body.patientReportedSummary?.highlights.recent_exercise_minutes).toBe(30);
    expect(body.patientReportedSummary?.highlights.pending_review_count).toBe(2);
    expect(body.patientReportedSummary?.highlights.severe_adr_count).toBe(1);
    expect(body.patientReportedSummary?.adverse_reactions[0]?.review_actions?.review_path).toBe('/api/patient-reported/adverse-reactions/501/review');
    expect(body.patientReportedSummary?.lifestyle_logs[0]?.review_actions?.review_path).toBe('/api/patient-reported/lifestyle-logs/601/review');
    expect(body.timeline?.some((item) => item.id === 'adr-501' && item.type === 'patient_reported_adr')).toBe(true);
    expect(body.timeline?.some((item) => item.id === 'lifestyle-601' && item.type === 'patient_reported_lifestyle')).toBe(true);
  });

  it('GET /patients/:id/chart?includeAiSummary=1 returns deterministic fallback physician summary when AI is unavailable', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart?includeAiSummary=1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      aiSummary?: {
        status: string;
        summary?: {
          oneLiner?: string;
          activeIssues?: Array<{ text: string; priority: string }>;
          patientContext?: Array<{ text: string; provenance: string }>;
          cautions?: Array<{ text: string }>;
        };
      };
    };
    expect(body.aiSummary?.status).toBe('fallback');
    expect(body.aiSummary?.summary?.oneLiner?.toLowerCase()).toContain('uncontrolled');
    expect(body.aiSummary?.summary?.activeIssues?.[0]?.priority).toBe('critical');
    expect(body.aiSummary?.summary?.patientContext?.some((item) => item.provenance === 'patient_reported')).toBe(true);
    expect(body.aiSummary?.summary?.cautions?.some((item) => item.text.toLowerCase().includes('patient-reported'))).toBe(true);
  });

  it('GET /patients/:id/chart/source/adr-501 returns patient-reported adverse reaction detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/adr-501');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        review_actions?: { review_path: string };
      };
    };
    expect(body.source.type).toBe('patient_reported_adr');
    expect(body.source.sections.some((item) => item.label === 'Reaction' && item.value.includes('rash'))).toBe(true);
    expect(body.source.review_actions?.review_path).toBe('/api/patient-reported/adverse-reactions/501/review');
  });

  it('GET /patients/:id/chart/source/lifestyle-601 returns patient-reported lifestyle detail', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/lifestyle-601');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: {
        type: string;
        sections: Array<{ label: string; value: string }>;
        review_actions?: { review_path: string };
      };
    };
    expect(body.source.type).toBe('patient_reported_lifestyle');
    expect(body.source.sections.some((item) => item.label === 'Sleep Hours' && item.value === '4.5')).toBe(true);
    expect(body.source.review_actions?.review_path).toBe('/api/patient-reported/lifestyle-logs/601/review');
  });

  it('GET /patients/:id/chart exposes family risk summary in ai brief fallback', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart?includeAiSummary=1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      familyRiskSummary?: {
        status: string;
        insights: Array<{ label: string; screening_priority?: string; screening_prompts?: string[] }>;
      };
      aiSummary?: {
        summary?: {
          familyHistory?: Array<{ text: string; citationIds: string[] }>;
        };
        citations?: Array<{ id: string; type: string }>;
      };
    };

    expect(body.familyRiskSummary?.status).toBe('attention');
    expect(body.familyRiskSummary?.insights.some((item) => item.label.includes('Diabetes'))).toBe(true);
    expect(body.familyRiskSummary?.insights[0]?.screening_priority).toBeTruthy();
    expect(body.familyRiskSummary?.insights[0]?.screening_prompts?.length).toBeGreaterThan(0);
    expect(body.aiSummary?.summary?.familyHistory?.[0]?.citationIds).toEqual(['family-risk-1']);
    expect(body.aiSummary?.citations?.some((item) => item.id === 'family-risk-1' && item.type === 'family_risk')).toBe(true);
  });

  it('GET /patients/:id/chart/source/family-risk-1 returns family risk detail for source panel', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/source/family-risk-1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      source?: {
        type?: string;
        title?: string;
        sections?: Array<{ label: string; value: string }>;
      };
    };

    expect(body.source?.type).toBe('family_risk');
    expect(body.source?.title).toBeTruthy();
    expect(body.source?.sections?.some((item) => item.label === 'Matched Relatives' && item.value.includes('Father One'))).toBe(true);
    expect(body.source?.sections?.some((item) => item.label === 'Screening Prompts')).toBe(true);
  });

  it('POST /patients/:id/chart/lab-order creates quick lab order', async () => {
    const { app, mockDB } = makeAppWithMock();
    const res = await app.request('/patients/1/chart/lab-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tests: [{ lab_test_id: 5, instructions: 'Urgent CBC' }],
        notes: 'Check infection markers',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toContain('Lab');
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing')
      && query.params.includes('bill_created')
    )).toBe(true);
  });

  it('POST /patients/:id/chart/lab-order keeps the committed legacy result when shadow projection fails', async () => {
    const { app, mockDB } = makeAppWithMock({ policy: 'shadow', tenantId: 'tenant-shadow' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await app.request('/patients/1/chart/lab-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tests: [{ lab_test_id: 5, instructions: 'Urgent CBC' }] }),
      });

      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) => /INSERT INTO lab_orders/i.test(query.sql))).toBe(true);
      expect(mockDB.queries.some((query) => /INSERT INTO canonical_processing_issues/i.test(query.sql))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('POST /patients/:id/chart/lab-order fails strict mapping preflight before legacy inserts', async () => {
    const { app, mockDB } = makeAppWithMock({ policy: 'strict', tenantId: '100' });
    const res = await app.request('/patients/1/chart/lab-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tests: [{ lab_test_id: 5 }] }),
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO lab_orders/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
  });

  it('POST /patients/:id/chart/radiology-order creates quick radiology requisition', async () => {
    const { app, mockDB } = makeAppWithMock();
    const res = await app.request('/patients/1/chart/radiology-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imaging_item_name: 'Chest X-Ray',
        imaging_type_name: 'X-Ray',
        urgency: 'urgent',
        requisition_remarks: 'Persistent cough with fever',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toContain('Radiology');
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing')
      && query.params.includes('bill_created')
    )).toBe(true);
  });

  it('POST /patients/:id/chart/radiology-order preserves free-text zero-value legacy success', async () => {
    const { app, mockDB } = makeAppWithMock({ radiologyItem: 'missing' });
    const res = await app.request('/patients/1/chart/radiology-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imaging_item_name: 'Outside Scan',
        imaging_type_name: 'Custom Scan',
        urgency: 'normal',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number; billingStatus: string };
    expect(body).toMatchObject({ total: 0, billingStatus: 'paid' });
    expect(mockDB.queries.some((query) => /INSERT INTO radiology_requisitions/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('bill_created')
    )).toBe(false);
  });

  it('POST /patients/:id/chart/radiology-order keeps legacy success when shadow projection fails', async () => {
    const { app, mockDB } = makeAppWithMock({
      policy: 'shadow',
      tenantId: 'tenant-radiology-shadow',
      radiologyItem: 'missing',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await app.request('/patients/1/chart/radiology-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imaging_item_name: 'Outside Scan',
          imaging_type_name: 'Custom Scan',
          urgency: 'normal',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { total: number };
      expect(body.total).toBe(0);
      expect(mockDB.queries.some((query) => /INSERT INTO radiology_requisitions/i.test(query.sql))).toBe(true);
      expect(mockDB.queries.some((query) => /INSERT INTO canonical_processing_issues/i.test(query.sql))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('POST /patients/:id/chart/radiology-order fails strict preflight before legacy inserts', async () => {
    const { app, mockDB } = makeAppWithMock({
      policy: 'strict',
      tenantId: '100',
      radiologyItem: 'missing',
    });
    const res = await app.request('/patients/1/chart/radiology-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imaging_item_name: 'Outside Scan',
        imaging_type_name: 'Custom Scan',
        urgency: 'normal',
      }),
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO radiology_requisitions/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
  });

  it('POST /patients/:id/chart/follow-up creates quick follow-up appointment', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apptDate: '2026-04-10',
        apptTime: '10:30',
        notes: 'Review after antibiotics',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toContain('Follow-up');
  });

  it('POST /patients/:id/chart/encounter-close completes active consultation from chart workspace', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/encounter-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consultation_id: 2,
        summary: 'Fever and sugar reviewed, patient stable for outpatient management.',
        diagnosis: 'Uncontrolled diabetes with febrile illness',
        prescription: 'Paracetamol and diabetic dose adjustment',
        reconciliation_summary: 'Current medicines reviewed, metformin continued, inhaler kept on hold.',
        medication_reconciliation_done: true,
        followup_date: '2026-04-04',
        followup_time: '09:30',
        followup_notes: 'Bring sugar chart and repeat BP',
        book_followup: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string; status: string; consultationId: number; followUpAppointmentId: number | null };
    expect(body.message).toContain('Encounter');
    expect(body.status).toBe('completed');
    expect(body.consultationId).toBe(2);
    expect(body.followUpAppointmentId).toBeTruthy();
  });

  it('PUT /patients/:id/chart/alerts/:alertId/acknowledge acknowledges active chart alert', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/alerts/71/acknowledge', {
      method: 'PUT',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string; alertId: number };
    expect(body.success).toBe(true);
    expect(body.status).toBe('acknowledged');
    expect(body.alertId).toBe(71);
  });

  it('PUT /patients/:id/chart/results/lab/:itemId/acknowledge marks lab result reviewed', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/results/lab/51/acknowledge', {
      method: 'PUT',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string; itemId: number };
    expect(body.success).toBe(true);
    expect(body.status).toBe('reviewed');
    expect(body.itemId).toBe(51);
  });

  it('PUT /patients/:id/chart/results/radiology/:reportId/acknowledge marks radiology report reviewed', async () => {
    const app = makeApp();
    const res = await app.request('/patients/1/chart/results/radiology/7/acknowledge', {
      method: 'PUT',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string; reportId: number };
    expect(body.success).toBe(true);
    expect(body.status).toBe('reviewed');
    expect(body.reportId).toBe(7);
  });
});
