import { useParams } from 'react-router-dom';
import { PlannerLayout } from '../../../layouts/PlannerLayout';
import { ListStateBlock } from '../../../ui/ListState';
import { PlannerLegend } from '../../../ui/PlannerGrid';
import { Skeleton } from '../../../ui/Skeleton';
import { PLANNER_HINT, usePlanner } from '../../shared/use-planner';
import { GoTo } from '../../shared/go-to';

export function ProjectStaffingScreen() {
  const { id = '' } = useParams();
  const planner = usePlanner(id);
  if (planner.state === 'loading') return <Skeleton kind="planner" />;
  if (planner.state !== 'ready') {
    return <ListStateBlock state={planner.state} label="Staffing" onRetry={planner.retry} capability="view project staffing" empty={{ message: 'Nobody is allocated to this project yet.', action: <GoTo to="/firm/workload">Open Workload</GoTo> }} />;
  }
  return (
    <>
      <PlannerLayout
        tools={<>{planner.period}{planner.zoomControl}<span style={{ marginLeft: 'auto' }}>{planner.publishButton}</span></>}
        grid={planner.grid} foot={<PlannerLegend hint={PLANNER_HINT} />}
      />
      {planner.sheets}
    </>
  );
}
