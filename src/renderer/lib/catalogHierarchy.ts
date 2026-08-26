import {
  catalogDepartmentNames,
  categoriesInCatalogDept,
  subcategoriesInCategory,
  subSubsFor,
} from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { Category, Subcategory, Department as CatalogDepartment } from '../../shared/types';

export function latestDepartments(
  departments: CatalogDepartment[],
  opsDept: Department | null,
): CatalogDepartment[] {
  return catalogDepartmentNames(opsDept)
    .map((name) => departments.find((d) => d.name === name))
    .filter((d): d is CatalogDepartment => !!d);
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

export function latestSubSubs(category?: Category, subcategory?: Subcategory): string[] {
  if (!category || !subcategory) return [];
  return subSubsFor(category.name, subcategory.name);
}
