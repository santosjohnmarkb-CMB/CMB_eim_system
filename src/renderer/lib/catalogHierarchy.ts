import {
  catalogDepartmentNames,
  catalogDeptHasTaxonomy,
  categoriesInCatalogDept,
  subcategoriesInCategory,
  subSubsFor,
  EQUIPMENT_HIERARCHY,
  EQUIPMENT_SUB_SUBS,
  isDelistedCategoryName,
  isPersonnelCatalogName,
  PERSONNEL_CATALOG_DEPT,
} from '../../shared/constants';
import type { EquipmentSection } from '../../shared/constants';
import type { Category, Subcategory, Department as CatalogDepartment } from '../../shared/types';

export interface HierarchyOption {
  id: string;
  name: string;
  departmentId?: string;
}

/** Prefer the department row whose categories match EQUIPMENT_HIERARCHY. Sync can leave extra rows with the same name. */
export function pickCatalogDepartment(
  departments: CatalogDepartment[],
  name: string,
  categories: Category[] = [],
): CatalogDepartment | undefined {
  const matches = departments.filter((d) => d.name === name);
  if (matches.length <= 1) return matches[0];
  const wanted = new Set(categoriesInCatalogDept(name));
  const score = (deptId: string) => wanted.size > 0
    ? categories.filter((c) => c.department_id === deptId && wanted.has(c.name)).length
    : categories.filter((c) => c.department_id === deptId).length;
  return [...matches].sort((a, b) => score(b.id) - score(a.id) || (b.display_order ?? 0) - (a.display_order ?? 0))[0];
}

export function latestDepartments(
  departments: CatalogDepartment[],
  opsDept: EquipmentSection | null,
  categories: Category[] = [],
): CatalogDepartment[] {
  if (opsDept === 'personnel') {
    const exact = pickCatalogDepartment(departments, PERSONNEL_CATALOG_DEPT, categories);
    const rest = departments
      .filter((d) => isPersonnelCatalogName(d.name) && d.id !== exact?.id)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));
    return exact ? [exact, ...rest] : rest;
  }
  return catalogDepartmentNames(opsDept)
    .map((name) => pickCatalogDepartment(departments, name, categories))
    .filter((d): d is CatalogDepartment => !!d);
}

function optionFor(name: string, row?: { id: string } | undefined, departmentId?: string): HierarchyOption {
  return { id: row?.id || name, name, departmentId };
}

/** Designations are stored as categories named Personnel… under Camera / Lights & Grips. */
function personnelCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => isPersonnelCatalogName(c.name) && !isDelistedCategoryName(c.name))
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
}

/** False when EQUIPMENT_HIERARCHY has no categories for this catalog department. */
export function departmentHasTaxonomy(deptName?: string | null): boolean {
  return catalogDeptHasTaxonomy(deptName);
}

export function latestCategories(
  categories: Category[],
  departments: CatalogDepartment[],
  opsDept: EquipmentSection | null,
): Category[] {
  if (opsDept === 'personnel') return personnelCategories(categories);
  const out: Category[] = [];
  for (const dept of latestDepartments(departments, opsDept, categories)) {
    const locked = categoriesInCatalogDept(dept.name);
    if (locked.length === 0) {
      out.push(...categories.filter((c) => c.department_id === dept.id && !isDelistedCategoryName(c.name) && !isPersonnelCatalogName(c.name))
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)));
      continue;
    }
    for (const catName of locked) {
      const cat = categories.find((c) => c.department_id === dept.id && c.name === catName);
      if (cat) out.push(cat);
    }
  }
  return out;
}

export function categoryOptionsForDepartment(
  categories: Category[],
  departments: CatalogDepartment[],
  catalogDeptId: string,
): HierarchyOption[] {
  const dept = departments.find((d) => d.id === catalogDeptId);
  if (!dept) return [];
  const locked = categoriesInCatalogDept(dept.name);
  if (locked.length === 0) {
    return categories
      .filter((c) => c.department_id === catalogDeptId && !isDelistedCategoryName(c.name) && !isPersonnelCatalogName(c.name))
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
      .map((c) => optionFor(c.name, c, catalogDeptId));
  }
  const seen = new Set<string>();
  const out: HierarchyOption[] = [];
  for (const name of locked) {
    if (isDelistedCategoryName(name)) continue;
    seen.add(name);
    out.push(optionFor(name, categories.find((c) => c.department_id === catalogDeptId && c.name === name), catalogDeptId));
  }
  return out;
}

export function categoryOptionsForOps(
  categories: Category[],
  departments: CatalogDepartment[],
  opsDept: EquipmentSection | null,
): HierarchyOption[] {
  if (opsDept === 'personnel') {
    const cats = personnelCategories(categories);
    const nameCount = new Map<string, number>();
    for (const c of cats) nameCount.set(c.name, (nameCount.get(c.name) || 0) + 1);
    return cats.map((c) => {
      const dept = departments.find((d) => d.id === c.department_id);
      const label = (nameCount.get(c.name) || 0) > 1 && dept ? `${c.name} (${dept.name})` : c.name;
      return optionFor(label, c, c.department_id);
    });
  }
  const out: HierarchyOption[] = [];
  const seen = new Set<string>();
  for (const dept of latestDepartments(departments, opsDept, categories)) {
    const options = categoryOptionsForDepartment(categories, departments, dept.id);
    for (const option of options) {
      if (seen.has(option.name) || isDelistedCategoryName(option.name) || isPersonnelCatalogName(option.name)) continue;
      seen.add(option.name);
      out.push(option);
    }
  }
  return out;
}

export function latestSubcategories(
  subcategories: Subcategory[],
  departments: CatalogDepartment[],
  category: Category | undefined,
): Subcategory[] {
  if (!category) return [];
  const dept = departments.find((d) => d.id === category.department_id);
  if (!dept) return [];
  const locked = subcategoriesInCategory(dept.name, category.name);
  if (locked.length === 0) {
    return subcategories
      .filter((s) => s.category_id === category.id)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }
  return locked
    .map((name) => subcategories.find((s) => s.category_id === category.id && s.name === name))
    .filter((s): s is Subcategory => !!s);
}

export function subcategoryOptionsForCategory(
  subcategories: Subcategory[],
  departments: CatalogDepartment[],
  catalogDeptId: string,
  categoryIdOrName: string,
  categories: Category[],
): HierarchyOption[] {
  if (!catalogDeptId || !categoryIdOrName) return [];
  const dept = departments.find((d) => d.id === catalogDeptId);
  if (!dept) return [];
  const category = categories.find((c) => c.id === categoryIdOrName)
    || categories.find((c) => c.department_id === catalogDeptId && c.name === categoryIdOrName);
  const categoryName = category?.name || categoryIdOrName;
  const categoryId = category?.id;
  const locked = subcategoriesInCategory(dept.name, categoryName);
  if (locked.length === 0) {
    return subcategories
      .filter((s) => categoryId && s.category_id === categoryId)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
      .map((s) => optionFor(s.name, s));
  }
  const seen = new Set<string>();
  const out: HierarchyOption[] = [];
  for (const name of locked) {
    seen.add(name);
    out.push(optionFor(name, subcategories.find((s) => s.name === name && (!categoryId || s.category_id === categoryId))));
  }
  return out;
}

export function latestSubSubs(category?: Category, subcategory?: Subcategory): string[] {
  if (!category || !subcategory) return [];
  return subSubsFor(category.name, subcategory.name);
}

export function subSubOptionsFor(categoryName?: string, subcategoryName?: string): string[] {
  if (!categoryName || !subcategoryName) return [];
  return subSubsFor(categoryName, subcategoryName);
}

export function allSubcategoryOptionsForDepartment(
  subcategories: Subcategory[],
  departments: CatalogDepartment[],
  catalogDeptId: string,
  categories: Category[],
): HierarchyOption[] {
  const dept = departments.find((d) => d.id === catalogDeptId);
  if (!dept) return [];
  const out: HierarchyOption[] = [];
  const seen = new Set<string>();
  const lockedTree = EQUIPMENT_HIERARCHY[dept.name] ?? {};
  if (Object.keys(lockedTree).length === 0) {
    const catIds = new Set(categories.filter((c) => c.department_id === catalogDeptId).map((c) => c.id));
    return subcategories
      .filter((s) => catIds.has(s.category_id))
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
      .filter((s) => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      })
      .map((s) => optionFor(s.name, s, catalogDeptId));
  }
  for (const [catName, subNames] of Object.entries(lockedTree)) {
    const cat = categories.find((c) => c.department_id === catalogDeptId && c.name === catName);
    for (const name of subNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(optionFor(
        name,
        subcategories.find((s) => s.name === name && (!cat || s.category_id === cat.id)),
        catalogDeptId,
      ));
    }
  }
  return out;
}

export function subcategoryChoices(
  subcategories: Subcategory[],
  departments: CatalogDepartment[],
  catalogDeptId: string,
  categoryIdOrName: string,
  categories: Category[],
): HierarchyOption[] {
  return subcategoryOptionsForCategory(
    subcategories, departments, catalogDeptId, categoryIdOrName, categories,
  );
}

export function allSubSubOptionsForCategory(categoryName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [key, names] of Object.entries(EQUIPMENT_SUB_SUBS)) {
    if (!key.startsWith(`${categoryName}::`)) continue;
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function allSubSubOptionsForDepartment(catalogDeptName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const catName of categoriesInCatalogDept(catalogDeptName)) {
    for (const name of allSubSubOptionsForCategory(catName)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function subSubChoices(
  catalogDeptName: string | undefined,
  categoryName?: string,
  subcategoryName?: string,
  items?: { sub_subcategory?: string | null; category_id?: string | null; subcategory_id?: string | null }[],
  categoryId?: string,
  subcategoryId?: string,
): string[] {
  const scoped = subSubOptionsFor(categoryName, subcategoryName);
  const seen = new Set<string>(scoped);
  const out = [...scoped];
  if (items) {
    for (const item of items) {
      const ss = (item.sub_subcategory || '').trim();
      if (!ss || seen.has(ss)) continue;
      if (categoryId && item.category_id !== categoryId) continue;
      if (subcategoryId && item.subcategory_id !== subcategoryId) continue;
      seen.add(ss);
      out.push(ss);
    }
  }
  return out;
}

export function categoryNameForSubcategory(catalogDeptName: string, subcategoryName: string): string | undefined {
  const cats = EQUIPMENT_HIERARCHY[catalogDeptName] ?? {};
  for (const [catName, subs] of Object.entries(cats)) {
    if (subs.includes(subcategoryName)) return catName;
  }
  return undefined;
}

export function pathForSubSub(subSubName: string): { category: string; subcategory: string } | undefined {
  for (const [key, names] of Object.entries(EQUIPMENT_SUB_SUBS)) {
    if (!names.includes(subSubName)) continue;
    const [category, subcategory] = key.split('::');
    if (category && subcategory) return { category, subcategory };
  }
  return undefined;
}
