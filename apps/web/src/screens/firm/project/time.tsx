import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getProjectTime, personName, type TimeRow } from '../../../api';
import { useResource } from '../../../api/useResource';
import { Avatar } from '../../../ui/Avatar';
import { Button } from '../../../ui/Button';
import { DataTable, type Column } from '../../../ui/DataTable';
import { FilterBar, type FilterDef } from '../../../ui/FilterBar';
import { Form, FormSection } from '../../../ui/Form';
import { Sheet } from '../../../ui/Sheet';
import { TextArea } from '../../../ui/TextArea';
import { useToast } from '../../../ui/Toast';
import { useOverlays } from '../../../app/overlays';

export function ProjectTimeScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const { openLogTime } = useOverlays();
  const { state, data, retry } = useResource(() => getProjectTime(id), [id]);
  const [edits, setEdits] = useState<Record<string, TimeRow>>({});
  const [returning, setReturning] = useState<TimeRow | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const all = useMemo(() => (data ?? []).map((r) => edits[r.id] ?? r), [data, edits]);
  const rows = all.filter((r) => (!params.get('person') || r.personId === params.get('person')) && (!params.get('phase') || r.phase === params.get('phase')));
  const filters: FilterDef[] = [
    { type: 'select', key: 'person', label: 'Person', options: [...new Set(all.map((r) => r.personId))].map((p) => ({ value: p, label: personName(p) })) },
    { type: 'select', key: 'phase', label: 'Phase', options: [...new Set(all.map((r) => r.phase))].map((p) => ({ value: p, label: p })) },
  ];
  const approve = (r: TimeRow) => {
    setEdits((e) => ({ ...e, [r.id]: { ...r, approved: r.approved + r.submitted, submitted: 0, status: 'Approved', note: undefined } }));
    toast({ variant: 'success', message: `Approved ${r.submitted.toFixed(2)} h for ${personName(r.personId)}.` });
  };
  const sendBack = () => {
    if (!returning) return;
    if (!reason.trim()) { setTried(true); return; }
    setEdits((e) => ({ ...e, [returning.id]: { ...returning, status: 'Returned', note: `Returned by you: ${reason.trim()}` } }));
    toast({ variant: 'warn', message: `Returned to ${personName(returning.personId)}.` });
    setReturning(null);
  };
  const columns: Column<TimeRow>[] = [
    { key: 'person', header: 'Person', value: (r) => personName(r.personId), sortable: true, render: (r) => <span className="dt__person"><Avatar name={personName(r.personId)} size={20} />{personName(r.personId)}</span> },
    { key: 'phase', header: 'Phase', value: (r) => r.phase, sortable: true, render: (r) => <span className="stacked"><span>{r.phase}</span>{r.note && <span className="t-caption ink-2">{r.note}</span>}</span> },
    { key: 'draft', header: 'Draft (h)', type: 'hours', value: (r) => r.draft, render: (r) => r.draft.toFixed(2), total: (l) => l.reduce((s, x) => s + x.draft, 0), formatTotal: (n) => n.toFixed(2) },
    { key: 'submitted', header: 'Submitted (h)', type: 'hours', value: (r) => r.submitted, render: (r) => r.submitted.toFixed(2), total: (l) => l.reduce((s, x) => s + x.submitted, 0), formatTotal: (n) => n.toFixed(2) },
    { key: 'approved', header: 'Approved (h)', type: 'hours', value: (r) => r.approved, render: (r) => r.approved.toFixed(2), total: (l) => l.reduce((s, x) => s + x.approved, 0), formatTotal: (n) => n.toFixed(2) },
    { key: 'status', header: 'Status', type: 'status', value: (r) => r.status },
    {
      key: 'actions', header: 'Actions', value: () => '',
      render: (r) => (r.submitted > 0 && r.status !== 'Returned'
        ? <span className="toolbar"><Button size="dense" onClick={() => approve(r)}>Approve</Button><Button size="dense" variant="ghost" onClick={() => { setReturning(r); setReason(''); setTried(false); }}>Return</Button></span>
        : <span className="ink-2">None</span>),
    },
  ];
  return (
    <>
      <div className="toolbar toolbar--between">
        <div className="toolbar"><h2 className="t-h2">Time</h2><span className="t-numeric ink-2">01 Sep to 08 Nov 2026</span></div>
      </div>
      <FilterBar filters={filters} />
      <DataTable
        label="Project time" columns={columns} rows={rows} rowKey={(r) => r.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry}
        capability="view project time" rowTone={(r) => (r.status === 'Returned' ? 'warn' : undefined)}
        empty={{ message: 'No time has been logged here yet.', action: <Button variant="primary" onClick={() => openLogTime()}>Log time</Button> }}
      />
      <Sheet
        open={!!returning} onClose={() => setReturning(null)} title="Return time" description={returning ? `${personName(returning.personId)}, ${returning.phase}` : undefined} dirty={reason !== ''}
        footer={<><Button variant="ghost" onClick={() => setReturning(null)}>Cancel</Button><Button variant="primary" onClick={sendBack}>Return line</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); sendBack(); }}>
          <FormSection>
            <TextArea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={tried && !reason.trim() ? 'Say what needs fixing' : undefined} />
          </FormSection>
        </Form>
      </Sheet>
    </>
  );
}
