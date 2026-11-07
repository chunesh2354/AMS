import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { LogTimeSheet, type LogTimePrefill } from '../screens/shared/log-time-sheet';
import { RequestLeaveSheet } from '../screens/shared/request-leave-sheet';

type Overlays = { openLogTime: (prefill?: LogTimePrefill) => void; openLeave: () => void };
const Ctx = createContext<Overlays | null>(null);

/** Section 9.3: "Log time" and "Request leave" open the same sheets from anywhere in the app. */
export function OverlaysProvider({ children }: { children: ReactNode }) {
  const [log, setLog] = useState<{ open: boolean; prefill?: LogTimePrefill }>({ open: false });
  const [leave, setLeave] = useState(false);
  const value = useMemo(() => ({ openLogTime: (prefill?: LogTimePrefill) => setLog({ open: true, prefill }), openLeave: () => setLeave(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <LogTimeSheet open={log.open} prefill={log.prefill} onClose={() => setLog({ open: false })} />
      <RequestLeaveSheet open={leave} onClose={() => setLeave(false)} />
    </Ctx.Provider>
  );
}
export function useOverlays() {
  const o = useContext(Ctx);
  if (!o) throw new Error('useOverlays must be used inside OverlaysProvider');
  return o;
}
