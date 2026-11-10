import type { ReactNode } from 'react';
import { Hourglass } from 'lucide-react';
import { PageHeader } from '../PageHeader';

export const NOT_AVAILABLE = 'Not available yet';

export type NotAvailableProps = { detail: string };

/**
 * Live mode, a screen or panel with no API yet: an honest empty state that says what it will show.
 * Never sample rows in its place.
 */
export function NotAvailable({ detail }: NotAvailableProps) {
  return (
    <div className="state" role="status">
      <span className="state__icon"><Hourglass size={20} strokeWidth={1.5} aria-hidden /></span>
      <p className="state__body">{NOT_AVAILABLE}</p>
      <p className="ink-2">{detail}</p>
    </div>
  );
}

/** A whole page with no API yet: the page title stays, the body is the empty state. */
export function NotAvailablePage({ title, detail, subtitle, children }: NotAvailableProps & { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {children}
      <div className="solid-panel"><NotAvailable detail={detail} /></div>
    </>
  );
}
