import { CalendarDays } from 'lucide-react';
import { Popover } from '../Popover';
import { Field, type FieldBaseProps } from '../Field';
import { Calendar } from './calendar';
import { formatDate } from '../format';

export { Calendar } from './calendar';

export type DateFieldProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  value: string | null;
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
  holidays?: string[];
  today?: string;
  placeholder?: string;
  defaultOpen?: boolean;
};

export function DateField({ value, onChange, min, max, holidays, today, placeholder = 'Select a date', defaultOpen, ...field }: DateFieldProps) {
  return (
    <Field {...field}>
      {(p) => (
        <Popover
          defaultOpen={defaultOpen}
          label={`${field.label} calendar`}
          trigger={(t) => (
            <button {...p} {...t} type="button" className="field__trigger" disabled={field.disabled || field.readOnly}>
              <CalendarDays size={16} strokeWidth={1.5} aria-hidden />
              {value ? <span className="t-numeric">{formatDate(value)}</span> : <span className="field__placeholder">{placeholder}</span>}
            </button>
          )}
        >
          {(close) => <Calendar selected={value} min={min} max={max} holidays={holidays} today={today} onSelect={(iso) => { onChange?.(iso); close(); }} />}
        </Popover>
      )}
    </Field>
  );
}
