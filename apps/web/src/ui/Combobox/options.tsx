import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export type Option = { value: string; label: string; icon?: ReactNode; meta?: ReactNode; group?: string; keywords?: string };

export const matches = (o: Option, q: string) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());

/** Shared listbox body used by Select, Combobox, MultiSelect and the pickers. */
export function OptionList({ id, options, active, selected, multi, empty, onPick, onHover, label }: {
  id: string; options: Option[]; active: number; selected: string[]; multi?: boolean; empty?: ReactNode;
  onPick: (o: Option) => void; onHover: (i: number) => void; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  if (!options.length) return <div className="options__empty">{empty ?? 'No matches'}</div>;
  let lastGroup: string | undefined;
  return (
    <div ref={ref} id={id} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="options">
      {options.map((o, i) => {
        const head = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        const sel = selected.includes(o.value);
        return (
          <div key={o.value} role="presentation">
            {head && <div className="options__group" role="presentation">{head}</div>}
            <div
              id={`${id}-${i}`} role="option" aria-selected={sel} data-active={i === active}
              className="option"
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(o)}
            >
              {o.icon}<span>{o.label}</span>{o.meta && <span className="ink-2 t-caption">{o.meta}</span>}
              {sel && <Check size={16} strokeWidth={1.5} className="option__check" aria-hidden />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function nextIndex(key: string, i: number, len: number) {
  if (!len) return -1;
  if (key === 'ArrowDown') return (i + 1) % len;
  if (key === 'ArrowUp') return (i - 1 + len) % len;
  if (key === 'Home') return 0;
  if (key === 'End') return len - 1;
  return i;
}
