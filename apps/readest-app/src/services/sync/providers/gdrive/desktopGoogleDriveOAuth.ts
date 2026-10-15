import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { buildAuthUrl, createPkcePair } from '../oauth/pkce';
import { parseRedirect } from '../oauth/parseRedirect';
import { exchangeCode, type FetchFn, type TokenSet } from '../oauth/tokenEndpoint';
import type { OAuthClientConfig } from '../oauth/oauthFlow';

interface DesktopGoogleDriveDeps {
  start: (state: string) => Promise<{ id: string; redirectUri: string }>;
  wait: (id: string) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  createPkcePair: typeof createPkcePair;
  newState: () => string;
}

const nativeDeps: DesktopGoogleDriveDeps = {
  start: (state) => invoke('plugin:native-bridge|google_drive_loopback_start', { state }),
  wait: (id) => invoke('plugin:native-bridge|google_drive_loopback_wait', { id }),
  cancel: (id) => invoke('plugin:native-bridge|google_drive_loopback_cancel', { id }),
  openUrl,
  createPkcePair,
  newState: () => crypto.randomUUID(),
};

/** Desktop client: system browser, a loopback-only listener, state and PKCE. */
export const runDesktopGoogleDriveOAuth = async (
  config: OAuthClientConfig,
  fetchFn: FetchFn,
  deps: DesktopGoogleDriveDeps = nativeDeps,
): Promise<TokenSet> => {
  const state = deps.newState();
  const { verifier, challenge } = await deps.createPkcePair();
  const session = await deps.start(state);
  // Observe rejection immediately, including when opening the browser fails.
  const redirect = deps.wait(session.id).then(
    (url) => ({ url }),
    (error: unknown) => ({ error }),
  );
  try {
    await deps.openUrl(
      buildAuthUrl({
        clientId: config.clientId,
        scope: config.scope,
        redirectUri: session.redirectUri,
        authEndpoint: config.authEndpoint,
        extraParams: config.authParams,
        state,
        challenge,
      }),
    );
    const result = await redirect;
    if ('error' in result) throw result.error;
    const { code } = parseRedirect(result.url, state, session.redirectUri);
    return await exchangeCode(
      {
        code,
        verifier,
        clientId: config.clientId,
        redirectUri: session.redirectUri,
        clientSecret: config.clientSecret,
        tokenEndpoint: config.tokenEndpoint,
      },
      fetchFn,
    );
  } finally {
    // A cleanup IPC failure must not replace a completed sign-in or its error.
    await deps.cancel(session.id).catch(() => {});
  }
};
