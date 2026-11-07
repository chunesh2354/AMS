import type { ReactNode } from 'react';
import { Bell, Search } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Menu, type MenuItem } from '../Menu';
import { Popover } from '../Popover';

export type Notification = { id: string; text: string; time: string; unread?: boolean };
export type NotificationGroup = { label: string; items: Notification[] };

export type TopBarProps = {
  onSearch: () => void;
  shortcut?: string;
  timer?: ReactNode;
  notifications: NotificationGroup[];
  onMarkAllRead?: () => void;
  userName: string;
  menuItems: MenuItem[];
  defaultNotificationsOpen?: boolean;
};

/** Glass bar. The breadcrumb lives in PageHeader, not here. */
export function TopBar({ onSearch, shortcut = 'Ctrl K', timer, notifications, onMarkAllRead, userName, menuItems, defaultNotificationsOpen }: TopBarProps) {
  const unread = notifications.flatMap((g) => g.items).filter((n) => n.unread).length;
  return (
    <header className="topbar glass glass--bar">
      <button type="button" className="topbar__search" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K">
        <Search size={16} strokeWidth={1.5} aria-hidden />
        <span className="topbar__label">Search people, projects, actions</span>
        <span className="topbar__kbd" aria-hidden>{shortcut}</span>
      </button>
      <div className="topbar__end">
        {timer}
        <Popover
          label="Notifications"
          placement="bottom-end"
          defaultOpen={defaultNotificationsOpen}
          trigger={(p) => (
            <button {...p} type="button" className="icon-btn topbar__bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Bell size={20} strokeWidth={1.5} aria-hidden />
              {unread > 0 && <span className="topbar__unread" aria-hidden />}
            </button>
          )}
        >
          <div className="notif">
            <div className="notif__head">
              <h2 className="t-h3">Notifications</h2>
              <button type="button" className="t-body-sm" style={{ color: 'var(--accent-text)' }} onClick={onMarkAllRead} disabled={!unread}>Mark all read</button>
            </div>
            {notifications.map((g) => (
              <section key={g.label} aria-label={g.label} style={{ paddingBottom: 'var(--s-2)' }}>
                <h3 className="notif__group">{g.label}</h3>
                {g.items.map((n) => (
                  <div key={n.id} className="notif__row">
                    <span className={n.unread ? 'notif__dot' : 'notif__dot notif__dot--read'} aria-hidden />
                    <div><p>{n.unread && <span className="sr-only">Unread: </span>}{n.text}</p><p className="notif__time">{n.time}</p></div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </Popover>
        <Menu
          label="Account"
          placement="bottom-end"
          items={menuItems}
          trigger={(p) => <button {...p} type="button" className="topbar__avatar"><Avatar name={userName} /><span className="sr-only">, account menu</span></button>}
        />
      </div>
    </header>
  );
}
