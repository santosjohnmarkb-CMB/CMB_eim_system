import { ipcInvoke } from './ipc';

export type ListSection = 'maintenance' | 'loan' | 'purchase';

export interface ArchiveListPayload {
  section: ListSection;
  departmentLabel: string;
  title: string;
  bodyHtml: string;
  filenameBase: string;
  recordIds: string[];
}

export interface ArchiveListResult {
  success: boolean;
  savedLocally: boolean;
  uploadedToDrive: boolean;
  driveFileId: string | null;
  localPath: string | null;
  filename: string | null;
  clearedCount: number;
  message?: string;
}

export interface ClearedArchiveEntry {
  section: ListSection;
  department: 'camera' | 'lights_grips' | null;
  closedDate: string | null;
  archivedAt: string | null;
  id: string;
  number: string;
  title: string;
  subtitle: string;
}

// Render a section's closed list to a PDF, save it (Drive + local mirror), and
// soft-clear the included records. Admin-only (enforced in the main handler).
export function archiveCompletedList(payload: ArchiveListPayload): Promise<ArchiveListResult> {
  return ipcInvoke<ArchiveListResult>('archive:list:create', payload);
}

// Reveal a saved archive PDF in the OS file manager.
export function openArchiveLocation(localPath: string): Promise<{ success: boolean; message?: string }> {
  return ipcInvoke<{ success: boolean; message?: string }>('archive:openLocation', localPath);
}

// Every soft-cleared record across all three sections, for the Archives browser.
export function getClearedArchive(): Promise<ClearedArchiveEntry[]> {
  return ipcInvoke<ClearedArchiveEntry[]>('archive:list:getCleared');
}

// Permanently delete one archived line entry. Admin-only and guarded server-side so
// it can only ever remove an already-archived, closed record.
export function deleteArchivedEntry(
  section: ListSection,
  id: string,
): Promise<{ success: boolean; message?: string }> {
  return ipcInvoke<{ success: boolean; message?: string }>('archive:list:deleteEntry', section, id);
}
