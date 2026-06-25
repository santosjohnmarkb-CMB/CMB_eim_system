/**
 * Google Drive auto-archive configuration IPC handlers.
 *
 * Channels:
 *   - gdrive:config:get / config:set / connect / disconnect
 *
 * OAuth secrets (client_secret, refresh_token, access_token, token_expiry) live
 * in the encrypted electron-store, NOT in SQLite. See ../sync/secrets-store. The
 * SQLite row only carries the operator-visible fields (client_id, folder_id,
 * account_email). The shape returned over IPC exposes only `has_client_secret` /
 * `has_refresh_token` boolean flags and `token_expiry` so the renderer never
 * receives raw secrets.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireAdmin } from './session';
import {
  saveGoogleSecrets,
  loadGoogleSecrets,
  clearGoogleSecrets,
} from '../sync/secrets-store';
import { extractFolderId } from '../sync/google-drive';

export function registerGoogleDriveHandlers(): void {
  const db = getDatabase();

  function buildGdriveConfigPayload(): any {
    const row = db.prepare('SELECT * FROM google_drive_config LIMIT 1').get() as any;
    if (!row) return null;
    const secrets = loadGoogleSecrets();
    return {
      id: row.id,
      client_id: row.client_id || '',
      folder_id: row.folder_id || '',
      account_email: row.account_email || '',
      has_client_secret: !!secrets.clientSecret,
      has_refresh_token: !!secrets.refreshToken,
      token_expiry: secrets.tokenExpiry || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  ipcMain.handle('gdrive:config:get', () => buildGdriveConfigPayload());

  ipcMain.handle('gdrive:config:set', (event: any, config: any) => {
    requireAdmin(event);
    const existing = db.prepare('SELECT id FROM google_drive_config LIMIT 1').get() as
      | { id: string }
      | undefined;

    const clientId = config.client_id || '';
    // Operators commonly paste a full Drive folder URL; store the bare ID so the
    // archive resolver can use it directly as a parent.
    const folderId = extractFolderId(config.folder_id);

    // Partial-update semantics for the secret: if the renderer didn't include a
    // `client_secret` field we keep whatever is on file. The UI only sends the
    // field when the operator typed a new value, so re-saving other fields does
    // not wipe the secret.
    const hasSecretField = Object.prototype.hasOwnProperty.call(config, 'client_secret');
    if (hasSecretField) {
      saveGoogleSecrets({ clientSecret: config.client_secret || '' });
    }

    if (existing) {
      db.prepare(
        `UPDATE google_drive_config SET client_id = ?, folder_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(clientId, folderId, existing.id);
    } else {
      db.prepare(
        `INSERT INTO google_drive_config (id, client_id, folder_id, account_email)
         VALUES (?, ?, ?, '')`,
      ).run(uuidv4(), clientId, folderId);
    }

    return buildGdriveConfigPayload();
  });

  // Single-shot OAuth flow using a loopback redirect (127.0.0.1 + random port).
  // Requires the OAuth client in Google Cloud Console to be of type "Desktop app".
  ipcMain.handle('gdrive:connect', async (event: any) => {
    requireAdmin(event);
    const { googleDriveService } = await import('../sync/google-drive');
    const config = db.prepare('SELECT * FROM google_drive_config LIMIT 1').get() as any;
    const secrets = loadGoogleSecrets();
    if (!config?.client_id || !secrets.clientSecret) {
      throw new Error(
        'Google Drive client credentials not configured. Please save your Client ID and Secret first.',
      );
    }
    const tokens = await googleDriveService.connect(config.client_id, secrets.clientSecret);

    saveGoogleSecrets({
      refreshToken: tokens.refresh_token || '',
      accessToken: tokens.access_token || '',
      tokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : '',
    });

    const existing = db.prepare('SELECT id FROM google_drive_config LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE google_drive_config SET account_email = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(tokens.email || '', existing.id);
    }
    return buildGdriveConfigPayload();
  });

  // Creates (or reuses) an app-owned root folder and stores its ID as the
  // archive destination. The operator can then move this folder anywhere in
  // Drive; archiving keeps working because we reference it by stable ID.
  ipcMain.handle('gdrive:createFolder', async (event: any) => {
    requireAdmin(event);
    const { googleDriveService } = await import('../sync/google-drive');
    if (!(await googleDriveService.isConnected())) {
      throw new Error('Google Drive is not connected. Save credentials and click Connect first.');
    }
    const folder = await googleDriveService.createArchiveFolder();

    const existing = db.prepare('SELECT id FROM google_drive_config LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE google_drive_config SET folder_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(folder.id, existing.id);
    } else {
      db.prepare(
        `INSERT INTO google_drive_config (id, client_id, folder_id, account_email)
         VALUES (?, '', ?, '')`,
      ).run(uuidv4(), folder.id);
    }

    // A fresh destination invalidates any cached folder lookups from a prior one.
    googleDriveService.clearFolderCache();

    return { folder, config: buildGdriveConfigPayload() };
  });

  // Uploads (and deletes) a throwaway file to confirm the app can actually write
  // into the destination folder — the exact permission auto-archive needs.
  ipcMain.handle('gdrive:test', async (event: any) => {
    requireAdmin(event);
    const { googleDriveService } = await import('../sync/google-drive');
    if (!(await googleDriveService.isConnected())) {
      throw new Error('Google Drive is not connected. Save credentials and click Connect first.');
    }
    return googleDriveService.testConnection();
  });

  ipcMain.handle('gdrive:disconnect', async (event: any) => {
    requireAdmin(event);
    clearGoogleSecrets();
    db.prepare(
      `UPDATE google_drive_config SET account_email = '', updated_at = datetime('now')`,
    ).run();
    const { googleDriveService } = await import('../sync/google-drive');
    googleDriveService.clearFolderCache();
    return { success: true };
  });
}
