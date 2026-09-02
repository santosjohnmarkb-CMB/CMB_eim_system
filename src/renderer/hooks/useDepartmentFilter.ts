import { useEffect, useMemo } from 'react';
import { useDepartmentStore } from '../stores/department.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { DEPARTMENT_CONFIG, opsDepartmentOf } from '../../shared/constants';
import type { Department } from '../../shared/constants';

/** Map ops-department catalog names to category ids. Empty catalog arrays are uninitialized, not a match-nothing filter. */
export function resolveDepartmentCategoryIds(
  departmentCategoryNames: string[] | null,
  departments: Array<{ id: string; name: string }>,
  categories: Array<{ id: string; department_id: string }>,
): Set<string> | null {
  if (!departmentCategoryNames) return null;
  if (departments.length === 0 || categories.length === 0) return null;
  const nameSet = new Set(departmentCategoryNames);
  const deptIds = new Set(departments.filter((d) => nameSet.has(d.name)).map((d) => d.id));
  return new Set(categories.filter((c) => deptIds.has(c.department_id)).map((c) => c.id));
}

export function useDepartmentFilter() {
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const categories = useEquipmentStore((s) => s.categories);
  const departments = useEquipmentStore((s) => s.departments);
  const fetchDepartments = useEquipmentStore((s) => s.fetchDepartments);
  const fetchCategories = useEquipmentStore((s) => s.fetchCategories);

  useEffect(() => {
    void fetchDepartments();
    void fetchCategories();
  }, [fetchDepartments, fetchCategories]);

  const departmentCategoryNames = useMemo(() => {
    if (!activeDepartment) return null;
    return DEPARTMENT_CONFIG[activeDepartment].categories;
  }, [activeDepartment]);

  const departmentCategoryIds = useMemo(
    () => resolveDepartmentCategoryIds(departmentCategoryNames, departments, categories),
    [departmentCategoryNames, categories, departments],
  );

  const isEquipmentInDepartment = useMemo(() => {
    if (!departmentCategoryIds) return () => true;
    return (categoryId: string) => departmentCategoryIds.has(categoryId);
  }, [departmentCategoryIds]);

  const getCategoryDepartment = (categoryName: string): Department | null => {
    const category = categories.find((c) => c.name === categoryName);
    const departmentName = category
      ? departments.find((d) => d.id === category.department_id)?.name
      : undefined;
    return opsDepartmentOf(departmentName, categoryName);
  };

  return {
    activeDepartment,
    departmentCategoryNames,
    departmentCategoryIds,
    isEquipmentInDepartment,
    getCategoryDepartment,
  };
}
