import type { ChartColor } from '../MiniChart';

export type BarSegment = { label: string; value: number; display: string; color: ChartColor };

/** Added for the Receivables ageing header: one bar split by share, with amounts in the legend. */
export function SegmentedBar({ label, segments }: { label: string; segments: BarSegment[] }) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className="segbar">
      <div className="segbar__track" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.display}`).join(', ')}`}>
        {shown.map((s) => <span key={s.label} className="segbar__seg" style={{ flexGrow: s.value, flexBasis: 0, background: `var(--${s.color})` }} />)}
      </div>
      <dl className="segbar__legend">
        {segments.map((s) => (
          <div key={s.label}>
            <dt><i className="bar__sw" style={{ background: `var(--${s.color})` }} />{s.label}</dt>
            <dd className="t-numeric">{s.display}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
