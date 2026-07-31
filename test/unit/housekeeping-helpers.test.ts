import { describe, it, expect } from 'vitest';
import { createPostDischargeCleaningTask } from '../../src/lib/housekeeping-helpers';
import { createMockDB } from '../integration/helpers/mock-db';

describe('createPostDischargeCleaningTask', () => {
  it('creates a post_discharge task linked to bed', async () => {
    const mockDB = createMockDB({
      tables: {
        beds: [{ id: 5, tenant_id: 't1', bed_number: 'B-101', ward_name: 'Ward A' }],
        housekeeping_tasks: [],
      },
    });

    await createPostDischargeCleaningTask(mockDB.db, 't1', {
      bedId: 5,
      admissionId: 42,
    });

    const insertQuery = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.toUpperCase().includes('INSERT INTO HOUSEKEEPING_TASKS'),
    );
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.params).toContain('post_discharge');
    expect(insertQuery!.params).toContain('high');
    expect(insertQuery!.params).toContain(5);   // bed_id
    expect(insertQuery!.params).toContain(42);  // admission_id
    expect(insertQuery!.params).toContain('Post-discharge cleaning — Bed B-101 (Ward A)');
  });

  it('assigns to nurse when provided', async () => {
    const mockDB = createMockDB({
      tables: {
        beds: [{ id: 3, tenant_id: 't1', bed_number: 'ICU-1', ward_name: 'ICU' }],
        housekeeping_tasks: [],
      },
    });

    await createPostDischargeCleaningTask(mockDB.db, 't1', {
      bedId: 3,
      admissionId: 99,
      assignedTo: 'Nurse Fatima',
      assignedToId: 7,
    });

    const insertQuery = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.toUpperCase().includes('INSERT INTO HOUSEKEEPING_TASKS'),
    );
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.params).toContain('Nurse Fatima');
    expect(insertQuery!.params).toContain(7);
  });

  it('skips task creation when bed not found', async () => {
    const mockDB = createMockDB({
      tables: {
        beds: [],
        housekeeping_tasks: [],
      },
    });

    await createPostDischargeCleaningTask(mockDB.db, 't1', {
      bedId: 999,
      admissionId: 1,
    });

    const insertQuery = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.toUpperCase().includes('INSERT INTO HOUSEKEEPING_TASKS'),
    );
    expect(insertQuery).toBeUndefined();
  });

  it('generates task number with HK- prefix', async () => {
    const mockDB = createMockDB({
      tables: {
        beds: [{ id: 1, tenant_id: 't1', bed_number: 'G1', ward_name: 'General' }],
        housekeeping_tasks: [],
      },
    });

    await createPostDischargeCleaningTask(mockDB.db, 't1', {
      bedId: 1,
      admissionId: 10,
    });

    const insertQuery = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.toUpperCase().includes('INSERT INTO HOUSEKEEPING_TASKS'),
    );
    expect(insertQuery).toBeDefined();
    // Task number is the second param (after tenant_id)
    const taskNumber = insertQuery!.params[1] as string;
    expect(taskNumber).toMatch(/^HK-\d{8}-\d{3}$/);
  });
});
