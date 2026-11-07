import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Play, Sun } from 'lucide-react';
import { getMyDay, personName, type Task } from '../../api';
import { useResource } from '../../api/useResource';
import { useOverlays } from '../../app/overlays';
import { useSession, useTimer } from '../../app/session';
import { QueueDashboard } from '../../layouts/QueueDashboard';
import { TODAY } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { QueueCard } from '../../ui/QueueCard';
import { SegmentedBar } from '../../ui/SegmentedBar';
import { Skeleton } from '../../ui/Skeleton';
import { TaskRow } from '../../ui/TaskRow';
import { formatDate, formatHours } from '../../ui/format';
import { TaskSheet } from '../shared/task-sheet';
import { taskStatus } from '../shared/task-bits';

const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const;

export function MyDayScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const timer = useTimer();
  const { openLogTime, openLeave } = useOverlays();
  const { state, data, retry } = useResource(() => getMyDay(viewer.id), [viewer.id]);
  const [open, setOpen] = useState<Task | null>(null);
  const first = viewer.name.split(' ')[0];
  const c = data?.counts;
  const cards = !c
    ? Array.from({ length: 6 }, (_, n) => <Skeleton key={n} kind="card" />)
    : [
      <QueueCard key="due" count={c.dueToday} label="Due today" severity={c.dueToday ? 'warn' : 'ok'} onClick={() => navigate('/me/work')} />,
      <QueueCard key="blocked" count={c.blocked} label="Blocked" severity={c.blocked ? 'danger' : 'ok'} onClick={() => navigate('/me/work')} />,
      <QueueCard key="reviews" count={c.reviews} label="Reviews requested" severity={c.reviews ? 'warn' : 'ok'} onClick={() => navigate('/me/work')} />,
      <QueueCard key="missing" count={c.missingDays} label="Missing time days" severity={c.missingDays ? 'warn' : 'ok'} onClick={() => navigate('/me/time')} />,
      <QueueCard key="returned" count={c.returned} label="Returned" severity={c.returned ? 'warn' : 'ok'} onClick={() => navigate('/me/time')} />,
      <QueueCard key="leave" count={c.leaveDecisions} label="Leave decisions" severity="neutral" onClick={() => navigate('/me/leave')} />,
    ];
  const today = data?.today ?? [];
  const effective = state === 'ready' && !today.length ? 'empty' : state;
  const allocation = data?.allocation ?? [];
  const COLORS = ['accent', 'neutral', 'ok'] as const;
  return (
    <>
      <PageHeader display title={`Good afternoon, ${first}`} meta={<span className="t-numeric ink-2">{formatDate(TODAY)}</span>} />
      <QueueDashboard
        cards={cards}
        main={(
          <section className="solid-panel" aria-labelledby="today">
            <div className="attention__head"><h2 id="today" className="t-h2">Today</h2>{effective === 'ready' && <span className="t-numeric ink-2">{today.length}</span>}</div>
            {effective !== 'ready'
              ? <div className="attention__state"><ListStateBlock state={effective} label="Your tasks" onRetry={retry} capability="view your tasks" empty={{ message: 'Nothing is due today.', action: <Button variant="primary" onClick={() => navigate('/me/work')}>See all my work</Button> }} /></div>
              : (
                <ul className="inbox__list">
                  {today.map((t) => <TaskRow key={t.id} title={t.title} where={`${t.project} · ${t.phase}`} due={t.due} priority={t.priority} status={taskStatus(t)} reviewer={personName(t.reviewerId)} onOpen={() => setOpen(t)} />)}
                </ul>
              )}
          </section>
        )}
        side={(
          <>
            <section className="card glass" aria-labelledby="week-alloc">
              <div className="panel__head"><h2 id="week-alloc" className="t-h2">This week's allocation</h2><span className="t-numeric">{formatHours(allocation.reduce((s, a) => s + a.hours, 0))}</span></div>
              {allocation.length
                ? <SegmentedBar label="This week's allocation" segments={allocation.map((a, n) => ({ label: a.label, value: a.hours, display: formatHours(a.hours), color: COLORS[n % COLORS.length] }))} />
                : <p className="t-body-sm ink-2">Nothing is allocated to you this week.</p>}
            </section>
            <section className="card glass" aria-labelledby="quick">
              <h2 id="quick" className="t-h2">Quick actions</h2>
              <div className="toolbar">
                <Button icon={<Clock {...i} />} onClick={() => openLogTime()}>Log time</Button>
                <Button icon={<Play {...i} />} disabled={timer.running} onClick={() => timer.start()}>Start timer</Button>
                <Button icon={<Sun {...i} />} onClick={openLeave}>Request leave</Button>
              </div>
            </section>
          </>
        )}
      />
      <TaskSheet task={open} onClose={() => setOpen(null)} />
    </>
  );
}
