import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hasFinanceAccess } from '../api/access';
import { ApiFailure, apiFetch, failureMessage, isLive } from '../api/live';
import { firmFromMe, type ApiMeFirm, type LiveFirm } from '../api/live/shell';
import { getActiveTimer, timerFromActive } from '../api/live/time';
import type { Role } from '../api/types';
import { PEOPLE } from '../mock/studio-meridian';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';

/**
 * Mock session for the UI build: who is viewing, and the theme (always light for now). No auth and no persistence.
 * `?as=P04` picks the starting viewer, which is how screenshots open as Rohan Shetty.
 * In live mode (VITE_LIVE=1) the viewer comes from GET /me instead, and `id` is the ref code (P01).
 */
export type { Role };
export type CapabilityLevel = 'firm' | 'scoped' | 'own' | 'view';
export type Viewer = {
  id: string; name: string; title: string; roles: Role[];
  /** Live mode only: the person's database id, the server's capability map and the project ids they lead. */
  personId?: string; capabilities?: Record<string, CapabilityLevel>; ledProjects?: string[];
  /** Live mode only: the firm the person signed in to (name, time zone, currency), from GET /me. */
  firm?: LiveFirm;
};

export const VIEWERS: Viewer[] = ['P01', 'P02', 'P04', 'P08', 'P10'].map((id) => {
  const p = PEOPLE.find((x) => x.id === id)!;
  return { id: p.id, name: p.name, title: p.title, roles: p.roles };
});

export const canUseFirm = (v: Viewer) => v.roles.some((r) => r !== 'staff');
export const canUseSettings = (v: Viewer) => v.roles.includes('principal') || v.roles.includes('operations');

/**
 * Whether the viewer holds a capability at any level. Live mode asks the server's capability map.
 * Mock mode has no capabilities, so it mirrors hasFinanceAccess. Pass firmWide for fenced values, which need level 'firm'.
 */
export function can(viewer: Viewer, capability: string, opts?: { firmWide?: boolean }): boolean {
  if (!isLive) return hasFinanceAccess(viewer);
  const level = viewer.capabilities?.[capability];
  return opts?.firmWide ? level === 'firm' : !!level;
}
/**
 * Settings > Rates: exactly those the server lets read the rate card (GET /rates needs rates.bill.manage or
 * rates.cost.view, firm-wide). Finance holds both; operations holds neither by default, so it would only get a 403.
 */
export const canSeeRates = (v: Viewer) => can(v, 'rates.bill.manage', { firmWide: true }) || can(v, 'rates.cost.view', { firmWide: true });
/** Who may open Settings at all: the settings roles, plus anyone who may see Rates (they get that section only). */
export const canOpenSettings = (v: Viewer) => canUseSettings(v) || canSeeRates(v);

/** can() bound to the current viewer. */
export function useCan() {
  const { viewer } = useSession();
  return useCallback((capability: string, opts?: { firmWide?: boolean }) => can(viewer, capability, opts), [viewer]);
}

export type ThemeChoice = 'system' | 'light' | 'dark';

type Session = {
  viewer: Viewer;
  setViewer: (id: string) => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
};

const Ctx = createContext<Session | null>(null);

/** Dark mode is switched off for now: the app is always light and the account menu offers no theme choice. */
const keepLight = () => {};
function useThemeChoice() {
  useEffect(() => { document.documentElement.dataset.theme = 'light'; }, []);
  return ['light' as ThemeChoice, keepLight as (t: ThemeChoice) => void] as const;
}

type ProviderProps = { children: ReactNode; initialViewer?: string };

export function SessionProvider(props: ProviderProps) {
  return isLive ? <LiveSessionProvider>{props.children}</LiveSessionProvider> : <MockSessionProvider {...props} />;
}

function MockSessionProvider({ children, initialViewer }: ProviderProps) {
  const [viewerId, setViewerId] = useState(() => initialViewer ?? new URLSearchParams(window.location.search).get('as') ?? 'P01');
  const [theme, setTheme] = useThemeChoice();

  const setViewer = useCallback((id: string) => setViewerId(id), []);
  const value = useMemo(
    () => ({ viewer: VIEWERS.find((v) => v.id === viewerId) ?? VIEWERS[0], setViewer, theme, setTheme }),
    [viewerId, setViewer, theme, setTheme],
  );
  return <Ctx.Provider value={value}><TimerState viewerId={value.viewer.id}>{children}</TimerState></Ctx.Provider>;
}

export type MeResponse = {
  person: { id: string; ref_code: string; name: string; work_email: string; job_title: string | null; manager_id: string | null };
  firm: ApiMeFirm & { accounting_adapter: string };
  permission_sets: Role[];
  capabilities: Record<string, CapabilityLevel>;
  led_projects: string[];
  member_projects: string[];
};

export const viewerFromMe = (me: MeResponse): Viewer => ({
  id: me.person.ref_code,
  name: me.person.name,
  title: me.person.job_title ?? '',
  roles: me.permission_sets,
  personId: me.person.id,
  capabilities: me.capabilities,
  ledProjects: me.led_projects,
  firm: firmFromMe(me.firm),
});

const NO_VIEWER: Viewer = { id: '', name: '', title: '', roles: [] };
const noop = () => {};

/** Paths that render without a firm viewer: the sign-in pages (/login and below), the invite page and the platform console (its own session). */
const NO_VIEWER_PATHS = ['/login', '/platform', '/accept-invite', '/reset-password'];
const needsNoViewer = (path: string) => NO_VIEWER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** Loads the signed-in person. Those pages render without one; a 401 anywhere else goes to /login inside apiFetch. */
function LiveSessionProvider({ children }: { children: ReactNode }) {
  const onLogin = needsNoViewer(window.location.pathname);
  const [viewer, setViewerState] = useState<Viewer | null>(onLogin ? NO_VIEWER : null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [theme, setTheme] = useThemeChoice();

  useEffect(() => {
    if (onLogin) return;
    let current = true;
    apiFetch<MeResponse>('/me')
      .then((me) => { if (current) setViewerState(viewerFromMe(me)); })
      .catch((e: unknown) => {
        // A 401 is already on its way to /login, so keep the skeleton up until the page changes.
        if (current && !(e instanceof ApiFailure && e.status === 401)) setError(failureMessage(e));
      });
    return () => { current = false; };
  }, [onLogin, attempt]);

  const value = useMemo(() => (viewer ? { viewer, setViewer: noop, theme, setTheme } : null), [viewer, theme, setTheme]);

  if (error) return <main className="solid-panel"><ErrorState message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} /></main>;
  if (!value) return <main style={{ padding: 'var(--s-6)' }}><Skeleton kind="table" rows={8} /></main>;
  return <Ctx.Provider value={value}><TimerState viewerId={value.viewer.personId ?? ''} live>{children}</TimerState></Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

export type Timer = { running: boolean; elapsed: number; context: string; start: (context?: string) => void; stop: () => void };
const TimerCtx = createContext<Timer | null>(null);

/** The mock's running timer: Rohan Shetty starts with one at 01:42. Live mode never shows it, since ref codes repeat across firms. */
const MOCK_TIMER = { viewerId: 'P04', elapsed: 6120, context: 'PRJ-01 · Concept design' };

/**
 * The one running timer, shared by the top bar and My time.
 * Live mode starts idle and asks GET /timers/active, so the pill shows the person's real timer or nothing.
 */
function TimerState({ viewerId, live = false, children }: { viewerId: string; live?: boolean; children: ReactNode }) {
  const demo = !live && viewerId === MOCK_TIMER.viewerId;
  const [running, setRunning] = useState(demo);
  const [elapsed, setElapsed] = useState(demo ? MOCK_TIMER.elapsed : 0);
  const [context, setContext] = useState(live ? '' : MOCK_TIMER.context);
  useEffect(() => {
    if (!live || !viewerId) return;
    let current = true;
    getActiveTimer().then((active) => {
      const t = timerFromActive(active);
      if (current && t) { setElapsed(t.elapsed); setContext(t.context); setRunning(true); }
    }, () => { /* No timer state is not an error worth a banner: the pill stays idle. */ });
    return () => { current = false; };
  }, [live, viewerId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const start = useCallback((c?: string) => { if (c) setContext(c); setRunning(true); }, []);
  const stop = useCallback(() => setRunning(false), []);
  const value = useMemo(() => ({ running, elapsed, context, start, stop }), [running, elapsed, context, start, stop]);
  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}
export function useTimer() {
  const t = useContext(TimerCtx);
  if (!t) throw new Error('useTimer must be used inside SessionProvider');
  return t;
}
