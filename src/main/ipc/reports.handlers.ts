import { ipcMain } from 'electron';
import { getDatabase } from '../database/index';
import { requireSession } from './session';

export function registerReportsHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('reports:fleetUtilization', () => {
    const statusDist: any[] = db.prepare(`
      SELECT ea.current_status, COUNT(*) as count
      FROM equipment_assets ea JOIN equipment_items e ON e.id = ea.equipment_id
      WHERE e.is_active = 1 GROUP BY ea.current_status
    `).all();
    const byCategory: any[] = db.prepare(`
      SELECT c.name as category, ea.current_status, COUNT(*) as count
      FROM equipment_assets ea
      JOIN equipment_items e ON e.id = ea.equipment_id
      JOIN categories c ON c.id = e.category_id
      WHERE e.is_active = 1
      GROUP BY c.name, ea.current_status ORDER BY c.name
    `).all();
    return { statusDistribution: statusDist, byCategory };
  });

  ipcMain.handle('reports:repairCosts', () => {
    const byEquipment: any[] = db.prepare(`
      SELECT e.equipment_code, e.name, SUM(mt.actual_cost) as total_cost, COUNT(*) as ticket_count
      FROM maintenance_tickets mt JOIN equipment_items e ON e.id = mt.equipment_id
      WHERE mt.repair_status = 'COMPLETED'
      GROUP BY mt.equipment_id ORDER BY total_cost DESC LIMIT 20
    `).all();
    const byMonth: any[] = db.prepare(`
      SELECT strftime('%Y-%m', completion_date) as month, SUM(actual_cost) as total_cost, COUNT(*) as count
      FROM maintenance_tickets WHERE repair_status = 'COMPLETED' AND completion_date IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all();
    return { byEquipment, byMonth };
  });

  ipcMain.handle('reports:partsSpend', () => {
    const topConsumed: any[] = db.prepare(`
      SELECT pc.part_code, pc.name, SUM(ABS(pt.quantity)) as total_consumed, SUM(ABS(pt.quantity) * pc.unit_cost) as total_cost
      FROM parts_transactions pt JOIN parts_catalog pc ON pc.id = pt.part_id
      WHERE pt.transaction_type = 'consume'
      GROUP BY pt.part_id ORDER BY total_cost DESC LIMIT 20
    `).all();
    const byMonth: any[] = db.prepare(`
      SELECT strftime('%Y-%m', pt.created_at) as month, SUM(ABS(pt.quantity) * pc.unit_cost) as total_cost
      FROM parts_transactions pt JOIN parts_catalog pc ON pc.id = pt.part_id
      WHERE pt.transaction_type = 'consume'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all();
    return { topConsumed, byMonth };
  });

  ipcMain.handle('reports:availabilityTrends', () => {
    const daily: any[] = db.prepare(`
      SELECT date(changed_at) as day, new_status, COUNT(*) as count
      FROM asset_status_log
      WHERE changed_at >= date('now', '-30 days')
      GROUP BY day, new_status ORDER BY day
    `).all();
    return { daily };
  });

  ipcMain.handle('reports:exportPdf', (event: any, reportType: string) => {
    requireSession(event);
    return { success: false, message: 'PDF export not yet implemented' };
  });

  ipcMain.handle('reports:exportExcel', (event: any, reportType: string) => {
    requireSession(event);
    return { success: false, message: 'Excel export not yet implemented' };
  });
}
