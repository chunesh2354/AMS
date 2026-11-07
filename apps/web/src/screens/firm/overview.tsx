import { useNavigate } from 'react-router-dom';
import { getOverview } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { QueueDashboard } from '../../layouts/QueueDashboard';
import { AttentionList } from '../../ui/AttentionList';
import { KpiTile } from '../../ui/KpiTile';
import { MiniChart, type ChartColor } from '../../ui/MiniChart';
import { PageHeader } from '../../ui/PageHeader';
import { QueueCard } from '../../ui/QueueCard';
import { RestrictedCell } from '../../ui/RestrictedCell';
import { Skeleton } from '../../ui/Skeleton';
import { formatDate, formatINR, formatPercent } from '../../ui/format';
import { TODAY } from '../../mock/studio-meridian';

const AGE_COLOR: Record<string, ChartColor> = { Current: 'ok', '30 d': 'warn', '60 d': 'danger', '90+ d': 'neutral' };

export function OverviewScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getOverview(viewer), [viewer.id]);
  const first = viewer.name.split(' ')[0];
  return (
    <>
      <PageHeader display title={`Good afternoon, ${first}`} meta={<span className="t-numeric ink-2">{formatDate(TODAY)}</span>} />
      <QueueDashboard
        cards={state === 'loading' || !data
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} kind="card" />)
          : data.queues.map((q) => <QueueCard key={q.key} count={q.count} label={q.label} severity={q.severity} restricted={q.restricted} onClick={() => navigate(q.to)} />)}
        main={<AttentionList items={data?.attention ?? []} state={state === 'ready' && !data ? 'loading' : state} onRetry={retry} capability="view firm attention items" />}
        side={data && (
          <>
            <div className="grid-12">
              <div className="span-6">
                <KpiTile
                  label="Ready to bill"
                  restricted={data.readyToBill.restricted}
                  value={data.readyToBill.restricted ? undefined : formatINR(data.readyToBill.value)}
                  delta={{ text: 'Across 2 projects' }}
                />
              </div>
              <div className="span-6">
                <KpiTile label="Utilization" value={formatPercent(data.utilization.value)} complete={data.utilization.missing.length === 0} missing={data.utilization.missing} delta={{ text: `Missing: ${data.utilization.missing.join(', ')}` }} />
              </div>
            </div>
            <section className="card glass" aria-labelledby="ageing">
              <h2 id="ageing" className="t-h2">Receivables ageing</h2>
              {data.ageing.restricted
                ? <RestrictedCell />
                : <MiniChart kind="donut" label="Receivables ageing" data={data.ageing.value.map((a) => ({ label: a.bucket, value: a.amount, color: AGE_COLOR[a.bucket], display: formatINR(a.amount) }))} />}
            </section>
          </>
        )}
      />
    </>
  );
}
