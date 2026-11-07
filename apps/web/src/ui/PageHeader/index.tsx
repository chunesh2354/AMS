import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { cx } from '../cx';

export type Crumb = { label: string; to?: string };
export type PageTab = { label: string; to: string; end?: boolean };

export type PageHeaderProps = {
  title: string;
  /** Display size is for Overview greetings and dashboards. */
  display?: boolean;
  breadcrumb?: Crumb[];
  meta?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  period?: ReactNode;
  tabs?: PageTab[];
};

/** Sticky under the top bar. Becomes a glass bar once stuck, and hides its meta row. */
export function PageHeader({ title, display, breadcrumb, meta, primaryAction, secondaryActions, period, tabs }: PageHeaderProps) {
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
      <div className={cx('pagehead', stuck && 'pagehead--stuck glass glass--bar', tabs && 'pagehead--tabs')}>
        {breadcrumb && (
          <nav className="pagehead__crumb" aria-label="Breadcrumb">
            <ol>
              {breadcrumb.map((c) => <li key={c.label}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>)}
            </ol>
          </nav>
        )}
        <div className="pagehead__row">
          <div style={{ minWidth: 0 }}>
            <h1 className={display ? 't-display' : 't-h1'}>{title}</h1>
            {meta && <div className="pagehead__meta">{meta}</div>}
          </div>
          {(period || secondaryActions || primaryAction) && <div className="pagehead__actions">{period}{secondaryActions}{primaryAction}</div>}
        </div>
        {tabs && (
          <nav className="pagehead__tabs" aria-label={`${title} sections`}>
            {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className="pagehead__tab">{t.label}</NavLink>)}
          </nav>
        )}
      </div>
    </>
  );
}
