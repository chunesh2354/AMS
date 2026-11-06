import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Placement } from '@floating-ui/react-dom';
import { Popover, type PopoverProps } from '../Popover';
import { cx } from '../cx';

export type MenuItem =
  | { type?: 'item'; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect?: () => void }
  | { type: 'separator' }
  | { type: 'heading'; label: string };

export type MenuProps = { trigger: PopoverProps['trigger']; items: MenuItem[]; label: string; placement?: Placement; defaultOpen?: boolean };

function MenuBody({ items, close }: { items: MenuItem[]; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus(); }, []);
  const onKey = (e: KeyboardEvent) => {
    const list = Array.from(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    if (e.key === 'Tab') close();
  };
  return (
    <div ref={root} className="menu" onKeyDown={onKey}>
      {items.map((item, i) => {
        if (item.type === 'separator') return <div key={i} role="separator" className="menu__sep" />;
        if (item.type === 'heading') return <div key={i} role="presentation" className="menu__head">{item.label}</div>;
        return (
          <button
            key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
            className={cx('menu__item', item.danger && 'menu__item--danger')}
            onClick={() => { close(); item.onSelect?.(); }}
          >
            {item.icon}{item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Menu({ trigger, items, label, placement, defaultOpen }: MenuProps) {
  return (
    <Popover trigger={trigger} placement={placement} haspopup="menu" role="menu" label={label} defaultOpen={defaultOpen}>
      {(close) => <MenuBody items={items} close={close} />}
    </Popover>
  );
}
