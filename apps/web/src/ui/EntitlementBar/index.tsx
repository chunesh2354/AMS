import { formatINR } from '../format';

export type EntitlementBarProps = { contracted: number; entitled: number; drafted: number; invoiced: number; collected: number };

/** Five stacked segments, neutral to ok. Each figure is cumulative and sits in the legend. */
export function EntitlementBar({ contracted, entitled, drafted, invoiced, collected }: EntitlementBarProps) {
  const segs = [
    { key: 'Collected', value: collected, width: collected, ramp: 5 },
    { key: 'Invoiced', value: invoiced, width: invoiced - collected, ramp: 4 },
    { key: 'Drafted', value: drafted, width: drafted - invoiced, ramp: 3 },
    { key: 'Entitled', value: entitled, width: entitled - drafted, ramp: 2 },
    { key: 'Contracted', value: contracted, width: contracted - entitled, ramp: 1 },
  ];
  return (
    <div className="ent">
      <div className="ent__track" role="img" aria-label={segs.map((s) => `${s.key} ${formatINR(s.value)}`).join(', ')}>
        {segs.filter((s) => s.width > 0).map((s) => (
          <span key={s.key} className={`ent__seg ramp-${s.ramp}`} style={{ flexGrow: s.width, flexBasis: 0 }} />
        ))}
      </div>
      <dl className="ent__legend">
        {[...segs].reverse().map((s) => (
          <div key={s.key} className="ent__item">
            <dt><i className={`bar__sw ramp-${s.ramp}`} />{s.key}</dt>
            <dd><b>{formatINR(s.value)}</b></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
