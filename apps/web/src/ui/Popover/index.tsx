import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Placement } from '@floating-ui/react-dom';
import { useAnchored, useDismiss } from '../useAnchored';
import { cx } from '../cx';

type TriggerProps = { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog' | 'menu' | 'listbox' };

export type PopoverProps = {
  trigger: (p: TriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  haspopup?: TriggerProps['aria-haspopup'];
  label?: string;
  role?: string;
};

/** Elevated glass, portalled. Escape and outside click close it; focus returns to the trigger. */
export function Popover({ trigger, children, placement, open: controlled, defaultOpen = false, onOpenChange, haspopup = 'dialog', label, role = 'dialog' }: PopoverProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const triggerEl = useRef<HTMLElement | null>(null);
  const { refs, floatingStyles } = useAnchored(open, placement);
  const set = (next: boolean) => { setInner(next); onOpenChange?.(next); };
  const close = () => { set(false); triggerEl.current?.focus(); };
  useDismiss(open, close, () => [triggerEl.current, refs.floating.current]);
  return (
    <>
      {trigger({
        ref: (el) => { triggerEl.current = el; refs.setReference(el); },
        onClick: () => set(!open),
        'aria-expanded': open,
        'aria-haspopup': haspopup,
      })}
      {open && createPortal(
        <div ref={refs.setFloating} role={role} aria-label={label} className={cx('popover glass glass--elevated')} style={floatingStyles}>
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  );
}
