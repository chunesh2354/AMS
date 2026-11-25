import { getLiveMySchedule, loadLevel, mondayOf, wdm, dm, type LiveMySchedule } from '../../api/live/calendar';
import { hoursOf } from '../../api/live';
import { useResource } from '../../api/useResource';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { InlineAlert } from '../../ui/InlineAlert';
import { formatDate, formatHours } from '../../ui/format';
import { cx } from '../../ui/cx';
import '../firm/calendar.css';

type Week = LiveMySchedule['weeks'][number];
const h = (v: string) => formatHours(hoursOf(v) ?? 0);

/** What a week's load cell says: the booked share of the hours available, or that the person is away. */
function loadText(w: Week) {
  const level = loadLevel(w);
  if (level === 'away') return 'Away';
  return w.load_pct == null ? '0%' : `${w.load_pct}%`;
}

/** The days off in a week: studio holidays and the person's own leave (theirs to see in full, pending included). */
function daysOff(w: Week) {
  return w.days.flatMap((d) => {
    const out: string[] = [];
    if (d.holiday) out.push(`${wdm(d.date)}: ${d.holiday.name}${d.holiday.half_day ? ', half day' : ''}`);
    if (d.leave) out.push(`${wdm(d.date)}: ${d.leave.leave_type.name}${d.leave.half_day ? ', half day' : ''}${d.leave.status === 'Approved' ? '' : ' (pending)'}`);
    return out;
  });
}

function WeekRow({ w, today }: { w: Week; today: string }) {
  const level = loadLevel(w);
  const now = mondayOf(today) === w.week_start;
  const off = daysOff(w);
  const pending = hoursOf(w.leave_pending) ?? 0;
  return (
    <section className="sched-week" aria-labelledby={`wk-${w.week_start}`}>
      <div className="sched-week__head">
        <h2 id={`wk-${w.week_start}`} className={cx('sched-week__title', now && 'is-now')}>Week of {dm(w.week_start)}{now ? ', this week' : ''}</h2>
        <span
          className={cx('load-cell', `load-cell--${level}`)}
          role="img"
          aria-label={level === 'away' ? 'Away all week' : `${w.load_pct ?? 0}% booked${w.conflict ? `, over by ${h(w.over_hours)}` : ''}`}
        >
          {loadText(w)}
        </span>
        <span className="t-caption ink-2 t-numeric">Booked {h(w.allocated)} of {h(w.available)} available</span>
        <span className="t-caption ink-2 t-numeric">{h(w.scheduled)} scheduled{(hoursOf(w.holiday_hours) ?? 0) > 0 ? `, ${h(w.holiday_hours)} holiday` : ''}{(hoursOf(w.leave_approved) ?? 0) > 0 ? `, ${h(w.leave_approved)} leave` : ''}</span>
        {pending > 0 && <span className="t-caption ink-2 t-numeric">{formatHours(pending)} leave pending, not taken off yet</span>}
      </div>
      <div className="sched-week__body">
        {w.conflict && <InlineAlert variant="danger" title={`Over by ${h(w.over_hours)} this week`}>Your confirmed bookings are more than the hours you have. Talk to your project manager.</InlineAlert>}
        {w.allocations.length > 0
          ? (
            <ul className="sched-allocs" aria-label={`Bookings, week of ${dm(w.week_start)}`}>
              {w.allocations.map((a) => (
                <li key={a.id} className={cx('sched-alloc', a.state === 'tentative' && 'sched-alloc--tentative')}>
                  <span>
                    <span className="t-numeric">{a.project.code}</span> {a.project.name}
                    <span className="t-caption ink-2">{a.phase ? `, ${a.phase.name}` : ''}{a.state === 'tentative' ? ', tentative' : ''}{a.on_hold ? ', on hold' : ''}</span>
                  </span>
                  <span className="t-numeric">{h(a.hours)}</span>
                </li>
              ))}
            </ul>
          )
          : <p className="t-body-sm ink-2" style={{ margin: 0 }}>Nothing booked this week.</p>}
        {off.length > 0 && <ul className="sched-days" aria-label={`Days off, week of ${dm(w.week_start)}`}>{off.map((t) => <li key={t} className="sched-day">{t}</li>)}</ul>}
      </div>
    </section>
  );
}

/** My schedule from GET /me/schedule: only the published plan, week by week, with holidays and the person's own leave. Read-only. */
export function LiveMyScheduleScreen() {
  const { state, data, retry } = useResource(() => getLiveMySchedule(), []);
  const weeks = data?.weeks ?? [];
  const booked = weeks.some((w) => w.allocations.length > 0);
  const rev = data?.last_published;
  return (
    <>
      <PageHeader
        title="My schedule"
        subtitle={rev ? `Plan revision ${rev.revision_no}, published ${formatDate(rev.published_at.slice(0, 10))} by ${rev.published_by.name}.` : undefined}
        meta={data && <span className="t-numeric ink-2">{formatDate(data.from)} to {formatDate(data.to)}</span>}
      />
      {state !== 'ready' || !data
        ? <ListStateBlock state={state === 'ready' ? 'loading' : state} label="Your schedule" onRetry={retry} capability="view this schedule" />
        : (
          <>
            {!booked && <InlineAlert title="Nothing is published for you in these weeks.">Bookings show here once a project manager publishes the plan.</InlineAlert>}
            <div className="sched-weeks">{weeks.map((w) => <WeekRow key={w.week_start} w={w} today={data.today} />)}</div>
          </>
        )}
    </>
  );
}
