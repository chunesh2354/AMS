import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; description?: ReactNode };

export function Toggle({ label, description, ...input }: ToggleProps) {
  return (
    <label className={cx('check', input.disabled && 'check--disabled')}>
      <input {...input} type="checkbox" role="switch" />
      <span className="switch" aria-hidden />
      <span className="check__text"><span>{label}</span>{description && <span className="check__desc">{description}</span>}</span>
    </label>
  );
}
