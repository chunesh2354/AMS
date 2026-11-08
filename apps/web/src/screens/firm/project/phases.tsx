import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPeople, getProject, personName, type Phase } from '../../../api';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { TODAY } from '../../../mock/studio-meridian';
import { Avatar } from '../../../ui/Avatar';
import { BudgetBar } from '../../../ui/BudgetBar';
import { Button } from '../../../ui/Button';
import { CompareColumns } from '../../../ui/CompareColumns';
import { DataTable, type Column } from '../../../ui/DataTable';
import { DateField } from '../../../ui/DateField';
import { Form, FormSection } from '../../../ui/Form';
import { GanttStrip } from '../../../ui/GanttStrip';
import { NumberField } from '../../../ui/NumberField';
import { PersonPicker } from '../../../ui/PersonPicker';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { TextArea } from '../../../ui/TextArea';
import { useToast } from '../../../ui/Toast';
import { Tooltip } from '../../../ui/Tooltip';
import { formatDate, formatGrouped, formatINR, formatPercent } from '../../../ui/format';
import { GoTo } from '../../shared/go-to';

const forecast = (p: Phase) => p.actual + p.etc;
const signed = (v: number) => (v > 0 ? `+${formatGrouped(v)}` : v < 0 ? `−${formatGrouped(-v)}` : formatGrouped(v));

function BudgetRevisionSheet({ phases, open, onClose, initial }: { phases: Phase[]; open: boolean; onClose: () => void; initial: string | null }) {
  const toast = useToast();
  const [phaseId, setPhaseId] = useState<string | null>(initial);
  const [revised, setRevised] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [opened, setOpened] = useState(false);
  if (open && !opened) { setOpened(true); setPhaseId(initial); setRevised(''); setReason(''); setTried(false); }
  if (!open && opened) setOpened(false);
  const p = phases.find((x) => x.id === phaseId) ?? null;
  const value = revised === '' ? p?.budget ?? 0 : Number(revised);
  const badRevised = revised !== '' && !(Number(revised) > 0);
  const submit = () => {
    if (!p || badRevised || !reason.trim()) { setTried(true); return; }
    toast({ variant: 'success', message: `Budget revision for ${p.name} sent to Asha Rao. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} size={640} title="Budget revision" description={p?.name} dirty={revised !== '' || reason !== ''}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit revision</Button></>}
    >
      <div className="stack-4" style={{ gap: 'var(--s-6)' }}>
        <Select label="Phase" options={phases.map((x) => ({ value: x.id, label: x.name }))} value={phaseId} onChange={(v) => { setPhaseId(v); setRevised(''); }} />
        {p && (
          <>
            <CompareColumns
              label="Budget compare"
              columns={[
                { label: 'Baseline', value: formatGrouped(p.budget), unit: 'h' },
                { label: 'Revised', value: formatGrouped(value), unit: 'h' },
                { label: 'Forecast', value: formatGrouped(forecast(p)), unit: 'h', danger: forecast(p) > value },
              ]}
            />
            <BudgetBar baseline={p.budget} revised={value} actual={p.actual} forecast={forecast(p)} />
            <Form onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <FormSection>
                <NumberField label="Revised budget (h)" value={revised} onChange={(e) => setRevised(e.target.value)} placeholder={String(p.budget)} error={badRevised ? 'Enter hours above zero' : undefined} />
                <TextArea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} helper="Goes to the principal for approval." error={tried && !reason.trim() ? 'Say why the budget changes' : undefined} />
              </FormSection>
            </Form>
          </>
        )}
      </div>
    </Sheet>
  );
}

function EditPhaseSheet({ phase, onClose, onSave, people }: { phase: Phase | null; onClose: () => void; onSave: (p: Phase) => void; people: { id: string; name: string; title: string }[] }) {
  const [draft, setDraft] = useState<Phase | null>(null);
  const [etc, setEtc] = useState('');
  const [delivery, setDelivery] = useState('');
  const [tried, setTried] = useState(false);
  if (phase && draft?.id !== phase.id) { setDraft(phase); setEtc(String(phase.etc)); setDelivery(String(phase.delivery)); setTried(false); }
  if (!phase && draft) setDraft(null);
  const badEtc = !(Number(etc) >= 0) || etc === '';
  const badDelivery = !(Number(delivery) >= 0 && Number(delivery) <= 100) || delivery === '';
  const save = () => {
    if (!draft || badEtc || badDelivery) { setTried(true); return; }
    onSave({ ...draft, etc: Number(etc), delivery: Number(delivery) });
  };
  return (
    <Sheet
      open={!!phase} onClose={onClose} title="Edit phase" description={phase?.name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save phase</Button></>}
    >
      {draft && (
        <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <FormSection>
            <PersonPicker label="Owner" people={people} value={draft.ownerId} onChange={(v) => v && setDraft({ ...draft, ownerId: v })} />
          </FormSection>
          <FormSection columns={2}>
            <DateField label="Start" value={draft.start} onChange={(v) => v && setDraft({ ...draft, start: v })} today={TODAY} />
            <DateField label="End" value={draft.end} onChange={(v) => v && setDraft({ ...draft, end: v })} today={TODAY} />
            <NumberField label="ETC (h)" value={etc} onChange={(e) => setEtc(e.target.value)} error={tried && badEtc ? 'Enter hours, zero or more' : undefined} />
            <NumberField label="Delivery (%)" value={delivery} onChange={(e) => setDelivery(e.target.value)} error={tried && badDelivery ? 'Enter 0 to 100' : undefined} />
          </FormSection>
        </Form>
      )}
    </Sheet>
  );
}

export function ProjectPhasesScreen() {
  const { id = '' } = useParams();
  const { viewer } = useSession();
  const toast = useToast();
  const { state, data: project, retry } = useResource(() => getProject(id, viewer), [id, viewer.id]);
  const people = useResource(getPeople, []);
  const [edits, setEdits] = useState<Record<string, Phase>>({});
  const [editing, setEditing] = useState<Phase | null>(null);
  const [revising, setRevising] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const phases = (project?.phases ?? []).map((p) => edits[p.id] ?? p);
  const overrun = phases.find((p) => forecast(p) > p.budget);
  const columns: Column<Phase>[] = [
    { key: 'name', header: 'Phase', value: (p) => p.name, render: (p) => <span style={{ whiteSpace: 'nowrap' }}>{p.name}</span> },
    { key: 'dates', header: 'Dates', value: (p) => p.start, render: (p) => <span className="stacked t-numeric"><span>{formatDate(p.start)}</span><span className="ink-2">{formatDate(p.end)}</span></span> },
    { key: 'owner', header: 'Owner', value: (p) => personName(p.ownerId), render: (p) => <Tooltip text={personName(p.ownerId)}><span tabIndex={0} className="tip-target"><Avatar name={personName(p.ownerId)} size={28} /></span></Tooltip> },
    { key: 'budget', header: 'Budget (h)', type: 'number', value: (p) => p.budget, total: (r) => r.reduce((s, x) => s + x.budget, 0) },
    { key: 'actual', header: 'Actual (h)', type: 'number', value: (p) => p.actual, total: (r) => r.reduce((s, x) => s + x.actual, 0) },
    { key: 'etc', header: 'ETC (h)', type: 'number', value: (p) => p.etc, total: (r) => r.reduce((s, x) => s + x.etc, 0) },
    { key: 'forecast', header: 'Forecast (h)', type: 'number', value: forecast, total: (r) => r.reduce((s, x) => s + forecast(x), 0) },
    {
      key: 'variance', header: 'Over / under (h)', type: 'number', value: (p) => forecast(p) - p.budget,
      render: (p) => { const v = forecast(p) - p.budget; return <span className={v > 0 ? 'err-cell' : v < 0 ? 'ink-2' : undefined} title="Forecast minus budget. Positive is over budget.">{signed(v)}</span>; },
    },
    { key: 'delivery', header: 'Delivery', type: 'number', value: (p) => p.delivery, render: (p) => formatPercent(p.delivery) },
    { key: 'fee', header: 'Fee allocation', type: 'money', value: (p) => p.fee, render: (p) => formatINR(p.fee), total: (r) => r.reduce((s, x) => s + x.fee, 0) },
    { key: 'status', header: 'Status', type: 'status', value: (p) => p.status },
  ];
  const tableState = state === 'ready' && !phases.length ? 'empty' : state;
  return (
    <>
      <div className="toolbar toolbar--between">
        <h2 className="t-h2">Phases</h2>
        <Button onClick={() => setRevising({ open: true, id: overrun?.id ?? phases[0]?.id ?? null })} disabled={!phases.length}>Budget revision</Button>
      </div>
      {state === 'ready' && phases.length > 0 && <GanttStrip today={TODAY} phases={phases} />}
      <DataTable
        label="Phases" columns={columns} rows={phases} rowKey={(p) => p.id} state={tableState} onRetry={retry} capability="view project phases"
        empty={{ message: 'This project has no phases yet.', action: <GoTo to={`/firm/projects/${id}`}>See project overview</GoTo> }}
        rowActions={(p) => [{ label: 'Edit', onSelect: () => setEditing(p) }, { label: 'Budget revision', onSelect: () => setRevising({ open: true, id: p.id }) }]}
      />
      <BudgetRevisionSheet phases={phases} open={revising.open} initial={revising.id} onClose={() => setRevising({ open: false, id: null })} />
      <EditPhaseSheet
        phase={editing} onClose={() => setEditing(null)}
        people={(people.data ?? []).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
        onSave={(p) => { setEdits((e) => ({ ...e, [p.id]: p })); setEditing(null); toast({ variant: 'success', message: `${p.name} updated in this view.` }); }}
      />
    </>
  );
}
