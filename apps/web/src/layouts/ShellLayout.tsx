import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { AppShell } from '../ui/AppShell';
import { BottomTabBar } from '../ui/BottomTabBar';
import { CommandPalette, useCommandShortcut, type PaletteAction } from '../ui/CommandPalette';
import { InlineAlert } from '../ui/InlineAlert';
import { SideNav } from '../ui/SideNav';
import { TimerPill } from '../ui/TimerPill';
import { TopBar, type NotificationGroup } from '../ui/TopBar';
import { useToast } from '../ui/Toast';
import { formatDate, toISO } from '../ui/format';
import { useMediaQuery } from '../ui/useMediaQuery';
import type { MenuItem } from '../ui/Menu';
import { FIRM_NAV, TEAM_NAV, firmTabs, teamTabs } from '../app/nav';
import { VIEWERS, canUseFirm, useSession, useTimer } from '../app/session';
import { OverlaysProvider, useOverlays } from '../app/overlays';
import { getNotifications } from '../api';
import { CONNECTED_ROUTES, SAMPLE_DATA_NOTICE, apiFetch, failureMessage, isLive, signOut, type ListResponse } from '../api/live';
import { FIRM_NAME } from '../mock/studio-meridian';

const isMac = /mac/i.test(navigator.platform);
const iconProps = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

type LiveNotification = { id: string; text: string; created_at: string; read_at: string | null };

function groupNotifications(rows: LiveNotification[], now = new Date()): NotificationGroup[] {
  const today = toISO(now);
  const items = rows.map((n) => {
    const at = new Date(n.created_at);
    const day = toISO(at);
    const time = day === today ? at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : formatDate(day);
    return { id: n.id, text: n.text, unread: !n.read_at, day, time };
  });
  return [
    { label: 'Today', items: items.filter((n) => n.day === today) },
    { label: 'Earlier', items: items.filter((n) => n.day !== today) },
  ].filter((g) => g.items.length > 0);
}

const PHONE_BANNER_KEY = 'phone-banner-dismissed';
const PHONE_OK_ROUTES = ['/firm/overview', '/firm/approvals'];
const readBannerDismissed = () => { try { return localStorage.getItem(PHONE_BANNER_KEY) === '1'; } catch { return false; } };
const isConnectedRoute = (pathname: string) => CONNECTED_ROUTES.some((path) => matchPath({ path, end: true }, pathname));

/** Real shell around both route trees: navigation, top bar, palette, notifications and the mock view-as switch. */
export function ShellLayout({ iface }: { iface: 'firm' | 'team' }) {
  return <OverlaysProvider><Shell iface={iface} /></OverlaysProvider>;
}

function Shell({ iface }: { iface: 'firm' | 'team' }) {
  const navigate = useNavigate();
  const { viewer, setViewer, theme, setTheme } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsedByUser, setCollapsedByUser] = useState(false);
  const [notifications, setNotifications] = useState<NotificationGroup[]>(() => (isLive ? [] : getNotifications()));
  const { pathname } = useLocation();
  const toast = useToast();
  const timer = useTimer();
  const { openLogTime, openLeave } = useOverlays();

  const narrow = useMediaQuery('(max-width: 1279px)');
  const phone = useMediaQuery('(max-width: 767px)');
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed);
  const dismissBanner = () => { setBannerDismissed(true); try { localStorage.setItem(PHONE_BANNER_KEY, '1'); } catch { /* storage blocked: dismissal lasts this visit */ } };
  const collapsed = narrow || collapsedByUser;

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandShortcut(openPalette);

  useEffect(() => {
    if (!isLive) return;
    let current = true;
    apiFetch<ListResponse<LiveNotification>>('/notifications')
      .then((res) => { if (current) setNotifications(groupNotifications(res.data)); })
      .catch((e: unknown) => { if (current) toast({ variant: 'danger', message: failureMessage(e) }); });
    return () => { current = false; };
  }, [toast]);

  const markAllRead = async () => {
    if (isLive) {
      try { await apiFetch('/notifications/read-all', { method: 'POST' }); } catch (e) { toast({ variant: 'danger', message: failureMessage(e) }); return; }
    }
    setNotifications((g) => g.map((x) => ({ ...x, items: x.items.map((n) => ({ ...n, unread: false })) })));
  };

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
    ...(isLive
      ? [{ label: 'Sign out', icon: <LogOut {...iconProps} />, onSelect: () => { signOut().catch((e: unknown) => toast({ variant: 'danger', message: failureMessage(e) })); } }]
      : [
        { type: 'heading' as const, label: 'View as (mock)' },
        ...VIEWERS.map((v) => ({ label: `${v.name}${v.id === viewer.id ? ' (current)' : ''}`, onSelect: () => setViewer(v.id) })),
      ]),
  ];

  const tabs = iface === 'firm' && firmAllowed ? firmTabs(navigate) : teamTabs(navigate);
  const showFirmNav = iface === 'firm' && firmAllowed;
  const sampleBanner = isLive && !isConnectedRoute(pathname) ? <InlineAlert variant="warn" title={SAMPLE_DATA_NOTICE} /> : undefined;
  const phoneBanner = phone && showFirmNav && !bannerDismissed && !PHONE_OK_ROUTES.some((path) => matchPath({ path, end: false }, pathname))
    ? <InlineAlert variant="info" title="Best on a larger screen" dismissible onDismiss={dismissBanner}>Overview and Approvals work here. Everything else is easier on a bigger display.</InlineAlert>
    : undefined;

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
            onMarkAllRead={markAllRead}
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
        banner={sampleBanner && phoneBanner ? <>{sampleBanner}{phoneBanner}</> : sampleBanner ?? phoneBanner}
        bottomBar={<BottomTabBar label={showFirmNav ? 'Firm' : 'Team'} items={tabs} />}
      >
        <Outlet />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={actions} />
    </>
  );
}
