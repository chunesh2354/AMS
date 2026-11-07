import { useMemo } from 'react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import {
  canSeeRatesTab, getAvailability, getPeople, getPerson, getPersonActivity, getPersonLeave, getProjects, getRates, getWorkingPattern, personName, type Fenced, type LeaveRequest,
} from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { WorkspaceColumns } from '../../layouts/WorkspaceColumns';
import { ActivityFeed, type ActivityDay } from '../../ui/ActivityFeed';
import { Avatar } from '../../ui/Avatar';
import { availableHours, AvailabilityBar, AvailabilityLegend } from '../../ui/AvailabilityBar';
import { AttentionList } from '../../ui/AttentionList';
import { ConflictBanner } from '../../ui/ConflictBanner';
import { DataTable, RESTRICTED, type Column } from '../../ui/DataTable';
import { EffectiveDatedList } from '../../ui/EffectiveDatedList';
import { EmptyState } from '../../ui/EmptyState';
import { KpiTile } from '../../ui/KpiTile';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { EditPersonSheet } from './person-sheets';

const TABS = ['overview', 'access', 'projects', 'capacity', 'leave', 'rates', 'activity'] as const;
type TabKey = (typeof TABS)[number];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const rateCell = (f: Fenced<number | null>) => (f.restricted ? RESTRICTED : f.value);

function Capacity({ id }: { id: string }) {
  const weeks = useResource(() => getAvailability(id), [id]);
  const pattern = useResource(() => getWorkingPattern(id), [id]);
  const list = weeks.data ?? [];
  const conflict = list.find((w) => w.allocated > availableHours(w));
  return (
    <>
      {conflict && (
        <ConflictBanner
          kind="overallocated"
          hoursOver={conflict.allocated - availableHours(conflict)}
          detail={`Week of ${conflict.week}: ${conflict.scheduled} h scheduled, ${conflict.holiday} holiday, ${conflict.leave} leave, ${conflict.commitments} commitment, ${conflict.allocated} allocated.`}
        />
      )}
      <WorkspaceColumns
        main={(
          <section className="card solid-panel" aria-labelledby="weeks">
            <div className="chip-row" style={{ justifyContent: 'space-between' }}><h2 id="weeks" className="t-h2">Next 8 weeks</h2><AvailabilityLegend /></div>
            {weeks.state !== 'ready'
              ? <ListStateBlock state={weeks.state === 'loading' ? 'loading' : weeks.state} label="Capacity" onRetry={weeks.retry} capability="view capacity" />
              : <div className="stack-rows">{list.map((w) => <AvailabilityBar key={w.week} label={w.week} {...w} />)}</div>}
          </section>
        )}
        side={(
          <section className="card solid-panel" aria-labelledby="pattern">
            <h2 id="pattern" className="t-h2">Working pattern</h2>
            {pattern.data && <EffectiveDatedList versions={pattern.data} current={Math.min(1, pattern.data.length - 1)} />}
          </section>
        )}
      />
    </>
  );
}

function Rates({ id }: { id: string }) {
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getRates(id, viewer), [id, viewer.id]);
  type Row = { id: string; from: string; cost: unknown; bill: unknown };
  const rows: Row[] = data ? [{ id: 'r1', from: '2026-04-01', cost: rateCell(data.cost), bill: rateCell(data.bill) }] : [];
  const columns: Column<Row>[] = [
    { key: 'from', header: 'Effective from', type: 'date', value: (r) => r.from },
    { key: 'cost', header: 'Cost rate (₹/h)', type: 'money', value: (r) => r.cost },
    { key: 'bill', header: 'Bill rate (₹/h)', type: 'money', value: (r) => r.bill },
  ];
  return <DataTable label="Rates" columns={columns} rows={rows} rowKey={(r) => r.id} state={state} onRetry={retry} capability="view rates" />;
}

function Leave({ id }: { id: string }) {
  const { state, data, retry } = useResource(() => getPersonLeave(id), [id]);
  const columns: Column<LeaveRequest>[] = [
    { key: 'type', header: 'Type', value: (l) => l.type },
    { key: 'dates', header: 'Dates', value: (l) => l.dates },
    { key: 'hours', header: 'Hours', type: 'hours', value: (l) => l.hours },
    { key: 'status', header: 'Status', type: 'status', value: (l) => l.status },
  ];
  return <DataTable label="Leave requests" columns={columns} rows={data ?? []} rowKey={(l) => l.id} state={state} onRetry={retry} capability="view leave" empty={{ message: 'No leave has been requested.' }} />;
}

function Activity({ id }: { id: string }) {
  const { state, data, retry } = useResource(() => getPersonActivity(id), [id]);
  const days = useMemo<ActivityDay[]>(() => {
    const map = new Map<string, ActivityDay>();
    (data ?? []).forEach((e) => {
      if (!map.has(e.day)) map.set(e.day, { day: e.day, events: [] });
      map.get(e.day)!.events.push(e);
    });
    return [...map.values()];
  }, [data]);
  const effective = state === 'ready' && !days.length ? 'empty' : state;
  if (effective !== 'ready') return <ListStateBlock state={effective} label="Activity" onRetry={retry} capability="view activity" empty={{ message: 'Nothing has happened here yet.' }} />;
  return <section className="card solid-panel" aria-label="Activity"><ActivityFeed days={days} /></section>;
}

function Projects({ codes }: { codes: string[] }) {
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getProjects(viewer), [viewer.id]);
  const rows = (data ?? []).filter((p) => codes.includes(p.code));
  type P = (typeof rows)[number];
  const columns: Column<P>[] = [
    { key: 'code', header: 'Code', value: (p) => p.code, render: (p) => <span className="t-numeric">{p.code}</span> },
    { key: 'name', header: 'Project', value: (p) => p.name },
    { key: 'pm', header: 'PM', type: 'person', value: (p) => personName(p.pmId) },
    { key: 'status', header: 'Status', type: 'status', value: (p) => p.status },
  ];
  return <DataTable label="Projects" columns={columns} rows={rows} rowKey={(p) => p.code} state={state} onRetry={retry} capability="view projects" empty={{ message: 'Not on a project yet.' }} />;
}

export function PersonScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { viewer } = useSession();
  const { state, data: person, retry } = useResource(() => getPerson(id), [id]);
  const everyone = useResource(getPeople, []);
  const [editing, setEditing] = useState(false);

  const showRates = canSeeRatesTab(viewer);
  const tabs = TABS.filter((t) => t !== 'rates' || showRates);
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && tabs.includes(requested) ? requested : 'overview';
  const crumb = [{ label: 'People', to: '/firm/people' }, { label: person?.name ?? id }];

  if (state === 'ready' && !person) {
    return (
      <>
        <PageHeader title="Person" breadcrumb={[{ label: 'People', to: '/firm/people' }, { label: id }]} />
        <div className="solid-panel"><EmptyState message="No one has that reference." action={<a href="/firm/people">Back to People</a>} /></div>
      </>
    );
  }
  if (state === 'error' || state === 'denied') {
    return (
      <>
        <PageHeader title="Person" breadcrumb={crumb} />
        <ListStateBlock state={state} label="This person" onRetry={retry} capability="view people" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={person?.name ?? 'Person'}
        breadcrumb={crumb}
        lead={person && <Avatar name={person.name} size={36} />}
        subtitle={person && `${person.title} · Manager ${personName(person.managerId)}`}
        meta={person && (
          <>
            <StatusChip size="sm" status={person.invitation} label={`Invitation ${person.invitation.toLowerCase()}`} />
            <StatusChip size="sm" status={person.employment} label={`Employment ${person.employment.toLowerCase()}`} />
            <StatusChip size="sm" status={person.login} label={`Login ${person.login.toLowerCase()}`} />
          </>
        )}
        secondaryActions={<Button onClick={() => setEditing(true)}>Edit person</Button>}
        tabs={tabs.map((t) => ({ label: cap(t), to: `?tab=${t}`, active: t === tab }))}
      />
      {tab === 'overview' && person && <OverviewTab id={id} projects={person.projects.length} missingRate={person.costRate == null} />}
      {tab === 'access' && person && <AccessTab roles={person.roles} />}
      {tab === 'projects' && person && <Projects codes={person.projects} />}
      {tab === 'capacity' && <Capacity id={id} />}
      {tab === 'leave' && <Leave id={id} />}
      {tab === 'rates' && <Rates id={id} />}
      {tab === 'activity' && <Activity id={id} />}
      <EditPersonSheet person={person ?? null} open={editing} onClose={() => setEditing(false)} people={everyone.data ?? []} />
    </>
  );
}

function OverviewTab({ id, projects, missingRate }: { id: string; projects: number; missingRate: boolean }) {
  const weeks = useResource(() => getAvailability(id), [id]);
  const now = weeks.data?.[0];
  const conflict = (weeks.data ?? []).find((w) => w.allocated > availableHours(w));
  return (
    <WorkspaceColumns
      main={(
        <div className="grid-12">
          <div className="span-4"><KpiTile label="This week allocated" value={now?.allocated ?? 0} unit="h" /></div>
          <div className="span-4"><KpiTile label="Projects" value={projects} /></div>
          <div className="span-4"><KpiTile label="Conflicts" value={conflict ? 1 : 0} complete={!missingRate} missing={['cost rate']} /></div>
        </div>
      )}
      side={(
        <AttentionList
          emptyMessage="Nothing needs attention for this person."
          items={[
            ...(conflict ? [{ id: 'c', status: 'Conflict' as const, title: `${conflict.allocated - availableHours(conflict)} h over`, detail: `Week of ${conflict.week}`, ageDays: 2, to: '?tab=capacity' }] : []),
            ...(missingRate ? [{ id: 'r', status: 'Incomplete data' as const, title: 'No cost rate', detail: 'Reports that use cost are incomplete', ageDays: 9, to: '?tab=rates' }] : []),
          ]}
        />
      )}
    />
  );
}

function AccessTab({ roles }: { roles: string[] }) {
  type Row = { id: string; set: string; scope: string };
  const rows: Row[] = roles.map((r) => ({ id: r, set: cap(r), scope: r === 'staff' ? 'Own records' : r === 'pm' ? 'Own projects' : 'Whole firm' }));
  const columns: Column<Row>[] = [
    { key: 'set', header: 'Permission set', value: (r) => r.set },
    { key: 'scope', header: 'Scoped grant', value: (r) => r.scope },
    { key: 'status', header: 'Status', type: 'status', value: () => 'Enabled' },
  ];
  return (
    <WorkspaceColumns
      main={<DataTable label="Permission sets" columns={columns} rows={rows} rowKey={(r) => r.id} />}
      side={(
        <section className="card glass" aria-labelledby="sub">
          <h2 id="sub" className="t-h3">Substitute</h2>
          <p className="t-body-sm ink-2">Takes over approvals during approved leave.</p>
          <p className="dt__person t-body-sm"><Avatar name="Arjun Das" size={20} />Arjun Das</p>
        </section>
      )}
    />
  );
}

