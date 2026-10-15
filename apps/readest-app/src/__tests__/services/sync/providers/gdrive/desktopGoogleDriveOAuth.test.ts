import { describe, expect, test, vi } from 'vitest';
import { runDesktopGoogleDriveOAuth } from '@/services/sync/providers/gdrive/desktopGoogleDriveOAuth';
import { buildGoogleOAuthConfig } from '@/services/sync/providers/gdrive/googleOAuthConfig';

const uri = 'http://127.0.0.1:49152/oauthredirect';
const config = buildGoogleOAuthConfig('desktop.apps.googleusercontent.com', 'drive.file');
const makeDeps = () => ({
  start: vi.fn(async (_state: string) => ({ id: 'session', redirectUri: uri })),
  wait: vi.fn(async (_id: string) => `${uri}?state=STATE&code=CODE`),
  cancel: vi.fn(async (_id: string) => {}),
  openUrl: vi.fn(async (_url: string) => {}),
  createPkcePair: vi.fn(async () => ({ verifier: 'VERIFIER', challenge: 'CHALLENGE' })),
  newState: () => 'STATE',
});

describe('desktop Google OAuth loopback flow', () => {
  test('desktop credential is sent only to the token endpoint, never the browser URL', async () => {
    const deps = makeDeps();
    const fetchFn = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(JSON.stringify({ access_token: 'TOKEN', expires_in: 3600 })),
    );
    await runDesktopGoogleDriveOAuth(
      { ...config, clientSecret: 'test-desktop-credential' },
      fetchFn,
      deps,
    );
    expect(deps.openUrl.mock.calls[0]![0]).not.toContain('test-desktop-credential');
    expect(new URLSearchParams(fetchFn.mock.calls[0]![1].body as string).get('client_secret')).toBe(
      'test-desktop-credential',
    );
  });

  test('exchanges the code with PKCE and the allocated loopback URI', async () => {
    const deps = makeDeps();
    const fetchFn = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ access_token: 'TOKEN', refresh_token: 'REFRESH', expires_in: 3600 }),
        ),
    );
    expect(await runDesktopGoogleDriveOAuth(config, fetchFn, deps)).toMatchObject({
      accessToken: 'TOKEN',
    });
    const authUrl = new URL(deps.openUrl.mock.calls[0]![0]);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(uri);
    expect(authUrl.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(authUrl.searchParams.get('state')).toBe('STATE');
    const body = new URLSearchParams(fetchFn.mock.calls[0]![1]?.body as string);
    expect(body.get('redirect_uri')).toBe(uri);
    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.has('client_secret')).toBe(false);
    expect(deps.cancel).toHaveBeenCalledExactlyOnceWith('session');
  });

  test('rejects callback state mismatch before sending a token request', async () => {
    const deps = makeDeps();
    deps.wait.mockResolvedValue(`${uri}?state=WRONG&code=CODE`);
    const fetchFn = vi.fn();
    await expect(runDesktopGoogleDriveOAuth(config, fetchFn, deps)).rejects.toThrow(
      /state mismatch/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deps.cancel).toHaveBeenCalledOnce();
  });

  test('cleanup failure preserves a successfully exchanged token', async () => {
    const deps = makeDeps();
    deps.cancel.mockRejectedValue(new Error('IPC closed'));
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'TOKEN', expires_in: 3600 })),
    );
    expect(await runDesktopGoogleDriveOAuth(config, fetchFn, deps)).toMatchObject({
      accessToken: 'TOKEN',
    });
  });

  test('browser opening failure cancels the listener and observes its pending rejection', async () => {
    const deps = makeDeps();
    deps.openUrl.mockRejectedValue(new Error('browser unavailable'));
    deps.wait.mockRejectedValue(new Error('cancelled'));
    await expect(runDesktopGoogleDriveOAuth(config, vi.fn(), deps)).rejects.toThrow(
      'browser unavailable',
    );
    expect(deps.cancel).toHaveBeenCalledOnce();
  });
});
