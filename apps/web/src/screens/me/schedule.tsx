import { useNavigate } from 'react-router-dom';
import { getMySchedule } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { PlannerLayout } from '../../layouts/PlannerLayout';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { PlannerGrid, PlannerLegend, type PlannerAllocation, type PlannerMark } from '../../ui/PlannerGrid';
import { Skeleton } from '../../ui/Skeleton';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { GoTo } from '../shared/go-to';
import { isLive } from '../../api/live';
import { NotAvailablePage } from '../../ui/NotAvailable';

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function MockMyScheduleScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const phone = useMediaQuery('(max-width: 767px)');
  const { state, data, retry } = useResource(() => getMySchedule(viewer.id), [viewer.id]);
  const weeks = data ?? [];
  const rows = weeks.map((w) => ({ id: w.label, label: w.label, sublabel: `${w.days.reduce((s, d) => s + d.cards.reduce((a, c) => a + c.hours, 0), 0)} h` }));
  const allocations: PlannerAllocation[] = weeks.flatMap((w) => w.days.flatMap((d, c) => d.cards.map((k, i) => ({ id: `${w.label}-${c}-${i}`, rowId: w.label, column: c, hours: k.hours, label: k.what, kind: k.kind }))));
  const off: PlannerMark[] = weeks.flatMap((w) => w.days.flatMap((d, c) => (d.off ? [{ rowId: w.label, column: c, label: d.off }] : [])));
  const markers: PlannerMark[] = weeks.flatMap((w) => w.days.flatMap((d, c) => (d.visit ? [{ rowId: w.label, column: c, label: d.visit }] : [])));
  const hasWork = allocations.length > 0;
  const effective = state === 'ready' && !hasWork ? 'empty' : state;
  return (
    <>
      <PageHeader title="My schedule" meta={weeks.length > 0 && <span className="t-numeric ink-2">02 Nov to 29 Nov 2026</span>} />
      {effective === 'loading'
        ? <Skeleton kind="planner" />
        : effective !== 'ready'
          ? <ListStateBlock state={effective} label="Your schedule" onRetry={retry} capability="view this schedule" empty={{ message: 'Nothing is planned for you in the next four weeks.', action: <GoTo to="/me/work">See my work</GoTo> }} />
          : (
            <PlannerLayout
              fit
              grid={(
                <PlannerGrid
                  readOnly label="My schedule" rowHeader="Week" firstColumnWidth={phone ? 72 : 112} columnMinWidth={phone ? 112 : 104}
                  columns={DOWS.map((d) => ({ key: d, label: d }))} rows={rows} allocations={allocations} off={off} markers={markers}
                  todayCell={{ rowId: '02 Nov', column: 4 }}
                  onCardClick={() => navigate('/me/work')}
                />
              )}
              foot={<PlannerLegend />}
            />
          )}
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function MyScheduleScreen() {
  return isLive ? <NotAvailablePage title="My schedule" detail="The projects you are booked on, week by week." /> : <MockMyScheduleScreen />;
}
