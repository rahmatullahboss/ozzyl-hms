import { describe, expect, test } from 'vitest';
import {
  readCdbV1071PatientLinkResumeState,
  runCdbV1071AuthorizedBackfills,
  type CdbV1071BackfillOperations,
  type CdbV1071BackfillResumeReader,
} from '../../scripts/canonical/execute-cdb-v1-071-production-release';
import { CDB_V1_071_TENANT_IDS } from '../../scripts/canonical/cdb-v1-071-production-release-authorization';

const NO_RESUME: CdbV1071BackfillResumeReader = {
  patientLinkChunk: async () => null,
};

function operations(options: { secondPassCreated?: number; practitionerAmbiguous?: number } = {}): {
  value: CdbV1071BackfillOperations;
  calls: Array<{ kind: string; tenantId: string; runPublicId: string; limit: number }>;
} {
  const calls: Array<{ kind: string; tenantId: string; runPublicId: string; limit: number }> = [];
  const created = (runPublicId: string) => runPublicId.includes('-pass2-') ? options.secondPassCreated ?? 0 : 2;
  return {
    calls,
    value: {
      async patientLinks(_db, input) {
        calls.push({ kind: 'patient-links', tenantId: input.tenantId, runPublicId: input.runPublicId, limit: input.chunkSize ?? 0 });
        return {
          completed: true,
          nextCursorLegacyPatientId: null,
          counts: {
            scanned: 2,
            created: created(input.runPublicId),
            skipped: 0,
            verified: 2,
            candidate: 0,
            unlinked: 0,
            events: created(input.runPublicId),
            mappings: created(input.runPublicId),
            issues: 0,
          },
        };
      },
      async practitioners(_db, input) {
        calls.push({ kind: 'practitioners', tenantId: input.tenantId, runPublicId: input.runPublicId, limit: input.maxSourceRecords ?? 0 });
        return {
          completed: true,
          counts: {
            scanned: 2,
            created: created(input.runPublicId),
            mapped: created(input.runPublicId),
            ambiguous: options.practitionerAmbiguous ?? 0,
            userLinks: 0,
            employeeLinks: 0,
            issues: options.practitionerAmbiguous ?? 0,
          },
        };
      },
      async appointments(_db, input) {
        calls.push({ kind: 'appointments', tenantId: input.tenantId, runPublicId: input.runPublicId, limit: input.maxSourceRecords ?? 0 });
        return {
          completed: true,
          counts: {
            scanned: 2,
            created: created(input.runPublicId),
            mapped: created(input.runPublicId),
            linked: created(input.runPublicId),
            skipped: 0,
            issues: 0,
          },
        };
      },
      async encounterAdmissionBed(_db, input) {
        calls.push({ kind: 'encounter-admission-bed', tenantId: input.tenantId, runPublicId: input.runPublicId, limit: input.maxSourceRecords ?? 0 });
        const count = created(input.runPublicId);
        return {
          completed: true,
          secondPassZeroNew: count === 0,
          counts: {
            scanned: 2,
            encountersHardened: count,
            locationsCreated: 0,
            bedsCreated: 0,
            admissionsCreated: count,
            eventsCreated: count,
            bedStaysCreated: 0,
            bedStaysUpdated: 0,
            mappingsCreated: count,
            issuesCreated: 0,
            skipped: 0,
            created: count,
            mapped: count,
            issues: 0,
          },
        };
      },
    },
  };
}

function resumeDatabase(rows: Array<Record<string, unknown>>) {
  const statement = {
    bind() {
      return statement;
    },
    async all() {
      return { results: rows };
    },
  };
  return {
    prepare() {
      return statement;
    },
  } as never;
}

describe('CDB-V1-071 authorized production backfills', () => {
  test('reads an exact paused patient-link checkpoint for safe resume', async () => {
    await expect(readCdbV1071PatientLinkResumeState(
      resumeDatabase([{
        run_status: 'succeeded',
        result_summary_json: JSON.stringify({
          candidate: 0,
          created: 100,
          events: 100,
          issues: 0,
          mappings: 100,
          scanned: 100,
          skipped: 0,
          unlinked: 85,
          verified: 15,
        }),
        checkpoint_status: 'paused',
        cursor_value: '1200',
      }]),
      '100',
      'cdbv1071-pass1-100-patient-links-2',
    )).resolves.toEqual({
      runStatus: 'succeeded',
      checkpointStatus: 'paused',
      cursorLegacyPatientId: 1200,
      counts: {
        candidate: 0,
        created: 100,
        events: 100,
        issues: 0,
        mappings: 100,
        scanned: 100,
        skipped: 0,
        unlinked: 85,
        verified: 15,
      },
    });
  });

  test('fails closed when a patient-link migration run has no checkpoint', async () => {
    await expect(readCdbV1071PatientLinkResumeState(
      resumeDatabase([{
        run_status: 'succeeded',
        result_summary_json: JSON.stringify({
          candidate: 0,
          created: 0,
          events: 0,
          issues: 0,
          mappings: 0,
          scanned: 0,
          skipped: 0,
          unlinked: 0,
          verified: 0,
        }),
        checkpoint_status: null,
        cursor_value: null,
      }]),
      '100',
      'cdbv1071-pass1-100-patient-links-1',
    )).rejects.toThrow('patient-link resume checkpoint is missing');
  });
  test('runs both passes for all exact tenants with a maximum limit of 100', async () => {
    const fake = operations();
    const result = await runCdbV1071AuthorizedBackfills(
      {} as never,
      '2026-07-31T05:30:00.000Z',
      fake.value,
      NO_RESUME,
    );
    expect(result.secondPassNewBusinessRows).toBe(0);
    expect(result.tenants).toEqual([...CDB_V1_071_TENANT_IDS]);
    expect(fake.calls).toHaveLength(CDB_V1_071_TENANT_IDS.length * 4 * 2);
    expect(fake.calls.every((call) => call.limit === 100)).toBe(true);
    expect(new Set(fake.calls.map((call) => call.tenantId))).toEqual(new Set(CDB_V1_071_TENANT_IDS));
  });

  test('fails closed when any second pass creates a business row', async () => {
    const fake = operations({ secondPassCreated: 1 });
    await expect(runCdbV1071AuthorizedBackfills(
      {} as never,
      '2026-07-31T05:30:00.000Z',
      fake.value,
      NO_RESUME,
    )).rejects.toThrow('second pass created new business rows');
  });

  test('fails closed on practitioner ambiguity or issue evidence', async () => {
    const fake = operations({ practitionerAmbiguous: 1 });
    await expect(runCdbV1071AuthorizedBackfills(
      {} as never,
      '2026-07-31T05:30:00.000Z',
      fake.value,
      NO_RESUME,
    )).rejects.toThrow('practitioner backfill reported ambiguity or issues');
  });

  test('resumes a completed patient-link chunk without re-running its write batch', async () => {
    const fake = operations();
    const resumeReader: CdbV1071BackfillResumeReader = {
      patientLinkChunk: async (_db, tenantId, runPublicId) => {
        if (tenantId !== '1' || runPublicId !== 'cdbv1071-pass1-1-patient-links-1') return null;
        return {
          runStatus: 'succeeded',
          checkpointStatus: 'completed',
          cursorLegacyPatientId: 3,
          counts: {
            scanned: 3,
            created: 3,
            skipped: 0,
            verified: 0,
            candidate: 0,
            unlinked: 3,
            events: 3,
            mappings: 3,
            issues: 0,
          },
        };
      },
    };
    const result = await runCdbV1071AuthorizedBackfills(
      {} as never,
      '2026-07-31T05:30:00.000Z',
      fake.value,
      resumeReader,
    );
    expect(fake.calls.some((call) => call.runPublicId === 'cdbv1071-pass1-1-patient-links-1'))
      .toBe(false);
    expect(result.entries).toContainEqual(expect.objectContaining({
      tenantId: '1',
      pass: 'pass1',
      kind: 'patient-links',
      created: 3,
      scanned: 3,
    }));
  });
});
