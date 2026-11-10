import { useParams } from 'react-router-dom';
import { getProjectActivity } from '../../../api';
import { useResource } from '../../../api/useResource';
import { ActivityFeed, type ActivityDay } from '../../../ui/ActivityFeed';
import { ListStateBlock } from '../../../ui/ListState';
import { GoTo } from '../../shared/go-to';
import { isLive } from '../../../api/live';
import { NotAvailable } from '../../../ui/NotAvailable';

function MockProjectActivityScreen() {
  const { id = '' } = useParams();
  const { state, data, retry } = useResource(() => getProjectActivity(id), [id]);
  const events = data ?? [];
  const days: ActivityDay[] = [...new Set(events.map((e) => e.day))].map((day) => ({ day, events: events.filter((e) => e.day === day) }));
  const effective = state === 'ready' && !events.length ? 'empty' : state;
  return (
    <>
      <h2 className="t-h2">Activity</h2>
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Activity" onRetry={retry} capability="view project activity" empty={{ message: 'Nothing has happened on this project yet.', action: <GoTo to={`/firm/projects/${id}`}>See project overview</GoTo> }} />
        : <div className="solid-panel panel"><ActivityFeed days={days} /></div>}
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function ProjectActivityScreen() {
  return isLive ? <><h2 className="t-h2">Activity</h2><div className="solid-panel"><NotAvailable detail="Everything that happens on this project, day by day." /></div></> : <MockProjectActivityScreen />;
}
