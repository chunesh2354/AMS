import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Field, type FieldBaseProps } from '../Field';
import { useAnchored, useDismiss } from '../useAnchored';
import { OptionList, matches, nextIndex, type Option } from '../Combobox';

export type MultiSelectProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  options: Option[];
  value: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  empty?: ReactNode;
  defaultOpen?: boolean;
};

export function MultiSelect({ options, value, onChange, placeholder = 'Search', empty, defaultOpen = false, ...field }: MultiSelectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const control = useRef<HTMLElement | null>(null);
  const { refs, floatingStyles, x } = useAnchored(open, 'bottom-start');
  const list = q ? options.filter((o) => matches(o, q)) : options;
  useDismiss(open, () => setOpen(false), () => [control.current, refs.floating.current]);
  const toggle = (o: Option) => onChange?.(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]);
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!open) setOpen(true); else setActive(nextIndex(e.key, active, list.length));
    } else if (e.key === 'Enter' && open && list[active]) {
      e.preventDefault();
      toggle(list[active]);
    } else if (e.key === 'Backspace' && !q && value.length) {
      onChange?.(value.slice(0, -1));
    }
  };
  return (
    <Field {...field}>
      {(p) => (
        <div
          ref={(el) => { control.current = el?.closest('.field__control') as HTMLElement | null; refs.setReference(control.current); }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-1)', flex: 1, alignItems: 'center', padding: 'var(--s-1) 0' }}
        >
          {options.filter((o) => value.includes(o.value)).map((o) => (
            <span key={o.value} className="tag">
              {o.label}
              {!field.disabled && !field.readOnly && (
                <button type="button" aria-label={`Remove ${o.label}`} onClick={() => toggle(o)}><X size={14} strokeWidth={1.5} aria-hidden /></button>
              )}
            </span>
          ))}
          <input
            {...p}
            role="combobox" aria-expanded={open} aria-autocomplete="list"
            aria-controls={open ? id : undefined}
            aria-activedescendant={open && list[active] ? `${id}-${active}` : undefined}
            className="field__input" style={{ flexBasis: 80, minHeight: 24 }} autoComplete="off" placeholder={value.length ? '' : placeholder}
            disabled={field.disabled} readOnly={field.readOnly} value={q}
            onFocus={() => { if (!field.readOnly) setOpen(true); }}
            onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
            onKeyDown={onKey}
          />
          {open && createPortal(
            <div ref={refs.setFloating} className="popover glass glass--elevated" style={{ ...floatingStyles, visibility: x == null ? 'hidden' : undefined }}>
              <OptionList id={id} label={field.label} multi options={list} active={active} selected={value} empty={empty} onPick={toggle} onHover={setActive} />
            </div>,
            document.body,
          )}
        </div>
      )}
    </Field>
  );
}
