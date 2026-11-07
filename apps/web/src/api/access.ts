import type { Fenced, Role } from './types';

/** Who may see what. The mock decides it here; the server decides it later. */
export type ViewerRef = { id: string; roles: Role[] };

export const hasFinanceAccess = (v: ViewerRef) => v.roles.includes('principal') || v.roles.includes('finance');
export const canSeeRatesTab = (v: ViewerRef) => !v.roles.every((r) => r === 'staff');
export const fence = <T,>(allowed: boolean, value: T): Fenced<T> => (allowed ? { restricted: false, value } : { restricted: true });
export const reply = <T,>(value: T): Promise<T> => Promise.resolve(value);
