import { afterEach, describe, expect, test, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  isSyncKeychainAvailable: vi.fn(async () => ({ available: true })),
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));
import { invoke } from '@tauri-apps/api/core';
import { getSecureItem } from '@/utils/bridge';
import {
  AndroidDriveAuth,
  createAndroidDriveAuth,
} from '@/services/sync/providers/gdrive/AndroidDriveAuth';

afterEach(() => vi.clearAllMocks());

const makeAuth = (account: string | null = 'reader@example.com') => {
  const deps = {
    loadAccount: vi.fn(async () => account),
    saveAccount: vi.fn(async (_email: string) => {}),
    clearAccount: vi.fn(async () => {}),
    authorize: vi.fn(async (_interactive: boolean, _accountName?: string) => ({
      accessToken: 'TOKEN',
    })),
    clearToken: vi.fn(async (_token: string) => {}),
    fetchFn: vi.fn(
      async () => new Response(JSON.stringify({ user: { emailAddress: 'reader@example.com' } })),
    ),
    now: vi.fn(() => 0),
  };
  return { auth: new AndroidDriveAuth(deps), deps };
};

describe('AndroidDriveAuth', () => {
  test('separate provider instances serialize native authorization calls', async () => {
    const clientId = 'android.apps.googleusercontent.com';
    vi.mocked(getSecureItem).mockResolvedValue({
      value: JSON.stringify({ clientId, accountName: 'reader@example.com' }),
    });
    let finish!: (result: { accessToken: string }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(invoke).mockResolvedValue({ accessToken: 'TOKEN' });
    const first = await createAndroidDriveAuth(clientId, vi.fn());
    const second = await createAndroidDriveAuth(clientId, vi.fn());
    const requests = Promise.all([first!.getAccessToken(), second!.getAccessToken()]);
    try {
      await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      finish({ accessToken: 'TOKEN' });
      await requests;
    }
  });

  test('a marker for a different OAuth client cannot authorize the device', async () => {
    vi.mocked(getSecureItem).mockResolvedValue({
      value: JSON.stringify({ clientId: 'old-client', accountName: 'reader@example.com' }),
    });
    const auth = await createAndroidDriveAuth('new-client', vi.fn());
    await expect(auth!.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('renewal is single-flight and pins the saved account without opening UI', async () => {
    const { auth, deps } = makeAuth();
    expect(await Promise.all([auth.getAccessToken(), auth.getAccessToken()])).toEqual([
      'TOKEN',
      'TOKEN',
    ]);
    expect(deps.authorize).toHaveBeenCalledExactlyOnceWith(false, 'reader@example.com');
    deps.now.mockReturnValue(6 * 60_000);
    await auth.getAccessToken();
    expect(deps.authorize).toHaveBeenCalledTimes(2);
  });

  test('a disconnected device cannot silently authorize its default account', async () => {
    const { auth, deps } = makeAuth(null);
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(deps.authorize).not.toHaveBeenCalled();
  });

  test('connect persists the actual Drive email before reporting success', async () => {
    const { auth, deps } = makeAuth(null);
    expect(await auth.connect()).toEqual({ accountLabel: 'reader@example.com' });
    expect(deps.authorize).toHaveBeenCalledExactlyOnceWith(true);
    expect(deps.saveAccount).toHaveBeenCalledExactlyOnceWith('reader@example.com');
    expect(await auth.getAccessToken()).toBe('TOKEN');
  });

  test('a display name cannot be saved as an Android account', async () => {
    const { auth, deps } = makeAuth(null);
    deps.fetchFn.mockResolvedValue(
      new Response(JSON.stringify({ user: { displayName: 'Reader' } })),
    );
    await expect(auth.connect()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(deps.saveAccount).not.toHaveBeenCalled();
  });

  test('failed secure storage prevents a successful connection', async () => {
    const { auth, deps } = makeAuth(null);
    deps.saveAccount.mockRejectedValue(new Error('keychain locked'));
    await expect(auth.connect()).rejects.toThrow('keychain locked');
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('revoked native permission becomes an auth failure, without interactive retry', async () => {
    const { auth, deps } = makeAuth();
    deps.authorize.mockRejectedValue('AUTHORIZATION_REQUIRED');
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(deps.authorize).toHaveBeenCalledExactlyOnceWith(false, 'reader@example.com');
  });

  test('a rejected bearer token is evicted once before concurrent renewal', async () => {
    const { auth, deps } = makeAuth();
    await auth.getAccessToken();
    await Promise.all([auth.invalidateAccessToken('TOKEN'), auth.invalidateAccessToken('TOKEN')]);
    expect(deps.clearToken).toHaveBeenCalledExactlyOnceWith('TOKEN');
    await auth.getAccessToken();
    expect(deps.authorize).toHaveBeenCalledTimes(2);
  });

  test('disconnect clears the local marker and stops automatic reconnection', async () => {
    const { auth, deps } = makeAuth();
    await auth.getAccessToken();
    await auth.disconnect();
    expect(deps.clearAccount).toHaveBeenCalledOnce();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('a renewal finishing after disconnect cannot restore the session', async () => {
    const { auth, deps } = makeAuth();
    let finish!: (result: { accessToken: string }) => void;
    deps.authorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const renewal = auth.getAccessToken();
    await vi.waitFor(() => expect(deps.authorize).toHaveBeenCalledOnce());
    await auth.disconnect();
    finish({ accessToken: 'STALE' });
    await expect(renewal).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('disconnect through another consumer invalidates an existing provider token', async () => {
    const { auth } = makeAuth();
    await auth.getAccessToken();
    const otherConsumer = makeAuth().auth;
    await otherConsumer.disconnect();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
});
