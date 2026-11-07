import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowLeftRight, PanelLeft } from 'lucide-react';
import { IconButton } from '../IconButton';
import { Segmented } from '../Segmented';
import { Tooltip } from '../Tooltip';
import { cx } from '../cx';

export type NavItem = { to: string; label: string; icon: ReactNode; badge?: number; end?: boolean };
export type NavSection = { label?: string; items: NavItem[] };
export type InterfaceName = 'firm' | 'team';

export type SideNavProps = {
  brand: string;
  sections: NavSection[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Present only for people who can use both interfaces. */
  switcher?: { value: InterfaceName; onChange: (value: InterfaceName) => void };
};

function Item({ item, collapsed }: { item: NavItem; collapsed?: boolean }) {
  const link = (
    <NavLink to={item.to} end={item.end} className="sidenav__item" aria-label={collapsed ? `${item.label}${item.badge ? `, ${item.badge}` : ''}` : undefined}>
      {item.icon}
      {!collapsed && item.label}
      {item.badge != null && <span className="sidenav__badge" aria-hidden={collapsed || undefined}>{item.badge}</span>}
    </NavLink>
  );
  return collapsed ? <Tooltip text={item.label} side="right">{link}</Tooltip> : link;
}

/** Glass navigation. Collapsed rail is 64 px and keeps every label in a tooltip. */
export function SideNav({ brand, sections, collapsed, onToggleCollapsed, switcher }: SideNavProps) {
  return (
    <nav className={cx('sidenav glass', collapsed && 'sidenav--collapsed')} aria-label="Main">
      <div className="sidenav__brand"><span className="sidenav__mark" aria-hidden />{!collapsed && brand}{collapsed && <span className="sr-only">{brand}</span>}</div>
      {sections.map((s, i) => (
        <div key={s.label ?? i} className="sidenav__group">
          {s.label && !collapsed && <p className="sidenav__head">{s.label}</p>}
          {s.items.map((item) => <Item key={item.to} item={item} collapsed={collapsed} />)}
        </div>
      ))}
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
        {onToggleCollapsed && <IconButton label={collapsed ? 'Expand navigation' : 'Collapse navigation'} icon={<PanelLeft size={20} strokeWidth={1.5} aria-hidden />} onClick={onToggleCollapsed} />}
      </div>
    </nav>
  );
}
