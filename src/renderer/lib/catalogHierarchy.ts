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

export function latestDepartments(
  departments: CatalogDepartment[],
  opsDept: Department | null,
): CatalogDepartment[] {
  return catalogDepartmentNames(opsDept)
    .map((name) => departments.find((d) => d.name === name))
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
    const dept = departments.find((d) => d.name === deptName);
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
  return categoriesInCatalogDept(dept.name).map((name) =>
    optionFor(name, categories.find((c) => c.department_id === catalogDeptId && c.name === name), catalogDeptId),
  );
}

export function categoryOptionsForOps(
  categories: Category[],
  departments: CatalogDepartment[],
  opsDept: Department | null,
): HierarchyOption[] {
  const out: HierarchyOption[] = [];
  const seen = new Set<string>();
  for (const deptName of catalogDepartmentNames(opsDept)) {
    const dept = departments.find((d) => d.name === deptName);
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
  return subcategoriesInCategory(dept.name, categoryName).map((name) =>
    optionFor(name, subcategories.find((s) => s.name === name && (!categoryId || s.category_id === categoryId))),
  );
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

export function subSubChoices(catalogDeptName: string | undefined, categoryName?: string, subcategoryName?: string): string[] {
  const scoped = subSubOptionsFor(categoryName, subcategoryName);
  if (scoped.length > 0) return scoped;
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
