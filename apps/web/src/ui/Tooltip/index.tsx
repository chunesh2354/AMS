import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Placement } from '@floating-ui/react-dom';
import { useAnchored } from '../useAnchored';

export type TooltipProps = { text: ReactNode; side?: Placement; defaultOpen?: boolean; children: ReactElement };

/** Glass elevated, 8 px padding. Opens on hover and keyboard focus, closes on blur or Escape. */
export function Tooltip({ text, side = 'top', defaultOpen = false, children }: TooltipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const { refs, floatingStyles } = useAnchored(open, side);
  const child = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-describedby': open ? id : undefined })
    : children;
  return (
    <span
      ref={refs.setReference}
      className="tip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(defaultOpen)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(defaultOpen)}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      {child}
      {open && createPortal(
        <span ref={refs.setFloating} id={id} role="tooltip" className="tooltip glass glass--elevated" style={floatingStyles}>{text}</span>,
        document.body,
      )}
    </span>
  );
}
