import type { ReactNode } from 'react';
import { Combobox, type Option } from '../Combobox';
import { Avatar } from '../Avatar';
import type { FieldBaseProps } from '../Field';

export type PersonOption = { id: string; name: string; title?: string };

export type PersonPickerProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  people: PersonOption[];
  recent?: string[];
  value: string | null;
  onChange?: (id: string | null) => void;
  empty?: ReactNode;
  defaultOpen?: boolean;
};

const toOption = (p: PersonOption, group?: string): Option => ({
  value: p.id, label: p.name, meta: p.title, keywords: p.title, group, icon: <Avatar name={p.name} size={20} />,
});

/** Avatar rows with search; recents are listed first until the user types. */
export function PersonPicker({ people, recent, value, onChange, empty, defaultOpen, ...field }: PersonPickerProps) {
  const rec = people.filter((p) => recent?.includes(p.id));
  const initial = recent?.length
    ? [...rec.map((p) => toOption(p, 'Recent')), ...people.filter((p) => !recent.includes(p.id)).map((p) => toOption(p, 'Everyone'))]
    : undefined;
  return (
    <Combobox {...field} placeholder="Search people" options={people.map((p) => toOption(p))} initial={initial} value={value} onChange={onChange} empty={empty ?? 'No one by that name.'} defaultOpen={defaultOpen} />
  );
}
