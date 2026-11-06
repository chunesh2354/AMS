import type { InputHTMLAttributes } from 'react';
import { Field, type FieldBaseProps } from '../Field';
import { cx } from '../cx';

export type TextFieldProps = FieldBaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { mono?: boolean };

export function TextField({ label, helper, error, prefix, suffix, dense, mono, className, ...input }: TextFieldProps) {
  return (
    <Field {...{ label, helper, error, prefix, suffix, dense }} disabled={input.disabled} readOnly={input.readOnly}>
      {(p) => <input {...p} {...input} className={cx('field__input', mono && 'field__input--mono', className)} />}
    </Field>
  );
}
