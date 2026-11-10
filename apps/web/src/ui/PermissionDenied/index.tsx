import { Lock } from 'lucide-react';
import { isLive } from '../../api/live';

/** Who to ask. The sample studio's principal in the mock; never a sample name in live mode. */
export const defaultContact = (live = isLive) => (live ? 'a principal in your studio' : 'Asha Rao (Principal)');

export type PermissionDeniedProps = { capability: string; contact?: string };

export function PermissionDenied({ capability, contact = defaultContact() }: PermissionDeniedProps) {
  return (
    <div className="state" role="status">
      <span className="state__icon"><Lock size={20} strokeWidth={1.5} aria-hidden /></span>
      <p className="state__body">You need the {capability} permission to see this.</p>
      <p className="ink-2">Ask {contact}</p>
    </div>
  );
}
