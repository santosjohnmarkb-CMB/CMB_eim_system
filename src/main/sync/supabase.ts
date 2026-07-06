import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import { loadSupabaseServiceCredentials } from './secrets-store';

let supabase: SupabaseClient | null = null;
let authenticated = false;

interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'sync-config.json');
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.supabaseUrl && config.supabaseAnonKey) return config;
    return null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function initSupabase(config?: SyncConfig): SupabaseClient | null {
  const cfg = config || loadSyncConfig();
  if (!cfg) return null;

  authenticated = false;
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      // Main-process client: persist the session so the JWT survives restarts
      // and is auto-refreshed while online. No browser storage here, so we let
      // supabase-js keep it in memory and rely on re-auth on next launch.
      persistSession: false,
      autoRefreshToken: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
      // Node.js < 22 lacks native WebSocket; provide ws polyfill
      transport: WebSocket as any,
    },
  });

  return supabase;
}

/**
 * If a Supabase Auth service-account credential is configured, sign in so the
 * client runs as the `authenticated` role (CRIT-2 hardening). This is a no-op
 * when no credential is set — the client stays on the anon key exactly as
 * before, so existing deployments are unaffected until an operator opts in.
 *
 * Returns true when the client is authenticated, false when it is running as
 * anon (either by design or because sign-in failed — failures are non-fatal so
 * offline-first behaviour and the retry loop are preserved).
 */
export async function authenticateClient(): Promise<boolean> {
  if (!supabase) return false;
  const creds = loadSupabaseServiceCredentials();
  if (!creds) {
    authenticated = false;
    return false; // No service account configured → anon mode (backward compatible).
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (error || !data.session) {
      console.error('[Sync] Service-account sign-in failed; falling back to anon:', error?.message);
      authenticated = false;
      return false;
    }
    // Propagate the JWT to the realtime socket so RLS-scoped realtime works.
    try {
      supabase.realtime.setAuth(data.session.access_token);
    } catch { /* older client versions apply it automatically */ }
    authenticated = true;
    console.log('[Sync] Signed in as Supabase service account (authenticated role).');
    return true;
  } catch (err) {
    console.error('[Sync] Service-account sign-in threw; falling back to anon:', err);
    authenticated = false;
    return false;
  }
}

export function isAuthenticated(): boolean {
  return authenticated;
}

export function disconnectSupabase(): void {
  if (supabase) {
    supabase.removeAllChannels();
    void supabase.auth.signOut().catch(() => { /* best-effort */ });
    supabase = null;
    authenticated = false;
  }
}
