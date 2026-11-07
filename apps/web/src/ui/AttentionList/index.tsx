import { Link } from 'react-router-dom';
import { StatusChip } from '../StatusChip';
import { ListStateBlock, type ListState } from '../ListState';
import { toneOf, type Status, type Tone } from '../status-colors';

export type AttentionRow = { id: string; status: Status; title: string; detail: string; ageDays: number; to?: string };

const RANK: Record<Tone, number> = { danger: 0, warn: 1, info: 2, neutral: 3, ok: 4 };

/** Severity first, then oldest first. */
export const sortAttention = <T extends AttentionRow>(rows: T[]) =>
  [...rows].sort((a, b) => RANK[toneOf(a.status)] - RANK[toneOf(b.status)] || b.ageDays - a.ageDays);

export type AttentionListProps = { title?: string; items: AttentionRow[]; state?: ListState; onRetry?: () => void; emptyMessage?: string; capability?: string };

/** Added for Queue dashboards and Workspaces: a solid list sorted severity then age. */
export function AttentionList({ title = 'Needs attention', items, state = 'ready', onRetry, emptyMessage = 'Nothing needs attention right now.', capability }: AttentionListProps) {
  const effective = state === 'ready' && items.length === 0 ? 'empty' : state;
  return (
    <section className="attention solid-panel" aria-label={title}>
      <header className="attention__head"><h2 className="t-h2">{title}</h2><span className="t-caption ink-2">Severity, then age</span></header>
      {effective !== 'ready'
        ? <div className="attention__state"><ListStateBlock state={effective} label={title} onRetry={onRetry} capability={capability} empty={{ message: emptyMessage }} /></div>
        : <ul>
            {sortAttention(items).map((a) => {
              const body = (
                <>
                  <span className="attention__chip"><StatusChip size="sm" status={a.status} /></span>
                  <span className="attention__main"><span className="attention__title">{a.title}</span><span className="t-caption ink-2">{a.detail}</span></span>
                  <span className="t-numeric ink-2">{a.ageDays} d</span>
                </>
              );
              return <li key={a.id}>{a.to ? <Link to={a.to} className="attention__row">{body}</Link> : <div className="attention__row">{body}</div>}</li>;
            })}
          </ul>}
    </section>
  );
}
