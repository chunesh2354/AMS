import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, UserMinus, UserPlus, Users } from 'lucide-react';
import { getPeople, personName, type Person } from '../../api';
import { useResource } from '../../api/useResource';
import { Avatar, AvatarGroup } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { PageHeader } from '../../ui/PageHeader';
import { Segmented } from '../../ui/Segmented';
import { StatusChip } from '../../ui/StatusChip';
import { AddPersonSheet } from './add-person-sheet';
import { DeactivateSheet } from './person-sheets';

type Tab = 'Active' | 'Invited' | 'Pending' | 'Deactivated';
const options = (values: string[]) => [...new Set(values)].sort().map((v) => ({ value: v, label: v }));

export function PeopleScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { state, data, retry } = useResource(getPeople, []);
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [deactivating, setDeactivating] = useState<Person | null>(null);
  const tab = (params.get('status') as Tab) || 'Active';
  const people = useMemo(() => data ?? [], [data]);

  const filters: FilterDef[] = useMemo(() => [
    { type: 'search', key: 'q', label: 'Search people' },
    { type: 'select', key: 'issue', label: 'Issue', options: [{ value: 'missing-time', label: 'Missing time' }] },
    { type: 'select', key: 'manager', label: 'Manager', options: options(people.filter((p) => p.managerId).map((p) => personName(p.managerId))) },
    { type: 'select', key: 'office', label: 'Office', options: options(people.map((p) => p.office)) },
    { type: 'multi', key: 'skill', label: 'Skill', options: options(people.flatMap((p) => p.skills)) },
    { type: 'select', key: 'project', label: 'Project', options: options(people.flatMap((p) => p.projects)) },
    { type: 'select', key: 'type', label: 'Type', options: options(people.map((p) => p.type)) },
  ], [people]);

  const rows = useMemo(() => {
    const q = params.get('q')?.toLowerCase() ?? '';
    const skills = params.get('skill')?.split(',') ?? [];
    return people.filter((p) =>
      (tab === 'Active' ? p.employment === 'Active' : tab === 'Invited' ? p.invitation === 'Sent' : tab === 'Pending' ? p.employment === 'Pending start' : p.employment === 'Ended')
      && (!q || `${p.name} ${p.title}`.toLowerCase().includes(q))
      && (params.get('issue') !== 'missing-time' || p.missingTime)
      && (!params.get('manager') || personName(p.managerId) === params.get('manager'))
      && (!params.get('office') || p.office === params.get('office'))
      && (!skills.length || skills.some((s) => p.skills.includes(s)))
      && (!params.get('project') || p.projects.includes(params.get('project')!))
      && (!params.get('type') || p.type === params.get('type')));
  }, [people, params, tab]);

  const setTab = (next: Tab) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    if (next === 'Active') n.delete('status'); else n.set('status', next);
    return n;
  }, { replace: true });

  const columns: Column<Person>[] = [
    {
      key: 'person', header: 'Person', value: (p) => p.name, sortable: true,
      render: (p) => <span className="dt__person"><Avatar name={p.name} /><span><span style={{ display: 'block', fontWeight: 500 }}>{p.name}</span><span className="t-caption ink-2" style={{ fontWeight: 400 }}>{p.title}</span></span></span>,
    },
    { key: 'manager', header: 'Manager', value: (p) => personName(p.managerId), sortable: true },
    { key: 'office', header: 'Office', value: (p) => p.office },
    { key: 'type', header: 'Type', value: (p) => (p.daysPerWeek < 5 ? `${p.type}, ${p.daysPerWeek} days` : p.type), sortable: true },
    { key: 'status', header: 'Status', value: (p) => p.employment, render: (p) => <span className="chip-row"><StatusChip size="sm" status={p.employment} /><StatusChip size="sm" status={p.login} label={`Login ${p.login.toLowerCase()}`} /></span> },
    {
      key: 'projects', header: 'Projects', value: (p) => p.projects.length,
      render: (p) => (p.projects.length
        ? <AvatarGroup size={20} names={p.projects} max={3} text={(code) => code.replace('PRJ-', '')} />
        : <span className="ink-2">No projects yet</span>),
    },
  ];

  const emptyFor: Record<Tab, string> = {
    Active: 'No one matches these filters.', Invited: 'No one has been invited yet.', Pending: 'No one is waiting to start.', Deactivated: 'No one has been deactivated.',
  };

  return (
    <>
      <PageHeader
        title="People"
        meta={state !== 'loading' && <span className="t-numeric ink-2">{people.length} people</span>}
        primaryAction={<Button variant="primary" icon={<UserPlus size={20} strokeWidth={1.5} aria-hidden />} onClick={() => setAdding(true)}>Add person</Button>}
      />
      <div className="chip-row">
        <Segmented<Tab> label="Status" value={tab} onChange={setTab} options={(['Active', 'Invited', 'Pending', 'Deactivated'] as Tab[]).map((v) => ({ value: v, label: v }))} />
      </div>
      <FilterBar filters={filters} />
      <DataTable
        label="People" columns={columns} rows={state === 'empty' ? [] : rows} rowKey={(p) => p.id} state={state === 'ready' && !rows.length ? 'empty' : state}
        columnPicker onRetry={retry} capability="view people"
        onRowClick={(p) => navigate(`/firm/people/${p.id}`)}
        empty={{ icon: <Users size={20} strokeWidth={1.5} aria-hidden />, message: emptyFor[tab], action: <Button variant="primary" onClick={() => setAdding(true)}>Add person</Button> }}
        rowActions={(p) => [
          { label: 'View profile', icon: <Eye size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => navigate(`/firm/people/${p.id}`) },
          { label: 'Deactivate', icon: <UserMinus size={16} strokeWidth={1.5} aria-hidden />, danger: true, onSelect: () => setDeactivating(p) },
        ]}
      />
      <AddPersonSheet open={adding} onClose={() => setAdding(false)} people={people} />
      <DeactivateSheet person={deactivating} onClose={() => setDeactivating(null)} />
    </>
  );
}
