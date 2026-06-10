import { FileText } from 'lucide-react';

export function FormsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-surface-100">Forms</h1>
        <p className="text-sm text-surface-500 mt-1">
          Fill out and submit equipment-related forms
        </p>
      </div>

      <div className="glass-panel rounded-2xl border border-surface-700/40 px-6 py-16 flex flex-col items-center text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary-500/10 mb-4">
          <FileText size={28} className="text-primary-400" />
        </div>
        <h2 className="text-base font-semibold text-surface-200 mb-1">No forms available yet</h2>
        <p className="text-sm text-surface-500 max-w-sm">
          Forms will appear here once they become available. Check back later.
        </p>
      </div>
    </div>
  );
}
