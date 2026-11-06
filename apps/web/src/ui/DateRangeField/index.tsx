import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Popover } from '../Popover';
import { Field, type FieldBaseProps } from '../Field';
import { Calendar } from '../DateField';
import { formatDate } from '../format';

export type DateRange = { from: string | null; to: string | null };
export type DateRangeFieldProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  value: DateRange;
  onChange?: (range: DateRange) => void;
  min?: string;
  max?: string;
  holidays?: string[];
  today?: string;
  defaultOpen?: boolean;
};

/** First click sets the start, second sets the end; an earlier second click restarts the range. */
export function DateRangeField({ value, onChange, min, max, holidays, today, defaultOpen, ...field }: DateRangeFieldProps) {
  const [draft, setDraft] = useState<DateRange | null>(null);
  const shown = draft ?? value;
  return (
    <Field {...field}>
      {(p) => (
        <Popover
          defaultOpen={defaultOpen}
          label={`${field.label} calendar`}
          onOpenChange={(o) => { if (!o) setDraft(null); }}
          trigger={(t) => (
            <button {...p} {...t} type="button" className="field__trigger" disabled={field.disabled || field.readOnly}>
              <CalendarRange size={16} strokeWidth={1.5} aria-hidden />
              {value.from
                ? <span className="t-numeric">{formatDate(value.from)}{value.to ? ` to ${formatDate(value.to)}` : ''}</span>
                : <span className="field__placeholder">Select dates</span>}
            </button>
          )}
        >
          {(close) => (
            <Calendar
              selected={shown.from} rangeEnd={shown.to} min={min} max={max} holidays={holidays} today={today}
              onSelect={(iso) => {
                if (!draft?.from || draft.to || iso < draft.from) { setDraft({ from: iso, to: null }); return; }
                const next = { from: draft.from, to: iso };
                setDraft(null);
                onChange?.(next);
                close();
              }}
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
