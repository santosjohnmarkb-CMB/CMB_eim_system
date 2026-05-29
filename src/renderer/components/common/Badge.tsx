import clsx from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        {
          'px-2 py-0.5 text-2xs': size === 'sm',
          'px-2.5 py-1 text-xs': size === 'md',
          'bg-surface-700 text-surface-300': variant === 'default',
          'bg-success-500/15 text-success-400': variant === 'success',
          'bg-warning-500/15 text-warning-400': variant === 'warning',
          'bg-danger-500/15 text-danger-400': variant === 'danger',
          'bg-primary-500/15 text-primary-400': variant === 'info',
          'bg-purple-500/15 text-purple-400': variant === 'purple',
        },
        className,
      )}
    >
      {children}
    </span>
  );
}
