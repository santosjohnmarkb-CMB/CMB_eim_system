import { useUiStore } from '../stores/ui.store';

/**
 * Imperatively surface a data-load failure to the user.
 *
 * Zustand stores are plain functions (no React hooks), so they can't use the
 * toast hook directly. This calls the UI store imperatively. Without it, a
 * failed `fetch*` silently leaves the list empty — which looks exactly like "all
 * my data was deleted" to the user (H-3). A toast makes the failure explicit.
 *
 * Returns a short message string so callers can also store it as `error` state
 * for an inline banner if they want.
 */
export function reportLoadError(what: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const message = `Couldn't load ${what}. ${detail}`;
  try {
    useUiStore.getState().addToast({ type: 'error', message });
  } catch { /* toast store unavailable — nothing else we can do */ }
  return message;
}
