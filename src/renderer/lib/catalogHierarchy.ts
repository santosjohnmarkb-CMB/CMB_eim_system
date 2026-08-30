import {
  catalogDepartmentNames,
  categoriesInCatalogDept,
  subcategoriesInCategory,
  subSubsFor,
  EQUIPMENT_HIERARCHY,
  EQUIPMENT_SUB_SUBS,
} from '../../shared/constants';
import type { Department } from '../../shared/constants';
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
  const score = (deptId: string) =>
    categories.filter((c) => c.department_id === deptId && wanted.has(c.name)).length;
  return [...matches].sort((a, b) => score(b.id) - score(a.id) || (b.display_order ?? 0) - (a.display_order ?? 0))[0];
}

export function latestDepartments(
  departments: CatalogDepartment[],
  opsDept: Department | null,
  categories: Category[] = [],
): CatalogDepartment[] {
  return catalogDepartmentNames(opsDept)
    .map((name) => pickCatalogDepartment(departments, name, categories))
    .filter((d): d is CatalogDepartment => !!d);
}

function optionFor(name: string, row?: { id: string } | undefined, departmentId?: string): HierarchyOption {
  return { id: row?.id || name, name, departmentId };
}

export function latestCategories(
  categories: Category[],
  departments: CatalogDepartment[],
  opsDept: Department | null,
): Category[] {
  const out: Category[] = [];
  for (const deptName of catalogDepartmentNames(opsDept)) {
    const dept = pickCatalogDepartment(departments, deptName, categories);
    if (!dept) continue;
    for (const catName of categoriesInCatalogDept(deptName)) {
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
  const seen = new Set<string>();
  const out: HierarchyOption[] = [];
  for (const name of categoriesInCatalogDept(dept.name)) {
    seen.add(name);
    out.push(optionFor(name, categories.find((c) => c.department_id === catalogDeptId && c.name === name), catalogDeptId));
  }
  for (const cat of categories) {
    if (cat.department_id !== catalogDeptId || seen.has(cat.name)) continue;
    seen.add(cat.name);
    out.push(optionFor(cat.name, cat, catalogDeptId));
  }
  return out;
}

export function categoryOptionsForOps(
  categories: Category[],
  departments: CatalogDepartment[],
  opsDept: Department | null,
): HierarchyOption[] {
  const out: HierarchyOption[] = [];
  const seen = new Set<string>();
  for (const deptName of catalogDepartmentNames(opsDept)) {
    const dept = pickCatalogDepartment(departments, deptName, categories);
    const options = dept
      ? categoryOptionsForDepartment(categories, departments, dept.id)
      : categoriesInCatalogDept(deptName).map((name) => optionFor(name));
    for (const option of options) {
      if (seen.has(option.name)) continue;
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
  return subcategoriesInCategory(dept.name, category.name)
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
  const seen = new Set<string>();
  const out: HierarchyOption[] = [];
  for (const name of subcategoriesInCategory(dept.name, categoryName)) {
    seen.add(name);
    out.push(optionFor(name, subcategories.find((s) => s.name === name && (!categoryId || s.category_id === categoryId))));
  }
  if (categoryId) {
    for (const sub of subcategories) {
      if (sub.category_id !== categoryId || seen.has(sub.name)) continue;
      seen.add(sub.name);
      out.push(optionFor(sub.name, sub));
    }
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
  for (const [catName, subNames] of Object.entries(EQUIPMENT_HIERARCHY[dept.name] ?? {})) {
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
  const deptCatIds = new Set(categories.filter((c) => c.department_id === catalogDeptId).map((c) => c.id));
  for (const sub of subcategories) {
    if (!deptCatIds.has(sub.category_id) || seen.has(sub.name)) continue;
    seen.add(sub.name);
    out.push(optionFor(sub.name, sub, catalogDeptId));
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
  const scoped = subcategoryOptionsForCategory(
    subcategories, departments, catalogDeptId, categoryIdOrName, categories,
  );
  if (scoped.length > 0) return scoped;
  return allSubcategoryOptionsForDepartment(subcategories, departments, catalogDeptId, categories);
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
  if (out.length > 0) return out;
  if (categoryName) {
    const forCat = allSubSubOptionsForCategory(categoryName);
    if (forCat.length > 0) return forCat;
  }
  return catalogDeptName ? allSubSubOptionsForDepartment(catalogDeptName) : [];
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
