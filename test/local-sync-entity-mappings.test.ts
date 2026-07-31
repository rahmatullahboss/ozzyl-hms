import { describe, expect, it } from 'vitest';
import {
  ensureSyncEntityMapping,
  getSyncEntityMappingByCloud,
  getSyncEntityMappingByLocal,
  persistSyncEntityMappings,
  type SyncEntityMapping,
} from '../src/lib/local-sync-entity-mappings';

type MappingState = {
  server_id: string;
  tenant_id: string;
  entity_type: string;
  local_entity_id: string;
  cloud_entity_id: string;
  natural_key: string | null;
};

function createMappingDatabase(initial: MappingState[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  const queries: Array<{ sql: string; params: unknown[]; method: 'run' | 'first' }> = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          return {
            async run() {
              queries.push({ sql, params, method: 'run' });
              if (normalized.startsWith('insert or ignore into sync_entity_mappings')) {
                const [serverId, tenantId, entityType, localId, cloudId, naturalKey] = params.map((value) => value == null ? null : String(value));
                const duplicate = rows.some((row) =>
                  row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && (row.local_entity_id === localId || row.cloud_entity_id === cloudId),
                );
                if (!duplicate) {
                  rows.push({
                    server_id: serverId!,
                    tenant_id: tenantId!,
                    entity_type: entityType!,
                    local_entity_id: localId!,
                    cloud_entity_id: cloudId!,
                    natural_key: naturalKey,
                  });
                }
                return { success: true, meta: { changes: duplicate ? 0 : 1, last_row_id: duplicate ? 0 : rows.length } };
              }
              if (normalized.startsWith('update sync_entity_mappings')) {
                const [naturalKey, serverId, tenantId, entityType, localId, cloudId] = params.map((value) => value == null ? null : String(value));
                const row = rows.find((candidate) =>
                  candidate.server_id === serverId
                  && candidate.tenant_id === tenantId
                  && candidate.entity_type === entityType
                  && candidate.local_entity_id === localId
                  && candidate.cloud_entity_id === cloudId,
                );
                if (row && row.natural_key == null) row.natural_key = naturalKey;
                return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
              }
              throw new Error(`Unhandled run SQL: ${normalized}`);
            },
            async first<T>() {
              queries.push({ sql, params, method: 'first' });
              if (normalized.includes('from sync_entity_mappings') && normalized.includes('local_entity_id = ?')) {
                const [serverId, tenantId, entityType, localId] = params.map(String);
                return (rows.find((row) =>
                  row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && row.local_entity_id === localId,
                ) ?? null) as T | null;
              }
              if (normalized.includes('from sync_entity_mappings') && normalized.includes('cloud_entity_id = ?')) {
                const [serverId, tenantId, entityType, cloudId] = params.map(String);
                return (rows.find((row) =>
                  row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && row.cloud_entity_id === cloudId,
                ) ?? null) as T | null;
              }
              throw new Error(`Unhandled first SQL: ${normalized}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, rows, queries };
}

const mapping: SyncEntityMapping = {
  serverId: 'hospital-lan-1',
  tenantId: 'tenant-1',
  entityType: 'patients',
  localEntityId: '123',
  cloudEntityId: '9001',
  naturalKey: 'UHID-123',
};

describe('local/cloud sync entity mappings', () => {
  it('creates and reads a stable local-to-cloud mapping', async () => {
    const state = createMappingDatabase();
    await expect(ensureSyncEntityMapping(state.db, mapping)).resolves.toEqual(mapping);
    await expect(getSyncEntityMappingByLocal(state.db, 'hospital-lan-1', 'tenant-1', 'patients', 123))
      .resolves.toEqual(mapping);
    await expect(getSyncEntityMappingByCloud(state.db, 'hospital-lan-1', 'tenant-1', 'patients', 9001))
      .resolves.toEqual(mapping);
  });

  it('treats an exact replay as idempotent and fills a missing natural key', async () => {
    const state = createMappingDatabase([{
      server_id: mapping.serverId,
      tenant_id: mapping.tenantId,
      entity_type: mapping.entityType,
      local_entity_id: mapping.localEntityId,
      cloud_entity_id: mapping.cloudEntityId,
      natural_key: null,
    }]);

    await expect(ensureSyncEntityMapping(state.db, mapping)).resolves.toEqual(mapping);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.natural_key).toBe('UHID-123');
  });

  it('rejects remapping one local entity to a different cloud ID', async () => {
    const state = createMappingDatabase([{
      server_id: mapping.serverId,
      tenant_id: mapping.tenantId,
      entity_type: mapping.entityType,
      local_entity_id: mapping.localEntityId,
      cloud_entity_id: mapping.cloudEntityId,
      natural_key: mapping.naturalKey ?? null,
    }]);

    await expect(ensureSyncEntityMapping(state.db, { ...mapping, cloudEntityId: '9002' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects mapping one cloud entity to a different local ID', async () => {
    const state = createMappingDatabase([{
      server_id: mapping.serverId,
      tenant_id: mapping.tenantId,
      entity_type: mapping.entityType,
      local_entity_id: '122',
      cloud_entity_id: mapping.cloudEntityId,
      natural_key: mapping.naturalKey ?? null,
    }]);

    await expect(ensureSyncEntityMapping(state.db, mapping))
      .rejects.toMatchObject({ status: 409 });
  });

  it('deduplicates repeated mappings before persistence', async () => {
    const state = createMappingDatabase();
    const persisted = await persistSyncEntityMappings(state.db, [mapping, mapping]);
    expect(persisted).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
  });
});
