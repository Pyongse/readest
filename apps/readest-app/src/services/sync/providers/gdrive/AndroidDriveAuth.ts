import { invoke } from '@tauri-apps/api/core';
import { FileSyncError } from '@/services/sync/file/provider';
import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';
import { aboutUrl } from './driveRest';
import type { DriveAuth, FetchFn } from './GoogleDriveProvider';
import type { ConnectGoogleDriveResult } from './connectGoogleDrive';

const ACCOUNT_KEY = 'gdrive_android_account';
// The SDK may return a cached token with less than an hour remaining.
const CACHE_MS = 5 * 60_000;
let connectionRevision = 0;
let nativeAuthorization = Promise.resolve();

const authorizeNative = (
  interactive: boolean,
  accountName?: string,
): Promise<{ accessToken: string }> => {
  const result = nativeAuthorization.then(() =>
    invoke<{ accessToken: string }>('plugin:native-bridge|google_drive_authorize', {
      payload: { interactive, accountName },
    }),
  );
  nativeAuthorization = result.then(
    () => {},
    () => {},
  );
  return result;
};

interface AndroidDriveAuthDeps {
  loadAccount: () => Promise<string | null>;
  saveAccount: (email: string) => Promise<void>;
  clearAccount: () => Promise<void>;
  authorize: (interactive: boolean, accountName?: string) => Promise<{ accessToken: string }>;
  clearToken: (token: string) => Promise<void>;
  fetchFn: FetchFn;
  now?: () => number;
}

/** Google Play services owns renewal; only the selected account is stored locally. */
export class AndroidDriveAuth implements DriveAuth {
  private revision = connectionRevision;
  private account: string | null | undefined;
  private token: { value: string; expiresAt: number } | null = null;
  private renewal: Promise<string> | null = null;
  private invalidation: Promise<void> | null = null;

  constructor(private readonly deps: AndroidDriveAuthDeps) {}

  async connect(): Promise<ConnectGoogleDriveResult> {
    const { accessToken } = await this.deps.authorize(true);
    const res = await this.deps.fetchFn(aboutUrl(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = res.ok ? ((await res.json()) as { user?: { emailAddress?: string } }) : null;
    const email = body?.user?.emailAddress;
    if (!email || !email.includes('@')) {
      throw new FileSyncError(
        'Google Drive could not confirm the selected account; reconnect',
        'AUTH_FAILED',
      );
    }
    await this.deps.saveAccount(email);
    this.revision = ++connectionRevision;
    this.account = email;
    this.token = { value: accessToken, expiresAt: this.now() + CACHE_MS };
    return { accountLabel: email };
  }

  async getAccessToken(): Promise<string> {
    const revision = this.revision;
    this.assertCurrent(revision);
    if (this.invalidation) await this.invalidation;
    this.assertCurrent(revision);
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    if (this.renewal) return this.renewal;
    this.renewal = (async () => {
      if (this.account === undefined) this.account = await this.deps.loadAccount();
      this.assertCurrent(revision);
      if (!this.account) throw new FileSyncError('Google Drive is not connected', 'AUTH_FAILED');
      try {
        const { accessToken } = await this.deps.authorize(false, this.account);
        this.assertCurrent(revision);
        if (!accessToken) throw new Error('Google did not return an access token');
        this.token = { value: accessToken, expiresAt: this.now() + CACHE_MS };
        return accessToken;
      } catch {
        throw new FileSyncError('Google Drive authorization expired; reconnect', 'AUTH_FAILED');
      }
    })();
    try {
      return await this.renewal;
    } finally {
      this.renewal = null;
    }
  }

  async invalidateAccessToken(token: string): Promise<void> {
    if (this.invalidation) return this.invalidation;
    if (this.token?.value !== token) return;
    this.token = null;
    this.invalidation = this.deps.clearToken(token);
    try {
      await this.invalidation;
    } finally {
      this.invalidation = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.deps.clearAccount();
    this.revision = ++connectionRevision;
    this.account = null;
    this.token = null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private assertCurrent(revision: number): void {
    if (revision !== this.revision || revision !== connectionRevision) {
      throw new FileSyncError('Google Drive connection changed; retry sync', 'AUTH_FAILED');
    }
  }
}

export const createAndroidDriveAuth = async (
  clientId: string,
  fetchFn: FetchFn,
): Promise<AndroidDriveAuth | null> => {
  if (!(await isSyncKeychainAvailable()).available) return null;
  return new AndroidDriveAuth({
    fetchFn,
    authorize: authorizeNative,
    clearToken: (accessToken) =>
      invoke('plugin:native-bridge|google_drive_clear_token', {
        payload: { accessToken },
      }),
    loadAccount: async () => {
      try {
        const stored = await getSecureItem({ key: ACCOUNT_KEY });
        if (stored.error || !stored.value) return null;
        const marker = JSON.parse(stored.value) as { clientId?: string; accountName?: string };
        return marker.clientId === clientId && marker.accountName?.includes('@')
          ? marker.accountName
          : null;
      } catch {
        return null;
      }
    },
    saveAccount: async (accountName) => {
      const result = await setSecureItem({
        key: ACCOUNT_KEY,
        value: JSON.stringify({ clientId, accountName }),
      });
      if (!result.success)
        throw new FileSyncError('Google Drive account could not be saved securely', 'AUTH_FAILED');
    },
    clearAccount: async () => {
      const result = await clearSecureItem({ key: ACCOUNT_KEY });
      if (!result.success)
        throw new FileSyncError('Google Drive account could not be cleared', 'AUTH_FAILED');
    },
  });
};
