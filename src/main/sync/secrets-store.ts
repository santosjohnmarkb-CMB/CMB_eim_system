/**
 * Encrypted-at-rest storage for OAuth secrets and other sensitive material.
 *
 * Why this exists
 * ───────────────
 * The Google Drive OAuth secrets (client_secret, refresh_token, access_token)
 * must never live as plain TEXT in the SQLite database — that file ships in the
 * user's app-data folder and is trivially readable. Anyone with filesystem
 * access to the machine, or anyone exfiltrating the SQLite database, could lift
 * the credentials and impersonate the linked Google Drive account.
 *
 * electron-store wraps Node's `crypto.createCipheriv()` and stores its JSON blob
 * with `aes-256-cbc`. The `encryptionKey` below is a static obfuscation key — it
 * is *not* a substitute for a hardware-backed credential vault, but it raises
 * the bar from "open the .db file in any editor" to "decrypt the blob, find the
 * plaintext". For the desktop trust model (single-user machine, admin operator)
 * that is the right step up. Higher-bar options like Keychain / DPAPI / libsecret
 * can be wired in later through the same export surface without touching the
 * call sites.
 */

import Store from 'electron-store';

interface SecureSecrets {
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleAccessToken?: string;
  googleTokenExpiry?: string;
}

let _store: Store<SecureSecrets> | null = null;

function getStore(): Store<SecureSecrets> {
  if (_store) return _store;
  _store = new Store<SecureSecrets>({
    name: 'secure-secrets',
    encryptionKey: 'cmb-eim-secrets-v1',
    clearInvalidConfig: true,
  });
  return _store;
}

export interface GoogleSecretInputs {
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiry?: string;
}

export interface GoogleSecrets {
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry: string;
}

/**
 * Persist any subset of Google OAuth secrets. Fields not included on the input
 * are left untouched (partial-update semantics) so callers don't accidentally
 * erase tokens when only refreshing one of them.
 */
export function saveGoogleSecrets(data: GoogleSecretInputs): void {
  const store = getStore();
  if (data.clientSecret !== undefined) store.set('googleClientSecret', data.clientSecret);
  if (data.refreshToken !== undefined) store.set('googleRefreshToken', data.refreshToken);
  if (data.accessToken !== undefined) store.set('googleAccessToken', data.accessToken);
  if (data.tokenExpiry !== undefined) store.set('googleTokenExpiry', data.tokenExpiry);
}

/**
 * Load the full secret tuple. Missing fields come back as empty strings so call
 * sites can use a simple `!!value` check.
 */
export function loadGoogleSecrets(): GoogleSecrets {
  const store = getStore();
  return {
    clientSecret: store.get('googleClientSecret', '') ?? '',
    refreshToken: store.get('googleRefreshToken', '') ?? '',
    accessToken: store.get('googleAccessToken', '') ?? '',
    tokenExpiry: store.get('googleTokenExpiry', '') ?? '',
  };
}

/**
 * Wipe every Google secret from the encrypted store. Used on disconnect.
 */
export function clearGoogleSecrets(): void {
  const store = getStore();
  store.delete('googleClientSecret');
  store.delete('googleRefreshToken');
  store.delete('googleAccessToken');
  store.delete('googleTokenExpiry');
}
