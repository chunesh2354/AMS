import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { Field, type FieldBaseProps } from '../Field';
import { useAnchored, useDismiss } from '../useAnchored';
import { OptionList, matches, nextIndex, type Option } from '../Combobox';

export type SelectProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  options: Option[];
  value: string | null;
  onChange?: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  defaultOpen?: boolean;
};

export function Select({ options, value, onChange, placeholder = 'Select', searchable, defaultOpen = false, ...field }: SelectProps) {
  const selected = options.find((o) => o.value === value);
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(Math.max(0, options.findIndex((o) => o.value === value)));
  const [q, setQ] = useState('');
  const id = useId();
  const btn = useRef<HTMLButtonElement | null>(null);
  const { refs, floatingStyles, x } = useAnchored(open, 'bottom-start');
  const list = q ? options.filter((o) => matches(o, q)) : options;
  const close = () => { setOpen(false); setQ(''); btn.current?.focus(); };
  useDismiss(open, close, () => [btn.current, refs.floating.current]);
  const pick = (o: Option) => { onChange?.(o.value); close(); };
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!open) setOpen(true); else setActive(nextIndex(e.key, active, list.length));
    } else if ((e.key === 'Enter' || (e.key === ' ' && !searchable)) && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    }
  };
  return (
    <Field {...field}>
      {(p) => (
        <>
          <button
            {...p}
            ref={(el) => { btn.current = el; refs.setReference(el); }}
            type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox"
            aria-controls={open ? id : undefined}
            aria-activedescendant={open && list[active] ? `${id}-${active}` : undefined}
            className="field__trigger" disabled={field.disabled || field.readOnly}
            onClick={() => (open ? close() : setOpen(true))}
            onKeyDown={onKey}
          >
            {selected?.icon}
            {selected ? <span>{selected.label}</span> : <span className="field__placeholder">{placeholder}</span>}
            <ChevronDown size={16} strokeWidth={1.5} style={{ marginLeft: 'auto' }} aria-hidden />
          </button>
          {open && createPortal(
            <div ref={refs.setFloating} className="popover glass glass--elevated" style={{ ...floatingStyles, visibility: x == null ? 'hidden' : undefined, minWidth: btn.current?.offsetWidth }}>
              {searchable && (
                <div style={{ padding: 'var(--s-2)' }}>
                  <input
                    autoFocus aria-label={`Search ${field.label}`} className="field__input" placeholder="Search"
                    value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
                  />
                </div>
              )}
              <OptionList id={id} label={field.label} options={list} active={active} selected={value ? [value] : []} onPick={pick} onHover={setActive} />
            </div>,
            document.body,
          )}
        </>
      )}
    </Field>
  );
}
