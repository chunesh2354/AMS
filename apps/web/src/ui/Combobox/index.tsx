import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Field, type FieldBaseProps } from '../Field';
import { useAnchored, useDismiss } from '../useAnchored';
import { OptionList, matches, nextIndex, type Option } from './options';

export type { Option } from './options';
export { OptionList, matches, nextIndex } from './options';

export type ComboboxProps = FieldBaseProps & {
  options: Option[];
  value: string | null;
  onChange?: (value: string | null) => void;
  onCreate?: (text: string) => void;
  placeholder?: string;
  empty?: ReactNode;
  defaultOpen?: boolean;
  /** Options to show before typing, such as recents. */
  initial?: Option[];
};

/** Type to filter. Arrow keys move, Enter picks, Escape closes; can offer a create option. */
export function Combobox({ options, value, onChange, onCreate, placeholder, empty, defaultOpen = false, initial, ...field }: ComboboxProps) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const { refs, floatingStyles, x } = useAnchored(open, 'bottom-start');
  const typed = (query ?? '').trim();
  const base = !typed && initial ? initial : options;
  const filtered = typed ? base.filter((o) => matches(o, typed)) : base;
  const canCreate = onCreate && typed && !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  const list: Option[] = canCreate ? [...filtered, { value: '__create', label: `Create "${typed}"` }] : filtered;
  const close = () => { setOpen(false); setQuery(null); };
  useDismiss(open, close, () => [input.current?.closest('.field__control'), refs.floating.current]);
  const pick = (o: Option) => {
    if (o.value === '__create') onCreate?.(typed); else onChange?.(o.value);
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!open) setOpen(true); else setActive(nextIndex(e.key, active, list.length));
    } else if (e.key === 'Enter' && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    }
  };
  return (
    <Field {...field}>
      {(p) => (
        <>
          <input
            {...p}
            ref={(el) => { input.current = el; refs.setReference(el?.closest('.field__control') ?? null); }}
            role="combobox" aria-expanded={open} aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && list[active] ? `${listId}-${active}` : undefined}
            className="field__input" autoComplete="off" placeholder={placeholder}
            disabled={field.disabled} readOnly={field.readOnly}
            value={query ?? selected?.label ?? ''}
            onFocus={() => { if (!field.readOnly) setOpen(true); }}
            onClick={() => { if (!field.readOnly) setOpen(true); }}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
            onKeyDown={onKey}
          />
          {open && createPortal(
            <div ref={refs.setFloating} className="popover glass glass--elevated" style={{ ...floatingStyles, visibility: x == null ? 'hidden' : undefined, minWidth: refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : undefined }}>
              <OptionList id={listId} label={field.label} options={list} active={active} selected={value ? [value] : []} empty={empty} onPick={pick} onHover={setActive} />
            </div>,
            document.body,
          )}
        </>
      )}
    </Field>
  );
}
