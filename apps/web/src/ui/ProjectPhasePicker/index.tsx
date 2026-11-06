import { Combobox, type Option } from '../Combobox';
import type { FieldBaseProps } from '../Field';

export type ProjectPhaseOption = { code: string; name: string; phases: { id: string; name: string }[] };

export type ProjectPhasePickerProps = Omit<FieldBaseProps, 'prefix' | 'suffix'> & {
  projects: ProjectPhaseOption[];
  recent?: string[];
  value: string | null;
  onChange?: (phaseId: string | null) => void;
  defaultOpen?: boolean;
};

export function ProjectPhasePicker({ projects, recent, value, onChange, defaultOpen, ...field }: ProjectPhasePickerProps) {
  const options: Option[] = projects.flatMap((p) =>
    p.phases.map((ph) => ({ value: ph.id, label: `${p.code} · ${ph.name}`, keywords: p.name, group: `${p.code} ${p.name}` })),
  );
  const initial = recent?.length
    ? [...options.filter((o) => recent.includes(o.value)).map((o) => ({ ...o, group: 'Recent' })), ...options.filter((o) => !recent.includes(o.value))]
    : undefined;
  return <Combobox {...field} placeholder="Search projects and phases" options={options} initial={initial} value={value} onChange={onChange} empty="No project or phase matches." defaultOpen={defaultOpen} />;
}
