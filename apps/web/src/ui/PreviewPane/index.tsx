import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';

export type PreviewPaneProps = {
  state?: 'ready' | 'loading' | 'empty';
  eyebrow?: string;
  title?: string;
  fields?: { label: string; value: ReactNode; mono?: boolean }[];
  alert?: ReactNode;
  evidence?: string[];
  history?: { text: string; time: string }[];
  actions?: ReactNode;
};

/** Glass summary beside a list: record, evidence and history. */
export function PreviewPane({ state = 'ready', eyebrow, title, fields = [], alert, evidence = [], history = [], actions }: PreviewPaneProps) {
  if (state === 'loading') return <aside className="preview glass" aria-label="Preview"><div className="skeleton-stack"><Skeleton width="40%" /><Skeleton width="70%" /><Skeleton kind="card" /></div></aside>;
  if (state === 'empty') return <aside className="preview glass" aria-label="Preview"><EmptyState message="Select an item to preview it." /></aside>;
  return (
    <aside className="preview glass" aria-label="Preview">
      <div><p className="t-label ink-2">{eyebrow}</p><h2 className="t-h2" style={{ marginTop: 'var(--s-1)' }}>{title}</h2></div>
      <dl className="preview__fields">
        {fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd className={f.mono ? 't-numeric' : undefined}>{f.value}</dd></div>)}
      </dl>
      {alert}
      {evidence.length > 0 && (
        <section aria-label="Evidence">
          <h3 className="t-label ink-2">Evidence</h3>
          <ul className="preview__evidence">{evidence.map((e) => <li key={e} className="preview__thumb"><FileText size={16} strokeWidth={1.5} aria-hidden />{e}</li>)}</ul>
        </section>
      )}
      {history.length > 0 && (
        <section aria-label="History">
          <h3 className="t-label ink-2">History</h3>
          <ul className="preview__history">{history.map((h) => <li key={h.text}><span>{h.text}</span><span className="t-numeric ink-2">{h.time}</span></li>)}</ul>
        </section>
      )}
      {actions && <div className="preview__actions">{actions}</div>}
    </aside>
  );
}
