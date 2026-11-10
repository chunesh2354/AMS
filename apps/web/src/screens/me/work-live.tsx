import { useMemo } from 'react';
import { useResource } from '../../api/useResource';
import { getMyWork, type LiveMyWork } from '../../api/live/me';
import { useSession } from '../../app/session';
import { DataTable, type Column } from '../../ui/DataTable';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { formatHours, formatMonth, parseISO } from '../../ui/format';
import { GoTo } from '../shared/go-to';

type PhaseRow = LiveMyWork['projects'][number]['phases'][number] & { project: string };

/** "PRJ-01 Lakeview Residence · Contributor · Active · Lakeview Trust": the group heading over a project's phases. */
export const projectHeading = (p: LiveMyWork['projects'][number]) => `${p.code} ${p.name} · ${p.role} · ${p.status}${p.client ? ` · ${p.client}` : ''}`;

export function workRows(data: LiveMyWork | null): PhaseRow[] {
  return (data?.projects ?? []).flatMap((p) => p.phases.map((ph) => ({ ...ph, project: projectHeading(p) })));
}

/**
 * My work in live mode, from GET /me/work: the projects the person is on, their phases with status and dates, and
 * the person's own hours on each phase this month. Tasks are not in this round, so the task list and board are not shown.
 */
export function LiveMyWorkScreen() {
  const { viewer } = useSession();
  const { state, data, retry } = useResource(getMyWork, [viewer.id]);
  const rows = useMemo(() => workRows(data), [data]);
  const month = data ? formatMonth(parseISO(`${data.month}-01`)) : '';
  const columns: Column<PhaseRow>[] = [
    { key: 'phase', header: 'Phase', value: (r) => r.name, render: (r) => <span>{r.name} <span className="ink-2">{r.code}</span>{r.current && <span className="t-caption ink-2"> · Now</span>}</span> },
    { key: 'status', header: 'Status', type: 'status', value: (r) => r.status, render: (r) => <StatusChip status={r.status} size="sm" /> },
    { key: 'start', header: 'Start', type: 'date', value: (r) => r.start },
    { key: 'end', header: 'End', type: 'date', value: (r) => r.end },
    { key: 'hours', header: `My hours, ${month || 'this month'}`, type: 'hours', value: (r) => r.hours, total: (all) => all.reduce((s, r) => s + r.hours, 0) },
  ];
  const tableState = state === 'ready' && !rows.length ? 'empty' : state;
  return (
    <>
      <PageHeader
        title="My work"
        meta={state === 'ready' && data && <span className="t-numeric ink-2">{data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'} · {formatHours(data.hours)} in {month}</span>}
      />
      <DataTable
        label="My projects and phases" columns={columns} rows={rows} rowKey={(r) => r.id} state={tableState} onRetry={retry} capability="view your work"
        groupBy={(r) => r.project}
        empty={{ message: 'You are not on any project team yet.', action: <GoTo to="/me/time">Open my time</GoTo> }}
      />
    </>
  );
}
