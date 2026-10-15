import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }));
vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => false,
  isTauriAppPlatform: () => true,
}));
vi.mock('@/services/sync/providers/gdrive/AndroidDriveAuth', () => ({
  createAndroidDriveAuth: vi.fn(),
}));
vi.mock('@/services/sync/providers/gdrive/driveTokenStore', () => ({
  createDriveTokenPersistence: vi.fn(),
}));
vi.mock('@/services/sync/file/providerRegistry', () => ({ resetFileSyncProviderCache: vi.fn() }));

import { createAndroidDriveAuth } from '@/services/sync/providers/gdrive/AndroidDriveAuth';
import { createDriveTokenPersistence } from '@/services/sync/providers/gdrive/driveTokenStore';
import { resetFileSyncProviderCache } from '@/services/sync/file/providerRegistry';
import {
  runGoogleDriveConnect,
  runGoogleDriveDisconnect,
} from '@/services/sync/providers/gdrive/googleDriveConnect';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('personal Android Drive wiring', () => {
  test('connect and disconnect use native authorization rather than a refresh-token store', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSONAL_BUILD', 'true');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', 'android.apps.googleusercontent.com');
    const auth = {
      connect: vi.fn(async () => ({ accountLabel: 'reader@example.com' })),
      disconnect: vi.fn(async () => {}),
    };
    vi.mocked(createAndroidDriveAuth).mockResolvedValue(
      auth as unknown as Awaited<ReturnType<typeof createAndroidDriveAuth>>,
    );
    expect(await runGoogleDriveConnect()).toEqual({ accountLabel: 'reader@example.com' });
    expect(resetFileSyncProviderCache).toHaveBeenCalledTimes(2);
    await runGoogleDriveDisconnect();
    expect(auth.connect).toHaveBeenCalledOnce();
    expect(auth.disconnect).toHaveBeenCalledOnce();
    expect(createDriveTokenPersistence).not.toHaveBeenCalled();
  });
});
