import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Mock session for the UI build: who is viewing, and the theme. No auth and no persistence.
 * `?as=P04` picks the starting viewer, which is how screenshots open as Rohan Shetty.
 */
export type Role = 'principal' | 'pm' | 'staff' | 'operations' | 'finance';
export type Viewer = { id: string; name: string; title: string; roles: Role[] };

export const VIEWERS: Viewer[] = [
  { id: 'P01', name: 'Asha Rao', title: 'Principal', roles: ['principal'] },
  { id: 'P02', name: 'Vikram Nair', title: 'Project architect', roles: ['pm'] },
  { id: 'P04', name: 'Rohan Shetty', title: 'Senior architect', roles: ['staff'] },
  { id: 'P10', name: 'Farah Khan', title: 'Operations', roles: ['operations', 'finance'] },
];

export const canUseFirm = (v: Viewer) => v.roles.some((r) => r !== 'staff');

export type ThemeChoice = 'system' | 'light' | 'dark';

type Session = {
  viewer: Viewer;
  setViewer: (id: string) => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [viewerId, setViewerId] = useState(() => new URLSearchParams(window.location.search).get('as') ?? 'P01');
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
