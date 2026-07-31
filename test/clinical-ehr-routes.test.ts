import { describe, expect, test } from 'vitest';
import clinicalRoutes from '../src/routes/tenant/clinical/index';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function buildApp(tableOverrides: Record<string, unknown[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables: tableOverrides });
  return createTestApp({
    route: clinicalRoutes,
    routePath: '/clinical',
    role: 'doctor',
    tenantId: 'tenant-1',
    userId: 10,
    mockDB,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// VITALS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Vitals API', () => {
  test('GET /vitals requires patientId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals');
    expect(res.status).toBe(400);
  });

  test('GET /vitals returns data for patient', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
  });

  test('POST /vitals validates at least one measurement', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: { patientId: 1 },
    });
    expect(res.status).toBe(400);
  });

  test('POST /vitals accepts valid vitals', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: {
        patientId: 1,
        temperature: 37.5,
        pulse: 72,
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        spo2: 98,
        weight: 70,
        height: 175,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number; alerts: { alertCount: number } } };
    expect(body.Results).toHaveProperty('id');
    expect(body.Results).toHaveProperty('alerts');
  });

  test('POST /vitals rejects out-of-range temperature', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: { patientId: 1, temperature: 50 },
    });
    expect(res.status).toBe(400);
  });

  test('POST /vitals rejects out-of-range spo2', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: { patientId: 1, spo2: 150 },
    });
    expect(res.status).toBe(400);
  });

  test('GET /vitals/:id returns single record', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals/1');
    expect(res.status).toBe(200);
  });

  test('GET /vitals/:id rejects non-numeric id', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals/abc');
    expect(res.status).toBe(400);
  });

  test('GET /vitals/trend/:patientId returns trend data', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals/trend/1');
    expect(res.status).toBe(200);
  });

  test('PUT /vitals/:id accepts partial update', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals/1', {
      method: 'PUT',
      body: { pulse: 80, notes: 'Improved' },
    });
    expect(res.status).toBe(200);
  });

  test('DELETE /vitals/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALLERGIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Allergies API', () => {
  test('GET /allergies requires patientId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies');
    expect(res.status).toBe(400);
  });

  test('GET /allergies returns data for patient', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
  });

  test('POST /allergies creates allergy (or 409 if duplicate)', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies', {
      method: 'POST',
      body: {
        patientId: 1,
        allergyType: 'drug',
        allergen: 'Penicillin',
        severity: 'severe',
        reaction: 'Anaphylaxis',
      },
    });
    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      const body = await res.json() as { Results: { id: number } };
      expect(body.Results).toHaveProperty('id');
    }
  });

  test('POST /allergies rejects invalid allergy type', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies', {
      method: 'POST',
      body: {
        patientId: 1,
        allergyType: 'invalid_type',
        allergen: 'Dust',
      },
    });
    expect(res.status).toBe(400);
  });

  test('POST /allergies rejects missing allergen', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies', {
      method: 'POST',
      body: { patientId: 1, allergyType: 'food' },
    });
    expect(res.status).toBe(400);
  });

  test('PUT /allergies/:id updates allergy', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies/1', {
      method: 'PUT',
      body: { severity: 'moderate', reaction: 'Rash' },
    });
    expect(res.status).toBe(200);
  });

  test('PUT /allergies/:id/verify marks as verified', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies/1/verify', { method: 'PUT' });
    expect(res.status).toBe(200);
  });

  test('DELETE /allergies/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('GET /allergies/:id returns single record', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies/1');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Medications API', () => {
  test('GET /medications requires patientId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications');
    expect(res.status).toBe(400);
  });

  test('GET /medications returns active meds', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
  });

  test('GET /medications?status=all returns all statuses', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications?patientId=1&status=all');
    expect(res.status).toBe(200);
  });

  test('POST /medications creates medication', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications', {
      method: 'POST',
      body: {
        patientId: 1,
        medicationName: 'Metformin',
        genericName: 'metformin',
        strength: '500mg',
        dosageForm: 'tablet',
        dosage: '1 tablet',
        frequency: 'twice daily',
        duration: '30 days',
        source: 'prescribed',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number; safetyWarnings: unknown[] } };
    expect(body.Results).toHaveProperty('id');
    expect(body.Results).toHaveProperty('safetyWarnings');
  });

  test('POST /medications rejects missing medication name', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications', {
      method: 'POST',
      body: { patientId: 1 },
    });
    expect(res.status).toBe(400);
  });

  test('PUT /medications/:id updates medication', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications/1', {
      method: 'PUT',
      body: { dosage: '2 tablets', frequency: 'once daily' },
    });
    expect(res.status).toBe(200);
  });

  test('PUT /medications/:id/discontinue stops medication', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications/1/discontinue', {
      method: 'PUT',
      body: { reason: 'Side effects' },
    });
    // May be 200 or 404 depending on mock data, but should not be 500
    expect([200, 404]).toContain(res.status);
  });

  test('DELETE /medications/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('GET /medications/:id returns single record', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications/1');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLINICAL NOTES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Notes API', () => {
  test('GET /notes requires patientId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes');
    expect(res.status).toBe(400);
  });

  test('GET /notes returns paginated results', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body).toHaveProperty('Results');
    expect(body).toHaveProperty('pagination');
    expect(body.pagination).toHaveProperty('page');
    expect(body.pagination).toHaveProperty('limit');
  });

  test('GET /notes filters by noteType', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes?patientId=1&noteType=soap');
    expect(res.status).toBe(200);
  });

  test('POST /notes creates a note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes', {
      method: 'POST',
      body: {
        patientId: 1,
        noteType: 'progress',
        content: 'Patient recovering well post-surgery.',
        chiefComplaint: 'Post-op follow-up',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  test('POST /notes creates SOAP note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes', {
      method: 'POST',
      body: {
        patientId: 1,
        noteType: 'soap',
        content: 'SOAP note for visit',
        subjective: 'Patient reports headache',
        objective: 'BP 120/80, temp 37.2',
        assessment: 'Tension headache',
        plan: 'OTC analgesic, rest',
      },
    });
    expect(res.status).toBe(201);
  });

  test('POST /notes rejects empty content', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes', {
      method: 'POST',
      body: { patientId: 1, noteType: 'progress', content: '' },
    });
    expect(res.status).toBe(400);
  });

  test('POST /notes rejects invalid note type', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes', {
      method: 'POST',
      body: { patientId: 1, noteType: 'invalid', content: 'Test' },
    });
    expect(res.status).toBe(400);
  });

  test('PUT /notes/:id updates note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes/1', {
      method: 'PUT',
      body: { content: 'Updated content', plan: 'Revised plan' },
    });
    expect(res.status).toBe(200);
  });

  test('PUT /notes/:id/sign signs the note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes/1/sign', { method: 'PUT' });
    expect(res.status).toBe(200);
  });

  test('DELETE /notes/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('GET /notes/:id returns single note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes/1');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLINICAL IMAGES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Images API', () => {
  test('GET /images requires patientId or visitId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images');
    expect(res.status).toBe(400);
  });

  test('GET /images returns data for patient', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
  });

  test('GET /images filters by imageType', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images?patientId=1&imageType=xray');
    expect(res.status).toBe(200);
  });

  test('POST /images creates image record', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images', {
      method: 'POST',
      body: {
        patientId: 1,
        imageType: 'xray',
        title: 'Chest X-Ray PA View',
        fileKey: 'clinical-images/tenant-1/1/chest-xray.jpg',
        fileName: 'chest-xray.jpg',
        mimeType: 'image/jpeg',
        bodyPart: 'chest',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  test('POST /images rejects missing title', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images', {
      method: 'POST',
      body: { patientId: 1, fileKey: 'test/key.jpg' },
    });
    expect(res.status).toBe(400);
  });

  test('POST /images rejects missing fileKey', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images', {
      method: 'POST',
      body: { patientId: 1, title: 'Test' },
    });
    expect(res.status).toBe(400);
  });

  test('POST /images rejects invalid image type', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images', {
      method: 'POST',
      body: { patientId: 1, title: 'Test', fileKey: 'k', imageType: 'invalid_type' },
    });
    expect(res.status).toBe(400);
  });

  test('PUT /images/:id updates metadata', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images/1', {
      method: 'PUT',
      body: { title: 'Updated title', bodyPart: 'left arm' },
    });
    expect(res.status).toBe(200);
  });

  test('DELETE /images/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('GET /images/:id returns single record', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/images/1');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENCOUNTERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Encounters API', () => {
  test('GET /encounters requires patientId', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters');
    expect(res.status).toBe(400);
  });

  test('GET /encounters returns paginated results', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters?patientId=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[]; pagination: { page: number; total: number } };
    expect(body).toHaveProperty('Results');
    expect(body).toHaveProperty('pagination');
  });

  test('POST /encounters creates encounter', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters', {
      method: 'POST',
      body: {
        patientId: 1,
        encounterType: 'outpatient',
        reasonForVisit: 'Follow-up visit',
        chiefComplaint: 'Persistent cough',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  test('POST /encounters validates encounter type', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters', {
      method: 'POST',
      body: { patientId: 1, encounterType: 'invalid_type' },
    });
    expect(res.status).toBe(400);
  });

  test('GET /encounters/:id returns encounter', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1');
    expect(res.status).toBe(200);
  });

  test('GET /encounters/:id/summary returns aggregated data', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: { encounter: unknown; vitals: unknown[]; notes: unknown[] } };
    expect(body.Results).toHaveProperty('encounter');
    expect(body.Results).toHaveProperty('vitals');
    expect(body.Results).toHaveProperty('notes');
    expect(body.Results).toHaveProperty('allergies');
    expect(body.Results).toHaveProperty('activeMedications');
  });

  test('PUT /encounters/:id updates encounter', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1', {
      method: 'PUT',
      body: { status: 'completed', dispositionCode: 'HOME', dispositionNote: 'Discharged to home' },
    });
    expect(res.status).toBe(200);
  });

  test('PUT /encounters/:id/complete completes encounter', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1/complete', {
      method: 'PUT',
      body: { code: 'HOME', note: 'Recovered' },
    });
    // 200 or 404 depending on mock — should not be 500
    expect([200, 404]).toContain(res.status);
  });

  test('DELETE /encounters/:id soft deletes', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schema validation edge cases', () => {
  test('vitals: pain scale must be 0-10', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: { patientId: 1, painScale: 15, temperature: 37 },
    });
    expect(res.status).toBe(400);
  });

  test('vitals: weight must be positive', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/vitals', {
      method: 'POST',
      body: { patientId: 1, weight: -5 },
    });
    expect(res.status).toBe(400);
  });

  test('allergies: severity enum validation', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/allergies', {
      method: 'POST',
      body: { patientId: 1, allergyType: 'drug', allergen: 'Test', severity: 'extreme' },
    });
    expect(res.status).toBe(400);
  });

  test('medications: source enum validation', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/medications', {
      method: 'POST',
      body: { patientId: 1, medicationName: 'Test', source: 'invalid_source' },
    });
    expect(res.status).toBe(400);
  });

  test('notes: content max length validation', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/notes', {
      method: 'POST',
      body: { patientId: 1, content: 'x'.repeat(50001) },
    });
    expect(res.status).toBe(400);
  });

  test('encounters: status enum validation', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/clinical/encounters/1', {
      method: 'PUT',
      body: { status: 'invalid_status' },
    });
    expect(res.status).toBe(400);
  });

  test('images: all valid image types accepted', async () => {
    const types = ['xray', 'ct', 'mri', 'ultrasound', 'photo', 'wound', 'eye', 'dental', 'ecg', 'pathology', 'other'];
    const { app } = buildApp();
    for (const imageType of types) {
      const res = await jsonRequest(app, '/clinical/images', {
        method: 'POST',
        body: { patientId: 1, title: `${imageType} test`, fileKey: `test/${imageType}.jpg`, imageType },
      });
      expect(res.status).toBe(201);
    }
  });

  test('encounters: all valid types accepted', async () => {
    const types = ['outpatient', 'inpatient', 'emergency', 'telehealth', 'home_visit', 'day_care'];
    const { app } = buildApp();
    for (const encounterType of types) {
      const res = await jsonRequest(app, '/clinical/encounters', {
        method: 'POST',
        body: { patientId: 1, encounterType },
      });
      expect(res.status).toBe(201);
    }
  });

  test('notes: all valid note types accepted', async () => {
    const types = ['progress', 'soap', 'procedure', 'consultation', 'discharge', 'history_physical', 'operative', 'referral', 'telephone', 'other'];
    const { app } = buildApp();
    for (const noteType of types) {
      const res = await jsonRequest(app, '/clinical/notes', {
        method: 'POST',
        body: { patientId: 1, noteType, content: `${noteType} note content` },
      });
      expect(res.status).toBe(201);
    }
  });
});
