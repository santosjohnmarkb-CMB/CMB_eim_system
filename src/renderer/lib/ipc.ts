const MUTATION_PATTERNS = [
  ':create', ':update', ':delete', ':bulkSave', ':bulkImport',
  ':importCsv', ':adjustStock', ':consumeParts',
  ':updateStatus', ':batchUpdateStatus',
  ':addNote', ':createSchedule', ':updateSchedule', ':deleteSchedule',
  ':setCompatibility',
];

function isMutationChannel(channel: string): boolean {
  return MUTATION_PATTERNS.some((p) => channel.endsWith(p));
}

export async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await window.electronAPI.invoke<T>(channel, ...args);
  if (isMutationChannel(channel)) {
    window.electronAPI.invoke('sync:notifyAction').catch(() => {});
  }
  return result;
}

export function ipcOn(channel: string, callback: (...args: unknown[]) => void): void {
  window.electronAPI.on(channel, callback);
}

export function ipcRemoveListener(channel: string, callback: (...args: unknown[]) => void): void {
  window.electronAPI.removeListener(channel, callback);
}
