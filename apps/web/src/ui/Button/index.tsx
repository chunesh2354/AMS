import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from '../cx';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'dense' | 'default' | 'cta';
  icon?: ReactNode;
  loading?: boolean;
};

export function Button({ variant = 'secondary', size = 'default', icon, loading, disabled, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, size !== 'default' && `btn--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={16} strokeWidth={1.5} className="btn__spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
