import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

const fieldClass = 'w-full px-3 py-2 pr-8 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500';

export function CatalogCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select or type',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const listId = useId();
  const names = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div>
      <label className="block text-xs font-medium text-surface-400 mb-1">{label}</label>
      <div className="relative">
        <input
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={fieldClass}
          autoComplete="off"
        />
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
        <datalist id={listId}>
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
