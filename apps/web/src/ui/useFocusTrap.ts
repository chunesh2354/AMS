import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isShown = (el: HTMLElement) => {
  if (el.closest('[hidden]')) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
};

/** Traps Tab inside a container while active and restores focus on release. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isShown);
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0] ?? root;
    target.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement;
      if (e.shiftKey && (current === first || !root.contains(current))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (current === last || !root.contains(current))) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => { root.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [ref, active]);
}
