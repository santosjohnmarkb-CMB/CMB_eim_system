import { getSupabase } from './supabase';

type TableName =
  | 'categories'
  | 'subcategories'
  | 'equipment_items'
  | 'package_definitions'
  | 'package_items'
  | 'users'
  | 'equipment_assets'
  | 'asset_status_log'
  | 'maintenance_tickets'
  | 'maintenance_notes'
  | 'ticket_actions'
  | 'equipment_loans'
  | 'equipment_loan_items'
  | 'purchase_requests'
  | 'purchase_request_items'
  | 'parts_catalog'
  | 'parts_inventory'
  | 'parts_transactions'
  | 'parts_compatibility'
  | 'preventive_schedules'
  | 'vendors'
  | 'sync_metadata'
  | 'audit_logs';

export class CloudService {
  private get client() {
    const c = getSupabase();
    if (!c) throw new Error('Supabase client not initialized');
    return c;
  }

  async getAll(table: TableName, orderBy?: string) {
    const PAGE_SIZE = 1000;
    const all: any[] = [];
    let from = 0;

    while (true) {
      let query = this.client.from(table).select('*').range(from, from + PAGE_SIZE - 1);
      if (orderBy) query = query.order(orderBy);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return all;
  }

  async getById(table: TableName, id: string) {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  async create(table: TableName, record: Record<string, unknown>) {
    const { data, error } = await this.client.from(table).insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async update(table: TableName, id: string, updates: Record<string, unknown>) {
    const { data, error } = await this.client
      .from(table)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async upsert(table: TableName, record: Record<string, unknown>) {
    const { data, error } = await this.client.from(table).upsert(record).select().single();
    if (error) throw error;
    return data;
  }

  async upsertMany(table: TableName, records: Record<string, unknown>[]) {
    if (records.length === 0) return [];
    const { data, error } = await this.client.from(table).upsert(records).select();
    if (error) throw error;
    return data;
  }

  async remove(table: TableName, id: string) {
    const { error } = await this.client.from(table).delete().eq('id', id);
    if (error) throw error;
  }

  async rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, params);
    if (error) throw error;
    return data as T;
  }

  async count(table: TableName): Promise<number> {
    const { count, error } = await this.client
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }
}

export const cloudService = new CloudService();
