import { useRef, useState } from 'react';
import { ImagePlus, Trash2, RefreshCw } from 'lucide-react';
import { fileToResizedDataUrl } from '../../lib/image';
import { useToast } from '../../hooks';

interface PhotoUploadProps {
  label?: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

// Upload control for attaching a single equipment photo. The chosen image is
// downscaled to a base64 data URL by the caller-shared helper so it can be stored
// and embedded into the printed document.
export function PhotoUpload({ label = 'Equipment Photo', value, onChange, disabled }: PhotoUploadProps) {
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
      const dataUrl = await fileToResizedDataUrl(file);
      onChange(dataUrl);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to read the selected image.');
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
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
        disabled={disabled || processing}
      />

      {value ? (
        <div className="flex items-start gap-3">
          <img
            src={value}
            alt="Requested equipment"
            className="h-28 w-28 rounded-lg object-cover border border-surface-700 bg-surface-800"
          />
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
          <ImagePlus size={20} />
          <span className="text-xs">{processing ? 'Processing image…' : 'Upload a photo of the equipment'}</span>
        </button>
      )}
    </div>
  );
}
