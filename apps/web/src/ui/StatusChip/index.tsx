import { markerClass, markerOf, toneClass, toneOf, type Status } from '../status-colors';
import { cx } from '../cx';

export type StatusChipProps = { status: Status; size?: 'sm' | 'md'; dot?: boolean; label?: string };

/** An 8px square marker beside the sentence-case status word. The word is always the accessible name,
 *  so the marker never carries meaning alone. */
export function StatusChip({ status, size = 'md', dot, label }: StatusChipProps) {
  const tone = toneClass(toneOf(status));
  const marker = markerOf(status);
  const text = label ?? status.replace(/ \((approval|accounting)\)$/, '');
  if (dot) return <span role="img" aria-label={text} title={text} className={cx('dot-only marker', markerClass(marker), tone)} />;
  return (
    <span role="status" aria-label={text} data-marker={marker} className={cx('chip', size === 'sm' && 'chip--sm', `chip--${marker}`, tone)}>
      <span className={cx('chip__dot marker', markerClass(marker))} aria-hidden />{text}
    </span>
  );
}
