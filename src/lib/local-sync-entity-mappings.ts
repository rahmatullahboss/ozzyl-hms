import { HTTPException } from 'hono/http-exception';

export type SyncEntityMapping = {
  serverId: string;
  tenantId: string;
  entityType: string;
  localEntityId: string;
  cloudEntityId: string;
  naturalKey?: string | null;
};

type MappingRow = {
  server_id: string;
  tenant_id: string;
  entity_type: string;
  local_entity_id: string;
  cloud_entity_id: string;
  natural_key: string | null;
};

function toMapping(row: MappingRow): SyncEntityMapping {
  return {
    serverId: String(row.server_id),
    tenantId: String(row.tenant_id),
    entityType: String(row.entity_type),
    localEntityId: String(row.local_entity_id),
    cloudEntityId: String(row.cloud_entity_id),
    naturalKey: row.natural_key ?? null,
  };
}

export async function getSyncEntityMappingByLocal(
  database: D1Database,
  serverId: string,
  tenantId: string,
  entityType: string,
  localEntityId: string | number,
): Promise<SyncEntityMapping | null> {
  const row = await database.prepare(`
    SELECT server_id, tenant_id, entity_type, local_entity_id, cloud_entity_id, natural_key
    FROM sync_entity_mappings
    WHERE server_id = ? AND tenant_id = ? AND entity_type = ? AND local_entity_id = ?
    LIMIT 1
  `).bind(serverId, tenantId, entityType, String(localEntityId)).first<MappingRow>();
  return row ? toMapping(row) : null;
}

export async function getSyncEntityMappingByCloud(
  database: D1Database,
  serverId: string,
  tenantId: string,
  entityType: string,
  cloudEntityId: string | number,
): Promise<SyncEntityMapping | null> {
  const row = await database.prepare(`
    SELECT server_id, tenant_id, entity_type, local_entity_id, cloud_entity_id, natural_key
    FROM sync_entity_mappings
    WHERE server_id = ? AND tenant_id = ? AND entity_type = ? AND cloud_entity_id = ?
    LIMIT 1
  `).bind(serverId, tenantId, entityType, String(cloudEntityId)).first<MappingRow>();
  return row ? toMapping(row) : null;
}

export async function ensureSyncEntityMapping(
  database: D1Database,
  mapping: SyncEntityMapping,
): Promise<SyncEntityMapping> {
  await database.prepare(`
    INSERT OR IGNORE INTO sync_entity_mappings (
      server_id, tenant_id, entity_type, local_entity_id, cloud_entity_id,
      natural_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    mapping.serverId,
    mapping.tenantId,
    mapping.entityType,
    String(mapping.localEntityId),
    String(mapping.cloudEntityId),
    mapping.naturalKey ?? null,
  ).run();

  const byLocal = await getSyncEntityMappingByLocal(
    database,
    mapping.serverId,
    mapping.tenantId,
    mapping.entityType,
    mapping.localEntityId,
  );
  if (!byLocal) {
    const byCloud = await getSyncEntityMappingByCloud(
      database,
      mapping.serverId,
      mapping.tenantId,
      mapping.entityType,
      mapping.cloudEntityId,
    );
    throw new HTTPException(409, {
      message: byCloud
        ? 'Cloud entity is already mapped to a different local entity ID'
        : 'Sync entity mapping could not be persisted',
    });
  }
  if (String(byLocal.cloudEntityId) !== String(mapping.cloudEntityId)) {
    throw new HTTPException(409, {
      message: 'Local entity is already mapped to a different cloud entity ID',
    });
  }

  if (mapping.naturalKey && byLocal.naturalKey !== mapping.naturalKey) {
    await database.prepare(`
      UPDATE sync_entity_mappings
      SET natural_key = COALESCE(natural_key, ?), updated_at = datetime('now')
      WHERE server_id = ? AND tenant_id = ? AND entity_type = ?
        AND local_entity_id = ? AND cloud_entity_id = ?
    `).bind(
      mapping.naturalKey,
      mapping.serverId,
      mapping.tenantId,
      mapping.entityType,
      String(mapping.localEntityId),
      String(mapping.cloudEntityId),
    ).run();
    return { ...byLocal, naturalKey: byLocal.naturalKey ?? mapping.naturalKey };
  }

  return byLocal;
}

export async function persistSyncEntityMappings(
  database: D1Database,
  mappings: SyncEntityMapping[],
): Promise<SyncEntityMapping[]> {
  const persisted: SyncEntityMapping[] = [];
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const key = [mapping.serverId, mapping.tenantId, mapping.entityType, mapping.localEntityId].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    persisted.push(await ensureSyncEntityMapping(database, mapping));
  }
  return persisted;
}
