import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import { cx } from '../cx';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode; dense?: boolean };

/** The label is required: it is both the tooltip and the accessible name. */
export function IconButton({ label, icon, dense, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <Tooltip text={label}>
      <button type={type} aria-label={label} className={cx('icon-btn', dense && 'icon-btn--dense', className)} {...rest}>{icon}</button>
    </Tooltip>
  );
}
