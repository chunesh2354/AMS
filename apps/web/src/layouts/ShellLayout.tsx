import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';
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
import { FIRM_NAV, TEAM_NAV, firmNav, firmTabs, teamTabs } from '../app/nav';
import { VIEWERS, canUseFirm, useSession, useTimer, type Viewer } from '../app/session';
import { OverlaysProvider, useOverlays } from '../app/overlays';
import { getNotifications } from '../api';
import { apiFetch, failureMessage, isLive, signOut, type ListResponse } from '../api/live';
import { pendingApprovalCount } from '../api/live/approvals';
import { approvalsBadge } from '../api/live/shell';
import { stopTimer } from '../api/live/time';
import { getLiveProjects } from '../api/live/projects';
import { getDirectory } from '../api/live/people';
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

/** The brand in the side nav: the signed-in firm in live mode (never the sample studio), the sample studio in the mock. */
export const brandFor = (viewer: Viewer, live = isLive) => (live ? viewer.firm?.name ?? '' : FIRM_NAME);

/** Real shell around both route trees: navigation, top bar, palette, notifications and the mock view-as switch. */
export function ShellLayout({ iface }: { iface: 'firm' | 'team' }) {
  return <OverlaysProvider><Shell iface={iface} /></OverlaysProvider>;
}

function Shell({ iface }: { iface: 'firm' | 'team' }) {
  const navigate = useNavigate();
  const { viewer, setViewer } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsedByUser, setCollapsedByUser] = useState(false);
  const [notifications, setNotifications] = useState<NotificationGroup[]>(() => (isLive ? [] : getNotifications()));
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
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

  // Live: the Approvals badge is the person's real queue. If the count cannot be read the badge is hidden, never guessed.
  useEffect(() => {
    if (!isLive || !canUseFirm(viewer)) return;
    let current = true;
    pendingApprovalCount().then((n) => { if (current) setPendingApprovals(n); }, () => { if (current) setPendingApprovals(null); });
    return () => { current = false; };
  }, [viewer, pathname]);
  const firmSections = useMemo(() => (isLive ? firmNav(approvalsBadge(pendingApprovals)) : FIRM_NAV), [pendingApprovals]);

  const markAllRead = async () => {
    if (isLive) {
      try { await apiFetch('/notifications/read-all', { method: 'POST' }); } catch (e) { toast({ variant: 'danger', message: failureMessage(e) }); return; }
    }
    setNotifications((g) => g.map((x) => ({ ...x, items: x.items.map((n) => ({ ...n, unread: false })) })));
  };

  const firmAllowed = canUseFirm(viewer);
  // Live: the palette searches this firm's real projects and people, loaded the first time it opens.
  // A list the viewer may not read is left out, so the palette falls back to navigation only.
  const [records, setRecords] = useState<{ projects: PaletteAction[]; people: PaletteAction[] } | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  useEffect(() => {
    if (!isLive || !paletteOpen || records || !firmAllowed) return;
    let current = true;
    setRecordsLoading(true);
    Promise.all([getLiveProjects().catch(() => []), getDirectory('active').catch(() => [])]).then(([projects, people]) => {
      if (!current) return;
      setRecords({
        projects: projects.map((p) => ({ id: `prj:${p.code}`, label: `${p.code} ${p.name}`, group: 'Projects', meta: p.status, onSelect: () => navigate(`/firm/projects/${encodeURIComponent(p.code)}`) })),
        people: people.map((p) => ({ id: `person:${p.id}`, label: p.name, group: 'People', meta: p.title || undefined, onSelect: () => navigate(`/firm/people/${encodeURIComponent(p.ref)}`) })),
      });
      setRecordsLoading(false);
    });
    return () => { current = false; };
  }, [paletteOpen, records, firmAllowed, navigate]);

  const actions = useMemo<PaletteAction[]>(() => {
    const go = (to: string) => () => navigate(to);
    const navItems = [...(firmAllowed ? firmSections : []), ...TEAM_NAV].flatMap((s) => s.items);
    return [
      { id: 'log', label: 'Log time', group: 'Actions', onSelect: () => openLogTime() },
      { id: 'leave', label: 'Request leave', group: 'Actions', onSelect: openLeave },
      ...navItems.map((n) => ({ id: n.to, label: n.label, group: 'Navigate', meta: n.badge ? `${n.badge} pending` : undefined, onSelect: go(n.to) })),
      ...(firmAllowed ? [
        { id: 'new-person', label: 'Add person', group: 'Create', onSelect: go('/firm/people?add=1') },
        { id: 'new-project', label: 'Create project', group: 'Create', onSelect: go('/firm/projects?new=1') },
      ] : []),
      // Sample people and projects: mock only, so live mode never offers a jump to a record that is not in this firm.
      ...(firmAllowed && !isLive ? [
        { id: 'p2', label: 'Vikram Nair', group: 'People', meta: 'Project architect', onSelect: go('/firm/people/P02') },
        { id: 'p5', label: 'Divya Menon', group: 'People', meta: 'Architect', onSelect: go('/firm/people/P05') },
        { id: 'prj1', label: 'PRJ-01 Lakeview Residence', group: 'Projects', meta: 'Active', onSelect: go('/firm/projects/PRJ-01') },
        { id: 'prj2', label: 'PRJ-02 Orchard Commercial Block', group: 'Projects', meta: 'Active', onSelect: go('/firm/projects/PRJ-02') },
        { id: 'prj3', label: 'PRJ-03 Heritage Cafe Refit', group: 'Projects', meta: 'On hold', onSelect: go('/firm/projects/PRJ-03') },
      ] : []),
      ...(isLive && records ? [...records.people, ...records.projects] : []),
    ];
  }, [navigate, firmAllowed, firmSections, openLogTime, openLeave, records]);

  // Light only for now: the theme choice is gone from the account menu (session.tsx forces light).
  const menuItems: MenuItem[] = [
    { label: 'My profile', icon: <UserRound {...iconProps} />, onSelect: () => navigate('/me/profile') },
    ...(isLive ? [] : [
      { type: 'separator' as const },
      { type: 'heading' as const, label: 'View as (mock)' },
      ...VIEWERS.map((v) => ({ label: `${v.name}${v.id === viewer.id ? ' (current)' : ''}`, onSelect: () => setViewer(v.id) })),
    ]),
  ];
  const onSignOut = isLive
    ? () => { signOut().catch((e: unknown) => toast({ variant: 'danger', message: failureMessage(e) })); }
    : () => navigate('/login');

  const tabs = iface === 'firm' && firmAllowed ? firmTabs(navigate, firmSections) : teamTabs(navigate);
  const showFirmNav = iface === 'firm' && firmAllowed;
  const phoneBanner = phone && showFirmNav && !bannerDismissed && !PHONE_OK_ROUTES.some((path) => matchPath({ path, end: false }, pathname))
    ? <InlineAlert variant="info" title="Best on a larger screen" dismissible onDismiss={dismissBanner}>Overview and Approvals work here. Everything else is easier on a bigger display.</InlineAlert>
    : undefined;

  return (
    <>
      <AppShell
        interface={iface}
        sideNav={
          <SideNav
            brand={brandFor(viewer)}
            sections={showFirmNav ? firmSections : TEAM_NAV}
            collapsed={collapsed}
            onToggleCollapsed={narrow ? undefined : () => setCollapsedByUser((c) => !c)}
            switcher={firmAllowed ? { value: iface, onChange: (v) => navigate(v === 'firm' ? '/firm/overview' : '/me/home') } : undefined}
            user={{ name: viewer.name, title: viewer.title, menuItems, onSignOut }}
          />
        }
        topBar={
          <TopBar
            onSearch={openPalette}
            shortcut={isMac ? '⌘K' : 'Ctrl K'}
            notifications={notifications}
            onMarkAllRead={markAllRead}
            timer={
              <TimerPill
                state={timer.running ? 'running' : 'idle'}
                elapsedSeconds={timer.elapsed}
                context={timer.context}
                onStart={isLive ? () => openLogTime() : () => timer.start()}
                onStop={isLive ? () => { stopTimer().then(timer.stop, (e: unknown) => toast({ variant: 'danger', message: failureMessage(e) })); } : timer.stop}
              />
            }
          />
        }
        banner={phoneBanner}
        bottomBar={<BottomTabBar label={showFirmNav ? 'Firm' : 'Team'} items={tabs} />}
      >
        <Outlet />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={actions} loading={isLive && recordsLoading} />
    </>
  );
}
