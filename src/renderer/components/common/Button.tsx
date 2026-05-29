import React from 'react';
import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950',
        {
          'bg-primary-600 text-white hover:bg-primary-500 focus:ring-primary-500': variant === 'primary',
          'bg-surface-700 text-surface-100 hover:bg-surface-600 focus:ring-surface-500': variant === 'secondary',
          'bg-danger-600 text-white hover:bg-danger-500 focus:ring-danger-500': variant === 'danger',
          'bg-transparent text-surface-300 hover:text-surface-100 hover:bg-surface-800 focus:ring-surface-500': variant === 'ghost',
          'px-2.5 py-1.5 text-xs gap-1': size === 'sm',
          'px-4 py-2 text-sm gap-2': size === 'md',
          'px-6 py-3 text-base gap-2': size === 'lg',
          'opacity-50 cursor-not-allowed': disabled || loading,
        },
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
