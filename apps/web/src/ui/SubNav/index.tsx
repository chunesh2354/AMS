import { Link, NavLink } from 'react-router-dom';
import { cx } from '../cx';

/** Items held in a URL param pass `active`, because the path does not change. */
export type SubNavProps = { label: string; items: { label: string; to: string; active?: boolean }[] };

/** Added for Settings and Reports: glass sub-navigation, 240 px. Becomes a scrolling row on small screens. */
export function SubNav({ label, items }: SubNavProps) {
  return (
    <nav className="subnav glass" aria-label={label}>
      {items.map((i) => (i.active === undefined
        ? <NavLink key={i.to} to={i.to} className="subnav__item">{i.label}</NavLink>
        : <Link key={i.to} to={i.to} className={cx('subnav__item', i.active && 'active')} aria-current={i.active ? 'page' : undefined}>{i.label}</Link>))}
    </nav>
  );
}
