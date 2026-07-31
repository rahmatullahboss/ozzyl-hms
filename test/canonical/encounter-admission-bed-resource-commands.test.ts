import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  createBedResource,
  createCareLocation,
  retireBedResource,
  retireCareLocation,
  updateBedResource,
  updateCareLocation,
  type CreateBedResourceInput,
  type CreateCareLocationInput,
} from '../../src/lib/canonical/commands/manage-care-location-and-bed';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_resource_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    )
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function locationInput(overrides: Partial<CreateCareLocationInput> = {}): CreateCareLocationInput {
  return {
    tenantId: 'tenant-a',
    locationPublicId: 'location-ward-a',
    parentLocationPublicId: null,
    locationKind: 'ward',
    locationCode: 'WARD-A',
    displayName: 'Ward A Sensitive Label',
    operationalStatus: 'active',
    timezone: 'Asia/Dhaka',
    sourceType: 'legacy_ward',
    sourcePublicId: 'ward-101',
    sourceTable: 'beds',
    sourceEvidenceSha256: 'a'.repeat(64),
    actorSystemKey: 'canonical.resource.test',
    idempotencyKey: 'create-location-ward-a',
    eventPublicId: 'event-create-location-ward-a',
    occurredAtUtc: '2026-07-27T00:00:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function bedInput(overrides: Partial<CreateBedResourceInput> = {}): CreateBedResourceInput {
  return {
    tenantId: 'tenant-a',
    bedPublicId: 'bed-a-01',
    locationPublicId: 'location-ward-a',
    bedCode: 'A-01',
    bedClass: 'general',
    operationalStatus: 'active',
    sourceType: 'legacy_bed',
    sourcePublicId: 'bed-101',
    sourceTable: 'beds',
    sourceEvidenceSha256: 'b'.repeat(64),
    actorSystemKey: 'canonical.resource.test',
    idempotencyKey: 'create-bed-a-01',
    eventPublicId: 'event-create-bed-a-01',
    occurredAtUtc: '2026-07-27T00:01:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function seedOpenStay(sqlite: DatabaseSync, db: CanonicalBatchDatabase): Promise<void> {
  await createCareLocation(db, locationInput());
  await createBedResource(db, bedInput());
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('c'.repeat(64), '2026-07-27T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,care_location_public_id,source_kind,
      source_command_key,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-ipd-101',101,'ptl-101','inpatient','in_progress',1,
              'location-ward-a','runtime','encounter-command-101',?,?)
  `).run('2026-07-27T00:10:00.000Z', 'd'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_admissions (
      tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,
      admission_number,admission_type,admission_source,current_status,status_version,
      admitted_at_utc,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','admission-101','encounter-ipd-101','ptl-101','ADM-101',
              'inpatient','planned','admitted',1,?,?,?,?)
  `).run(
    '2026-07-27T00:10:00.000Z',
    'admission-command-101',
    'e'.repeat(64),
    'f'.repeat(64),
  );
  sqlite.prepare(`
    INSERT INTO canonical_bed_stays (
      tenant_id,bed_stay_public_id,encounter_public_id,
      legacy_patient_bed_info_id,legacy_admission_id,legacy_bed_id,
      admission_public_id,bed_public_id,patient_link_public_id,
      started_at_utc,status,stay_version,movement_reason,
      source_command_key,source_evidence_sha256
    ) VALUES ('tenant-a','stay-101','encounter-ipd-101',901,101,501,
              'admission-101','bed-a-01','ptl-101',?,'active',1,
              'admission','stay-command-101',?)
  `).run('2026-07-27T00:10:00.000Z', '1'.repeat(64));
}

describe('canonical care-location and bed resource commands', () => {
  it('atomically creates location and bed identity, mappings, compatibility, and PHI-minimised outbox evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const locationCompat = db.prepare(`INSERT INTO legacy_resource_compat(marker) VALUES (?)`).bind('legacy-ward-101');
      await expect(createCareLocation(db, locationInput(), {
        authoritativeStatements: [locationCompat],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          locationPublicId: 'location-ward-a',
          operationalStatus: 'active',
          version: 1,
        },
      });
      const bedCompat = db.prepare(`INSERT INTO legacy_resource_compat(marker) VALUES (?)`).bind('legacy-bed-101');
      await expect(createBedResource(db, bedInput(), {
        authoritativeStatements: [bedCompat],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          bedPublicId: 'bed-a-01',
          operationalStatus: 'active',
          version: 1,
        },
      });

      expect(count(sqlite, 'canonical_care_locations')).toBe(1);
      expect(count(sqlite, 'canonical_beds')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
      expect(count(sqlite, 'legacy_resource_compat')).toBe(2);
      const events = sqlite.prepare(`
        SELECT aggregate_type,aggregate_public_id,event_type,payload_json
        FROM canonical_outbox_events ORDER BY id
      `).all() as Array<Record<string, string>>;
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        aggregate_type: 'canonical_care_location',
        aggregate_public_id: 'location-ward-a',
        event_type: 'canonical.care-location.created',
      });
      expect(events[1]).toMatchObject({
        aggregate_type: 'canonical_bed_resource',
        aggregate_public_id: 'bed-a-01',
        event_type: 'canonical.bed-resource.created',
      });
      for (const event of events) {
        for (const forbidden of [
          'Ward A Sensitive Label', 'WARD-A', 'A-01', 'ward-101', 'bed-101',
          'legacy_ward', 'legacy_bed', 'aaaaaaaa', 'bbbbbbbb',
        ]) expect(event.payload_json).not.toContain(forbidden);
      }
    } finally {
      sqlite.close();
    }
  });

  it('creates deterministic IDs, exactly replays identical requests, and rejects changed replay', async () => {
    const { sqlite, db } = harness();
    try {
      const request = locationInput({
        locationPublicId: undefined,
        idempotencyKey: 'create-location-deterministic',
        eventPublicId: undefined,
        sourcePublicId: 'ward-deterministic',
      });
      const first = await createCareLocation(db, request);
      expect(first.result.locationPublicId).toMatch(/^location_[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(createCareLocation(db, request)).resolves.toEqual({
        status: 'replayed',
        result: first.result,
      });
      await expect(createCareLocation(db, {
        ...request,
        displayName: 'Changed Ward Label',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_care_locations')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('enforces tenant-safe hierarchy, rejects cycles, and guards updates with exact versions', async () => {
    const { sqlite, db } = harness();
    try {
      await createCareLocation(db, locationInput({
        locationPublicId: 'location-floor-a',
        locationKind: 'floor',
        locationCode: 'FLOOR-A',
        displayName: 'Floor A',
        sourcePublicId: 'floor-a',
        idempotencyKey: 'create-floor-a',
        eventPublicId: 'event-create-floor-a',
      }));
      await createCareLocation(db, locationInput({
        parentLocationPublicId: 'location-floor-a',
      }));

      await expect(updateCareLocation(db, {
        tenantId: 'tenant-a',
        locationPublicId: 'location-floor-a',
        expectedVersion: 1,
        parentLocationPublicId: 'location-ward-a',
        locationKind: 'floor',
        locationCode: 'FLOOR-A',
        displayName: 'Floor A',
        operationalStatus: 'active',
        timezone: 'Asia/Dhaka',
        sourceEvidenceSha256: '2'.repeat(64),
        actorSystemKey: 'canonical.resource.test',
        idempotencyKey: 'cycle-floor-a',
        eventPublicId: 'event-cycle-floor-a',
        occurredAtUtc: '2026-07-27T00:02:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/cycle/i);

      const update = {
        tenantId: 'tenant-a',
        locationPublicId: 'location-ward-a',
        expectedVersion: 1,
        parentLocationPublicId: 'location-floor-a',
        locationKind: 'ward' as const,
        locationCode: 'WARD-A',
        displayName: 'Ward A Updated',
        operationalStatus: 'active' as const,
        timezone: 'Asia/Dhaka',
        sourceEvidenceSha256: '3'.repeat(64),
        actorSystemKey: 'canonical.resource.test',
        idempotencyKey: 'update-ward-a',
        eventPublicId: 'event-update-ward-a',
        occurredAtUtc: '2026-07-27T00:03:00.000Z',
        businessDate: '2026-07-27',
      };
      await expect(updateCareLocation(db, update)).resolves.toMatchObject({
        status: 'applied',
        result: { locationPublicId: 'location-ward-a', version: 2 },
      });
      await expect(updateCareLocation(db, {
        ...update,
        idempotencyKey: 'stale-update-ward-a',
        eventPublicId: 'event-stale-update-ward-a',
      })).rejects.toThrow(/version/i);
      expect(sqlite.prepare(`
        SELECT parent_location_public_id,display_name,version
        FROM canonical_care_locations WHERE location_public_id='location-ward-a'
      `).get()).toEqual({
        parent_location_public_id: 'location-floor-a',
        display_name: 'Ward A Updated',
        version: 2,
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects occupancy vocabulary, supports bed maintenance transitions, and blocks retirement with an open stay', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createBedResource(db, bedInput({
        operationalStatus: 'occupied' as never,
      }))).rejects.toThrow(/operationalStatus/i);
      await seedOpenStay(sqlite, db);

      await expect(updateBedResource(db, {
        tenantId: 'tenant-a',
        bedPublicId: 'bed-a-01',
        expectedVersion: 1,
        locationPublicId: 'location-ward-a',
        bedCode: 'A-01',
        bedClass: 'general',
        operationalStatus: 'maintenance',
        sourceEvidenceSha256: '4'.repeat(64),
        actorSystemKey: 'canonical.resource.test',
        idempotencyKey: 'maintenance-bed-a-01',
        eventPublicId: 'event-maintenance-bed-a-01',
        occurredAtUtc: '2026-07-27T00:20:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/open stay|occupied/i);

      await expect(retireBedResource(db, {
        tenantId: 'tenant-a',
        bedPublicId: 'bed-a-01',
        expectedVersion: 1,
        reasonCode: 'decommissioned',
        sourceEvidenceSha256: '5'.repeat(64),
        actorSystemKey: 'canonical.resource.test',
        idempotencyKey: 'retire-bed-a-01',
        eventPublicId: 'event-retire-bed-a-01',
        occurredAtUtc: '2026-07-27T00:21:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/open stay/i);

      await expect(retireCareLocation(db, {
        tenantId: 'tenant-a',
        locationPublicId: 'location-ward-a',
        expectedVersion: 1,
        reasonCode: 'ward_closed',
        sourceEvidenceSha256: '6'.repeat(64),
        actorSystemKey: 'canonical.resource.test',
        idempotencyKey: 'retire-location-ward-a',
        eventPublicId: 'event-retire-location-ward-a',
        occurredAtUtc: '2026-07-27T00:22:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/active bed|bed resource/i);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back resource, mapping, outbox, and compatibility together', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO legacy_resource_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_resource_compat(marker) VALUES ('duplicate')`);
      await expect(createCareLocation(db, locationInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(count(sqlite, 'canonical_care_locations')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
