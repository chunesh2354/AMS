import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../IconButton';
import { VARIANT_ICON, VARIANT_TONE, type ToastVariant } from '../Toast';

export type InlineAlertProps = { variant?: ToastVariant; title: string; children?: ReactNode; links?: { label: string; href: string }[]; dismissible?: boolean };

export function InlineAlert({ variant = 'info', title, children, links, dismissible }: InlineAlertProps) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const Icon = VARIANT_ICON[variant];
  return (
    <div className={`alert tone-${VARIANT_TONE[variant]}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} strokeWidth={1.5} className="alert__icon" aria-hidden />
      <div className="alert__main">
        <p className="alert__title">{title}</p>
        {children && <p>{children}</p>}
        {links && <div className="alert__links">{links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</div>}
      </div>
      {dismissible && <IconButton dense label="Dismiss" icon={<X size={16} strokeWidth={1.5} aria-hidden />} onClick={() => setGone(true)} />}
    </div>
  );
}
