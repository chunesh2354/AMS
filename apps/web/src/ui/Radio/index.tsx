import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; description?: ReactNode };

export function Radio({ label, description, ...input }: RadioProps) {
  return (
    <label className={cx('check', input.disabled && 'check--disabled')}>
      <input {...input} type="radio" />
      <span className="check__box check__box--radio" aria-hidden><span className="check__dot" /></span>
      <span className="check__text"><span>{label}</span>{description && <span className="check__desc">{description}</span>}</span>
    </label>
  );
}
