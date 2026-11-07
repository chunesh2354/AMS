import { useState, type ReactNode } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Menu } from '../Menu';
import { cx } from '../cx';

export type BoardColumn<T> = { key: string; label: string; items: T[]; emptyText?: string };
export type KanbanBoardProps<T> = {
  label: string;
  columns: BoardColumn<T>[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onOpen?: (item: T) => void;
  onMove?: (item: T, toColumn: string) => void;
};

/**
 * Added for the Pipeline and Tasks boards (section 8): 280 px glass columns on the plane, solid cards inside.
 * Cards drag between columns; the Move menu does the same from the keyboard.
 */
export function KanbanBoard<T>({ label, columns, itemKey, itemLabel, renderCard, onOpen, onMove }: KanbanBoardProps<T>) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const all = columns.flatMap((c) => c.items);
  return (
    <div className="board" tabIndex={0} role="region" aria-label={label}>
      {columns.map((c) => (
        <section
          key={c.key} aria-label={`${c.label}, ${c.items.length}`}
          className={cx('board__col glass', over === c.key && 'board__col--over')}
          onDragOver={onMove ? (e) => { e.preventDefault(); setOver(c.key); } : undefined}
          onDragLeave={onMove ? () => setOver((o) => (o === c.key ? null : o)) : undefined}
          onDrop={onMove ? (e) => {
            e.preventDefault();
            setOver(null);
            const k = e.dataTransfer.getData('text/plain') || dragKey;
            const item = all.find((i) => itemKey(i) === k);
            if (item) onMove(item, c.key);
          } : undefined}
        >
          <header className="board__head"><h3 className="t-h3">{c.label}</h3><span className="t-numeric ink-2">{c.items.length}</span></header>
          {c.items.length === 0
            ? <p className="board__empty t-body-sm ink-2">{c.emptyText ?? 'Nothing here.'}</p>
            : (
              <ul className="board__list">
                {c.items.map((item) => {
                  const k = itemKey(item);
                  return (
                    <li
                      key={k} className={cx('bcard', dragKey === k && 'bcard--dragging')} draggable={!!onMove}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'move'; setDragKey(k); }}
                      onDragEnd={() => { setDragKey(null); setOver(null); }}
                    >
                      <button type="button" className="bcard__open" onClick={() => onOpen?.(item)}>{renderCard(item)}</button>
                      {onMove && (
                        <span className="bcard__move">
                          <Menu
                            label={`Move ${itemLabel(item)}`} placement="bottom-end"
                            items={[{ type: 'heading', label: 'Move to' }, ...columns.filter((x) => x.key !== c.key).map((x) => ({ label: x.label, onSelect: () => onMove(item, x.key) }))]}
                            trigger={(p) => <button {...p} type="button" aria-label={`Move ${itemLabel(item)}`} className="icon-btn icon-btn--dense"><ArrowRightLeft size={16} strokeWidth={1.5} aria-hidden /></button>}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      ))}
    </div>
  );
}
