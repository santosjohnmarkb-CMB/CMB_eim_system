/**
 * Equipment-package IPC handlers (EIM owns package creation and editing).
 *
 * Channels:
 *   - db:packages:getAll       — active packages (department-scoped), main_item + items hydrated
 *   - db:packages:getById      — single package, hydrated (department-checked)
 *   - db:packages:create       — inventory access; rebuilds package_items in a tx
 *   - db:packages:update       — inventory access; replace-and-rewrite components
 *   - db:packages:delete       — inventory access; soft delete (is_active = 0)
 *   - packages:readCsvFile     — file-picker + read for the importer
 *   - db:packages:bulkImport   — inventory access; CSV import
 *   - packages:downloadTemplate — write a 3-sheet xlsx template
 *
 * Adapted from the rental app: writes are gated by requireInventoryAccess (admin +
 * equipment_manager) instead of admin-only, are department-scoped via the main
 * item's category, and only admins may set/change the package price (the main
 * item's base_price). Cloud pushes go through pushCatalogToCloud, mirroring the
 * equipment handler.
 *
 * Hydration helpers (`loadPackageItems`, `hydratePackage`) match the renderer
 * `PackageItem` shape; flattening would silently break `pkgItem.component?.*`
 * accesses in the components UI.
 */

import { ipcMain, app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/index';
import { requireInventoryAccess } from './session';
import { parseCsvRow } from './utils/csv';
import { pushCatalogToCloud } from '../sync/catalog-sync';
import { sessionDepartment, departmentForCategory, assertEquipmentInDepartment } from './department';
import { PackageCreateSchema, PackageUpdateSchema } from '../../shared/schemas';

export function registerPackageHandlers(): void {
  const db = getDatabase();

  // Fetch a package's items with the FULL component row nested under `.component`,
  // matching the PackageItem TypeScript shape the renderer expects.
  const loadPackageItems = (packageId: string) => {
    const rows = db
      .prepare('SELECT * FROM package_items WHERE package_id = ? ORDER BY display_order')
      .all(packageId) as any[];
    const eqStmt = db.prepare('SELECT * FROM equipment_items WHERE id = ?');
    return rows.map((row) => ({
      ...row,
      is_required: !!row.is_required,
      component: eqStmt.get(row.component_id) ?? undefined,
    }));
  };

  // Hydrate main_item + items on a package row so the edit form can pre-fill the
  // "Main Equipment" picker and component list without extra round trips.
  const hydratePackage = (pkg: any) => {
    if (!pkg) return pkg;
    pkg.main_item = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(pkg.main_item_id);
    pkg.items = loadPackageItems(pkg.id);
    return pkg;
  };

  // The department a package belongs to, derived from its main item's category.
  const packageDepartment = (mainItemId: string): string | null => {
    const row: any = db.prepare(`
      SELECT c.name as category_name
      FROM equipment_items e LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.id = ?
    `).get(mainItemId);
    return departmentForCategory(row?.category_name);
  };

  ipcMain.handle('db:packages:getAll', (event: any) => {
    const dept = sessionDepartment(event);
    const packages = db
      .prepare('SELECT * FROM package_definitions WHERE is_active = 1 ORDER BY name')
      .all() as any[];
    const scoped = dept
      ? packages.filter((p) => packageDepartment(p.main_item_id) === dept)
      : packages;
    return scoped.map(hydratePackage);
  });

  ipcMain.handle('db:packages:getById', (event: any, id: string) => {
    const pkg: any = db.prepare('SELECT * FROM package_definitions WHERE id = ?').get(id);
    if (!pkg) return null;
    const dept = sessionDepartment(event);
    if (dept && packageDepartment(pkg.main_item_id) !== dept) return null;
    return hydratePackage(pkg);
  });

  // Push the current package_items for a package, deleting any cloud rows that were
  // dropped by a rewrite (component rows get fresh UUIDs on every edit, so stale
  // cloud rows must be removed or they resurface in the rental picker).
  const syncPackageItems = (packageId: string, previousItemIds: string[]): void => {
    const current: any[] = db.prepare('SELECT * FROM package_items WHERE package_id = ?').all(packageId);
    const currentIds = new Set(current.map((r) => r.id));
    for (const oldId of previousItemIds) {
      if (!currentIds.has(oldId)) void pushCatalogToCloud('package_items', 'DELETE', { id: oldId });
    }
    for (const item of current) void pushCatalogToCloud('package_items', 'INSERT', item);
  };

  ipcMain.handle('db:packages:create', (event: any, data: unknown) => {
    const user = requireInventoryAccess(event);
    const input = PackageCreateSchema.parse(data);
    assertEquipmentInDepartment(db, event, input.main_item_id);
    const isPricingAdmin = user.role === 'admin';

    const pkgId = uuidv4();
    const now = new Date().toISOString();

    const createTx = db.transaction(() => {
      // Only admins may set the price; managers still flag the item as a package main.
      if (isPricingAdmin) {
        db.prepare(
          `UPDATE equipment_items SET base_price = ?, pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
        ).run(input.package_cost, now, input.main_item_id);
      } else {
        db.prepare(
          `UPDATE equipment_items SET pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
        ).run(now, input.main_item_id);
      }

      db.prepare(
        `INSERT INTO package_definitions (id, main_item_id, name, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(pkgId, input.main_item_id, input.name, input.description || '', now, now);

      const insertItem = db.prepare(
        `INSERT INTO package_items (id, package_id, component_id, included_qty, is_required, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < input.components.length; i++) {
        const comp = input.components[i]!;
        insertItem.run(uuidv4(), pkgId, comp.equipment_id, comp.qty, comp.is_required ? 1 : 0, i, now, now);
      }
    });
    createTx();

    const pkg: any = db.prepare('SELECT * FROM package_definitions WHERE id = ?').get(pkgId);
    const mainItem: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(input.main_item_id);
    void pushCatalogToCloud('equipment_items', 'UPDATE', mainItem);
    void pushCatalogToCloud('package_definitions', 'INSERT', pkg);
    syncPackageItems(pkgId, []);

    return hydratePackage(pkg);
  });

  /**
   * Update an existing package. The components list is the canonical replacement
   * for the package's content: existing package_items rows are deleted and
   * re-inserted from the payload in a single transaction. Only admins may change
   * the price (base_price on the main item).
   */
  ipcMain.handle('db:packages:update', (event: any, id: string, data: unknown) => {
    const user = requireInventoryAccess(event);
    const input = PackageUpdateSchema.parse(data);

    const existing: any = db.prepare('SELECT id FROM package_definitions WHERE id = ?').get(id);
    if (!existing) throw new Error(`Package ${id} not found`);

    // The package (via its current main item) must be in the caller's department,
    // and so must the item it is being pointed at.
    const current: any = db.prepare('SELECT main_item_id FROM package_definitions WHERE id = ?').get(id);
    if (current) assertEquipmentInDepartment(db, event, current.main_item_id);
    assertEquipmentInDepartment(db, event, input.main_item_id);

    const isPricingAdmin = user.role === 'admin';
    const now = new Date().toISOString();
    const previousItemIds: string[] = (db.prepare('SELECT id FROM package_items WHERE package_id = ?').all(id) as any[]).map((r) => r.id);

    const updateTx = db.transaction(() => {
      if (isPricingAdmin) {
        db.prepare(
          `UPDATE equipment_items SET base_price = ?, pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
        ).run(input.package_cost, now, input.main_item_id);
      } else {
        db.prepare(
          `UPDATE equipment_items SET pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
        ).run(now, input.main_item_id);
      }

      db.prepare(
        `UPDATE package_definitions SET main_item_id = ?, name = ?, description = ?, updated_at = ? WHERE id = ?`,
      ).run(input.main_item_id, input.name, input.description || '', now, id);

      db.prepare('DELETE FROM package_items WHERE package_id = ?').run(id);

      const insertItem = db.prepare(
        `INSERT INTO package_items (id, package_id, component_id, included_qty, is_required, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < input.components.length; i++) {
        const comp = input.components[i]!;
        insertItem.run(uuidv4(), id, comp.equipment_id, comp.qty, comp.is_required ? 1 : 0, i, now, now);
      }
    });
    updateTx();

    const pkg: any = db.prepare('SELECT * FROM package_definitions WHERE id = ?').get(id);
    const mainItem: any = db.prepare('SELECT * FROM equipment_items WHERE id = ?').get(input.main_item_id);
    void pushCatalogToCloud('equipment_items', 'UPDATE', mainItem);
    void pushCatalogToCloud('package_definitions', 'UPDATE', pkg);
    syncPackageItems(id, previousItemIds);

    return hydratePackage(pkg);
  });

  /**
   * Soft-delete a package. Foreign keys on package_items keep the row
   * referenceable by historical records. Setting is_active=0 removes it from the
   * packages list and pickers without breaking past data.
   */
  ipcMain.handle('db:packages:delete', (event: any, id: string) => {
    requireInventoryAccess(event);
    const existing: any = db
      .prepare('SELECT id, is_active, main_item_id FROM package_definitions WHERE id = ?')
      .get(id);
    if (!existing) throw new Error(`Package ${id} not found`);
    assertEquipmentInDepartment(db, event, existing.main_item_id);
    if (existing.is_active === 0) return { ok: true, alreadyInactive: true };

    const now = new Date().toISOString();
    db.prepare('UPDATE package_definitions SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
    const deactivated: any = db.prepare('SELECT * FROM package_definitions WHERE id = ?').get(id);
    void pushCatalogToCloud('package_definitions', 'UPDATE', deactivated);
    return { ok: true, alreadyInactive: false };
  });

  // ── Package CSV Import ──

  ipcMain.handle('packages:readCsvFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Package CSV File',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return fs.readFileSync(result.filePaths[0]!, 'utf-8');
  });

  ipcMain.handle('db:packages:bulkImport', (event: any, csvContent: string) => {
    const user = requireInventoryAccess(event);
    const isPricingAdmin = user.role === 'admin';
    const dept = sessionDepartment(event);
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV file must have a header row and at least one data row');

    const headerLine = lines[0]!;
    const headers = parseCsvRow(headerLine).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));

    const requiredHeaders = ['package_name', 'main_equipment_code', 'component_equipment_code', 'qty'];
    const missing = requiredHeaders.filter((h) => !headers.includes(h));
    if (missing.length > 0) throw new Error(`Missing required columns: ${missing.join(', ')}`);

    const equipByCode = new Map<string, any>();
    const allEquip: any[] = db.prepare('SELECT * FROM equipment_items WHERE is_active = 1').all();
    for (const eq of allEquip) {
      equipByCode.set(eq.equipment_code.toLowerCase(), eq);
    }

    const errors: { row: number; message: string }[] = [];

    const grouped = new Map<
      string,
      {
        description: string;
        package_cost: number;
        mainCode: string;
        components: Array<{ code: string; qty: number; is_required: boolean; rowNum: number }>;
        firstRow: number;
      }
    >();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const values = parseCsvRow(line);
      if (values.length === 0 || (values.length === 1 && !values[0]!.trim())) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim();
      });

      const pkgName = row.package_name;
      if (!pkgName) {
        errors.push({ row: i + 1, message: 'package_name is required' });
        continue;
      }
      if (!row.main_equipment_code) {
        errors.push({ row: i + 1, message: 'main_equipment_code is required' });
        continue;
      }
      if (!row.component_equipment_code) {
        errors.push({ row: i + 1, message: 'component_equipment_code is required' });
        continue;
      }

      const qty = parseInt(row.qty || '1', 10);
      if (isNaN(qty) || qty < 1) {
        errors.push({ row: i + 1, message: 'qty must be a positive integer' });
        continue;
      }

      const mainEquip = equipByCode.get(row.main_equipment_code.toLowerCase());
      if (!mainEquip) {
        errors.push({ row: i + 1, message: `Main equipment "${row.main_equipment_code}" not found` });
        continue;
      }

      // Managers may only import packages whose main item is in their department.
      if (dept && departmentForCategory(equipCategoryName(db, mainEquip.id)) !== dept) {
        errors.push({ row: i + 1, message: `Main equipment "${row.main_equipment_code}" is in another department` });
        continue;
      }

      const compEquip = equipByCode.get(row.component_equipment_code.toLowerCase());
      if (!compEquip) {
        errors.push({
          row: i + 1,
          message: `Component equipment "${row.component_equipment_code}" not found`,
        });
        continue;
      }

      if (!grouped.has(pkgName)) {
        grouped.set(pkgName, {
          description: row.description || '',
          package_cost: parseFloat(row.package_cost || '0') || 0,
          mainCode: row.main_equipment_code,
          components: [],
          firstRow: i + 1,
        });
      }

      const group = grouped.get(pkgName)!;
      if (group.mainCode.toLowerCase() !== row.main_equipment_code.toLowerCase()) {
        errors.push({
          row: i + 1,
          message: `Conflicting main_equipment_code for package "${pkgName}". Expected "${group.mainCode}"`,
        });
        continue;
      }
      if (row.package_cost && parseFloat(row.package_cost) > 0) {
        group.package_cost = parseFloat(row.package_cost);
      }
      if (row.description && !group.description) {
        group.description = row.description;
      }

      const isReq = (row.is_required || '1').trim();
      group.components.push({
        code: row.component_equipment_code,
        qty,
        is_required: isReq === '1' || isReq.toLowerCase() === 'true' || isReq.toLowerCase() === 'yes',
        rowNum: i + 1,
      });
    }

    let imported = 0;

    const importTransaction = db.transaction(() => {
      for (const [pkgName, group] of grouped) {
        const mainEquip = equipByCode.get(group.mainCode.toLowerCase());
        if (!mainEquip) continue;

        const existingPkg: any = db
          .prepare('SELECT id FROM package_definitions WHERE name = ?')
          .get(pkgName);
        if (existingPkg) {
          errors.push({ row: group.firstRow, message: `Package "${pkgName}" already exists` });
          continue;
        }

        const pkgId = uuidv4();
        const now = new Date().toISOString();

        // Only admins may set the price on import; managers still tag the main item.
        if (group.package_cost > 0 && isPricingAdmin) {
          db.prepare(
            `UPDATE equipment_items SET base_price = ?, pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
          ).run(group.package_cost, now, mainEquip.id);
        } else {
          db.prepare(
            `UPDATE equipment_items SET pricing_type = 'package_rate', item_type = 'package_main', updated_at = ? WHERE id = ?`,
          ).run(now, mainEquip.id);
        }

        db.prepare(
          `INSERT INTO package_definitions (id, main_item_id, name, description, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        ).run(pkgId, mainEquip.id, pkgName, group.description, now, now);

        const insertItem = db.prepare(
          `INSERT INTO package_items (id, package_id, component_id, included_qty, is_required, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (let i = 0; i < group.components.length; i++) {
          const comp = group.components[i]!;
          const compEquip = equipByCode.get(comp.code.toLowerCase());
          if (!compEquip) continue;
          insertItem.run(uuidv4(), pkgId, compEquip.id, comp.qty, comp.is_required ? 1 : 0, i, now, now);
        }

        imported++;
      }
    });

    importTransaction();

    if (imported > 0) {
      const allPkgs: any[] = db.prepare('SELECT * FROM package_definitions WHERE is_active = 1').all();
      for (const p of allPkgs) void pushCatalogToCloud('package_definitions', 'INSERT', p);
      const allPkgItems: any[] = db.prepare('SELECT * FROM package_items').all();
      for (const it of allPkgItems) void pushCatalogToCloud('package_items', 'INSERT', it);
      const activeEquip: any[] = db.prepare('SELECT * FROM equipment_items WHERE is_active = 1').all();
      for (const eq of activeEquip) void pushCatalogToCloud('equipment_items', 'UPDATE', eq);
    }

    return { imported, errors };
  });

  // ── Download Package Import Template ──

  ipcMain.handle('packages:downloadTemplate', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save Package Import Template',
      defaultPath: path.join(app.getPath('documents'), 'package_import_template.xlsx'),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const equipment: any[] = db
      .prepare(
        'SELECT equipment_code, name, display_name FROM equipment_items WHERE is_active = 1 ORDER BY equipment_code',
      )
      .all();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CMB EIM';
    workbook.created = new Date();

    const templateSheet = workbook.addWorksheet('Package Import');
    templateSheet.columns = [
      { header: 'package_name', key: 'package_name', width: 28 },
      { header: 'description', key: 'description', width: 35 },
      { header: 'main_equipment_code', key: 'main_equipment_code', width: 22 },
      { header: 'component_equipment_code', key: 'component_equipment_code', width: 26 },
      { header: 'qty', key: 'qty', width: 8 },
      { header: 'is_required', key: 'is_required', width: 12 },
      { header: 'package_cost', key: 'package_cost', width: 14 },
    ];

    const headerRow = templateSheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      cell.alignment = { horizontal: 'center' };
    });

    const sampleMain = equipment[0]?.equipment_code || 'CAM-100';
    const sampleComp1 = equipment[1]?.equipment_code || 'LENS-001';
    const sampleComp2 = equipment[2]?.equipment_code || 'BATT-001';

    templateSheet.addRow({
      package_name: 'Sample Camera Package',
      description: 'Full camera setup with lens and battery',
      main_equipment_code: sampleMain,
      component_equipment_code: sampleComp1,
      qty: 1,
      is_required: 1,
      package_cost: 15000,
    });
    templateSheet.addRow({
      package_name: 'Sample Camera Package',
      description: '',
      main_equipment_code: sampleMain,
      component_equipment_code: sampleComp2,
      qty: 2,
      is_required: 1,
      package_cost: '',
    });

    const refSheet = workbook.addWorksheet('Equipment Reference');
    refSheet.columns = [
      { header: 'equipment_code', key: 'equipment_code', width: 20 },
      { header: 'name', key: 'name', width: 35 },
      { header: 'display_name', key: 'display_name', width: 40 },
    ];
    const refHeader = refSheet.getRow(1);
    refHeader.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      cell.alignment = { horizontal: 'center' };
    });
    for (const eq of equipment) {
      refSheet.addRow({
        equipment_code: eq.equipment_code,
        name: eq.name,
        display_name: eq.display_name,
      });
    }

    const instructionSheet = workbook.addWorksheet('Instructions');
    instructionSheet.getColumn(1).width = 80;
    const instructions = [
      'PACKAGE IMPORT INSTRUCTIONS',
      '',
      '1. Each row represents one component in a package.',
      '2. Rows sharing the same "package_name" are grouped into a single package.',
      '3. "main_equipment_code" is the headline equipment item for the package (must be the same for all rows in a package).',
      '4. "component_equipment_code" is an equipment item included in the package.',
      '5. "qty" is how many of that component are included (default: 1).',
      '6. "is_required" — 1 = required, 0 = optional (default: 1).',
      '7. "package_cost" — the total package price. Only admins can set prices; managers can leave this blank.',
      '8. "description" — optional, only needs to be set on one row per package.',
      '',
      'All equipment codes must match existing equipment in the system.',
      'See the "Equipment Reference" sheet for all valid equipment codes.',
    ];
    instructions.forEach((text, i) => {
      const cell = instructionSheet.getCell(`A${i + 1}`);
      cell.value = text;
      if (i === 0) cell.font = { bold: true, size: 14 };
    });

    await workbook.xlsx.writeFile(result.filePath);
    return result.filePath;
  });
}

// Category name for an equipment id (used by the department guard in bulkImport).
function equipCategoryName(db: any, equipmentId: string): string | null {
  const row: any = db.prepare(`
    SELECT c.name as category_name
    FROM equipment_items e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.id = ?
  `).get(equipmentId);
  return row?.category_name ?? null;
}
