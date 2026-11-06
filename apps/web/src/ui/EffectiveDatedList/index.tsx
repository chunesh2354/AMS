import type { ReactNode } from 'react';
import { formatDate } from '../format';

export type EffectiveVersion = { from: string; to?: string | null; label: ReactNode; detail?: ReactNode };
export type EffectiveDatedListProps = { versions: EffectiveVersion[]; current: number };

/** Vertical timeline, oldest first: past muted, current highlighted, future dashed. */
export function EffectiveDatedList({ versions, current }: EffectiveDatedListProps) {
  return (
    <ol className="edl">
      {versions.map((v, i) => {
        const state = i === current ? 'current' : i < current ? 'past' : 'future';
        return (
          <li key={v.from} className={`edl__item edl__item--${state}`} aria-current={i === current ? 'true' : undefined}>
            <span className="edl__mark" aria-hidden />
            <span className="edl__dates">{formatDate(v.from)} to {v.to ? formatDate(v.to) : 'open'}</span>
            <span className={state === 'current' ? 't-h3' : 't-body'}>{v.label}</span>
            {v.detail && <span className="t-caption ink-2">{v.detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}
