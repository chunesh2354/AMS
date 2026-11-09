import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPeople, getProject, personName, type Phase } from '../../../api';
import { failureMessage, isLive } from '../../../api/live';
import { getProjectTab, isForbidden, nameOf, savePhaseProgress, type ProjectTabView } from '../../../api/live/project-tabs';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { TODAY } from '../../../mock/studio-meridian';
import { Avatar } from '../../../ui/Avatar';
import { BudgetBar } from '../../../ui/BudgetBar';
import { Button } from '../../../ui/Button';
import { CompareColumns } from '../../../ui/CompareColumns';
import { DataTable, RESTRICTED, type Column } from '../../../ui/DataTable';
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
const noPeople = async (): Promise<Awaited<ReturnType<typeof getPeople>>> => [];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** One plain sentence about the worst overrun and where hours could come from. Live mode has no budget revision yet, so it states the overrun only. */
function overrunNote(phases: Phase[], advise = true): string | null {
  const over = phases.filter((p) => forecast(p) > p.budget).sort((a, b) => (forecast(b) - b.budget) - (forecast(a) - a.budget))[0];
  if (!over) return null;
  const spare = phases.filter((p) => p.id !== over.id && forecast(p) < p.budget).sort((a, b) => (b.budget - forecast(b)) - (a.budget - forecast(a)))[0];
  const head = `${over.name} is forecast at ${formatGrouped(forecast(over))} h against a ${formatGrouped(over.budget)} h budget.`;
  if (!advise) return head;
  return spare
    ? `${head} Raise a budget revision or move hours from ${spare.name.toLowerCase()}, which is ${formatGrouped(spare.budget - forecast(spare))} h under.`
    : `${head} Raise a budget revision to cover it.`;
}
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

/** progressOnly: live mode, where PUT /phases/:id/progress takes ETC and delivery only. Owner and dates have no endpoint yet. */
function EditPhaseSheet({ phase, onClose, onSave, people, progressOnly = false, busy = false }: { phase: Phase | null; onClose: () => void; onSave: (p: Phase) => void; people: { id: string; name: string; title: string }[]; progressOnly?: boolean; busy?: boolean }) {
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
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save phase</Button></>}
    >
      {draft && (
        <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
          {!progressOnly && (
            <FormSection>
              <PersonPicker label="Owner" people={people} value={draft.ownerId} onChange={(v) => v && setDraft({ ...draft, ownerId: v })} />
            </FormSection>
          )}
          <FormSection columns={2}>
            {!progressOnly && (
              <>
                <DateField label="Start" value={draft.start} onChange={(v) => v && setDraft({ ...draft, start: v })} today={TODAY} />
                <DateField label="End" value={draft.end} onChange={(v) => v && setDraft({ ...draft, end: v })} today={TODAY} />
              </>
            )}
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
  const [denied, setDenied] = useState(false);
  const { state: loadState, data: project, retry } = useResource(
    () => (isLive ? getProjectTab(id).catch((e: unknown) => { if (isForbidden(e)) setDenied(true); throw e; }) : getProject(id, viewer)),
    [id, viewer.id],
  );
  const state = denied ? 'denied' : loadState;
  const people = useResource(isLive ? noPeople : getPeople, []);
  const livePeople = isLive ? (project as ProjectTabView | null)?.people ?? {} : {};
  const ownerName = (ref: string) => (isLive ? nameOf(livePeople, ref) : personName(ref));
  const today = isLive ? new Date().toISOString().slice(0, 10) : TODAY;
  const [saving, setSaving] = useState(false);
  const saveLive = async (p: Phase) => {
    setSaving(true);
    try {
      await savePhaseProgress(p.id, { etc: p.etc, delivery: p.delivery });
      setEditing(null);
      toast({ variant: 'success', message: `${p.name} progress saved.` });
      retry();
    } catch (e) {
      toast({ variant: 'danger', message: failureMessage(e) });
    } finally { setSaving(false); }
  };
  const [edits, setEdits] = useState<Record<string, Phase>>({});
  const [editing, setEditing] = useState<Phase | null>(null);
  const [revising, setRevising] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const phases = (project?.phases ?? []).map((p) => edits[p.id] ?? p);
  const overrun = phases.find((p) => forecast(p) > p.budget);
  const columns: Column<Phase>[] = [
    { key: 'name', header: 'Phase', value: (p) => p.name, render: (p) => <span style={{ whiteSpace: 'nowrap' }}>{p.name}</span> },
    // Status sits next to the name so it stays in view when the hours columns overflow at 1440.
    { key: 'status', header: 'Status', type: 'status', value: (p) => p.status },
    { key: 'dates', header: 'Dates', value: (p) => p.start, render: (p) => <span className="stacked t-numeric"><span>{formatDate(p.start)}</span><span className="ink-2">{formatDate(p.end)}</span></span> },
    { key: 'owner', header: 'Owner', value: (p) => ownerName(p.ownerId), render: (p) => <Tooltip text={ownerName(p.ownerId)}><span tabIndex={0} className="tip-target"><Avatar name={ownerName(p.ownerId)} size={28} /></span></Tooltip> },
    { key: 'budget', header: 'Budget h', type: 'number', value: (p) => p.budget, total: (r) => r.reduce((s, x) => s + x.budget, 0) },
    { key: 'actual', header: 'Actual h', type: 'number', value: (p) => p.actual, total: (r) => r.reduce((s, x) => s + x.actual, 0) },
    { key: 'etc', header: 'ETC h', type: 'number', value: (p) => p.etc, total: (r) => r.reduce((s, x) => s + x.etc, 0) },
    { key: 'forecast', header: 'Forecast h', type: 'number', value: forecast, total: (r) => r.reduce((s, x) => s + forecast(x), 0) },
    {
      key: 'variance', header: 'Over/under h', type: 'number', value: (p) => forecast(p) - p.budget,
      render: (p) => { const v = forecast(p) - p.budget; return <span className={v > 0 ? 'err-cell' : v < 0 ? 'ink-2' : undefined} title="Forecast minus budget. Positive is over budget.">{signed(v)}</span>; },
    },
    { key: 'delivery', header: 'Delivery', type: 'number', value: (p) => p.delivery, render: (p) => formatPercent(p.delivery) },
    isLive
      // The server fences a fee it will not show: that cell reads Restricted, and no total is made across a gap.
      ? { key: 'fee', header: 'Fee', type: 'money', value: (p) => (Number.isFinite(p.fee) ? p.fee : RESTRICTED), render: (p) => formatINR(p.fee), total: phases.every((x) => Number.isFinite(x.fee)) ? (r) => r.reduce((s, x) => s + x.fee, 0) : undefined }
      : { key: 'fee', header: 'Fee', type: 'money', value: (p) => p.fee, render: (p) => formatINR(p.fee), total: (r) => r.reduce((s, x) => s + x.fee, 0) },
  ];
  const tableState = state === 'ready' && !phases.length ? 'empty' : state;
  const span = phases.length
    ? { from: phases.reduce((m, p) => (p.start < m ? p.start : m), phases[0].start), to: phases.reduce((m, p) => (p.end > m ? p.end : m), phases[0].end) }
    : null;
  const note = state === 'ready' ? overrunNote(phases, !isLive) : null;
  return (
    <div className="scr-phases">
      {state === 'ready' && phases.length > 0 && span && (!isLive || phases.every((p) => p.start && p.end)) && (
        <section className="ph-section" aria-labelledby="ph-timeline-h">
          <header className="ph-section__head">
            <h2 id="ph-timeline-h" className="t-h2">Timeline</h2>
            <span className="t-body-sm ink-2">{monthYear(span.from)} to {monthYear(span.to)}, today is {longDate(today)}</span>
          </header>
          <GanttStrip today={today} phases={phases} />
        </section>
      )}
      <section className="ph-section" aria-labelledby="ph-phases-h">
      <header className="ph-section__head">
        <h2 id="ph-phases-h" className="t-h2">Phases</h2>
        {/* Budget revisions have no endpoint yet, so live mode does not offer one. */}
        {!isLive && <Button onClick={() => setRevising({ open: true, id: overrun?.id ?? phases[0]?.id ?? null })} disabled={!phases.length}>Budget revision</Button>}
      </header>
      <DataTable
        label="Phases" columns={columns} rows={phases} rowKey={(p) => p.id} state={tableState} onRetry={retry} capability="view project phases"
        empty={{ message: 'This project has no phases yet.', action: <GoTo to={`/firm/projects/${id}`}>See project overview</GoTo> }}
        rowActions={(p) => (isLive
          ? [{ label: 'Edit', onSelect: () => setEditing(p) }]
          : [{ label: 'Edit', onSelect: () => setEditing(p) }, { label: 'Budget revision', onSelect: () => setRevising({ open: true, id: p.id }) }])}
      />
      {note && <p className="t-body-sm ink-2">{note}</p>}
      </section>
      {!isLive && <BudgetRevisionSheet phases={phases} open={revising.open} initial={revising.id} onClose={() => setRevising({ open: false, id: null })} />}
      <EditPhaseSheet
        phase={editing} onClose={() => setEditing(null)}
        people={(people.data ?? []).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
        progressOnly={isLive} busy={saving}
        onSave={isLive
          ? (p) => { void saveLive(p); }
          : (p) => { setEdits((e) => ({ ...e, [p.id]: p })); setEditing(null); toast({ variant: 'success', message: `${p.name} updated in this view.` }); }}
      />
    </div>
  );
}
