import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getApprovals, getPeople, type Approval, type ApprovalType } from '../../api';
import { useResource } from '../../api/useResource';
import { ApprovalRow } from '../../ui/ApprovalRow';
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
import { useToast } from '../../ui/Toast';
import { useMediaQuery } from '../../ui/useMediaQuery';

const QUEUES: ('All' | ApprovalType)[] = ['All', 'Time', 'Leave', 'Expenses', 'Bills', 'Changes', 'Billing drafts'];

function Preview({ item, onApprove, onDelegate }: { item: Approval | null; onApprove: (a: Approval) => void; onDelegate: (a: Approval) => void }) {
  if (!item) return <PreviewPane state="empty" />;
  return (
    <PreviewPane
      eyebrow={item.type}
      title={item.submitter}
      fields={[
        { label: 'Project', value: item.project },
        { label: 'Period', value: item.period },
        { label: 'Amount or h', value: item.amount, mono: true },
        { label: 'Approver', value: item.approver },
        { label: 'Waiting', value: `${item.ageDays} d`, mono: true },
      ]}
      alert={item.exception && <InlineAlert variant="warn" title={`Exception: ${item.exception.toLowerCase()}`}>Thursday has 12.50 h. This item needs its own decision and stays out of batch approval.</InlineAlert>}
      evidence={item.evidence}
      history={item.history}
      actions={<><Button variant="primary" onClick={() => onApprove(item)}>Approve</Button><Button onClick={() => onDelegate(item)}>Delegate</Button></>}
    />
  );
}

export function ApprovalsScreen() {
  const [params, setParams] = useSearchParams();
  const { state, data, retry } = useResource(getApprovals, []);
  const people = useResource(getPeople, []);
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
  const approve = (a: Approval) => { clear([a.id]); setSheetPreview(false); toast({ variant: 'success', message: `Approved ${a.submitter}, ${a.type.toLowerCase()}.` }); };
  const batch = () => {
    clear(picked);
    toast({ variant: 'success', message: `${picked.length} approved.${exceptions ? ` ${exceptions} exception${exceptions > 1 ? 's' : ''} excluded.` : ''}` });
  };
  const startDelegate = (a: Approval) => { setSheetPreview(false); setDelegating(a); setDelegate(null); setRange({ from: null, to: null }); setDelegateTried(false); };
  const saveDelegate = () => {
    if (!delegate || !range.from || !range.to) { setDelegateTried(true); return; }
    const name = people.data?.find((p) => p.id === delegate)?.name;
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
  const allOn = eligible.length > 0 && picked.length === eligible.length;

  return (
    <>
      <PageHeader
        title="Approvals"
        meta={<span className="t-numeric ink-2">{open.length} pending</span>}
        primaryAction={<Button variant="primary" disabled={!picked.length} onClick={batch}>Approve {picked.length || ''} selected</Button>}
      />
      <div className="inbox">
        <QueueRail
          label="Queues" value={queue} onChange={setQueue}
          items={QUEUES.map((q) => ({ key: q, label: q, count: q === 'All' ? open.length : open.filter((a) => a.type === q).length }))}
        />
        {effective !== 'ready'
          ? <ListStateBlock state={effective} label="Approvals" onRetry={retry} capability="approve work" rows={8} empty={{ message: 'Nothing is waiting for you here.', action: queue !== 'All' ? <Button variant="primary" onClick={() => setQueue('All')}>See all queues</Button> : undefined }} />
          : (
            <section className="solid-panel" aria-label="Approval items">
              <div className="inbox__toolbar">
                <Checkbox label={`Select all ${eligible.length} eligible`} checked={allOn} indeterminate={!allOn && picked.length > 0} onChange={(e) => setSelected(e.target.checked ? eligible.map((a) => a.id) : [])} />
                {exceptions > 0 && <span className="t-caption ink-2">{exceptions} exception excluded from batch</span>}
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
                    onReturn={(reason) => { clear([a.id]); toast({ variant: 'warn', message: `Returned to ${a.submitter}: ${reason}` }); }}
                    onDelegate={() => startDelegate(a)}
                  />
                ))}
              </ul>
            </section>
          )}
        {wide && <Preview item={effective === 'ready' ? active : null} onApprove={approve} onDelegate={startDelegate} />}
      </div>
      {!wide && (
        <Sheet open={sheetPreview && !!active} onClose={() => setSheetPreview(false)} title={active?.submitter ?? 'Preview'} description={active?.type}>
          <Preview item={active} onApprove={approve} onDelegate={startDelegate} />
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
              people={(people.data ?? []).filter((p) => !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
              error={delegateTried && !delegate ? 'Choose a person' : undefined}
            />
            <DateRangeField label="Dates" value={range} onChange={setRange} today="2026-11-06" min="2026-11-06" error={delegateTried && (!range.from || !range.to) ? 'Choose a start and end date' : undefined} />
          </FormSection>
        </Form>
      </Sheet>
    </>
  );
}
