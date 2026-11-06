import { useState } from 'react';
import { TextField, type TextFieldProps } from '../TextField';
import { formatDuration, parseDuration } from '../format';

export type DurationFieldProps = Omit<TextFieldProps, 'value' | 'defaultValue' | 'onChange' | 'mono'> & {
  minutes: number | null;
  onChange?: (minutes: number | null) => void;
};

/** Entered and displayed as h:mm; "6.5" normalises to 6:30 on blur. */
export function DurationField({ minutes, onChange, error, ...rest }: DurationFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft != null && draft.trim() !== '' && parseDuration(draft) == null;
  return (
    <TextField
      {...rest}
      mono
      placeholder={rest.placeholder ?? '0:00'}
      suffix={rest.suffix ?? 'h:mm'}
      error={error ?? (invalid ? 'Use h:mm, for example 6:30' : undefined)}
      value={draft ?? (minutes == null ? '' : formatDuration(minutes))}
      onChange={(e) => { setDraft(e.target.value); onChange?.(parseDuration(e.target.value)); }}
      onBlur={() => { if (!invalid) setDraft(null); }}
    />
  );
}
