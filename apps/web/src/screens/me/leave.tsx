import { useState } from 'react';
import { getLeaveBalances, getLeaveStrip, getMyLeave, type LeaveRequest } from '../../api';
import { useResource } from '../../api/useResource';
import { useOverlays } from '../../app/overlays';
import { useSession } from '../../app/session';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { KpiTile } from '../../ui/KpiTile';
import { PageHeader } from '../../ui/PageHeader';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { WeekStrip } from '../../ui/WeekStrip';

const daysOf = (l: LeaveRequest) => (l.hours / 8).toFixed(2);

export function MyLeaveScreen() {
  const { viewer } = useSession();
  const toast = useToast();
  const { openLeave } = useOverlays();
  const { state, data, retry } = useResource(() => getMyLeave(viewer.id), [viewer.id]);
  const balances = useResource(getLeaveBalances, []);
  const strip = useResource(getLeaveStrip, []);
  const [cancelled, setCancelled] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const rows = (data ?? []).map((l) => (cancelled.includes(l.id) ? { ...l, status: 'Cancellation requested' as const } : l));
  const columns: Column<LeaveRequest>[] = [
    { key: 'type', header: 'Type', value: (l) => l.type },
    { key: 'dates', header: 'Dates', value: (l) => l.dates, render: (l) => <span className="t-numeric">{l.dates}</span> },
    { key: 'days', header: 'Days', type: 'number', value: daysOf, render: daysOf },
    { key: 'status', header: 'Status', type: 'status', value: (l) => l.status },
    { key: 'actions', header: 'Actions', value: () => '', render: (l) => (l.status === 'Approved' ? <Button size="dense" variant="ghost" onClick={() => setCancelling(l)}>Cancel</Button> : <span className="ink-2">None</span>) },
  ];
  const request = <Button variant="primary" onClick={openLeave}>Request leave</Button>;
  return (
    <>
      <PageHeader title="My leave" primaryAction={request} />
      <div className="tile-row">
        {(balances.data ?? []).map((b) => <KpiTile key={b.label} label={b.label} value={b.days.toFixed(2)} unit="days" />)}
      </div>
      <section className="stack-rows" aria-labelledby="next-weeks">
        <h2 id="next-weeks" className="t-h3">Next 12 weeks</h2>
        <WeekStrip label="Next 12 weeks" weeks={strip.data ?? []} />
      </section>
      <DataTable label="Leave requests" columns={columns} rows={rows} rowKey={(l) => l.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry} capability="view your leave" empty={{ message: 'You have not requested any leave.', action: request }} />
      <Sheet
        open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel approved leave" description={cancelling?.dates}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)}>Keep leave</Button>
            <Button variant="danger" onClick={() => { if (cancelling) { setCancelled((c) => [...c, cancelling.id]); toast({ variant: 'info', message: 'Cancellation requested from your approver.' }); } setCancelling(null); }}>Request cancellation</Button>
          </>
        )}
      >
        <p className="t-body-sm">Your approver decides. The leave stays on the plan until they do.</p>
      </Sheet>
    </>
  );
}
