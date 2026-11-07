import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '../api/types';
import { PEOPLE } from '../mock/studio-meridian';

/**
 * Mock session for the UI build: who is viewing, and the theme. No auth and no persistence.
 * `?as=P04` picks the starting viewer, which is how screenshots open as Rohan Shetty.
 */
export type { Role };
export type Viewer = { id: string; name: string; title: string; roles: Role[] };

export const VIEWERS: Viewer[] = ['P01', 'P02', 'P04', 'P10'].map((id) => {
  const p = PEOPLE.find((x) => x.id === id)!;
  return { id: p.id, name: p.name, title: p.title, roles: p.roles };
});

export const canUseFirm = (v: Viewer) => v.roles.some((r) => r !== 'staff');

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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
