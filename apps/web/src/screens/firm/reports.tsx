import { useParams } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { REPORT_LIST, getReport, type ReportView } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { SettingsLayout } from '../../layouts/SettingsLayout';
import { Button } from '../../ui/Button';
import { DataTable, RESTRICTED, type Column } from '../../ui/DataTable';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { IncompleteIndicator } from '../../ui/IncompleteIndicator';
import { ListStateBlock } from '../../ui/ListState';
import { MiniChart, type ChartColor } from '../../ui/MiniChart';
import { PageHeader } from '../../ui/PageHeader';
import { RestrictedCell } from '../../ui/RestrictedCell';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { Tooltip } from '../../ui/Tooltip';
import { GoTo } from '../shared/go-to';
import { isLive } from '../../api/live';
import { NotAvailablePage } from '../../ui/NotAvailable';

const FILTERS: FilterDef[] = [
  { type: 'select', key: 'period', label: 'Period', options: [{ value: '2026-10', label: 'Oct 2026' }, { value: '2026-09', label: 'Sep 2026' }] },
  { type: 'select', key: 'team', label: 'Team', options: [{ value: 'P02', label: "Vikram Nair's team" }, { value: 'P03', label: "Meera Iyer's team" }] },
  { type: 'select', key: 'project', label: 'Project', options: [{ value: 'PRJ-01', label: 'PRJ-01' }, { value: 'PRJ-02', label: 'PRJ-02' }, { value: 'PRJ-03', label: 'PRJ-03' }] },
];
const AGE: Record<string, ChartColor> = { Current: 'ok', '30 d': 'warn', '60 d': 'danger', '90+ d': 'neutral' };

type Row = ReportView['rows'][number];

function Body({ r, retry }: { r: ReportView; retry: () => void }) {
  const toast = useToast();
  const columns: Column<Row>[] = [
    { key: 'label', header: r.col1, value: (x) => x.label },
    {
      key: 'value', header: r.col2, type: 'number', value: (x) => (x.value.restricted ? RESTRICTED : x.value.value),
      render: (x) => (x.value.restricted ? <RestrictedCell /> : x.missing ? <IncompleteIndicator missing={x.missing}>{x.value.value}</IncompleteIndicator> : x.value.value),
    },
    { key: 'extra', header: r.col3, type: 'number', value: (x) => (x.extra.restricted ? RESTRICTED : x.extra.value), render: (x) => (x.extra.restricted ? <RestrictedCell /> : x.extra.value) },
  ];
  const chartable = r.rows.every((x) => x.chart != null);
  const data = r.rows.map((x) => ({ label: x.label, value: x.chart ?? 0, display: x.value.restricted ? 'Restricted' : x.value.value, color: r.chart === 'donut' ? AGE[x.label] : undefined }));
  const exportBtn = r.fenced
    ? <Tooltip text="Some columns are Restricted"><span tabIndex={0} className="tip-target tip-target--btn"><Button disabled aria-label="Export, disabled because some columns are Restricted">Export</Button></span></Tooltip>
    : <Button onClick={() => toast({ variant: 'info', message: `${r.label} export is mocked in this demo.` })}>Export</Button>;
  return (
    <>
      <div className="toolbar toolbar--between">
        <div className="toolbar">
          <h2 className="t-h2">{r.label}</h2>
          {r.estimate && <span className="chip chip--sm tone-warn">Management estimate</span>}
        </div>
        {exportBtn}
      </div>
      <section className="card glass" aria-label="Definition">
        <h3 className="t-h3">Definition</h3>
        <dl className="def-list"><dt>Numerator</dt><dd>{r.numerator}</dd><dt>Denominator</dt><dd>{r.denominator}</dd></dl>
      </section>
      <FilterBar filters={FILTERS} />
      <section className="solid-panel panel" aria-label={`${r.label} chart`}>
        {r.headline && (
          <div className="toolbar">
            {r.missing?.length
              ? <IncompleteIndicator missing={r.missing}><span className="kpi__num">{r.headline}</span></IncompleteIndicator>
              : <span className="kpi__num">{r.headline}</span>}
            {!!r.missing?.length && <span className="t-caption ink-2">Incomplete. Missing: {r.missing.join(', ')}</span>}
          </div>
        )}
        {chartable ? <MiniChart kind={r.chart} label={`${r.label} chart`} data={data} /> : <RestrictedCell />}
      </section>
      <DataTable label={r.label} columns={columns} rows={r.rows} rowKey={(x) => x.key} onRetry={retry} />
    </>
  );
}

function MockReportsScreen() {
  const { key = 'utilization' } = useParams();
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getReport(key, viewer), [key, viewer.id]);
  if (!REPORT_LIST.some((r) => r.key === key)) return <Navigate to="/firm/reports/utilization" replace />;
  return (
    <>
      <PageHeader title="Reports" />
      <SettingsLayout label="Reports" items={REPORT_LIST.map((r) => ({ label: r.label, to: `/firm/reports/${r.key}` }))}>
        {state === 'loading' || (state === 'ready' && !data)
          ? <Skeleton kind="table" rows={8} />
          : state !== 'ready'
            ? <ListStateBlock state={state} label="This report" onRetry={retry} capability="view reports" rows={8} empty={{ message: 'This report has no data for the period.', action: <GoTo to="/firm/overview">Back to Overview</GoTo> }} />
            : <Body r={data!} retry={retry} />}
      </SettingsLayout>
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function ReportsScreen() {
  return isLive ? <NotAvailablePage title="Reports" detail="Utilization, contribution, fee entitlement and the other studio reports." /> : <MockReportsScreen />;
}
