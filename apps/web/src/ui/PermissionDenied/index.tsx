import { Lock } from 'lucide-react';

export type PermissionDeniedProps = { capability: string; contact?: string };

export function PermissionDenied({ capability, contact = 'Asha Rao (Principal)' }: PermissionDeniedProps) {
  return (
    <div className="state" role="status">
      <span className="state__icon"><Lock size={20} strokeWidth={1.5} aria-hidden /></span>
      <p className="state__body">You need the {capability} permission to see this.</p>
      <p className="ink-2">Ask {contact}</p>
    </div>
  );
}
