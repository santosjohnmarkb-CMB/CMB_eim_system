import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getDatabase } from '../database/index';
import { requireSession } from './session';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';

type ReportType = 'fleet' | 'repair' | 'parts' | 'availability';

interface ReportSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

interface ReportModel {
  key: ReportType;
  title: string;
  subtitle: string;
  sections: ReportSection[];
}

const REPORT_TITLES: Record<ReportType, string> = {
  fleet: 'Fleet Utilization',
  repair: 'Repair Costs',
  parts: 'Parts Spend',
  availability: 'Availability Trends',
};

function isDepartment(v: any): v is Department {
  return v === 'camera' || v === 'lights_grips';
}

/** Category names that belong to a department, or null for "all departments". */
function categoriesFor(department: Department | null): string[] | null {
  if (!department) return null;
  return DEPARTMENT_CONFIG[department].categories;
}

/** Build an `AND col IN (?, ?, ...)` fragment plus its bound params. */
function inClause(column: string, values: string[] | null): { sql: string; params: string[] } {
  if (!values || values.length === 0) return { sql: '', params: [] };
  const placeholders = values.map(() => '?').join(', ');
  return { sql: ` AND ${column} IN (${placeholders})`, params: values };
}

function fleetData(department: Department | null) {
  const db = getDatabase();
  const cats = categoriesFor(department);
  const catFilter = inClause('c.name', cats);
  const statusDist: any[] = db.prepare(`
    SELECT ea.current_status, COUNT(*) as count
    FROM equipment_assets ea
    JOIN equipment_items e ON e.id = ea.equipment_id
    JOIN categories c ON c.id = e.category_id
    WHERE e.is_active = 1${catFilter.sql}
    GROUP BY ea.current_status
  `).all(...catFilter.params);
  const byCategory: any[] = db.prepare(`
    SELECT c.name as category, ea.current_status, COUNT(*) as count
    FROM equipment_assets ea
    JOIN equipment_items e ON e.id = ea.equipment_id
    JOIN categories c ON c.id = e.category_id
    WHERE e.is_active = 1${catFilter.sql}
    GROUP BY c.name, ea.current_status ORDER BY c.name
  `).all(...catFilter.params);
  return { statusDistribution: statusDist, byCategory };
}

function repairData(department: Department | null) {
  const db = getDatabase();
  const cats = categoriesFor(department);
  const catFilter = inClause('c.name', cats);
  const byEquipment: any[] = db.prepare(`
    SELECT e.equipment_code, e.name, SUM(mt.actual_cost) as total_cost, COUNT(*) as ticket_count
    FROM maintenance_tickets mt
    JOIN equipment_items e ON e.id = mt.equipment_id
    JOIN categories c ON c.id = e.category_id
    WHERE mt.repair_status = 'COMPLETED'${catFilter.sql}
    GROUP BY mt.equipment_id ORDER BY total_cost DESC LIMIT 20
  `).all(...catFilter.params);
  const byMonth: any[] = db.prepare(`
    SELECT strftime('%Y-%m', mt.completion_date) as month, SUM(mt.actual_cost) as total_cost, COUNT(*) as count
    FROM maintenance_tickets mt
    JOIN equipment_items e ON e.id = mt.equipment_id
    JOIN categories c ON c.id = e.category_id
    WHERE mt.repair_status = 'COMPLETED' AND mt.completion_date IS NOT NULL${catFilter.sql}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...catFilter.params);
  return { byEquipment, byMonth };
}

function partsData(department: Department | null) {
  const db = getDatabase();
  // parts_catalog carries its own department column, so filter on that directly.
  const deptFilter = department ? ' AND pc.department = ?' : '';
  const deptParams = department ? [department] : [];
  const topConsumed: any[] = db.prepare(`
    SELECT pc.part_code, pc.name, SUM(ABS(pt.quantity)) as total_consumed, SUM(ABS(pt.quantity) * pc.unit_cost) as total_cost
    FROM parts_transactions pt JOIN parts_catalog pc ON pc.id = pt.part_id
    WHERE pt.transaction_type = 'consume'${deptFilter}
    GROUP BY pt.part_id ORDER BY total_cost DESC LIMIT 20
  `).all(...deptParams);
  const byMonth: any[] = db.prepare(`
    SELECT strftime('%Y-%m', pt.created_at) as month, SUM(ABS(pt.quantity) * pc.unit_cost) as total_cost
    FROM parts_transactions pt JOIN parts_catalog pc ON pc.id = pt.part_id
    WHERE pt.transaction_type = 'consume'${deptFilter}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...deptParams);
  return { topConsumed, byMonth };
}

function availabilityData(department: Department | null) {
  const db = getDatabase();
  const cats = categoriesFor(department);
  const catFilter = inClause('c.name', cats);
  const daily: any[] = db.prepare(`
    SELECT date(asl.changed_at) as day, asl.new_status, COUNT(*) as count
    FROM asset_status_log asl
    JOIN equipment_items e ON e.id = asl.equipment_id
    JOIN categories c ON c.id = e.category_id
    WHERE asl.changed_at >= date('now', '-30 days')${catFilter.sql}
    GROUP BY day, asl.new_status ORDER BY day
  `).all(...catFilter.params);
  return { daily };
}

function num(v: any): number {
  return typeof v === 'number' ? v : 0;
}

function buildModel(type: ReportType, department: Department | null): ReportModel {
  const title = REPORT_TITLES[type];
  const subtitle = department ? DEPARTMENT_CONFIG[department].label : 'All Departments';
  if (type === 'fleet') {
    const d = fleetData(department);
    return {
      key: type, title, subtitle,
      sections: [
        {
          title: 'Status Distribution',
          columns: ['Status', 'Count'],
          rows: d.statusDistribution.map((s) => [s.current_status ?? 'Unknown', num(s.count)]),
        },
        {
          title: 'By Category',
          columns: ['Category', 'Status', 'Count'],
          rows: d.byCategory.map((s) => [s.category ?? '', s.current_status ?? '', num(s.count)]),
        },
      ],
    };
  }
  if (type === 'repair') {
    const d = repairData(department);
    return {
      key: type, title, subtitle,
      sections: [
        {
          title: 'Top Repair Costs by Equipment',
          columns: ['Code', 'Equipment', 'Total Cost', 'Tickets'],
          rows: d.byEquipment.map((r) => [r.equipment_code ?? '', r.name ?? '', num(r.total_cost), num(r.ticket_count)]),
        },
        {
          title: 'Monthly Repair Spend',
          columns: ['Month', 'Total Cost', 'Completed'],
          rows: d.byMonth.map((r) => [r.month ?? '', num(r.total_cost), num(r.count)]),
        },
      ],
    };
  }
  if (type === 'parts') {
    const d = partsData(department);
    return {
      key: type, title, subtitle,
      sections: [
        {
          title: 'Top Consumed Parts',
          columns: ['Code', 'Part', 'Units Consumed', 'Total Cost'],
          rows: d.topConsumed.map((r) => [r.part_code ?? '', r.name ?? '', num(r.total_consumed), num(r.total_cost)]),
        },
        {
          title: 'Monthly Parts Spend',
          columns: ['Month', 'Total Cost'],
          rows: d.byMonth.map((r) => [r.month ?? '', num(r.total_cost)]),
        },
      ],
    };
  }
  const d = availabilityData(department);
  return {
    key: type, title, subtitle,
    sections: [
      {
        title: 'Status Changes (Last 30 Days)',
        columns: ['Day', 'Status', 'Count'],
        rows: d.daily.map((r) => [r.day ?? '', r.new_status ?? '', num(r.count)]),
      },
    ],
  };
}

function isReportType(v: any): v is ReportType {
  return v === 'fleet' || v === 'repair' || v === 'parts' || v === 'availability';
}

function defaultFileName(type: ReportType, department: Department | null, ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const dept = department ? `-${department}` : '';
  return `${type}${dept}-report-${date}.${ext}`;
}

async function promptSavePath(event: any, defaultName: string, filters: Electron.FileFilter[]): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = win
    ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function writeExcel(model: ReportModel, filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CMB EIM';
  wb.created = new Date();
  for (const section of model.sections) {
    // Worksheet names have a 31-char limit and forbid a handful of characters.
    const safeName = section.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Sheet';
    const ws = wb.addWorksheet(safeName);
    const header = ws.addRow(section.columns);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    });
    for (const row of section.rows) ws.addRow(row);
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        max = Math.max(max, String(cell.value ?? '').length + 2);
      });
      col.width = Math.min(max, 60);
    });
  }
  await wb.xlsx.writeFile(filePath);
}

function writePdf(model: ReportModel, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.font('Helvetica-Bold').fontSize(18).text(model.title, { align: 'left' });
    doc.font('Helvetica').fontSize(10).fillColor('#444444').text(model.subtitle);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#666666').text(`Generated ${new Date().toLocaleString()}`);
    doc.fillColor('#000000').moveDown(0.8);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    for (const section of model.sections) {
      doc.font('Helvetica-Bold').fontSize(12).text(section.title);
      doc.moveDown(0.3);

      const colWidth = usable / section.columns.length;
      const rowHeight = 16;
      const drawRow = (cells: (string | number)[], bold: boolean) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - rowHeight) doc.addPage();
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        cells.forEach((cell, i) => {
          doc.text(String(cell), left + i * colWidth, y, { width: colWidth - 6, ellipsis: true });
        });
        doc.y = y + rowHeight;
        doc.x = left;
      };

      drawRow(section.columns, true);
      if (section.rows.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#999999').text('No data', left);
        doc.fillColor('#000000');
      } else {
        for (const row of section.rows) drawRow(row, false);
      }
      doc.moveDown(0.8);
    }

    doc.end();
  });
}

function resolveDepartment(v: any): Department | null {
  return isDepartment(v) ? v : null;
}

export function registerReportsHandlers(): void {
  ipcMain.handle('reports:fleetUtilization', (_event: any, department?: string) =>
    fleetData(resolveDepartment(department)));

  ipcMain.handle('reports:repairCosts', (_event: any, department?: string) =>
    repairData(resolveDepartment(department)));

  ipcMain.handle('reports:partsSpend', (_event: any, department?: string) =>
    partsData(resolveDepartment(department)));

  ipcMain.handle('reports:availabilityTrends', (_event: any, department?: string) =>
    availabilityData(resolveDepartment(department)));

  ipcMain.handle('reports:exportExcel', async (event: any, reportType: string, department?: string) => {
    requireSession(event);
    if (!isReportType(reportType)) return { success: false, message: 'Unknown report type' };
    const dept = resolveDepartment(department);
    const model = buildModel(reportType, dept);
    const filePath = await promptSavePath(event, defaultFileName(reportType, dept, 'xlsx'), [
      { name: 'Excel Workbook', extensions: ['xlsx'] },
    ]);
    if (!filePath) return { success: false, canceled: true };
    await writeExcel(model, filePath);
    return { success: true, path: filePath };
  });

  ipcMain.handle('reports:exportPdf', async (event: any, reportType: string, department?: string) => {
    requireSession(event);
    if (!isReportType(reportType)) return { success: false, message: 'Unknown report type' };
    const dept = resolveDepartment(department);
    const model = buildModel(reportType, dept);
    const filePath = await promptSavePath(event, defaultFileName(reportType, dept, 'pdf'), [
      { name: 'PDF Document', extensions: ['pdf'] },
    ]);
    if (!filePath) return { success: false, canceled: true };
    await writePdf(model, filePath);
    return { success: true, path: filePath };
  });
}
