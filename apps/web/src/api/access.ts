import type { Fenced, Role } from './types';
import { isLive } from './live';

/** Who may see what. The mock decides it here; the server decides it later. */
export type ViewerRef = { id: string; roles: Role[] };

export const hasFinanceAccess = (v: ViewerRef) => v.roles.includes('principal') || v.roles.includes('finance');
export const canSeeRatesTab = (v: ViewerRef) => !v.roles.every((r) => r === 'staff');
export const fence = <T,>(allowed: boolean, value: T): Fenced<T> => (allowed ? { restricted: false, value } : { restricted: true });
export const reply = <T,>(value: T): Promise<T> => Promise.resolve(value);

/**
 * The sample studio is for the mock build only. In live mode (VITE_LIVE=1) every mock getter answers as if the
 * studio had nothing: an empty list, no record, or a refusal for a whole view. A screen that still reaches one
 * by mistake shows an empty or error state, never a sample name.
 */
export const sample = <T,>(value: () => T, empty: T, live = isLive): Promise<T> => reply(live ? empty : value());
export const sampleView = <T,>(value: () => T, live = isLive): Promise<T> => (live ? Promise.reject(new Error('Not available yet')) : reply(value()));
export const sampleSync = <T,>(value: () => T, empty: T, live = isLive): T => (live ? empty : value());
