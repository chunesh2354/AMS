import { Tooltip } from '../Tooltip';

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase();
};

export type AvatarProps = { name: string; size?: 20 | 28 | 36 };

export function Avatar({ name, size = 28 }: AvatarProps) {
  return <span className={`avatar avatar--${size}`} role="img" aria-label={name}>{initials(name)}</span>;
}

export type AvatarGroupProps = { names: string[]; size?: 20 | 28 | 36; max?: number };

export function AvatarGroup({ names, size = 28, max = 3 }: AvatarGroupProps) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="avatar-group">
      {shown.map((n) => <Tooltip key={n} text={n}><span tabIndex={0}><Avatar name={n} size={size} /></span></Tooltip>)}
      {extra > 0 && <span className={`avatar avatar--${size}`} role="img" aria-label={`${extra} more: ${names.slice(max).join(', ')}`}>+{extra}</span>}
    </span>
  );
}
