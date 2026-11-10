import type { ReactNode } from 'react';
import { cx } from '../cx';

export type AppShellProps = {
  interface: 'firm' | 'team';
  sideNav: ReactNode;
  topBar: ReactNode;
  bottomBar?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
};

/** White page, hairline-edged navigation and top bar, scrolling content with page gutter. */
export function AppShell({ interface: iface, sideNav, topBar, bottomBar, banner, children }: AppShellProps) {
  return (
    <div className={cx('shell', bottomBar && 'shell--tabs')} data-interface={iface}>
      <a href="#main" className="skip-link">Skip to content</a>
      {sideNav}
      <div className="shell__main">
        {topBar}
        {banner && <div className="shell__banner">{banner}</div>}
        <main id="main" className="shell__content" tabIndex={-1}>{children}</main>
      </div>
      {bottomBar}
    </div>
  );
}
