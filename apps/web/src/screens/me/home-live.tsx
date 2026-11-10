import { Link, useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useResource } from '../../api/useResource';
import { getMyHome, greetingFor, type LiveMyHome } from '../../api/live/me';
import { rangeLabel } from '../../api/live/time';
import { useOverlays } from '../../app/overlays';
import { useSession } from '../../app/session';
import { QueueDashboard } from '../../layouts/QueueDashboard';
import { Button } from '../../ui/Button';
import { DayTotalRing } from '../../ui/DayTotalRing';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { QueueCard } from '../../ui/QueueCard';
import { StatusChip } from '../../ui/StatusChip';
import { formatDate, formatHours } from '../../ui/format';

const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const;
const timeOf = (iso: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
};

/**
 * Home in live mode: everything comes from GET /me/home. Tasks are not in this round, so the task list and its
 * queue cards are not shown; leave has no endpoint yet, so there is no Request leave action here.
 */
export function LiveMyDayScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const { openLogTime } = useOverlays();
  const { state, data, retry } = useResource(getMyHome, [viewer.id]);
  const first = viewer.name.split(' ')[0];
  const tz = data?.timeZone ?? viewer.firm?.timezone ?? 'Asia/Kolkata';
  const title = `${greetingFor(tz)}, ${first}`;
  if (state !== 'ready' || !data) {
    return (
      <>
        <PageHeader display title={title} />
        <ListStateBlock state={state === 'ready' ? 'loading' : state} label="Your day" rows={6} onRetry={retry} capability="see your day" />
      </>
    );
  }
  const cards = [
    <QueueCard key="returned" count={data.returned.length} label="Returned lines" severity={data.returned.length ? 'warn' : 'ok'} onClick={() => navigate('/me/time')} />,
    <QueueCard key="pending" count={data.pending.length} label="My requests pending" severity="neutral" />,
    ...(data.approvals == null ? [] : [<QueueCard key="approve" count={data.approvals} label="Waiting for me to approve" severity={data.approvals ? 'warn' : 'ok'} onClick={() => navigate('/firm/approvals')} />]),
    <QueueCard key="projects" count={data.projects.length} label="My projects" severity="neutral" onClick={() => navigate('/me/work')} />,
  ];
  return (
    <>
      <PageHeader display title={title} meta={<span className="t-numeric ink-2">{formatDate(data.today)}</span>} />
      <QueueDashboard
        cards={cards}
        main={(
          <>
            <WeekPanel data={data} />
            <ReturnedPanel data={data} />
          </>
        )}
        side={(
          <>
            {data.timer && (
              <section className="card glass" aria-labelledby="timer">
                <div className="panel__head"><h2 id="timer" className="t-h2">Timer running</h2><span className="t-numeric">since {timeOf(data.timer.startedAt, tz)}</span></div>
                <p className="t-body-sm">{data.timer.where}</p>
                <div className="toolbar"><Button onClick={() => navigate('/me/time')}>Open my time</Button></div>
              </section>
            )}
            <ProjectsPanel data={data} />
            {data.pending.length > 0 && (
              <section className="card glass" aria-labelledby="pending">
                <div className="panel__head"><h2 id="pending" className="t-h2">Waiting for approval</h2><span className="t-numeric ink-2">{data.pending.length}</span></div>
                <ul className="link-list">
                  {data.pending.map((p) => <li key={p.id}><span>{p.label} · {p.where}</span><span className="t-numeric ink-2">{p.week ? `Week of ${formatDate(p.week)}` : ''}</span></li>)}
                </ul>
              </section>
            )}
            <section className="card glass" aria-labelledby="quick">
              <h2 id="quick" className="t-h2">Quick actions</h2>
              <div className="toolbar">
                <Button icon={<Clock {...i} />} onClick={() => openLogTime()}>Log time</Button>
                <Button onClick={() => navigate('/me/time')}>Open my time</Button>
              </div>
            </section>
          </>
        )}
      />
    </>
  );
}

function WeekPanel({ data }: { data: LiveMyHome }) {
  const { week } = data;
  return (
    <section className="solid-panel" aria-labelledby="week">
      <div className="attention__head">
        <h2 id="week" className="t-h2">This week</h2>
        <span className="t-numeric ink-2">{formatHours(week.hours)} of {formatHours(week.scheduled)} scheduled</span>
      </div>
      <div className="stack-4" style={{ padding: 'var(--s-4)' }}>
        <p className="t-body-sm ink-2">{rangeLabel(week.start, week.end)}</p>
        <ul aria-label="Hours by day" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', listStyle: 'none', margin: 0, padding: 0 }}>
          {week.days.map((d) => (
            <li key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s-1)' }}>
              <DayTotalRing hours={d.hours} scheduled={d.scheduled} label={d.key} />
              <span className="t-caption ink-2">{d.key}</span>
            </li>
          ))}
        </ul>
        <dl className="def-list">
          <dt>This week</dt><dd><StatusChip status={data.thisWeek.status} size="sm" /></dd>
          <dt>Last week</dt><dd><StatusChip status={data.lastWeek.status} size="sm" /> <span className="t-numeric ink-2">{formatHours(data.lastWeek.hours)}</span></dd>
        </dl>
        {data.notices.map((n) => <InlineAlert key={n} variant="warn" title={n} links={[{ label: 'Open my time', href: '/me/time' }]} />)}
      </div>
    </section>
  );
}

function ReturnedPanel({ data }: { data: LiveMyHome }) {
  if (!data.returned.length) return null;
  return (
    <section className="solid-panel attention" aria-labelledby="returned">
      <div className="attention__head"><h2 id="returned" className="t-h2">Returned to you</h2><span className="t-numeric ink-2">{data.returned.length}</span></div>
      <ul className="inbox__list">
        {data.returned.map((l) => (
          <li key={l.key}>
            <Link to="/me/time" className="attention__row">
              <StatusChip status="Returned" size="sm" />
              <span className="attention__main">
                <span className="attention__title">{l.title} · {l.where}</span>
                <span className="t-body-sm ink-2">{l.reason ?? 'No reason given'} · week of {formatDate(l.week)}</span>
              </span>
              <span className="t-numeric">{formatHours(l.hours)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectsPanel({ data }: { data: LiveMyHome }) {
  return (
    <section className="card glass" aria-labelledby="my-projects">
      <div className="panel__head"><h2 id="my-projects" className="t-h2">My projects</h2><span className="t-numeric ink-2">{data.projects.length}</span></div>
      {data.projects.length
        ? (
          <ul className="link-list" style={{ gap: 'var(--s-4)' }}>
            {data.projects.map((p) => (
              <li key={p.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <span className="ov-project__line"><span className="ov-project__name">{p.code} {p.name}</span><span className="ink-2">{p.role}</span></span>
                {p.recent.length
                  ? <span className="t-body-sm ink-2">Recently: {p.recent.map((ph) => `${ph.name} ${formatHours(ph.hours)}`).join(', ')}</span>
                  : <span className="t-body-sm ink-3">No time logged in the last four weeks</span>}
              </li>
            ))}
          </ul>
        )
        : <p className="t-body-sm ink-2">You are not on any project team yet.</p>}
    </section>
  );
}
