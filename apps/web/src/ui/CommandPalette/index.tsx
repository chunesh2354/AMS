import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { Skeleton } from '../Skeleton';
import { useFocusTrap } from '../useFocusTrap';

export type PaletteAction = { id: string; label: string; group: string; meta?: string; keywords?: string; icon?: ReactNode; onSelect: () => void };

export type CommandPaletteProps = { open: boolean; onClose: () => void; actions: PaletteAction[]; loading?: boolean };

/** Subsequence match. Consecutive letters and word starts score higher; 0 means no match. */
export function fuzzyScore(query: string, text: string) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 1;
  let from = 0; let score = 0; let run = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return 0;
    run = i === from ? run + 1 : 0;
    score += 1 + run + (i === 0 || t[i - 1] === ' ' ? 2 : 0);
    from = i + 1;
  }
  return score;
}

/** Ctrl K or Cmd K anywhere opens the palette. */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpen(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

function Body({ onClose, actions, loading }: Omit<CommandPaletteProps, 'open'>) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useFocusTrap(panel, true);

  const results = useMemo(() => {
    if (!query.trim()) return actions;
    return actions
      .map((a) => ({ a, s: Math.max(fuzzyScore(query, a.label), fuzzyScore(query, a.keywords ?? '') * 0.5) }))
      .filter((r) => r.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((r) => r.a);
  }, [actions, query]);

  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (a?: PaletteAction) => { if (a) { onClose(); a.onSelect(); } };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  const hasResults = !loading && results.length > 0;
  let lastGroup: string | null = null;
  return (
    <>
      <div className="palette-scrim" onClick={onClose} />
      <div ref={panel} className="palette glass glass--elevated" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette__input">
          <Search size={20} strokeWidth={1.5} aria-hidden />
          <input
            role="combobox" aria-expanded={hasResults} aria-controls={hasResults ? listId : undefined} aria-autocomplete="list" aria-label="Search actions, people and projects"
            aria-activedescendant={hasResults && results[active] ? `${listId}-${active}` : undefined}
            placeholder="Search actions, people and projects" value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          />
        </div>
        <div ref={listRef} id={hasResults ? listId : undefined} role={hasResults ? 'listbox' : undefined} aria-label={hasResults ? 'Results' : undefined} className="palette__list">
          {loading && <div style={{ padding: 'var(--s-3)' }} className="skeleton-stack"><Skeleton width="70%" /><Skeleton width="50%" /><Skeleton width="60%" /></div>}
          {!loading && results.length === 0 && <p className="palette__state" role="status">No matches. Try a name, a project code or an action.</p>}
          {!loading && results.map((a, i) => {
            const head = !query.trim() && a.group !== lastGroup ? a.group : null;
            lastGroup = a.group;
            return (
              <div key={a.id} role="presentation">
                {head && <div className="palette__group" role="presentation">{head}</div>}
                <div
                  id={`${listId}-${i}`} role="option" aria-selected={i === active} className="palette__item"
                  onMouseEnter={() => setActive(i)} onClick={() => choose(a)}
                >
                  {a.icon}<span>{a.label}</span>{a.meta && <span className="palette__meta">{a.meta}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette__foot" aria-hidden><span><kbd>↑ ↓</kbd> Move</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
      </div>
    </>
  );
}

export function CommandPalette({ open, ...rest }: CommandPaletteProps) {
  if (!open) return null;
  return createPortal(<Body {...rest} />, document.body);
}
