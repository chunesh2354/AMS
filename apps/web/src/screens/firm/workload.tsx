import { getPeople, personName } from '../../api';
import { useResource } from '../../api/useResource';
import { PROJECTS } from '../../mock/studio-meridian';
import { PlannerLayout } from '../../layouts/PlannerLayout';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { PlannerLegend } from '../../ui/PlannerGrid';
import { Skeleton } from '../../ui/Skeleton';
import { PLANNER_HINT, usePlanner } from '../shared/use-planner';
import { GoTo } from '../shared/go-to';
import { isLive } from '../../api/live';
import { NotAvailablePage } from '../../ui/NotAvailable';

function MockWorkloadScreen() {
  const planner = usePlanner();
  const people = useResource(getPeople, []);
  const list = people.data ?? [];
  const filters: FilterDef[] = [
    { type: 'select', key: 'project', label: 'Project', options: PROJECTS.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })) },
    { type: 'select', key: 'team', label: 'Team', options: [...new Set(list.map((p) => p.managerId).filter(Boolean) as string[])].map((id) => ({ value: id, label: `${personName(id)}'s team` })) },
    { type: 'select', key: 'skill', label: 'Skill', options: [...new Set(list.flatMap((p) => p.skills))].sort().map((s) => ({ value: s, label: s })) },
  ];
  return (
    <>
      <PageHeader title="Workload" subtitle="Resource planner" period={planner.period} secondaryActions={planner.zoomControl} primaryAction={planner.publishButton} />
      {planner.state === 'loading'
        ? <Skeleton kind="planner" />
        : planner.state !== 'ready'
          ? <ListStateBlock state={planner.state} label="The plan" onRetry={planner.retry} capability="view the resource plan" empty={{ message: 'No allocations are planned yet.', action: <GoTo to="/firm/projects">Open projects</GoTo> }} />
          : <PlannerLayout tools={<FilterBar filters={filters} />} grid={planner.grid} foot={<PlannerLegend hint={PLANNER_HINT} />} />}
      {planner.sheets}
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function WorkloadScreen() {
  return isLive ? <NotAvailablePage title="Workload" detail="Who is booked on which project, week by week, against their capacity." /> : <MockWorkloadScreen />;
}
