import { useState } from 'react';
import { TextField, type TextFieldProps } from '../TextField';
import { formatGrouped } from '../format';

export type MoneyFieldProps = Omit<TextFieldProps, 'value' | 'defaultValue' | 'onChange' | 'prefix' | 'mono'> & {
  value: number | null;
  onChange?: (value: number | null) => void;
};

/** Shows en-IN grouping at rest and the raw number while editing. */
export function MoneyField({ value, onChange, ...rest }: MoneyFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      {...rest}
      mono
      prefix="₹"
      inputMode="decimal"
      style={{ textAlign: 'right' }}
      value={draft ?? (value == null ? '' : formatGrouped(value))}
      onFocus={() => setDraft(value == null ? '' : String(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const clean = e.target.value.replace(/[^\d.]/g, '');
        setDraft(clean);
        onChange?.(clean === '' ? null : Number(clean));
      }}
    />
  );
}
