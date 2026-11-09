import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getApprovals, getPeople, type Approval, type ApprovalType } from '../../api';
import { useResource } from '../../api/useResource';
import { failureMessage, isLive } from '../../api/live';
import { approveOne, batchApprove, batchMessage, delegateOne, liveApprovals, liveDelegates, returnOne, type ApprovalItem, type DelegateOption } from '../../api/live/approvals';
import { todayIn } from '../../api/live/time';
import { useSession } from '../../app/session';
import { ApprovalRow, SELF_APPROVED_LABEL } from '../../ui/ApprovalRow';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { DateRangeField, type DateRange } from '../../ui/DateRangeField';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { PersonPicker } from '../../ui/PersonPicker';
import { PreviewPane } from '../../ui/PreviewPane';
import { QueueRail } from '../../ui/QueueRail';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { GoTo } from '../shared/go-to';

const loadDelegates = async (): Promise<DelegateOption[]> =>
  isLive ? liveDelegates() : (await getPeople()).filter((p) => !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }));

const QUEUES: ('All' | ApprovalType)[] = ['All', 'Time', 'Leave', 'Expenses', 'Bills', 'Changes', 'Billing drafts'];

/** The studio's today: the first day a delegation can start (never a date baked into the build). */
export const delegateStart = (timeZone?: string, now: Date = new Date()) => todayIn(timeZone, now);

const amountLabel = (t: ApprovalType) => (t === 'Time' || t === 'Leave' || t === 'Changes' ? 'Hours' : 'Amount');

type PreviewProps = { item: ApprovalItem | null; onApprove: (a: Approval) => void; onReturn: (a: Approval, reason: string) => void; onDelegate: (a: Approval) => void };

function Preview(props: PreviewProps) {
  if (!props.item) return <PreviewPane state="empty" />;
  return <PreviewBody key={props.item.id} {...props} item={props.item} />;
}

function PreviewBody({ item, onApprove, onReturn, onDelegate }: PreviewProps & { item: ApprovalItem }) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const sendReturn = () => {
    if (!reason.trim()) { setTried(true); return; }
    onReturn(item, reason.trim());
  };
  return (
    <PreviewPane
      eyebrow={item.type}
      title={item.submitter}
      fields={[
        { label: 'Project', value: item.project },
        { label: 'Period', value: item.period },
        { label: amountLabel(item.type), value: item.amount, mono: true },
        { label: 'Approver', value: item.approver },
        { label: 'Waiting', value: `${item.ageDays} d`, mono: true },
      ]}
      alert={(item.selfApproval || item.exception) && (
        <>
          {item.selfApproval && <InlineAlert variant="info" title={SELF_APPROVED_LABEL}>Nobody else in the studio can approve this, so it is yours to approve and is recorded as a self-approval. Name a fallback approver in Settings, Approvals to change this.</InlineAlert>}
          {item.exception && <InlineAlert variant="danger" title={`Exception: ${item.exception.toLowerCase()}`}>{isLive ? '' : 'Thursday has 12.50 h. '}It is left out of bulk approval. Approve it here or return it with a note.</InlineAlert>}
        </>
      )}
      evidence={item.evidence}
      history={item.history}
      actions={returning
        ? <div className="apr__return">
            <TextField
              dense autoFocus label={`Note to ${item.submitter}`} value={reason} placeholder="Say what to change before you approve"
              error={tried && !reason.trim() ? 'Add a note before you send it back' : undefined} onChange={(e) => setReason(e.target.value)}
            />
            <Button variant="primary" onClick={sendReturn}>Send back</Button>
            <Button variant="ghost" onClick={() => { setReturning(false); setTried(false); }}>Cancel</Button>
          </div>
        : <><Button variant="primary" onClick={() => onApprove(item)}>Approve</Button><Button onClick={() => setReturning(true)}>Return with note</Button><Button variant="ghost" onClick={() => onDelegate(item)}>Delegate</Button></>}
    />
  );
}

export function ApprovalsScreen() {
  const [params, setParams] = useSearchParams();
  const { state, data, retry } = useResource<ApprovalItem[]>(isLive ? liveApprovals : getApprovals, []);
  const { viewer } = useSession();
  const today = delegateStart(viewer.firm?.timezone);
  const people = useResource(loadDelegates, []);
  const toast = useToast();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [done, setDone] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheetPreview, setSheetPreview] = useState(false);
  const [delegating, setDelegating] = useState<Approval | null>(null);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [delegateTried, setDelegateTried] = useState(false);

  const queue = (params.get('queue') as (typeof QUEUES)[number]) || 'All';
  const open = useMemo(() => (data ?? []).filter((a) => !done.includes(a.id)), [data, done]);
  const shown = queue === 'All' ? open : open.filter((a) => a.type === queue);
  const eligible = shown.filter((a) => !a.exception);
  const exceptions = shown.length - eligible.length;
  const picked = selected.filter((id) => eligible.some((a) => a.id === id));
  const active = shown.find((a) => a.id === activeId) ?? (wide ? shown[0] ?? null : null);

  const clear = (ids: string[]) => { setDone((d) => [...d, ...ids]); setSelected((s) => s.filter((x) => !ids.includes(x))); };
  const fail = (e: unknown) => toast({ variant: 'danger', message: failureMessage(e) });
  const reload = () => { setSelected([]); retry(); };
  const approve = (a: Approval) => {
    setSheetPreview(false);
    if (isLive) {
      approveOne(a.id).then(() => toast({ variant: 'success', message: `Approved ${a.submitter}, ${a.type.toLowerCase()}.` }), fail).finally(reload);
      return;
    }
    clear([a.id]); toast({ variant: 'success', message: `Approved ${a.submitter}, ${a.type.toLowerCase()}.` });
  };
  const returnItem = (a: Approval, reason: string) => {
    if (isLive) {
      returnOne(a.id, reason).then(() => toast({ variant: 'warn', message: `Returned to ${a.submitter}: ${reason}` }), fail).finally(reload);
      return;
    }
    clear([a.id]); toast({ variant: 'warn', message: `Returned to ${a.submitter}: ${reason}` });
  };
  const batch = () => {
    if (isLive) {
      batchApprove(picked).then((r) => toast({ variant: r.skipped.length ? 'warn' : 'success', message: batchMessage(r) }), fail).finally(reload);
      return;
    }
    clear(picked);
    toast({ variant: 'success', message: `${picked.length} approved.${exceptions ? ` ${exceptions} exception${exceptions > 1 ? 's' : ''} excluded.` : ''}` });
  };
  const startDelegate = (a: Approval) => { setSheetPreview(false); setDelegating(a); setDelegate(null); setRange({ from: null, to: null }); setDelegateTried(false); };
  const saveDelegate = () => {
    if (!delegate || !range.from || !range.to) { setDelegateTried(true); return; }
    const name = people.data?.find((p) => p.id === delegate)?.name;
    if (isLive) {
      const item = delegating;
      if (!item) return;
      delegateOne(item.id, delegate, range.to).then(() => {
        toast({ variant: 'info', message: `${item.submitter}, ${item.type.toLowerCase()} delegated to ${name}.` });
        setDelegating(null);
        reload();
      }, fail);
      return;
    }
    toast({ variant: 'info', message: `${delegating?.submitter}, ${delegating?.type.toLowerCase()} delegated to ${name}.` });
    if (delegating) clear([delegating.id]);
    setDelegating(null);
  };
  const setQueue = (key: string) => {
    setSelected([]);
    setActiveId(null);
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (key === 'All') n.delete('queue'); else n.set('queue', key);
      return n;
    }, { replace: true });
  };

  const effective = state === 'ready' && !shown.length ? 'empty' : state;
  const oldest = open.reduce((m, a) => Math.max(m, a.ageDays), 0);
  const context = !open.length
    ? 'Nothing is waiting for you.'
    : `${open.length} waiting for you. The oldest has waited ${oldest} ${oldest === 1 ? 'day' : 'days'}.`;
  const allOn = eligible.length > 0 && picked.length === eligible.length;

  return (
    <div className="scr-approvals">
      <PageHeader
        title="Approvals"
        meta={<span className="t-body ink-2">{state === 'ready' ? context : 'Loading what is waiting for you.'}</span>}
        primaryAction={<Button variant="primary" disabled={!picked.length} onClick={batch}>Approve {picked.length || ''} selected</Button>}
      />
      <div className="inbox">
        <QueueRail
          label="Queues" value={queue} onChange={setQueue}
          items={QUEUES.map((q) => ({ key: q, label: q, count: q === 'All' ? open.length : open.filter((a) => a.type === q).length }))}
        />
        {effective !== 'ready'
          ? <ListStateBlock state={effective} label="Approvals" onRetry={retry} capability="approve work" rows={8} empty={{ message: 'Nothing is waiting for you here.', action: queue !== 'All' ? <Button variant="primary" onClick={() => setQueue('All')}>See all queues</Button> : <GoTo to="/firm/overview">Back to Overview</GoTo> }} />
          : (
            <section className="solid-panel" aria-label="Approval items">
              <div className="inbox__toolbar">
                <Checkbox label={`Select all ${eligible.length} eligible`} checked={allOn} indeterminate={!allOn && picked.length > 0} onChange={(e) => setSelected(e.target.checked ? eligible.map((a) => a.id) : [])} />
                {exceptions > 0 && <span className="apr-excluded t-body-sm"><span className="marker marker--alert" aria-hidden />{exceptions} {exceptions === 1 ? 'exception' : 'exceptions'} excluded</span>}
              </div>
              <ul className="inbox__list">
                {shown.map((a) => (
                  <ApprovalRow
                    key={a.id} item={a}
                    selected={selected.includes(a.id)}
                    active={active?.id === a.id}
                    onSelect={(on) => setSelected((s) => (on ? [...s, a.id] : s.filter((x) => x !== a.id)))}
                    onOpen={() => { setActiveId(a.id); if (!wide) setSheetPreview(true); }}
                    onApprove={() => approve(a)}
                    onReturn={(reason) => returnItem(a, reason)}
                    onDelegate={() => startDelegate(a)}
                  />
                ))}
              </ul>
            </section>
          )}
        {wide && <Preview item={effective === 'ready' ? active : null} onApprove={approve} onReturn={returnItem} onDelegate={startDelegate} />}
      </div>
      {!wide && (
        <Sheet open={sheetPreview && !!active} onClose={() => setSheetPreview(false)} title={active?.submitter ?? 'Preview'} description={active?.type}>
          <Preview item={active} onApprove={approve} onReturn={returnItem} onDelegate={startDelegate} />
        </Sheet>
      )}
      <Sheet
        open={!!delegating} onClose={() => setDelegating(null)} title="Delegate approval"
        description={delegating ? `${delegating.submitter}, ${delegating.type.toLowerCase()}` : undefined}
        footer={<><Button variant="ghost" onClick={() => setDelegating(null)}>Cancel</Button><Button variant="primary" onClick={saveDelegate}>Delegate</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); saveDelegate(); }}>
          <FormSection>
            <PersonPicker
              label="Delegate to" value={delegate} onChange={setDelegate}
              people={people.data ?? []}
              error={delegateTried && !delegate ? 'Choose a person' : undefined}
            />
            <DateRangeField label="Dates" value={range} onChange={setRange} today={today} min={today} error={delegateTried && (!range.from || !range.to) ? 'Choose a start and end date' : undefined} />
          </FormSection>
        </Form>
      </Sheet>
    </div>
  );
}
