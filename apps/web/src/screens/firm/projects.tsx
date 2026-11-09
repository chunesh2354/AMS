import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { getPeople, getProjects, personName, type ProjectView } from '../../api';
import { CreateProjectSheet } from './create-project-sheet';
import { useResource } from '../../api/useResource';
import { apiFetch, isLive, type ListResponse } from '../../api/live';
import { mapProject, type ApiProject, type LiveProjectView } from '../../api/live/projects';
import { useSession } from '../../app/session';
import { Avatar } from '../../ui/Avatar';
import { BudgetBar } from '../../ui/BudgetBar';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { formatGrouped } from '../../ui/format';

const opts = (v: string[]) => [...new Set(v)].sort().map((x) => ({ value: x, label: x }));
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

/** A live row keeps the PM's name from GET /projects: ref codes (P01...) repeat the sample studio's, so they must never be looked up there. */
export type ProjectRow = ProjectView & { pmName?: string };
export const pmNameOf = (p: ProjectRow): string => p.pmName ?? personName(p.pmId);
export const toProjectRow = (p: ApiProject): LiveProjectView & { pmName: string } => ({ ...mapProject(p), pmName: p.pm?.name ?? 'Not set' });
const getLiveProjectRows = async (): Promise<ProjectRow[]> => (await apiFetch<ListResponse<ApiProject>>('/projects')).data.map(toProjectRow);

export function ProjectsScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const people = useResource(getPeople, []);
  const { state, data, retry } = useResource<ProjectRow[]>(() => (isLive ? getLiveProjectRows() : getProjects(viewer)), [viewer.id]);
  const projects = useMemo(() => data ?? [], [data]);

  const filters: FilterDef[] = useMemo(() => [
    { type: 'select', key: 'pm', label: 'PM', options: opts(projects.map((p) => pmNameOf(p))) },
    { type: 'select', key: 'client', label: 'Client', options: opts(projects.map((p) => p.client)) },
    { type: 'select', key: 'stage', label: 'Stage', options: opts(projects.map((p) => p.stage)) },
    { type: 'select', key: 'status', label: 'Status', options: opts(projects.map((p) => p.status)) },
    { type: 'select', key: 'risk', label: 'Risk', options: projects.map((p) => ({ value: slug(p.risk.label), label: p.risk.label })) },
  ], [projects]);

  const rows = projects.filter((p) =>
    (!params.get('pm') || pmNameOf(p) === params.get('pm'))
    && (!params.get('client') || p.client === params.get('client'))
    && (!params.get('stage') || p.stage === params.get('stage'))
    && (!params.get('status') || p.status === params.get('status'))
    && (!params.get('risk') || slug(p.risk.label) === params.get('risk')));

  const columns: Column<ProjectRow>[] = [
    { key: 'code', header: 'Code', value: (p) => p.code, sortable: true, render: (p) => <span className="t-numeric">{p.code}</span> },
    { key: 'name', header: 'Name', value: (p) => p.name, sortable: true },
    { key: 'client', header: 'Client', value: (p) => p.client, sortable: true },
    { key: 'pm', header: 'PM', value: (p) => pmNameOf(p), render: (p) => <span className="dt__person"><Avatar name={pmNameOf(p)} size={20} />{pmNameOf(p)}</span> },
    { key: 'stage', header: 'Stage', value: (p) => p.stage },
    { key: 'status', header: 'Status', type: 'status', value: (p) => p.status },
    { key: 'risk', header: 'Risk', value: (p) => p.risk.label, render: (p) => <span className="risk"><StatusChip dot status={p.risk.status} label={p.risk.label} />{p.risk.label}</span> },
    {
      key: 'hours', header: 'Hours', value: (p) => p.hours.actual, width: 180,
      render: (p) => <div className="stack-rows" style={{ gap: 'var(--s-1)' }}><BudgetBar mini baseline={p.hours.budget} actual={p.hours.actual} forecast={p.hours.forecast} /><span className="t-caption ink-2"><span className="t-numeric" style={{ fontSize: 12 }}>{formatGrouped(p.hours.actual)}</span> of <span className="t-numeric" style={{ fontSize: 12 }}>{formatGrouped(p.hours.budget)}</span> h</span></div>,
    },
    { key: 'next', header: 'Next milestone', type: 'date', value: (p) => p.nextMilestone, sortable: true },
  ];

  return (
    <>
      <PageHeader
        title="Projects"
        meta={state !== 'loading' && <span className="t-numeric ink-2">{projects.length} projects</span>}
        primaryAction={<Button variant="primary" onClick={() => setCreating(true)}>Create project</Button>}
      />
      <FilterBar filters={filters} />
      <DataTable
        label="Projects" columns={columns} rows={state === 'empty' ? [] : rows} rowKey={(p) => p.code} state={state === 'ready' && !rows.length ? 'empty' : state}
        onRetry={retry} capability="view projects" columnPicker onRowClick={(p) => navigate(`/firm/projects/${p.code}`)}
        empty={{ icon: <FolderKanban size={20} strokeWidth={1.5} aria-hidden />, message: 'No project matches these filters.', action: <Button variant="primary" onClick={() => setCreating(true)}>Create project</Button> }}
      />
      <CreateProjectSheet open={creating} onClose={() => setCreating(false)} people={people.data ?? []} />
    </>
  );
}
