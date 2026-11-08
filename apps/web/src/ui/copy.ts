import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copies text to the clipboard. Tries the async Clipboard API first; where that is missing or blocked
 * (an insecure origin, a permissions policy, a browser setting), falls back to a hidden textarea and
 * document.execCommand('copy'). Resolves true when one of them reported success, false otherwise. Never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked: try the fallback below.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
    active?.focus?.();
  }
}

/** Selects all of an input's text, so the person can press Ctrl+C themselves. */
export function selectAll(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return;
  el.focus();
  el.select();
}

export const COPY_BLOCKED = 'Copy blocked by the browser. The link is selected; press Ctrl+C.';
export type CopyState = 'idle' | 'copied' | 'blocked';

/**
 * Copy with visible feedback: 'copied' for resetMs after a success; 'blocked' after a failure, with the field's
 * text selected (pass the field's id) so Ctrl+C works.
 */
export function useCopy(resetMs = 2000) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string, fieldId?: string) => {
    const ok = await copyText(text);
    clearTimeout(timer.current);
    if (ok) {
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), resetMs);
    } else {
      setState('blocked');
      if (fieldId) selectAll(document.getElementById(fieldId) as HTMLInputElement | null);
    }
    return ok;
  }, [resetMs]);
  const reset = useCallback(() => { clearTimeout(timer.current); setState('idle'); }, []);
  return { state, copy, reset };
}
