import { Tooltip } from '../Tooltip';

export type ChartColor = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral';
export type ChartDatum = { label: string; value: number; color?: ChartColor; display?: string };
export type MiniChartProps = { kind: 'bar' | 'line' | 'donut'; label: string; data: ChartDatum[] };

const fill = (c: ChartColor = 'accent') => `var(--${c})`;
const show = (d: ChartDatum) => d.display ?? String(d.value);

function Bars({ data }: { data: ChartDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 100 / data.length;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, borderBottom: '1px solid var(--line-strong)' }}>
        {data.map((d) => (
          <Tooltip key={d.label} text={`${d.label}: ${show(d)}`}>
            <span
              tabIndex={0} role="img" aria-label={`${d.label}: ${show(d)}`} className="chart__mark"
              style={{ display: 'block', width: `${w}%`, flex: 1, minWidth: 4, maxWidth: 24, height: `${(d.value / max) * 80}px`, background: fill(d.color), borderRadius: '4px 4px 0 0' }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function Line({ data }: { data: ChartDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 240; const H = 80;
  const x = (i: number) => (data.length === 1 ? 0 : (i / (data.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 6) - 2;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="var(--line-strong)" />
      <polyline points={pts} fill="none" stroke={fill(data[0]?.color)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={d.label} cx={x(i)} cy={y(d.value)} r={3} fill={fill(d.color)} stroke="var(--surface)" strokeWidth={1}><title>{`${d.label}: ${show(d)}`}</title></circle>
      ))}
    </svg>
  );
}

function Donut({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 40; const C = 2 * Math.PI * R; const gap = data.filter((d) => d.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="chart__donut">
      <svg viewBox="0 0 112 112" aria-hidden>
        <circle cx={56} cy={56} r={R} fill="none" stroke="var(--neutral-soft)" strokeWidth={12} />
        {data.filter((d) => d.value > 0).map((d) => {
          const len = (d.value / total) * C;
          const seg = (
            <circle key={d.label} className="chart__mark" cx={56} cy={56} r={R} fill="none" stroke={fill(d.color)} strokeWidth={12}
              strokeDasharray={`${Math.max(len - gap, 1)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 56 56)">
              <title>{`${d.label}: ${show(d)}`}</title>
            </circle>
          );
          offset += len;
          return seg;
        })}
      </svg>
      <ul className="chart__legend">
        {data.map((d) => (
          <li key={d.label} className="chart__row">
            <span><i className="bar__sw" style={{ background: fill(d.color) }} />{d.label}</span><b>{show(d)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small inline charts. Colour comes only from accent, ok, warn, danger and neutral; text stays in ink. */
export function MiniChart({ kind, label, data }: MiniChartProps) {
  return (
    <figure className="chart" role="group" aria-label={label}>
      {kind !== 'bar' && <span className="sr-only">{data.map((d) => `${d.label}: ${show(d)}`).join(', ')}</span>}
      {kind === 'bar' && <Bars data={data} />}
      {kind === 'line' && <Line data={data} />}
      {kind === 'donut' && <Donut data={data} />}
    </figure>
  );
}
