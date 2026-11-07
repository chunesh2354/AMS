import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, type MenuItem } from '../Menu';
import { cx } from '../cx';

export type TabItem = { label: string; icon: ReactNode; to?: string; menu?: MenuItem[] };

export type BottomTabBarProps = { label: string; items: TabItem[]; /** Shows the bar at any width, for documentation. */ always?: boolean };

/** Glass bar shown below 768 px. */
export function BottomTabBar({ label, items, always }: BottomTabBarProps) {
  return (
    <nav className={cx('tabbar glass glass--bar', always && 'tabbar--always')} aria-label={label}>
      {items.map((item) => item.to
        ? <NavLink key={item.label} to={item.to} className="tabbar__item">{item.icon}{item.label}</NavLink>
        : <div key={item.label} className="tabbar__slot">
            <Menu label={item.label} placement="top-end" items={item.menu ?? []} trigger={(p) => <button {...p} type="button" className="tabbar__item">{item.icon}{item.label}</button>} />
          </div>)}
    </nav>
  );
}
