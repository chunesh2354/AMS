import { Outlet, useParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import type { Status } from '../../ui/status-colors';

const PROJECTS: Record<string, { name: string; status: Status; risk?: Status }> = {
  'PRJ-01': { name: 'Lakeview Residence', status: 'Active', risk: 'Overrun' },
  'PRJ-02': { name: 'Orchard Commercial Block', status: 'Active' },
  'PRJ-03': { name: 'Heritage Cafe Refit', status: 'On hold' },
};
const TABS = ['phases', 'tasks', 'staffing', 'time', 'costs', 'billing', 'changes', 'files', 'activity'];

export function ProjectLayout() {
  const { id = '' } = useParams();
  const p = PROJECTS[id] ?? { name: id, status: 'Draft' as Status };
  const base = `/firm/projects/${id}`;
  return (
    <>
      <PageHeader
        title={p.name}
        breadcrumb={[{ label: 'Projects', to: '/firm/projects' }, { label: id }]}
        meta={<><StatusChip size="sm" status={p.status} />{p.risk && <StatusChip size="sm" status={p.risk} />}</>}
        primaryAction={<Button variant="primary">Log time</Button>}
        tabs={[{ label: 'Overview', to: base, end: true }, ...TABS.map((t) => ({ label: t[0].toUpperCase() + t.slice(1), to: `${base}/${t}` }))]}
      />
      <Outlet />
    </>
  );
}
