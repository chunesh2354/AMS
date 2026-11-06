import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { IconButton } from '../IconButton';
import { Button } from '../Button';
import type { Tone } from '../status-colors';

export type ToastVariant = 'success' | 'warn' | 'danger' | 'info';
export const VARIANT_TONE: Record<ToastVariant, Tone> = { success: 'ok', warn: 'warn', danger: 'danger', info: 'info' };
export const VARIANT_ICON = { success: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info };

export type ToastData = { id?: number; variant?: ToastVariant; message: ReactNode; action?: { label: string; onClick: () => void } };

/** Dismisses itself after 4 s; the timer pauses while the pointer is over it. */
export function Toast({ variant = 'info', message, action, onDismiss, persist }: ToastData & { onDismiss?: () => void; persist?: boolean }) {
  const [hover, setHover] = useState(false);
  const remaining = useRef(4000);
  useEffect(() => {
    if (hover || persist) return;
    const started = Date.now();
    const t = setTimeout(() => onDismiss?.(), remaining.current);
    return () => { clearTimeout(t); remaining.current -= Date.now() - started; };
  }, [hover, persist, onDismiss]);
  const Icon = VARIANT_ICON[variant];
  return (
    <div className={`toast glass glass--elevated tone-${VARIANT_TONE[variant]}`} role={variant === 'danger' ? 'alert' : 'status'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Icon size={16} strokeWidth={1.5} className="toast__icon" aria-hidden />
      <div className="toast__body">{message}</div>
      {action && <Button size="dense" variant="ghost" onClick={action.onClick}>{action.label}</Button>}
      {onDismiss && <IconButton dense label="Dismiss" icon={<X size={16} strokeWidth={1.5} aria-hidden />} onClick={onDismiss} />}
    </div>
  );
}

const Ctx = createContext<(t: ToastData) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastData & { id: number })[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: ToastData) => setToasts((l) => [...l, { ...t, id: ++seq.current }]), []);
  const drop = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  return (
    <Ctx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts">{toasts.map((t) => <ToastItem key={t.id} toast={t} onDrop={drop} />)}</div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDrop }: { toast: ToastData & { id: number }; onDrop: (id: number) => void }) {
  const dismiss = useCallback(() => onDrop(toast.id), [onDrop, toast.id]);
  return <Toast {...toast} onDismiss={dismiss} />;
}
