import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

export type FieldBaseProps = {
  label: string;
  helper?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  dense?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
};

export type FieldRenderProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };

/** Shared label, helper, error and affix shell for every form field. */
export function Field({ label, helper, error, prefix, suffix, dense, disabled, readOnly, id: idProp, children }: FieldBaseProps & { id?: string; children: (p: FieldRenderProps) => ReactNode }) {
  const auto = useId();
  const id = idProp ?? auto;
  const noteId = `${id}-note`;
  const note = error ?? helper;
  return (
    <div className={cx('field', dense && 'field--dense', error && 'field--error', disabled && 'field--disabled', readOnly && 'field--readonly')}>
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="field__control">
        {prefix && <span className="field__affix">{prefix}</span>}
        {children({ id, 'aria-describedby': note ? noteId : undefined, 'aria-invalid': error ? true : undefined })}
        {suffix && <span className="field__affix">{suffix}</span>}
      </div>
      {note && <p id={noteId} className={error ? 'field__error' : 'field__help'}>{note}</p>}
    </div>
  );
}
