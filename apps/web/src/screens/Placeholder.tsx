import { useParams } from 'react-router-dom';
import { Hammer } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { PageHeader, type Crumb } from '../ui/PageHeader';

const CANVAS = 'https://claude.ai/artifact/FZa2sjKqkXFMfsa2q6JsUg';

export type PlaceholderProps = { title: string; task: string; crumbs?: Crumb[]; embedded?: boolean };

/** Holds a route until its task ships, so every path is navigable through the real shell. */
export function Placeholder({ title, task, crumbs, embedded }: PlaceholderProps) {
  const { id, key } = useParams();
  const suffix = id ?? key;
  return (
    <>
      {!embedded && <PageHeader title={suffix ? `${title} · ${suffix}` : title} breadcrumb={crumbs} />}
      <div className="solid-panel">
        <EmptyState
          icon={<Hammer size={20} strokeWidth={1.5} aria-hidden />}
          message={`This screen is built in ${task}.`}
          action={<a href={CANVAS} target="_blank" rel="noreferrer">See the design on the canvas</a>}
        />
      </div>
    </>
  );
}
