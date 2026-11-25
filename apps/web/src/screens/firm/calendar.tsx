import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { isLive } from '../../api/live';
import {
  DAY_NAMES, MONTH_NAMES, addDays, calItem, dayNum, dowIndex, getCalendar, itemsOn, monthGrid, monthLabel, monthStart, mondayOf, shiftMonth, weekLabel, wdm,
  type CalFilter, type CalItem, type LiveCalendar, type LiveCalendarEvent,
} from '../../api/live/calendar';
import { getLiveProjects } from '../../api/live/projects';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { Popover } from '../../ui/Popover';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { cx } from '../../ui/cx';
import './calendar.css';

type View = 'month' | 'week' | 'list';
type Project = { code: string; name: string; onHold?: boolean };

const VIEWS: { value: View; label: string }[] = [{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }];
const TYPES: { value: CalFilter; label: string; mk: string }[] = [
  { value: 'phase', label: 'Phases', mk: 'cal-mk--fill' },
  { value: 'task', label: 'Task due dates', mk: 'cal-mk--line' },
  { value: 'leave', label: 'Leave', mk: 'cal-mk--leave' },
  { value: 'holiday', label: 'Holidays', mk: 'cal-mk--band' },
  { value: 'milestone', label: 'Billing milestones', mk: 'cal-mk--dia' },
];
const ALL_TYPES = Object.fromEntries(TYPES.map((t) => [t.value, true])) as Record<CalFilter, boolean>;
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- Mock mode: the approved design's demo studio calendar ----------

/** The design's "today". Mock mode only; live mode takes the studio's today from GET /calendar. */
const DEMO_TODAY = '2026-11-25';
const DEMO_PROJECTS: Project[] = [
  { code: 'PRJ-01', name: 'Lakeview Residence' },
  { code: 'PRJ-02', name: 'Orchard Commercial Block' },
  { code: 'PRJ-03', name: 'Heritage Cafe Refit', onHold: true },
];
const pr = (code: string) => { const p = DEMO_PROJECTS.find((x) => x.code === code)!; return { id: code, code, name: p.name }; };
const ph = (name: string) => ({ id: name, code: name.slice(0, 2).toUpperCase(), name });
const phase = (id: string, type: 'phase_start' | 'phase_end', date: string, code: string, name: string): LiveCalendarEvent =>
  ({ id, type, date, title: `${name} ${type === 'phase_start' ? 'starts' : 'ends'}`, project: pr(code), phase: ph(name) });
const task = (id: string, date: string, code: string, title: string, who: string, status = 'To do'): LiveCalendarEvent =>
  ({ id, type: 'task_due', date, title, status, project: pr(code), phase: null, task: { id, assignee: { id: who, name: who }, mine: false } });
const leave = (id: string, from: string, to: string, who: string): LiveCalendarEvent =>
  ({ id, type: 'leave', date: from, start_date: from, end_date: to, half_day: false, status: 'Approved', title: `${who}: On leave`, label: 'On leave', leave_type: null, person: { id: who, ref_code: who, name: who }, mine: false });
const DEMO_EVENTS: LiveCalendarEvent[] = [
  phase('p1', 'phase_start', '2026-11-02', 'PRJ-01', 'Concept design'),
  phase('p2', 'phase_start', '2026-11-02', 'PRJ-02', 'Schematic design'),
  { id: 'h1', type: 'holiday', date: '2026-11-09', title: 'Diwali', half_day: false },
  task('t1', '2026-11-12', 'PRJ-01', 'Site survey drawings', 'Rohan Shetty', 'Done'),
  leave('l1', '2026-11-20', '2026-11-20', 'Karan Bhat'),
  task('t2', '2026-11-20', 'PRJ-02', 'Facade options set', 'Divya Menon'),
  task('t3', '2026-11-26', 'PRJ-01', 'Area statement', 'Arjun Das'),
  phase('p3', 'phase_end', '2026-11-27', 'PRJ-01', 'Concept design'),
  { id: 'b1', type: 'milestone', date: '2026-11-27', date_basis: 'phase_end', title: 'Invoice: Concept design stage', status: 'Ready', project: pr('PRJ-01'), phase: ph('Concept design') },
  phase('p4', 'phase_start', '2026-11-30', 'PRJ-01', 'Working drawings'),
  task('t4', '2026-11-30', 'PRJ-02', 'Structural coordination set', 'Karan Bhat'),
  task('t5', '2026-12-11', 'PRJ-01', 'Municipal submission drawings', 'Vikram Nair'),
  phase('p5', 'phase_end', '2026-12-18', 'PRJ-02', 'Schematic design'),
  { id: 'b2', type: 'milestone', date: '2026-12-18', date_basis: 'phase_end', title: 'Invoice: Schematic design stage', status: 'Planned', project: pr('PRJ-02'), phase: ph('Schematic design') },
  phase('p6', 'phase_start', '2026-12-21', 'PRJ-02', 'Design development'),
  leave('l2', '2026-12-21', '2026-12-24', 'Arjun Das'),
  { id: 'h2', type: 'holiday', date: '2026-12-25', title: 'Christmas', half_day: false },
];

async function demoCalendar(from: string, to: string, project: string | null): Promise<LiveCalendar> {
  const events = DEMO_EVENTS.filter((e) => {
    const end = e.type === 'leave' ? e.end_date : e.date;
    if (end < from || e.date > to) return false;
    if (!project || e.type === 'holiday') return true;
    return 'project' in e && e.project.code === project;
  });
  return { from, to, today: DEMO_TODAY, timezone: 'Asia/Kolkata', types: [], project: null, events };
}

// ---------- Screen ----------

/** Today in the studio's time zone, to pick the first month shown. The ring itself uses the server's today. */
function studioToday(timeZone?: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}

/** Phases, task due dates, leave, studio holidays and billing milestones. Live mode reads GET /calendar; mock mode shows the design's demo items. */
export function CalendarScreen() {
  const { viewer } = useSession();
  const start = isLive ? studioToday(viewer.firm?.timezone) : DEMO_TODAY;
  const [view, setView] = useState<View>('month');
  const [month, setMonth] = useState(() => monthStart(start));
  const [week, setWeek] = useState(() => mondayOf(start));
  const [project, setProject] = useState<string>('all');
  const [types, setTypes] = useState<Record<CalFilter, boolean>>(ALL_TYPES);

  const grid = monthGrid(month);
  const range = view === 'week' ? { from: week, to: addDays(week, 6) } : { from: grid.start, to: grid.end };
  const code = project === 'all' ? null : project;
  const cal = useResource(() => (isLive ? getCalendar(range.from, range.to, code) : demoCalendar(range.from, range.to, code)), [range.from, range.to, code]);
  const projectList = useResource<Project[]>(
    async () => (isLive ? (await getLiveProjects()).filter((p) => p.status !== 'Archived').map((p) => ({ code: p.code, name: p.name, onHold: p.status === 'On hold' })) : DEMO_PROJECTS),
    [],
  );
  const projects = projectList.data ?? [];

  const today = cal.data?.today ?? start;
  const items = useMemo(() => (cal.data?.events ?? []).map((e) => calItem(e, today)).filter((it) => types[it.filter]), [cal.data, today, types]);
  const isWeek = view === 'week';
  const period = isWeek ? weekLabel(week) : monthLabel(month);
  const step = (n: number) => (isWeek ? setWeek(addDays(week, 7 * n)) : setMonth(shiftMonth(month, n)));
  const picked = projects.find((p) => p.code === project);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Phases, task due dates, leave, studio holidays and billing milestones in one place. Leave shows who is away, never the type of leave."
      />
      <div className="cal-bar cal-bar--rule">
        <Segmented label="Calendar view" options={VIEWS} value={view} onChange={setView} />
        <div className="cal-nav" role="group" aria-label="Dates shown">
          <IconButton label={isWeek ? 'Previous week' : 'Previous month'} icon={<ChevronLeft size={16} strokeWidth={1.5} aria-hidden />} onClick={() => step(-1)} />
          <Button onClick={() => { setMonth(monthStart(today)); setWeek(mondayOf(today)); }}>Today</Button>
          <IconButton label={isWeek ? 'Next week' : 'Next month'} icon={<ChevronRight size={16} strokeWidth={1.5} aria-hidden />} onClick={() => step(1)} />
          <h2 className="cal-nav__title" aria-live="polite">{period}</h2>
        </div>
        <div className="cal-project">
          <Select
            label="Project" dense searchable={projects.length > 8} value={project}
            options={[{ value: 'all', label: 'All projects' }, ...projects.map((p) => ({ value: p.code, label: `${p.code} ${p.name}${p.onHold ? ', on hold' : ''}` }))]}
            onChange={setProject}
          />
        </div>
      </div>
      <div className="cal-bar">
        <div className="cal-filters" role="group" aria-label="Show item types">
          <span className="cal-filters__label">Show</span>
          {TYPES.map((t) => (
            <button key={t.value} type="button" className="cal-chip" aria-pressed={types[t.value]} onClick={() => setTypes({ ...types, [t.value]: !types[t.value] })}>
              <span className={cx('cal-mk', t.mk)} aria-hidden />{t.label}
            </button>
          ))}
        </div>
        <span className="cal-note"><span className="cal-mk cal-mk--overdue" aria-hidden />Overdue task</span>
        {picked && <span className="cal-note">Showing {picked.code} {picked.name}: its team&apos;s leave and the studio holidays too.</span>}
      </div>
      {cal.state !== 'ready'
        ? <ListStateBlock state={cal.state} label="The calendar" onRetry={cal.retry} capability="view the studio calendar" />
        : view === 'month'
          ? <MonthView month={month} items={items} today={today} period={period} />
          : view === 'week'
            ? <WeekView week={week} items={items} today={today} period={period} />
            : <ListView month={month} items={items} today={today} period={period} />}
    </>
  );
}

const dayLabel = (day: string, today: string, n?: number) =>
  `${DAY_NAMES[dowIndex(day)]} ${dayNum(day)} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1]}${day === today ? ', today' : ''}${n ? `, ${n} ${n === 1 ? 'item' : 'items'}` : ''}`;

function MonthView({ month, items, today, period }: { month: string; items: CalItem[]; today: string; period: string }) {
  const grid = monthGrid(month);
  const inMonth = (d: string) => d.slice(0, 7) === month.slice(0, 7);
  return (
    <div className="cal-scroll">
      <div className="cal" role="table" aria-label={period}>
        <div className="cal__row" role="row">
          {DOWS.map((d, i) => <div key={d} role="columnheader" className={cx('cal__dow', i >= 5 && 'is-wkend')}>{d}</div>)}
        </div>
        {Array.from({ length: grid.weeks }, (_, r) => (
          <div key={r} className="cal__row" role="row">
            {Array.from({ length: 7 }, (__, c) => {
              const day = addDays(grid.start, r * 7 + c);
              const list = itemsOn(items, day);
              return (
                <div key={day} role="cell" aria-label={dayLabel(day, today, list.length)} className={cx('cal__day', !inMonth(day) && 'is-out')}>
                  <span className={cx('cal__num', day === today && 'is-today')} aria-hidden>{dayNum(day)}</span>
                  {list.map((it) => <Entry key={it.id} item={it} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({ week, items, today, period }: { week: string; items: CalItem[]; today: string; period: string }) {
  return (
    <div className="cal-scroll">
      <div className="cal-week" role="table" aria-label={period}>
        <div className="cal-week__row" role="row">
          {DOWS.map((d, i) => {
            const day = addDays(week, i);
            const list = itemsOn(items, day);
            return (
              <div key={day} role="cell" aria-label={dayLabel(day, today, list.length)} className="cal-week__day">
                <div className={cx('cal-week__head', i >= 5 && 'is-wkend')} aria-hidden><span>{d}</span><span className={cx('cal__num', day === today && 'is-today')}>{dayNum(day)}</span></div>
                {list.map((it) => <Entry key={it.id} item={it} wrap />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({ month, items, today, period }: { month: string; items: CalItem[]; today: string; period: string }) {
  const end = shiftMonth(month, 1);
  const groups: { day: string; list: CalItem[] }[] = [];
  for (let day = month; day < end; day = addDays(day, 1)) {
    const list = itemsOn(items, day);
    if (list.length) groups.push({ day, list });
  }
  if (!groups.length) return <p className="cal-note cal-empty">Nothing matches these filters in {period}.</p>;
  return (
    <div className="cal-list">
      {groups.map((g) => (
        <section key={g.day} className="cal-list__group" aria-label={dayLabel(g.day, today)}>
          <h3 className={cx('cal-list__date', g.day === today && 'is-today')}>{wdm(g.day)}{g.day === today ? ', today' : ''}</h3>
          <ul className="cal-list__items">
            {g.list.map((it) => (
              <li key={it.id} className="cal-list__item">
                <span className={cx('cal-mk', marker(it))} aria-hidden />
                <span className="cal-list__main">
                  <span className={cx('cal-list__title', it.overdue && 'is-overdue', it.done && 'is-done')}>{it.label}</span>
                  <span className="cal-caption">{it.meta}</span>
                </span>
                <span className={cx('cal-list__status', it.overdue && 'is-red')}>{it.filter === 'task' ? it.status : ''}</span>
                {it.link ? <Link className="cal-pop__link" to={it.link.to}>{it.link.label}</Link> : <span />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function marker(it: CalItem) {
  switch (it.filter) {
    case 'phase': return 'cal-mk--fill';
    case 'milestone': return 'cal-mk--dia';
    case 'leave': return it.pending ? 'cal-mk--pending' : 'cal-mk--leave';
    case 'holiday': return 'cal-mk--band';
    default: return it.overdue ? 'cal-mk--overdue' : it.done ? 'cal-mk--done' : 'cal-mk--line';
  }
}

/** One item in a day: a holiday band or a marked line. Either opens a popover with the details and a link to its source. */
function Entry({ item, wrap }: { item: CalItem; wrap?: boolean }) {
  const aria = `${item.label}, ${item.filter === 'task' ? item.status : item.meta}`;
  return (
    <Popover
      label={item.label}
      placement="bottom-start"
      trigger={(p) => (item.filter === 'holiday'
        ? <button {...p} type="button" className={cx('cal-band', p['aria-expanded'] && 'is-open')} aria-label={aria}>{item.label}</button>
        : (
          <button
            {...p} type="button" aria-label={aria}
            className={cx('cal-it', wrap && 'cal-it--wrap', item.filter === 'phase' && 'cal-it--phase', item.overdue && 'cal-it--overdue', item.done && 'cal-it--done', item.pending && 'cal-it--pending', p['aria-expanded'] && 'is-open')}
          >
            <span className={cx('cal-mk', marker(item))} aria-hidden /><span className="cal-it__t">{item.label}</span>
          </button>
        ))}
    >
      {(close) => (
        <PopBody>
          <div className="cal-pop__head">
            <p className="cal-pop__title">{item.label}</p>
            <IconButton dense label="Close" icon={<X size={16} strokeWidth={1.5} aria-hidden />} onClick={close} />
          </div>
          <p className="cal-caption">{item.when}</p>
          <dl className="cal-pop__rows">
            {item.rows.map((r) => <div key={r.k} className="cal-pop__row"><dt>{r.k}</dt><dd className={cx(r.red && 'is-red')}>{r.v}</dd></div>)}
          </dl>
          {item.note && <p className="cal-caption">{item.note}</p>}
          {item.link && <Link className="cal-pop__link" to={item.link.to}>{item.link.label}</Link>}
        </PopBody>
      )}
    </Popover>
  );
}

/** The popover's body takes focus when it opens, so Tab reaches Close and the source link; Escape returns focus to the item. */
function PopBody({ children }: { children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { el.current?.focus(); }, []);
  return <div ref={el} className="cal-pop" tabIndex={-1}>{children}</div>;
}
