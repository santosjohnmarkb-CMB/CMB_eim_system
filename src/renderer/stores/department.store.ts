import { create } from 'zustand';
import type { Department } from '../../shared/constants';

interface DepartmentState {
  activeDepartment: Department | null;
  setDepartment: (dept: Department) => void;
  initFromUser: (userDept: Department | null) => void;
}

export const useDepartmentStore = create<DepartmentState>((set) => ({
  activeDepartment: null,

  setDepartment: (dept) => set({ activeDepartment: dept }),

  initFromUser: (userDept) => {
    set({ activeDepartment: userDept || null });
  },
}));
