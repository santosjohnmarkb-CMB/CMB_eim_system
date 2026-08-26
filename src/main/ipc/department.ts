import type { IpcMainInvokeEvent } from 'electron';
import { getSession } from './session';
import { DEPARTMENT_CONFIG, opsDepartmentOf } from '../../shared/constants';
import type { Department } from '../../shared/constants';

// Returns the department the current session is scoped to, or null for admins
// and viewers (and unauthenticated callers), who are allowed to see every
// department. Viewers get cross-department visibility but are read-only and are
// blocked from writes by requireWriteAccess on the mutating handlers.
export function sessionDepartment(event: IpcMainInvokeEvent): Department | null {
  const user = getSession(event);
  if (!user || user.role === 'admin' || user.role === 'viewer') return null;
  const dept = user.department;
  if (dept === 'camera' || dept === 'lights_grips') return dept;
  return null;
}

// Catalog department names that belong to an ops department. Null means "all".
export function categoriesForDepartment(dept: Department | null): string[] | null {
  if (!dept) return null;
  return DEPARTMENT_CONFIG[dept].categories;
}

export function departmentForCategory(categoryName: string | null | undefined): Department | null {
  return opsDepartmentOf(null, categoryName);
}

export function departmentForCatalogDepartment(departmentName: string | null | undefined): Department | null {
  return opsDepartmentOf(departmentName, null);
}

// Throws if the given equipment item does not belong to the session's department.
export function assertEquipmentInDepartment(db: any, event: IpcMainInvokeEvent, equipmentId: string): void {
  const dept = sessionDepartment(event);
  if (!dept) return;
  const row: any = db.prepare(`
    SELECT d.name as department_name, c.name as category_name
    FROM equipment_items e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.id = ?
  `).get(equipmentId);
  if (!row || opsDepartmentOf(row.department_name, row.category_name) !== dept) {
    throw new Error('This equipment belongs to another department.');
  }
}
