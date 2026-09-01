import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

const fieldClass = 'w-full px-3 py-2 pr-8 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500';

export function CatalogCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select or type',
  allowCreate = false,
  createLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  /** Show an "Add …" row when the typed value has no exact match. */
  allowCreate?: boolean;
  /** Override the create-row label (default: "Add «typed value»"). */
  createLabel?: string;
}) {
  const listId = `catlist-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const names = value && !options.includes(value) ? [value, ...options] : options;
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [names, value]);

  const trimmed = value.trim();
  const showCreate = allowCreate && trimmed.length > 0
    && !options.some((o) => o.toLowerCase() === trimmed.toLowerCase());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={wrapRef}>
      <label className="block text-xs font-medium text-surface-400 mb-1" htmlFor={listId}>{label}</label>
      <div className="relative">
        <input
          id={listId}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={fieldClass}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-options`}
        />
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
        {open && (filtered.length > 0 || showCreate || trimmed.length > 0) && (
          <ul
            id={`${listId}-options`}
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-surface-800 border border-surface-700 rounded-lg shadow-lg"
          >
            {filtered.map((name) => (
              <li key={name} role="option" aria-selected={name === value}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    name === value ? 'bg-primary-500/15 text-surface-100' : 'text-surface-200 hover:bg-surface-700/60'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
            {showCreate && (
              <li role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-primary-400 hover:bg-surface-700/60 transition-colors flex items-center gap-1.5 border-t border-surface-700/50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(trimmed);
                    setOpen(false);
                  }}
                >
                  <Plus size={14} />
                  {createLabel || `Add "${trimmed}"`}
                </button>
              </li>
            )}
            {filtered.length === 0 && !showCreate && (
              <li className="px-3 py-2 text-sm text-surface-500" role="presentation">No results</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
