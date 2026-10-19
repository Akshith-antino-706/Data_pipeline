'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  confirmText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, confirmText, busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const firstRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    firstRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const blocked = busy || (confirmText !== undefined && typed !== confirmText);

  return (
    <div className="ui-dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {description && <div>{typeof description === 'string' ? <p>{description}</p> : description}</div>}
        {confirmText !== undefined && (
          <div className="ui-field">
            <label className="ui-label" htmlFor={inputId}>Type <b>{confirmText}</b> to confirm</label>
            <input
              id={inputId}
              ref={el => { firstRef.current = el; }}
              className="ui-input"
              value={typed}
              autoComplete="off"
              onChange={e => setTyped(e.target.value)}
            />
          </div>
        )}
        <div className="ui-dialog-actions">
          <Button
            variant="ghost"
            onClick={onCancel}
            ref={confirmText === undefined ? (el => { firstRef.current = el; }) : undefined}
          >
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={blocked}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
