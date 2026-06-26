import { useState } from 'react';
import { Archive } from 'lucide-react';
import { Button } from './Button';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../hooks';
import { archiveCompletedList, openArchiveLocation, type ListSection } from '../../lib/archiveList';

interface ArchiveListButtonProps {
  section: ListSection;
  // Human-readable label used for the Drive/local folder and toast, e.g. "Camera" or
  // "Camera (Outward)".
  departmentLabel: string;
  // Base of the saved PDF filename (a timestamp is appended in the main process).
  filenameBase: string;
  // The records (in display order) captured into the snapshot and then soft-cleared.
  recordIds: string[];
  // Builds the printable document body at click time so the PDF matches what's shown.
  buildDoc: () => { title: string; bodyHtml: string };
  // Called after a successful archive so the page can refetch and drop cleared rows.
  onArchived?: () => void;
  className?: string;
}

// Admin-only "Archive List" control. Renders nothing for non-admins. On click it
// confirms, archives the current closed list to a PDF (Drive + local mirror), clears
// the archived records from the view, and offers to open the saved file location.
export function ArchiveListButton({
  section,
  departmentLabel,
  filenameBase,
  recordIds,
  buildDoc,
  onArchived,
  className,
}: ArchiveListButtonProps) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;

  const count = recordIds.length;
  const disabled = busy || count === 0;

  const handleClick = async () => {
    if (count === 0) {
      toast.info('There are no records to archive.');
      return;
    }
    const confirmed = window.confirm(
      `Archive these ${count} record${count === 1 ? '' : 's'} for ${departmentLabel} and clear them from this list?\n\n` +
      'A PDF copy is saved to the archive (Google Drive and a local copy). The records stay saved and remain searchable in the Archives section.',
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const { title, bodyHtml } = buildDoc();
      const res = await archiveCompletedList({
        section,
        departmentLabel,
        title,
        bodyHtml,
        filenameBase,
        recordIds,
      });

      if (!res.success) {
        toast.error(res.message || 'Failed to archive the list.');
        return;
      }

      const where = res.uploadedToDrive ? 'Google Drive and a local copy' : 'a local copy';
      toast.success(
        `Archived ${res.clearedCount} record${res.clearedCount === 1 ? '' : 's'} for ${departmentLabel} to ${where}.`,
      );

      if (res.localPath && window.confirm('Open the saved file location now?')) {
        const opened = await openArchiveLocation(res.localPath);
        if (!opened.success) toast.error(opened.message || 'Could not open the file location.');
      }

      onArchived?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive the list.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      onClick={handleClick}
      disabled={disabled}
      loading={busy}
      className={className}
    >
      <Archive size={16} /> Archive List
    </Button>
  );
}
