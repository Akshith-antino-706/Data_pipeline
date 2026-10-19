import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon-only button. Pass an aria-label. */
  icon?: boolean;
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', icon = false, extra?: string): string {
  return [
    'ui-btn',
    variant !== 'secondary' ? `ui-btn--${variant}` : '',
    size !== 'md' ? `ui-btn--${size}` : '',
    icon ? 'ui-btn--icon' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon = false, className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, icon, className)} {...rest} />;
});
