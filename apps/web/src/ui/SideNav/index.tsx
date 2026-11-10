import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowLeftRight, LogOut, PanelLeft } from 'lucide-react';
import { Avatar } from '../Avatar';
import { IconButton } from '../IconButton';
import { Menu, type MenuItem } from '../Menu';
import { Segmented } from '../Segmented';
import { Tooltip } from '../Tooltip';
import { cx } from '../cx';

export type NavItem = { to: string; label: string; icon: ReactNode; badge?: number; end?: boolean };
export type NavSection = { label?: string; items: NavItem[] };
export type InterfaceName = 'firm' | 'team';

export type SideNavUser = {
  name: string;
  title?: string;
  /** The account menu: profile and, in the mock build, view-as. The trigger is the person block. */
  menuItems?: MenuItem[];
  onSignOut?: () => void;
};

export type SideNavProps = {
  /** The studio name, shown under the wordmark. */
  brand: string;
  /** The product wordmark. */
  product?: string;
  sections: NavSection[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Present only for people who can use both interfaces. */
  switcher?: { value: InterfaceName; onChange: (value: InterfaceName) => void };
  /** The signed-in person, shown at the foot with Sign out. */
  user?: SideNavUser;
};

function Item({ item, collapsed }: { item: NavItem; collapsed?: boolean }) {
  const link = (
    <NavLink to={item.to} end={item.end} className="sidenav__item" aria-label={collapsed ? `${item.label}${item.badge ? `, ${item.badge}` : ''}` : undefined}>
      {collapsed ? item.icon : <span className="sidenav__label">{item.label}</span>}
      {item.badge != null && <span className="sidenav__badge" aria-hidden={collapsed || undefined}>{item.badge}</span>}
    </NavLink>
  );
  return collapsed ? <Tooltip text={item.label} side="right">{link}</Tooltip> : link;
}

function Person({ user, collapsed }: { user: SideNavUser; collapsed?: boolean }) {
  const body = (
    <>
      <Avatar name={user.name} size={32} />
      {!collapsed && (
        <span className="sidenav__who">
          <span className="sidenav__name">{user.name}</span>
          {user.title && <span className="sidenav__title">{user.title}</span>}
        </span>
      )}
    </>
  );
  if (!user.menuItems?.length) return <div className="sidenav__person">{body}</div>;
  return (
    <Menu
      label="Account"
      placement={collapsed ? 'right-end' : 'top-start'}
      items={user.menuItems}
      trigger={(p) => <button {...p} type="button" className="sidenav__person sidenav__person--btn">{body}<span className="sr-only">, account menu</span></button>}
    />
  );
}

/** White navigation with a hairline edge. The collapsed rail is 64 px and keeps every label in a tooltip. */
export function SideNav({ brand, product = 'Practice', sections, collapsed, onToggleCollapsed, switcher, user }: SideNavProps) {
  return (
    <nav className={cx('sidenav', collapsed && 'sidenav--collapsed')} aria-label="Main">
      <div className="sidenav__brand">
        <span className="sidenav__wordmark"><span className="sidenav__mark" aria-hidden />{collapsed ? <span className="sr-only">{product}</span> : product}</span>
        {collapsed ? <span className="sr-only">{brand}</span> : <span className="sidenav__studio">{brand}</span>}
      </div>
      <div className="sidenav__groups">
        {sections.map((s, i) => (
          <div key={s.label ?? i} className="sidenav__group">
            {s.label && !collapsed && <p className="sidenav__head">{s.label}</p>}
            {s.items.map((item) => <Item key={item.to} item={item} collapsed={collapsed} />)}
          </div>
        ))}
      </div>
      <div className="sidenav__foot">
        {switcher && (collapsed
          ? <IconButton
              label={`Switch to ${switcher.value === 'firm' ? 'Team' : 'Firm'} interface`}
              icon={<ArrowLeftRight size={20} strokeWidth={1.5} aria-hidden />}
              onClick={() => switcher.onChange(switcher.value === 'firm' ? 'team' : 'firm')}
            />
          : <Segmented<InterfaceName>
              label="Interface"
              value={switcher.value}
              onChange={switcher.onChange}
              options={[{ value: 'firm', label: 'Firm' }, { value: 'team', label: 'Team' }]}
            />)}
        {user && <Person user={user} collapsed={collapsed} />}
        {(user?.onSignOut || onToggleCollapsed) && (
          <div className="sidenav__actions">
            {user?.onSignOut && (collapsed
              ? <IconButton label="Sign out" icon={<LogOut size={20} strokeWidth={1.5} aria-hidden />} onClick={user.onSignOut} />
              : <button type="button" className="sidenav__signout" onClick={user.onSignOut}>Sign out</button>)}
            {onToggleCollapsed && <IconButton label={collapsed ? 'Expand navigation' : 'Collapse navigation'} icon={<PanelLeft size={20} strokeWidth={1.5} aria-hidden />} onClick={onToggleCollapsed} />}
          </div>
        )}
      </div>
    </nav>
  );
}
