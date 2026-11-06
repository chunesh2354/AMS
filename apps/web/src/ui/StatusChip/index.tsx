import { toneClass, toneOf, type Status } from '../status-colors';
import { cx } from '../cx';

export type StatusChipProps = { status: Status; size?: 'sm' | 'md'; dot?: boolean; label?: string };

/** The status word is always the accessible name, so colour never carries meaning alone. */
export function StatusChip({ status, size = 'md', dot, label }: StatusChipProps) {
  const tone = toneClass(toneOf(status));
  const text = label ?? status.replace(/ \((approval|accounting)\)$/, '');
  if (dot) return <span role="img" aria-label={text} title={text} className={cx('dot-only', tone)} />;
  return (
    <span role="status" aria-label={text} className={cx('chip', size === 'sm' && 'chip--sm', tone)}>
      <span className="chip__dot" aria-hidden />{text}
    </span>
  );
}
