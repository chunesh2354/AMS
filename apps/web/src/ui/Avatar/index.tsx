import { Tooltip } from '../Tooltip';

export const initials = (name: string) => {
  // Skip words that start with punctuation, such as the "(DEMO)" suffix, so they never become "P(".
  const words = name.trim().split(/\s+/).filter(Boolean);
  const named = words.filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const parts = named.length ? named : words;
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase();
};

export type AvatarProps = { name: string; size?: 20 | 28 | 32 | 36; /** Overrides derived initials, for things that are not people. */ text?: string };

export function Avatar({ name, size = 28, text }: AvatarProps) {
  return <span className={`avatar avatar--${size}`} role="img" aria-label={name}>{text ?? initials(name)}</span>;
}

export type AvatarGroupProps = { names: string[]; size?: 20 | 28 | 32 | 36; max?: number; text?: (name: string) => string };

export function AvatarGroup({ names, size = 28, max = 3, text }: AvatarGroupProps) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className={text ? 'avatar-group avatar-group--spaced' : 'avatar-group'}>
      {shown.map((n) => <Tooltip key={n} text={n}><span tabIndex={0}><Avatar name={n} size={size} text={text?.(n)} /></span></Tooltip>)}
      {extra > 0 && <span className={`avatar avatar--${size}`} role="img" aria-label={`${extra} more: ${names.slice(max).join(', ')}`}>+{extra}</span>}
    </span>
  );
}
