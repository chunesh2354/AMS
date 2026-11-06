import type { TextareaHTMLAttributes } from 'react';
import { Field, type FieldBaseProps } from '../Field';

export type TextAreaProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ label, helper, error, dense, ...input }: TextAreaProps) {
  return (
    <Field {...{ label, helper, error, dense }} disabled={input.disabled} readOnly={input.readOnly}>
      {(p) => <textarea rows={3} {...p} {...input} className="field__input" />}
    </Field>
  );
}
