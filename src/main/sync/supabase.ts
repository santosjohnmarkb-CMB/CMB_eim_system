import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';

let supabase: SupabaseClient | null = null;

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

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: {
      params: { eventsPerSecond: 10 },
      // Node.js < 22 lacks native WebSocket; provide ws polyfill
      transport: WebSocket as any,
    },
  });

  return supabase;
}

export function disconnectSupabase(): void {
  if (supabase) {
    supabase.removeAllChannels();
    supabase = null;
  }
}
