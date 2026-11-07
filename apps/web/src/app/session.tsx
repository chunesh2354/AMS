import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '../api/types';
import { PEOPLE } from '../mock/studio-meridian';

/**
 * Mock session for the UI build: who is viewing, and the theme. No auth and no persistence.
 * `?as=P04` picks the starting viewer, which is how screenshots open as Rohan Shetty.
 */
export type { Role };
export type Viewer = { id: string; name: string; title: string; roles: Role[] };

export const VIEWERS: Viewer[] = ['P01', 'P02', 'P04', 'P08', 'P10'].map((id) => {
  const p = PEOPLE.find((x) => x.id === id)!;
  return { id: p.id, name: p.name, title: p.title, roles: p.roles };
});

export const canUseFirm = (v: Viewer) => v.roles.some((r) => r !== 'staff');
export const canUseSettings = (v: Viewer) => v.roles.includes('principal') || v.roles.includes('operations');

export type ThemeChoice = 'system' | 'light' | 'dark';

type Session = {
  viewer: Viewer;
  setViewer: (id: string) => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children, initialViewer }: { children: ReactNode; initialViewer?: string }) {
  const [viewerId, setViewerId] = useState(() => initialViewer ?? new URLSearchParams(window.location.search).get('as') ?? 'P01');
  const [theme, setTheme] = useState<ThemeChoice>('system');

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setViewer = useCallback((id: string) => setViewerId(id), []);
  const value = useMemo(
    () => ({ viewer: VIEWERS.find((v) => v.id === viewerId) ?? VIEWERS[0], setViewer, theme, setTheme }),
    [viewerId, setViewer, theme],
  );
  return <Ctx.Provider value={value}><TimerState viewerId={value.viewer.id}>{children}</TimerState></Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

export type Timer = { running: boolean; elapsed: number; context: string; start: (context?: string) => void; stop: () => void };
const TimerCtx = createContext<Timer | null>(null);

/** The one running timer, shared by the top bar and My time. Rohan Shetty starts with one running at 01:42. */
function TimerState({ viewerId, children }: { viewerId: string; children: ReactNode }) {
  const [running, setRunning] = useState(viewerId === 'P04');
  const [elapsed, setElapsed] = useState(viewerId === 'P04' ? 6120 : 0);
  const [context, setContext] = useState('PRJ-01 · Concept design');
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
