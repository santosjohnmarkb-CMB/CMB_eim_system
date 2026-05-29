import { useCallback } from 'react';
import { useUiStore } from '../stores/ui.store';

export function useToast() {
  const addToast = useUiStore((s) => s.addToast);

  const success = useCallback((message: string) => {
    addToast({ type: 'success', message });
  }, [addToast]);

  const error = useCallback((message: string) => {
    addToast({ type: 'error', message });
  }, [addToast]);

  const warning = useCallback((message: string) => {
    addToast({ type: 'warning', message });
  }, [addToast]);

  const info = useCallback((message: string) => {
    addToast({ type: 'info', message });
  }, [addToast]);

  return { success, error, warning, info };
}
