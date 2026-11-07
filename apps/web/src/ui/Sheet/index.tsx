import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { useFocusTrap } from '../useFocusTrap';
import { cx } from '../cx';

const DURATION = 200;

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: 480 | 640;
  footer?: ReactNode;
  /** When true, closing asks for confirmation first. */
  dirty?: boolean;
  children: ReactNode;
};

/** Right-hand elevated glass sheet. Traps focus, closes on Escape, restores focus, guards unsaved changes. */
export function Sheet({ open, onClose, title, description, size = 480, footer, dirty, children }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      setConfirming(false);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setMounted(false), reduced ? 0 : DURATION);
    return () => clearTimeout(t);
  }, [open]);

  useFocusTrap(panel, mounted && open);
  useEffect(() => {
    if (mounted && open) body.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, [mounted, open]);

  const requestClose = () => { if (dirty) setConfirming(true); else onClose(); };

  useEffect(() => {
    if (!mounted || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false); else if (dirty) setConfirming(true); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, open, confirming, dirty, onClose]);

  if (!mounted) return null;
  const state = shown ? 'open' : 'closed';
  return createPortal(
    <>
      <div className="sheet-scrim" data-state={state} onClick={requestClose} />
      <div
        ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}
        className={cx('sheet glass glass--elevated', size === 640 && 'sheet--640')} data-state={state}
      >
        <div className="sheet__head">
          <div>
            <h2 id={titleId} className="t-h2">{title}</h2>
            {description && <p id={descId} className="sheet__desc">{description}</p>}
          </div>
          <IconButton label="Close" icon={<X size={20} strokeWidth={1.5} aria-hidden />} onClick={requestClose} />
        </div>
        <div ref={body} className="sheet__body">{children}</div>
        <div className="sheet__foot">
          {confirming
            ? <div role="alertdialog" aria-label="Unsaved changes" style={{ display: 'contents' }}>
                <p className="sheet__confirm">Discard unsaved changes?</p>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Keep editing</Button>
                <Button variant="danger" onClick={() => { setConfirming(false); onClose(); }}>Discard</Button>
              </div>
            : footer}
        </div>
      </div>
    </>,
    document.body,
  );
}
