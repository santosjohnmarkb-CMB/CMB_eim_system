import { useRef, useState } from 'react';
import { FileUp, FileText, Trash2, RefreshCw } from 'lucide-react';
import { fileToResizedDataUrl } from '../../lib/image';
import { useToast } from '../../hooks';

interface DocumentUploadProps {
  label?: string;
  hint?: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

// Matches AttachmentDataSchema in src/shared/schemas: ~25MB of base64 (≈18MB raw).
const MAX_DATA_URL_LENGTH = 25_000_000;

function isPdf(dataUrl: string): boolean {
  return dataUrl.startsWith('data:application/pdf');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

// Upload control for attaching a single supporting document (signed form, invoice,
// or service completion document). Images are downscaled to keep payloads small;
// PDFs are stored as-is. The resulting base64 data URL is merged into the archived
// Google Drive document for the workflow.
export function DocumentUpload({
  label = 'Supporting Document',
  hint = 'Upload an image or PDF',
  value,
  onChange,
  disabled,
}: DocumentUploadProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcessing(true);
    try {
      let dataUrl: string;
      if (file.type === 'application/pdf') {
        dataUrl = await readFileAsDataUrl(file);
      } else if (file.type.startsWith('image/')) {
        dataUrl = await fileToResizedDataUrl(file);
      } else {
        throw new Error('Please choose an image or a PDF file.');
      }
      if (dataUrl.length > MAX_DATA_URL_LENGTH) {
        throw new Error('That file is too large. Please upload a file under ~18MB.');
      }
      onChange(dataUrl);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to read the selected file.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="w-full">
      <label className="block text-xs font-medium text-surface-400 mb-1">{label}</label>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={handleFile}
        disabled={disabled || processing}
      />

      {value ? (
        <div className="flex items-start gap-3">
          {isPdf(value) ? (
            <div className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 text-surface-300">
              <FileText size={28} />
              <span className="text-[11px] font-medium">PDF document</span>
            </div>
          ) : (
            <img
              src={value}
              alt="Uploaded document"
              className="h-28 w-28 rounded-lg object-cover border border-surface-700 bg-surface-800"
            />
          )}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={disabled || processing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-surface-700 bg-surface-800 text-surface-200 hover:text-surface-100 hover:border-surface-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} /> Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || processing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-danger-500/40 bg-danger-500/10 text-danger-300 hover:bg-danger-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pickFile}
          disabled={disabled || processing}
          className="flex flex-col items-center justify-center gap-1.5 w-full h-28 rounded-lg border border-dashed border-surface-700 bg-surface-800/50 text-surface-400 hover:text-surface-200 hover:border-surface-600 transition-colors disabled:opacity-50"
        >
          <FileUp size={20} />
          <span className="text-xs">{processing ? 'Processing file…' : hint}</span>
        </button>
      )}
    </div>
  );
}
