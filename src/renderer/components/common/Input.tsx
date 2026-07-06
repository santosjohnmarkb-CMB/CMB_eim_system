import React, { useId } from 'react';
import clsx from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-surface-400 mb-1">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={clsx(
            'w-full px-3 py-2 text-sm bg-surface-800 border rounded-lg',
            'text-surface-100 placeholder-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500',
            'transition-colors duration-150',
            error ? 'border-danger-500' : 'border-surface-700',
            className,
          )}
          {...props}
        />
        {error && <p id={errorId} className="mt-1 text-xs text-danger-400">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
