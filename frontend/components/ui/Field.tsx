'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={['ui-input', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={['ui-input', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
});

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Render prop so the label, help and error are wired to the control by id. */
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, help, error, required, children }: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>
        {label}
        {required && <span className="ui-req" aria-hidden="true"> *</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {help && <span id={helpId} className="ui-help">{help}</span>}
      {error && <span id={errId} className="ui-err" role="alert">{error}</span>}
    </div>
  );
}
