import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { AppShell } from '../ui/AppShell';
import { BottomTabBar } from '../ui/BottomTabBar';
import { CommandPalette, useCommandShortcut, type PaletteAction } from '../ui/CommandPalette';
import { InlineAlert } from '../ui/InlineAlert';
import { SideNav } from '../ui/SideNav';
import { TimerPill } from '../ui/TimerPill';
import { TopBar } from '../ui/TopBar';
import { useMediaQuery } from '../ui/useMediaQuery';
import type { MenuItem } from '../ui/Menu';
import { FIRM_NAV, TEAM_NAV, firmTabs, teamTabs } from '../app/nav';
import { VIEWERS, canUseFirm, useSession, useTimer } from '../app/session';
import { OverlaysProvider, useOverlays } from '../app/overlays';
import { getNotifications } from '../api';
import { FIRM_NAME } from '../mock/studio-meridian';

const isMac = /mac/i.test(navigator.platform);
const iconProps = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Real shell around both route trees: navigation, top bar, palette, notifications and the mock view-as switch. */
export function ShellLayout({ iface }: { iface: 'firm' | 'team' }) {
  return <OverlaysProvider><Shell iface={iface} /></OverlaysProvider>;
}

function Shell({ iface }: { iface: 'firm' | 'team' }) {
  const navigate = useNavigate();
  const { viewer, setViewer, theme, setTheme } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsedByUser, setCollapsedByUser] = useState(false);
  const [notifications, setNotifications] = useState(getNotifications);
  const timer = useTimer();
  const { openLogTime, openLeave } = useOverlays();

  const narrow = useMediaQuery('(max-width: 1279px)');
  const phone = useMediaQuery('(max-width: 767px)');
  const collapsed = narrow || collapsedByUser;

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandShortcut(openPalette);

  const firmAllowed = canUseFirm(viewer);
  const actions = useMemo<PaletteAction[]>(() => {
    const go = (to: string) => () => navigate(to);
    const navItems = [...(firmAllowed ? FIRM_NAV : []), ...TEAM_NAV].flatMap((s) => s.items);
    return [
      { id: 'log', label: 'Log time', group: 'Actions', onSelect: () => openLogTime() },
      { id: 'leave', label: 'Request leave', group: 'Actions', onSelect: openLeave },
      ...navItems.map((n) => ({ id: n.to, label: n.label, group: 'Navigate', meta: n.badge ? `${n.badge} pending` : undefined, onSelect: go(n.to) })),
      ...(firmAllowed ? [
        { id: 'new-person', label: 'Add person', group: 'Create', onSelect: go('/firm/people?add=1') },
        { id: 'new-project', label: 'Create project', group: 'Create', onSelect: go('/firm/projects?new=1') },
        { id: 'p2', label: 'Vikram Nair', group: 'People', meta: 'Project architect', onSelect: go('/firm/people/P02') },
        { id: 'p5', label: 'Divya Menon', group: 'People', meta: 'Architect', onSelect: go('/firm/people/P05') },
        { id: 'prj1', label: 'PRJ-01 Lakeview Residence', group: 'Projects', meta: 'Active', onSelect: go('/firm/projects/PRJ-01') },
        { id: 'prj2', label: 'PRJ-02 Orchard Commercial Block', group: 'Projects', meta: 'Active', onSelect: go('/firm/projects/PRJ-02') },
        { id: 'prj3', label: 'PRJ-03 Heritage Cafe Refit', group: 'Projects', meta: 'On hold', onSelect: go('/firm/projects/PRJ-03') },
      ] : []),
    ];
  }, [navigate, firmAllowed, openLogTime, openLeave]);

  const menuItems: MenuItem[] = [
    { label: 'My profile', icon: <UserRound {...iconProps} />, onSelect: () => navigate('/me/profile') },
    { type: 'separator' },
    { type: 'heading', label: 'Theme' },
    { label: `System${theme === 'system' ? ' (current)' : ''}`, icon: <Monitor {...iconProps} />, onSelect: () => setTheme('system') },
    { label: `Light${theme === 'light' ? ' (current)' : ''}`, icon: <Sun {...iconProps} />, onSelect: () => setTheme('light') },
    { label: `Dark${theme === 'dark' ? ' (current)' : ''}`, icon: <Moon {...iconProps} />, onSelect: () => setTheme('dark') },
    { type: 'separator' },
    { type: 'heading', label: 'View as (mock)' },
    ...VIEWERS.map((v) => ({ label: `${v.name}${v.id === viewer.id ? ' (current)' : ''}`, onSelect: () => setViewer(v.id) })),
  ];

  const tabs = iface === 'firm' && firmAllowed ? firmTabs(navigate) : teamTabs(navigate);
  const showFirmNav = iface === 'firm' && firmAllowed;

  return (
    <>
      <AppShell
        interface={iface}
        sideNav={
          <SideNav
            brand={FIRM_NAME}
            sections={showFirmNav ? FIRM_NAV : TEAM_NAV}
            collapsed={collapsed}
            onToggleCollapsed={narrow ? undefined : () => setCollapsedByUser((c) => !c)}
            switcher={firmAllowed ? { value: iface, onChange: (v) => navigate(v === 'firm' ? '/firm/overview' : '/me/home') } : undefined}
          />
        }
        topBar={
          <TopBar
            onSearch={openPalette}
            shortcut={isMac ? '⌘K' : 'Ctrl K'}
            userName={viewer.name}
            menuItems={menuItems}
            notifications={notifications}
            onMarkAllRead={() => setNotifications((g) => g.map((x) => ({ ...x, items: x.items.map((n) => ({ ...n, unread: false })) })))}
            timer={
              <TimerPill
                state={timer.running ? 'running' : 'idle'}
                elapsedSeconds={timer.elapsed}
                context={timer.context}
                onStart={() => timer.start()}
                onStop={timer.stop}
              />
            }
          />
        }
        banner={phone && showFirmNav
          ? <InlineAlert variant="info" title="Best on a larger screen" dismissible>Overview and Approvals work here. Everything else is easier on a bigger display.</InlineAlert>
          : undefined}
        bottomBar={<BottomTabBar label={showFirmNav ? 'Firm' : 'Team'} items={tabs} />}
      >
        <Outlet />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={actions} />
    </>
  );
}
