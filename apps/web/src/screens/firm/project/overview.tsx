import { useParams } from 'react-router-dom';
import { getProject, getProjectAttention, personName, type Phase } from '../../../api';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { WorkspaceColumns } from '../../../layouts/WorkspaceColumns';
import { AttentionList } from '../../../ui/AttentionList';
import { BudgetBar } from '../../../ui/BudgetBar';
import { DataTable, type Column } from '../../../ui/DataTable';
import { EntitlementBar } from '../../../ui/EntitlementBar';
import { GanttStrip } from '../../../ui/GanttStrip';
import { KpiTile } from '../../../ui/KpiTile';
import { ListStateBlock } from '../../../ui/ListState';
import { Skeleton } from '../../../ui/Skeleton';
import { formatGrouped, formatINR, formatPercent } from '../../../ui/format';
import { TODAY } from '../../../mock/studio-meridian';

export function ProjectOverviewScreen() {
  const { id = '' } = useParams();
  const { viewer } = useSession();
  const { state, data: p, retry } = useResource(() => getProject(id, viewer), [id, viewer.id]);
  const attention = useResource(() => getProjectAttention(id), [id]);
  if (state === 'error' || state === 'denied' || state === 'empty') {
    return <ListStateBlock state={state} label="This project" onRetry={retry} capability="view this project" empty={{ message: 'This project has no data yet.' }} />;
  }
  if (!p || state === 'loading') {
    return <div className="grid-12">{Array.from({ length: 4 }, (_, i) => <div key={i} className="span-3"><Skeleton kind="card" /></div>)}</div>;
  }
  const columns: Column<Phase>[] = [
    { key: 'name', header: 'Phase', value: (x) => x.name },
    { key: 'owner', header: 'Owner', type: 'person', value: (x) => personName(x.ownerId), hiddenByDefault: true },
    { key: 'budget', header: 'Budget (h)', type: 'number', value: (x) => x.budget, total: (r) => r.reduce((s, x) => s + x.budget, 0) },
    { key: 'actual', header: 'Actual (h)', type: 'number', value: (x) => x.actual, total: (r) => r.reduce((s, x) => s + x.actual, 0) },
    { key: 'forecast', header: 'Forecast (h)', type: 'number', value: (x) => x.actual + x.etc, total: (r) => r.reduce((s, x) => s + x.actual + x.etc, 0) },
    {
      key: 'variance', header: 'Var. (h)', type: 'number', value: (x) => x.actual + x.etc - x.budget,
      render: (x) => { const v = x.actual + x.etc - x.budget; return <span style={{ color: v > 0 ? 'var(--danger-ink)' : undefined }}>{v > 0 ? `+${v}` : v}</span>; },
    },
    { key: 'status', header: 'Status', type: 'status', value: (x) => x.status },
  ];
  return (
    <>
      <div className="grid-12">
        <div className="span-3">
          <KpiTile label="Hours" value={formatGrouped(p.hours.actual)} unit={`/ ${formatGrouped(p.hours.budget)} h`}>
            <BudgetBar mini baseline={p.hours.budget} actual={p.hours.actual} forecast={p.hours.forecast} />
          </KpiTile>
        </div>
        <div className="span-2"><KpiTile label="Delivery" value={formatPercent(p.delivery)} /></div>
        <div className="span-2"><KpiTile label="Open tasks" value={p.openTasks} delta={p.blockedTasks ? { text: `${p.blockedTasks} blocked` } : undefined} /></div>
        <div className="span-2"><KpiTile label="Conflicts" value={p.conflicts} /></div>
        <div className="span-3">
          <KpiTile
            label="Contribution"
            restricted={p.contribution.restricted}
            value={p.contribution.restricted ? undefined : formatINR(p.contribution.value)}
            delta={{ text: 'Management estimate' }}
          />
        </div>
        <div className="span-12">
          <section className="card glass" aria-labelledby="entitlement">
            <h2 id="entitlement" className="t-label ink-2">Entitlement</h2>
            {!p.entitlement.restricted && <EntitlementBar {...p.entitlement.value} />}
          </section>
        </div>
      </div>
      <GanttStrip today={TODAY} phases={p.phases} />
      <WorkspaceColumns
        main={<DataTable label="Phases" columns={columns} rows={p.phases} rowKey={(x) => x.id} density="dense" columnPicker />}
        side={<AttentionList items={attention.data ?? []} state={attention.state} onRetry={attention.retry} emptyMessage="Nothing needs attention on this project." capability="view this project" />}
      />
    </>
  );
}
