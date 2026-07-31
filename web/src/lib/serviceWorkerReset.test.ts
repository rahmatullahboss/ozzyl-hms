import { describe, expect, it, vi } from 'vitest';
import { refreshStaleHmsServiceWorker } from './serviceWorkerReset';

function registration(scope: string, scriptURL: string) {
  return {
    scope,
    active: { scriptURL },
    waiting: null,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn(),
  };
}

describe('refreshStaleHmsServiceWorker', () => {
  it('updates only the same-origin HMS worker without unregistering registrations', async () => {
    const hms = registration('https://hms.example/', 'https://hms.example/sw.js');
    const unrelated = registration('https://hms.example/tools/', 'https://hms.example/tools/sw.js');
    const storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() };

    await refreshStaleHmsServiceWorker(
      { getRegistrations: vi.fn().mockResolvedValue([hms, unrelated]) },
      storage,
      'https://hms.example',
    );

    expect(hms.update).toHaveBeenCalledOnce();
    expect(hms.unregister).not.toHaveBeenCalled();
    expect(unrelated.update).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalledWith('hms-sw-reset-public-api-patterns-2026-06-18', '1');
  });

  it('does not mark the migration complete when the update fails', async () => {
    const hms = registration('https://hms.example/', 'https://hms.example/sw.js');
    hms.update.mockRejectedValueOnce(new Error('update failed'));
    const storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() };

    let caught: unknown;
    try {
      await refreshStaleHmsServiceWorker(
        { getRegistrations: vi.fn().mockResolvedValue([hms]) },
        storage,
        'https://hms.example',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toEqual(new Error('update failed'));
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
