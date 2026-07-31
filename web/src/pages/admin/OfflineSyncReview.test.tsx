import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineSyncReview from './OfflineSyncReview';
import { api } from '../../lib/apiClient';
import type { DecryptedSyncQueueRow } from '../../lib/secure-store';

vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../components/admin/AdminPageShell', () => ({
  default: ({ title, subtitle, actions, summaryCards, children }: any) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      <div>{actions}</div>
      <div>{summaryCards}</div>
      <main>{children}</main>
    </div>
  ),
}));

const secureStoreMocks = vi.hoisted(() => ({
  getActiveTenantId: vi.fn(() => 'tenant-a'),
  getAllSyncQueueRowsDecrypted: vi.fn(),
  markSyncItemStatusEncrypted: vi.fn(),
  removeSyncItemEncrypted: vi.fn(),
}));

vi.mock('../../lib/secure-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/secure-store')>();
  return {
    ...actual,
    getActiveTenantId: secureStoreMocks.getActiveTenantId,
    getAllSyncQueueRowsDecrypted: secureStoreMocks.getAllSyncQueueRowsDecrypted,
    markSyncItemStatusEncrypted: secureStoreMocks.markSyncItemStatusEncrypted,
    removeSyncItemEncrypted: secureStoreMocks.removeSyncItemEncrypted,
  };
});

const offlineMocks = vi.hoisted(() => ({
  syncNow: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useOffline', () => ({
  useOffline: () => ({
    isOnline: true,
    pendingCount: 1,
    isSyncing: false,
    lastSyncAt: null,
    syncNow: offlineMocks.syncNow,
  }),
}));

function serverSyncResponse() {
  return {
    deploymentMode: 'local_server' as const,
    localServerId: 'hospital-lan-01',
    generatedAt: '2026-07-11T08:00:00.000Z',
    warnings: [],
    coverage: {
      mode: 'explicit_outbox' as const,
      fullDatabaseReplication: false,
      explicitLocalEmitterTypes: ['ipd_doctor_round', 'billing_provisional_doctor_round', 'patients', 'global_patient_identity', 'patient_health_links', 'medicine_catalog_entry'],
      nonAtomicEmitterTypes: ['patients', 'global_patient_identity', 'patient_health_links'],
      partialWritePathCoverageTypes: ['patients'],
      atomicPatientWritePaths: ['patients:update', 'emergency:create-patient', 'patient-portal:register', 'referrals:accept-create-patient', 'reception:quick-admit'],
      durableStagedPatientWritePaths: ['patients:link-global', 'referrals:accept-health-link'],
      patientWritePathGaps: ['patients:create-global-link', 'marketplace-patient:create', 'fhir:patient-import'],
      entityIdMappingGaps: ['visits', 'appointments', 'bills', 'payments'],
      cloudApplyTypes: ['ipd_doctor_round', 'billing_provisional_doctor_round', 'patients', 'global_patient_identity', 'patient_health_links', 'medicine_catalog_entry'],
      coreOutboxGaps: ['appointments', 'visits', 'bills', 'payments'],
    },
    localOutbox: {
      summary: { total: 2, pending: 0, exporting: 0, exported: 1, failed: 0, poison: 1 },
      rows: [{
        id: 91,
        entityType: 'ipd_doctor_round',
        entityId: 'round-91',
        operation: 'upsert',
        status: 'poison' as const,
        attempts: 5,
        lastError: 'Signed IPD doctor round sync conflict requires clinical review',
        createdAt: '2026-07-11 07:00:00',
      }],
    },
    cloudIngest: {
      summary: { total: 3, metadataOnly: 0, processing: 0, applied: 2, failed: 1 },
      rows: [{
        id: 71,
        serverId: 'hospital-lan-01',
        batchId: 'batch-71',
        entityType: 'ipd_doctor_round',
        entityId: 'round-91',
        operation: 'upsert',
        applyStatus: 'failed' as const,
        applyError: 'Signed IPD doctor round sync conflict requires clinical review',
        receivedAt: '2026-07-11 07:01:00',
      }],
    },
    cloudPull: {
      summary: { total: 2, pending: 0, applied: 1, failed: 1, skipped: 0 },
      rows: [{
        tableName: 'appointments',
        lastSnapshotId: 'snapshot-7',
        lastPulledAt: '2026-07-11 06:30:00',
        rowsReceived: 12,
        rowsApplied: 0,
        status: 'failed' as const,
        lastError: 'local write conflict',
        updatedAt: '2026-07-11 06:31:00',
      }],
    },
  };
}

function row(overrides: Partial<DecryptedSyncQueueRow> = {}): DecryptedSyncQueueRow {
  return {
    id: 1,
    store: 'patients',
    status: 'conflict',
    createdAt: 1782543600000,
    attemptCount: 2,
    lastError: 'duplicate patient',
    payload: {
      method: 'POST',
      url: '/api/patients',
      body: { name: 'Offline Patient' },
      localId: 'local-1',
      store: 'patients',
      local_ref: 'OFF-PATIENTS-REC01-20260627-090000',
      queue_id: 'idem-1',
      idempotency_key: 'idem-1',
      original_tenant_id: 'tenant-a',
      original_user_id: 'user-a',
      original_workstation_id: 'REC-01',
      original_session_id: null,
      created_at: 1782543600000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  secureStoreMocks.getActiveTenantId.mockReturnValue('tenant-a');
  secureStoreMocks.getAllSyncQueueRowsDecrypted.mockResolvedValue([row()]);
  secureStoreMocks.markSyncItemStatusEncrypted.mockResolvedValue(undefined);
  secureStoreMocks.removeSyncItemEncrypted.mockResolvedValue(undefined);
  vi.mocked(api.get).mockResolvedValue(serverSyncResponse());
  vi.mocked(api.post).mockResolvedValue({ message: 'Server sync retry queued' });
});

describe('OfflineSyncReview', () => {
  it('renders browser-local offline queue rows and review summary', async () => {
    render(<OfflineSyncReview />);

    expect(await screen.findByText('Offline Sync Review')).toBeInTheDocument();
    expect(await screen.findByText('OFF-PATIENTS-REC01-20260627-090000')).toBeInTheDocument();
    expect(screen.getAllByText('Conflict review').length).toBeGreaterThan(0);
    expect(screen.getByText('duplicate patient')).toBeInTheDocument();
    expect(screen.getAllByText('REC-01').length).toBeGreaterThan(0);
    expect(secureStoreMocks.getAllSyncQueueRowsDecrypted).toHaveBeenCalledWith('tenant-a');
  });

  it('marks a conflict row queued for manual retry', async () => {
    render(<OfflineSyncReview />);

    fireEvent.click(await screen.findByRole('button', { name: /mark retry/i }));

    await waitFor(() => {
      expect(secureStoreMocks.markSyncItemStatusEncrypted).toHaveBeenCalledWith(1, 'queued');
    });
  });

  it('removes a local queue row when admin discards it', async () => {
    render(<OfflineSyncReview />);

    fireEvent.click(await screen.findByRole('button', { name: /remove local/i }));

    await waitFor(() => {
      expect(secureStoreMocks.removeSyncItemEncrypted).toHaveBeenCalledWith(1);
    });
  });

  it('shows an encrypted queue unavailable message when local decryption fails', async () => {
    secureStoreMocks.getAllSyncQueueRowsDecrypted.mockRejectedValueOnce(new Error('secure store is not active'));

    render(<OfflineSyncReview />);

    expect(await screen.findByText('Encrypted queue unavailable')).toBeInTheDocument();
    expect(screen.getByText('secure store is not active')).toBeInTheDocument();
  });

  it('renders browser and hospital local-server sync as separate channels', async () => {
    render(<OfflineSyncReview />);

    expect(await screen.findByText('Hospital local server ↔ cloud')).toBeInTheDocument();
    expect(screen.getByText('Browser offline queue')).toBeInTheDocument();
    expect(screen.getByText('hospital-lan-01')).toBeInTheDocument();
    expect(screen.getByText('Local-server push outbox')).toBeInTheDocument();
    expect(screen.getByText('Cloud ingest receipts')).toBeInTheDocument();
    expect(screen.getByText('Cloud-to-local pull state')).toBeInTheDocument();
    expect(screen.getByText('Local-server incremental push coverage is partial')).toBeInTheDocument();
    expect(screen.getByText(/Emitted after the main write rather than atomically: patients, global_patient_identity, patient_health_links/i)).toBeInTheDocument();
    expect(screen.getByText(/Entities with only partial write-path coverage: patients/i)).toBeInTheDocument();
    expect(screen.getByText(/Atomic patient write paths: patients:update, emergency:create-patient, patient-portal:register, referrals:accept-create-patient, reception:quick-admit/i)).toBeInTheDocument();
    expect(screen.getByText(/Durable staged patient write paths: patients:link-global, referrals:accept-health-link/i)).toBeInTheDocument();
    expect(screen.getByText(/Patient write paths still missing atomic sync coverage: patients:create-global-link, marketplace-patient:create, fhir:patient-import/i)).toBeInTheDocument();
    expect(screen.getByText(/Entities still needing stable local↔cloud ID mapping: visits, appointments, bills, payments/i)).toBeInTheDocument();
    expect(screen.getByText(/Core write paths still requiring outbox coverage: appointments, visits, bills, payments/i)).toBeInTheDocument();
    expect(screen.getByText('appointments')).toBeInTheDocument();
    expect(screen.getAllByText(/signed ipd doctor round sync conflict/i).length).toBeGreaterThanOrEqual(2);
    expect(api.get).toHaveBeenCalledWith('/api/audit/server-sync?limit=100');
  });

  it('queues a hospital local-server outbox retry through the audited server API', async () => {
    render(<OfflineSyncReview />);

    fireEvent.click(await screen.findByRole('button', { name: /queue server retry/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/audit/server-sync/outbox/91/retry', {});
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('keeps the browser queue usable when server-side sync review cannot load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('server review unavailable'));

    render(<OfflineSyncReview />);

    expect(await screen.findByText('Server sync review unavailable')).toBeInTheDocument();
    expect(screen.getByText('server review unavailable')).toBeInTheDocument();
    expect(screen.getByText('OFF-PATIENTS-REC01-20260627-090000')).toBeInTheDocument();
    expect(screen.getByText('Browser offline queue')).toBeInTheDocument();
  });
});
