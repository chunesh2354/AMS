import { useEffect, useRef } from 'react';
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react-dom';

/** Positions a portalled surface next to a trigger. */
export function useAnchored(open: boolean, placement: Placement = 'bottom-start', gap = 6) {
  return useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
}

/** Calls onClose on Escape and on pointer-down outside the given elements. */
export function useDismiss(open: boolean, onClose: () => void, refs: (() => (Element | null | undefined)[])) {
  const latest = useRef({ onClose, refs });
  latest.current = { onClose, refs };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!latest.current.refs().some((el) => el?.contains(e.target as Node))) latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); latest.current.onClose(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
}
