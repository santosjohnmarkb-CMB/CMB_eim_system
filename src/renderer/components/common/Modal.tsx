import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Route onClose through a ref so the focus/keydown effect below can depend only on
  // `isOpen`. Callers typically pass an inline arrow for onClose (new identity every
  // render); if the effect depended on it, it would tear down and re-run on every
  // parent re-render — e.g. on each keystroke in a form field — stealing focus back
  // to the first focusable element (the close button). Keeping the ref current avoids
  // stale closures without re-subscribing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!isOpen) return;

    // Remember what had focus so we can restore it when the modal closes.
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Move focus to the first focusable element inside the body (the actual form
    // fields) rather than the header's close button, which is first in DOM order.
    const focusFirst = () => {
      const body = bodyRef.current;
      const node = dialogRef.current;
      const first =
        body?.querySelector<HTMLElement>(FOCUSABLE) ??
        node?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node)?.focus();
    };
    focusFirst();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Trap Tab within the dialog.
      if (e.key === 'Tab') {
        const node = dialogRef.current;
        if (!node) return;
        const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the trigger element on close.
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative glass-panel rounded-xl shadow-2xl animate-fade-in outline-none',
          'max-h-[90vh] overflow-y-auto',
          {
            'w-full max-w-sm': size === 'sm',
            'w-full max-w-lg': size === 'md',
            'w-full max-w-2xl': size === 'lg',
            'w-full max-w-4xl': size === 'xl',
          },
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
          <h2 id={titleId} className="text-lg font-semibold text-surface-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div ref={bodyRef} className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
