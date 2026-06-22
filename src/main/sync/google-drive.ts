import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';
import http from 'http';
import { AddressInfo } from 'net';
import { shell } from 'electron';
import { URL } from 'url';
import { loadGoogleSecrets } from './secrets-store';

// Google deprecated the OOB flow ("urn:ietf:wg:oauth:2.0:oob") in early 2023.
// For desktop apps we use the official replacement: a loopback redirect on
// 127.0.0.1 with an OS-assigned port. This requires the OAuth client in
// Google Cloud Console to be of type "Desktop app".
// See: https://developers.google.com/identity/protocols/oauth2/native-app
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class GoogleDriveService {
  private folderCache: Map<string, string> = new Map();
  // Serialises concurrent ensureFolder() calls for the SAME (parent,name) pair
  // so two flows archiving to the same Year/Month path can never both miss the
  // cache, both run a `files.list` that returns nothing, and both call
  // `files.create` — which would leave Drive with duplicate sibling folders of
  // the same name. Each key resolves to the in-flight promise whenever one is
  // already running.
  private folderLocks: Map<string, Promise<string>> = new Map();
  // When the user-configured `folder_id` turns out to be inaccessible (most
  // commonly because it was created in the Drive web UI, not by this app — the
  // `drive.file` scope can only see app-created files), we self-heal by falling
  // back to "My Drive" root for the duration of the process. This flag
  // suppresses repeated 404 retries for the same archive call.
  private rootOverride: string | null = null;

  private buildClient(clientId: string, clientSecret: string, redirectUri?: string): OAuth2Client {
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /**
   * Runs the full OAuth flow end-to-end:
   *   1. Boots a one-shot HTTP server on 127.0.0.1:<random-port>
   *   2. Opens the consent screen in the user's default browser
   *   3. Captures the ?code= query on the redirect
   *   4. Exchanges the code for tokens using the same redirect_uri
   *   5. Tears the server down
   *
   * Resolves with the tokens + the linked Google account email.
   */
  async connect(
    clientId: string,
    clientSecret: string,
  ): Promise<{
    refresh_token: string;
    access_token: string;
    expiry_date: number | null;
    email: string;
  }> {
    return new Promise((resolve, reject) => {
      // Mutable ref set once the server starts listening and we know the port.
      let redirectUri = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try { fn(); } catch { /* ignore */ }
      };

      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url) {
            res.writeHead(400).end('Missing URL');
            return;
          }
          const reqUrl = new URL(req.url, 'http://127.0.0.1');
          if (reqUrl.pathname !== '/oauth2callback') {
            res.writeHead(404).end();
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const errParam = reqUrl.searchParams.get('error');

          if (errParam) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderResultPage(false, `Google returned: ${errParam}`));
            finish(() => server.close());
            reject(new Error(`Google authorization failed: ${errParam}`));
            return;
          }
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderResultPage(false, 'No authorization code returned.'));
            return;
          }

          // Exchange the code using the SAME redirect_uri we advertised.
          const client = this.buildClient(clientId, clientSecret, redirectUri);
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);

          let email = '';
          try {
            const oauth2 = google.oauth2({ version: 'v2', auth: client });
            const info = await oauth2.userinfo.get();
            email = info.data.email || '';
          } catch {
            // non-fatal
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderResultPage(true, email));

          finish(() => server.close());
          resolve({
            refresh_token: tokens.refresh_token || '',
            access_token: tokens.access_token || '',
            expiry_date: tokens.expiry_date ?? null,
            email,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderResultPage(false, msg));
          } catch { /* ignore */ }
          finish(() => server.close());
          reject(err instanceof Error ? err : new Error(msg));
        }
      });

      server.on('error', (err) => {
        finish(() => server.close());
        reject(err);
      });

      // Bind to port 0 → OS picks a free port. Google's "Desktop app" OAuth
      // client type accepts any http://127.0.0.1:<port>/* as redirect_uri.
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        const client = this.buildClient(clientId, clientSecret, redirectUri);
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          prompt: 'consent',
        });
        void shell.openExternal(authUrl);
      });

      const timer = setTimeout(() => {
        finish(() => server.close());
        reject(new Error('Google Drive authorization timed out. Please try again.'));
      }, AUTH_TIMEOUT_MS);
      server.on('close', () => clearTimeout(timer));
    });
  }

  private async getAuthorizedClient(
    clientId: string,
    secrets: { clientSecret: string; refreshToken: string; accessToken: string; tokenExpiry: string },
  ): Promise<OAuth2Client> {
    // Refresh calls don't need a redirect URI; they only need client id/secret
    // matched to the refresh_token that was issued.
    const client = this.buildClient(clientId, secrets.clientSecret);
    client.setCredentials({
      refresh_token: secrets.refreshToken,
      access_token: secrets.accessToken || undefined,
      expiry_date: secrets.tokenExpiry ? parseInt(secrets.tokenExpiry, 10) : undefined,
    });
    return client;
  }

  async isConnected(): Promise<boolean> {
    try {
      const { getDatabase } = await import('../database/index');
      const db = getDatabase();
      const config: any = db.prepare('SELECT * FROM google_drive_config LIMIT 1').get();
      const secrets = loadGoogleSecrets();
      return !!(config?.client_id && secrets.clientSecret && secrets.refreshToken);
    } catch {
      return false;
    }
  }

  private async getDriveClient() {
    const { getDatabase } = await import('../database/index');
    const db = getDatabase();
    const config: any = db.prepare('SELECT * FROM google_drive_config LIMIT 1').get();
    const secrets = loadGoogleSecrets();
    if (!config?.client_id || !secrets.clientSecret || !secrets.refreshToken) {
      throw new Error('Google Drive not configured');
    }
    const auth = await this.getAuthorizedClient(config.client_id, secrets);
    return { drive: google.drive({ version: 'v3', auth }), config };
  }

  async ensureFolder(parentId: string | null, name: string): Promise<string> {
    const cacheKey = `${parentId ?? 'root'}::${name}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached) return cached;

    // If another call is already resolving this exact folder, reuse its promise
    // instead of racing another list+create.
    const inflight = this.folderLocks.get(cacheKey);
    if (inflight) return inflight;

    const promise = this.resolveOrCreateFolder(parentId, name, cacheKey)
      .finally(() => this.folderLocks.delete(cacheKey));
    this.folderLocks.set(cacheKey, promise);
    return promise;
  }

  private async resolveOrCreateFolder(
    parentId: string | null,
    name: string,
    cacheKey: string,
  ): Promise<string> {
    const { drive, config } = await this.getDriveClient();
    const configuredRoot = config.folder_id || 'root';
    // Determine the effective parent: caller-supplied parentId wins, otherwise
    // we use the configured root (or its self-heal override once we've
    // discovered it's inaccessible).
    const rootFolderId = parentId ?? (this.rootOverride || configuredRoot);
    const effectiveParent = rootFolderId;

    try {
      return await this.listOrCreateFolder(drive, effectiveParent, name, cacheKey);
    } catch (err) {
      // Only the *root* call can self-heal — if a nested Year/Month folder we
      // created ourselves comes back 404 there's nothing safe to fall back to.
      // Self-heal applies when the caller didn't pin a parentId AND the
      // configured root is something other than 'root'.
      const is404 = isDriveNotFound(err);
      const canSelfHeal =
        is404 &&
        parentId === null &&
        configuredRoot !== 'root' &&
        this.rootOverride !== 'root';

      if (!canSelfHeal) throw decorateDriveError(err, `lookup folder "${name}" under ${effectiveParent}`);

      // Configured folder_id is unreachable for this OAuth token (most commonly:
      // scope is drive.file but the folder wasn't created by this app). Switch
      // to My Drive root for the rest of this process and retry. Operators can
      // clear or fix the folder_id in Settings.
      console.warn(
        `[GoogleDrive] Configured folder_id "${configuredRoot}" is not accessible — ` +
        `falling back to "My Drive" root. Clear the Folder ID in Settings → Google Drive ` +
        `to silence this warning, or pick a folder this app created.`,
      );
      this.rootOverride = 'root';
      return await this.listOrCreateFolder(drive, 'root', name, cacheKey);
    }
  }

  private async listOrCreateFolder(
    drive: ReturnType<typeof google.drive>,
    effectiveParent: string,
    name: string,
    cacheKey: string,
  ): Promise<string> {
    const query = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${effectiveParent}' in parents`,
      `trashed = false`,
    ].join(' and ');

    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (res.data.files && res.data.files.length > 0) {
      const id = res.data.files[0]!.id!;
      this.folderCache.set(cacheKey, id);
      return id;
    }

    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [effectiveParent],
      },
      fields: 'id',
    });

    const id = created.data.id!;
    this.folderCache.set(cacheKey, id);
    return id;
  }

  /**
   * Upload a file into `folderId`, replacing any existing file with the same
   * name rather than creating a duplicate sibling. Re-archiving the same
   * document (e.g. retry after a partial archive failure) therefore leaves a
   * single authoritative PDF instead of accumulating copies.
   */
  async uploadFile(folderId: string, filename: string, buffer: Buffer): Promise<string> {
    const { drive } = await this.getDriveClient();

    const body = () => {
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);
      return stream;
    };

    try {
      const existingQuery = [
        `name = '${filename.replace(/'/g, "\\'")}'`,
        `'${folderId}' in parents`,
        `trashed = false`,
      ].join(' and ');

      const existing = await drive.files.list({
        q: existingQuery,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 1,
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const fileId = existing.data.files[0]!.id!;
        try {
          await drive.files.update({
            fileId,
            media: { mimeType: 'application/pdf', body: body() },
            fields: 'id',
          });
          return fileId;
        } catch (updateErr) {
          // The file row vanished between list and update (deleted, permanently
          // trashed, or revoked). Fall through to a fresh create instead of
          // failing the whole archive.
          if (!isDriveNotFound(updateErr)) {
            throw decorateDriveError(updateErr, `update existing "${filename}"`);
          }
        }
      }

      const res = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [folderId],
        },
        media: {
          mimeType: 'application/pdf',
          body: body(),
        },
        fields: 'id',
      });

      return res.data.id!;
    } catch (err) {
      throw decorateDriveError(err, `upload "${filename}" into folder ${folderId}`);
    }
  }

  clearFolderCache(): void {
    this.folderCache.clear();
    this.rootOverride = null;
  }
}

export const googleDriveService = new GoogleDriveService();

function renderResultPage(success: boolean, detail: string): string {
  const title = success ? 'Google Drive Connected' : 'Connection Failed';
  const body = success
    ? `<p>Signed in as <strong>${escapeHtml(detail || 'your Google account')}</strong>.</p>
       <p>You can close this browser tab and return to the app.</p>`
    : `<p>${escapeHtml(detail)}</p>
       <p>You can close this browser tab and try again from the app.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
 .card{background:#1e293b;padding:32px 40px;border-radius:12px;max-width:420px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}
 h1{margin:0 0 12px;font-size:20px;color:${success ? '#4ade80' : '#f87171'}}
 p{margin:6px 0;color:#cbd5e1;font-size:14px;line-height:1.5}
 strong{color:#fff}
</style></head><body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * googleapis throws a `GaxiosError` whose `code` / `response.status` is the HTTP
 * status. A vanilla Drive 404 has `code === 404` and a message that begins with
 * "File not found.". We sniff both because some pathways throw a stripped-down
 * error object before the response object is attached.
 */
function isDriveNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number | string; response?: { status?: number }; message?: string };
  if (e.code === 404 || e.code === '404') return true;
  if (e.response?.status === 404) return true;
  return typeof e.message === 'string' && /file not found/i.test(e.message);
}

/**
 * Wrap an opaque Drive API error with the operation that triggered it so the
 * surfaced toast / log line names the failing step instead of the bare
 * "File not found." string Google returns.
 */
function decorateDriveError(err: unknown, action: string): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const status = (err as any)?.code ?? (err as any)?.response?.status;
  const statusPart = status ? ` (HTTP ${status})` : '';

  let hint = '';
  if (isDriveNotFound(err)) {
    hint =
      ' Tip: this usually means the configured Google Drive Folder ID points to a folder ' +
      'this app cannot access. Clear the Folder ID in Settings → Google Drive (the app will ' +
      'use My Drive root and create its own subfolders), then try again.';
  }

  const wrapped = new Error(
    `Google Drive: failed to ${action}${statusPart} — ${original.message}.${hint}`,
  );
  (wrapped as any).cause = original;
  return wrapped;
}
