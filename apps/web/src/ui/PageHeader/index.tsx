import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { cx } from '../cx';

export type Crumb = { label: string; to?: string };
/** Route tabs use NavLink. Tabs held in a URL param pass `active` because the path does not change. */
export type PageTab = { label: string; to: string; end?: boolean; active?: boolean };

export type PageHeaderProps = {
  title: string;
  /** Kept for Overview greetings and dashboards; the approved design sets every page title at 40 px. */
  display?: boolean;
  breadcrumb?: Crumb[];
  lead?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  period?: ReactNode;
  tabs?: PageTab[];
};

/** Sticky under the top bar. Once stuck it gains a hairline, shrinks the title and hides its meta row. */
export function PageHeader({ title, display, breadcrumb, lead, subtitle, meta, primaryAction, secondaryActions, period, tabs }: PageHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: '-57px 0px 0px 0px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden style={{ height: 1, marginBottom: -1 }} />
      <div className={cx('pagehead', stuck && 'pagehead--stuck', tabs && 'pagehead--tabs')}>
        {breadcrumb && (
          <nav className="pagehead__crumb" aria-label="Breadcrumb">
            <ol>
              {breadcrumb.map((c) => <li key={c.label}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>)}
            </ol>
          </nav>
        )}
        <div className="pagehead__row">
          <div style={{ minWidth: 0 }}>
            <div className="person-head">
              {lead}
              <div className="pagehead__heading">
                <h1 className={cx(display ? 't-display' : 't-h1', 'pagehead__title')}>{title}</h1>
                {subtitle && <p className="pagehead__context">{subtitle}</p>}
              </div>
            </div>
            {meta && <div className="pagehead__meta">{meta}</div>}
          </div>
          {(period || secondaryActions || primaryAction) && <div className="pagehead__actions">{period}{secondaryActions}{primaryAction}</div>}
        </div>
        {tabs && (
          <nav className="pagehead__tabs" aria-label={`${title} sections`}>
            {tabs.map((t) => t.active === undefined
              ? <NavLink key={t.to} to={t.to} end={t.end} className="pagehead__tab">{t.label}</NavLink>
              : <Link key={t.to} to={t.to} className={cx('pagehead__tab', t.active && 'active')} aria-current={t.active ? 'page' : undefined}>{t.label}</Link>)}
          </nav>
        )}
      </div>
    </>
  );
}
