import type { FormHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export function Form({ children, className, ...rest }: FormHTMLAttributes<HTMLFormElement>) {
  return <form noValidate className={cx('form', className)} {...rest}>{children}</form>;
}

export function FormSection({ title, columns = 1, children }: { title?: string; columns?: 1 | 2; children: ReactNode }) {
  return (
    <section className="form__section">
      {title && <h3 className="t-h3">{title}</h3>}
      <div className={cx('form__fields', columns === 2 && 'form__fields--two')}>{children}</div>
    </section>
  );
}

/** Sticky footer: a validation summary on the left, actions on the right. */
export function FormFooter({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="form__footer">
      {summary && <p className="form__summary" role="status">{summary}</p>}
      {children}
    </div>
  );
}
