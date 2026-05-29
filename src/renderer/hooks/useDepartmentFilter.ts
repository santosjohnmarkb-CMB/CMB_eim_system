import { useMemo } from 'react';
import { useDepartmentStore } from '../stores/department.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';

export function useDepartmentFilter() {
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const categories = useEquipmentStore((s) => s.categories);

  const departmentCategoryNames = useMemo(() => {
    if (!activeDepartment) return null;
    return DEPARTMENT_CONFIG[activeDepartment].categories;
  }, [activeDepartment]);

  const departmentCategoryIds = useMemo(() => {
    if (!departmentCategoryNames) return null;
    const nameSet = new Set(departmentCategoryNames);
    return new Set(categories.filter((c) => nameSet.has(c.name)).map((c) => c.id));
  }, [departmentCategoryNames, categories]);

  const isEquipmentInDepartment = useMemo(() => {
    if (!departmentCategoryIds) return () => true;
    return (categoryId: string) => departmentCategoryIds.has(categoryId);
  }, [departmentCategoryIds]);

  const getCategoryDepartment = (categoryName: string): Department | null => {
    return CATEGORY_TO_DEPARTMENT[categoryName] || null;
  };

  return {
    activeDepartment,
    departmentCategoryNames,
    departmentCategoryIds,
    isEquipmentInDepartment,
    getCategoryDepartment,
  };
}
