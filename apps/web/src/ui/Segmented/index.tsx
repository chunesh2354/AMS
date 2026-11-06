import { useRef, type KeyboardEvent } from 'react';

export type SegmentedProps<T extends string> = { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void };

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    root.current?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
  };
  return (
    <div ref={root} role="radiogroup" aria-label={label} className="segmented" onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} className="segmented__opt" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
