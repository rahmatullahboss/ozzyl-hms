import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';
import {
  assertReceivableAdjustmentAuthorityReady,
  getReceivableAdjustmentReadiness,
  ReceivableAuthorityConfigurationError,
  resolveReceivableAuthority,
} from '../../../src/services/actionCenter/collections/authority';

function createFeatureFlags(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE canonical_feature_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      UNIQUE(tenant_id, flag_key)
    );
  `);
}

function createCanonicalInvoices(
  sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite'],
  options: { withPaymentProjection?: boolean; withAdjustmentProjection?: boolean } = {},
): void {
  const paymentColumns = options.withPaymentProjection
    ? ', paid_minor INTEGER NOT NULL DEFAULT 0, due_minor INTEGER NOT NULL DEFAULT 0'
    : '';
  const adjustmentColumns = options.withAdjustmentProjection
    ? ', credited_minor INTEGER NOT NULL DEFAULT 0, net_due_minor INTEGER NOT NULL DEFAULT 0'
    : '';

  sqlite.exec(`
    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL DEFAULT '2026-07-14T00:00:00.000Z'
      ${paymentColumns}
      ${adjustmentColumns},
      UNIQUE(tenant_id, invoice_public_id)
    );
  `);
}

function createCanonicalWriteOffSchema(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE canonical_source_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE canonical_outbox_events (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE canonical_credit_notes (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE canonical_credit_note_lines (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE canonical_compensation_accruals (id INTEGER PRIMARY KEY AUTOINCREMENT);
  `);
}

function setReceivableFlag(
  sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite'],
  input: { tenantId: string; mode: 'legacy' | 'shadow' | 'canonical' | 'disabled'; enabled: boolean },
): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,
      flag_key,
      domain,
      mode,
      is_enabled
    ) VALUES (?, 'billing.receivables', 'billing', ?, ?)
  `).run(input.tenantId, input.mode, input.enabled ? 1 : 0);
}

describe('receivable authority resolution', () => {
  it('defaults to legacy when the canonical feature flag table is absent', async () => {
    const harness = createSqliteD1Harness();

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-a',
    })).resolves.toEqual({
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable: false,
    });
  });

  it('keeps legacy authority for missing, disabled, or explicitly legacy tenant flags', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-without-flag',
    })).resolves.toEqual({
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable: false,
    });

    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-disabled',
      mode: 'disabled',
      enabled: false,
    });
    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-disabled',
    })).resolves.toEqual({
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable: false,
    });

    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-legacy',
      mode: 'legacy',
      enabled: true,
    });
    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-legacy',
    })).resolves.toEqual({
      mode: 'legacy',
      requestedMode: 'legacy',
      canonicalSchemaAvailable: false,
    });
  });

  it('enables shadow mode only when canonical invoice and payment projections are available', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, { withPaymentProjection: true });
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-shadow',
      mode: 'shadow',
      enabled: true,
    });

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-shadow',
    })).resolves.toEqual({
      mode: 'shadow',
      requestedMode: 'shadow',
      canonicalSchemaAvailable: true,
    });
  });

  it('fails closed when shadow mode is requested without canonical payment projections', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite);
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-shadow',
      mode: 'shadow',
      enabled: true,
    });

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-shadow',
    })).rejects.toMatchObject({
      name: 'ReceivableAuthorityConfigurationError',
      requestedMode: 'shadow',
      missingRequirements: expect.arrayContaining(['canonical_invoices.paid_minor', 'canonical_invoices.due_minor']),
    });
  });

  it('enables canonical mode only with payment and adjustment projections', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, {
      withPaymentProjection: true,
      withAdjustmentProjection: true,
    });
    createCanonicalWriteOffSchema(harness.sqlite);
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-canonical',
      mode: 'canonical',
      enabled: true,
    });

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-canonical',
    })).resolves.toEqual({
      mode: 'canonical',
      requestedMode: 'canonical',
      canonicalSchemaAvailable: true,
    });
  });

  it('reports exact missing canonical requirements instead of silently falling back', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, { withPaymentProjection: true });
    createCanonicalWriteOffSchema(harness.sqlite);
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-canonical',
      mode: 'canonical',
      enabled: true,
    });

    const error = await resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-canonical',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReceivableAuthorityConfigurationError);
    expect(error).toMatchObject({
      requestedMode: 'canonical',
      missingRequirements: [
        'canonical_invoices.credited_minor',
        'canonical_invoices.net_due_minor',
      ],
    });
  });

  it('keeps canonical reads available but fails closed for adjustment commands when tables are incomplete', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, {
      withPaymentProjection: true,
      withAdjustmentProjection: true,
    });
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-canonical',
      mode: 'canonical',
      enabled: true,
    });

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-canonical',
    })).resolves.toEqual({
      mode: 'canonical',
      requestedMode: 'canonical',
      canonicalSchemaAvailable: true,
    });
    await expect(assertReceivableAdjustmentAuthorityReady({
      db: harness.db,
      authorityMode: 'canonical',
    })).rejects.toMatchObject({
      name: 'ReceivableAuthorityConfigurationError',
      requestedMode: 'canonical',
      missingRequirements: [
        'billing_mutation_idempotency_keys',
        'canonical_source_mappings',
        'canonical_outbox_events',
        'canonical_credit_notes',
        'canonical_credit_note_lines',
        'canonical_compensation_accruals',
        'fiscal_years',
        'accounting_period_closes',
      ],
    });
  });

  it('reports missing command columns when a required canonical table is only partially migrated', async () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE canonical_compensation_accruals (
        tenant_id TEXT NOT NULL,
        invoice_public_id TEXT NOT NULL
      );
    `);

    await expect(getReceivableAdjustmentReadiness({
      db: harness.db,
      authorityMode: 'canonical',
    })).resolves.toMatchObject({
      ready: false,
      missingRequirements: expect.arrayContaining([
        'canonical_compensation_accruals.settled_minor',
      ]),
    });
  });

  it('never reads another tenant flag', async () => {
    const harness = createSqliteD1Harness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, {
      withPaymentProjection: true,
      withAdjustmentProjection: true,
    });
    createCanonicalWriteOffSchema(harness.sqlite);
    setReceivableFlag(harness.sqlite, {
      tenantId: 'tenant-b',
      mode: 'canonical',
      enabled: true,
    });

    await expect(resolveReceivableAuthority({
      db: harness.db,
      tenantId: 'tenant-a',
    })).resolves.toEqual({
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable: true,
    });
  });
});
