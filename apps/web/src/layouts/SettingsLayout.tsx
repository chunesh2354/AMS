import type { ReactNode } from 'react';
import { SubNav } from '../ui/SubNav';

/** Section 8, Settings: glass sub-nav on the left, the section on the right. */
export function SettingsLayout({ label, items, children }: { label: string; items: { label: string; to: string; active?: boolean }[]; children: ReactNode }) {
  return (
    <div className="settings">
      <SubNav label={label} items={items} />
      <div className="stack-4">{children}</div>
    </div>
  );
}
