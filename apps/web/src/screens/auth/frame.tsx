import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StudioClock, type StudioClockProps } from '../../ui/StudioClock';
import '../../ui/styles/auth.css';

export const SUPPORT_EMAIL = 'support@csdv.in';
/** There is no self-service reset yet, so "Forgot password?" writes to support. */
export const FORGOT_PASSWORD_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Password reset')}`;

export const LOGIN_PATHS = { chooser: '/login', studio: '/login/studio', team: '/login/team', platform: '/platform/login' } as const;

/** The white page, the Practice mark, and whatever the header's right side needs. */
export function AuthPage({ headerEnd, children, footer }: { headerEnd?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth-header">
        <Link to={LOGIN_PATHS.chooser} className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true" />
          Practice
        </Link>
        {headerEnd}
      </header>
      {children}
      {footer}
    </div>
  );
}

export function BackToOptions() {
  return (
    <Link to={LOGIN_PATHS.chooser} className="auth-header__link">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 12H5M11 6l-6 6 6 6" /></svg>
      All sign-in options
    </Link>
  );
}

/** Form on the left, the clock on the right; they stack on narrow screens. */
export function AuthSplit({ children, clock, wide }: { children: ReactNode; clock?: StudioClockProps; wide?: boolean }) {
  return (
    <main className="auth-split">
      <section className="auth-split__form">
        <div className={wide ? 'auth-panel auth-panel--invite' : 'auth-panel'}>{children}</div>
      </section>
      <aside className="auth-split__aside" aria-label={clock?.label ?? 'Studio time'}>
        <StudioClock {...clock} />
      </aside>
    </main>
  );
}

export function AuthHeading({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="auth-heading">
      <h1 className="auth-title">{title}</h1>
      {lead && <p className="auth-lead">{lead}</p>}
    </div>
  );
}

/** A problem with the whole form: a black frame with a redline mark. */
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div className="auth-alert" role="alert">
      <svg className="auth-alert__icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.5" /></svg>
      <span>{children}</span>
    </div>
  );
}

/** A password input with a Show/Hide button. The button's name is "Show password" or "Hide password", and aria-pressed says which. */
export function SecretInput({ shown, onToggle, inputProps }: {
  shown: boolean;
  onToggle: () => void;
  inputProps: InputHTMLAttributes<HTMLInputElement> & { id: string };
}) {
  return (
    <div className="auth-secret">
      <input {...inputProps} className="auth-secret__input" type={shown ? 'text' : 'password'} />
      <button type="button" className="auth-secret__toggle" aria-pressed={shown} aria-controls={inputProps.id} onClick={onToggle}>
        {shown ? 'Hide' : 'Show'}{' '}<span className="sr-only">password</span>
      </button>
    </div>
  );
}

export type DoorLink = { lead: string; label: string; to?: string };

/** The other ways in, as hairline rows under the form. A row without a destination is plain text. */
export function DoorLinks({ links }: { links: DoorLink[] }) {
  return (
    <div className="auth-doorlinks">
      {links.map((l) => (l.to ? (
        <Link key={l.label} to={l.to} className="auth-doorlinks__row">
          <span className="auth-doorlinks__lead">{l.lead}</span><span>{l.label}</span>
        </Link>
      ) : (
        <p key={l.label} className="auth-doorlinks__row auth-doorlinks__row--plain">
          <span className="auth-doorlinks__lead">{l.lead}</span><span>{l.label}</span>
        </p>
      )))}
    </div>
  );
}
