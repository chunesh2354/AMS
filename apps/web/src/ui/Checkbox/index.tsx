import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cx } from '../cx';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hideLabel?: boolean; description?: ReactNode; indeterminate?: boolean };

export function Checkbox({ label, hideLabel, description, indeterminate, ...input }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label className={cx('check', input.disabled && 'check--disabled')}>
      <input ref={ref} {...input} type="checkbox" />
      <span className="check__box" aria-hidden>
        {indeterminate ? <Minus size={12} strokeWidth={2.5} /> : (input.checked ?? input.defaultChecked) ? <Check size={12} strokeWidth={2.5} /> : null}
      </span>
      <span className={hideLabel ? 'sr-only' : 'check__text'}><span>{label}</span>{description && <span className="check__desc">{description}</span>}</span>
    </label>
  );
}
