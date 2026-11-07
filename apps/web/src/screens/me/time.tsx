import { useEffect, useMemo, useState } from 'react';
import { getProjectPhaseOptions, getTimesheet, type TimesheetLineData } from '../../api';
import { useResource } from '../../api/useResource';
import { useOverlays } from '../../app/overlays';
import { useSession, useTimer } from '../../app/session';
import { Button } from '../../ui/Button';
import { DurationField } from '../../ui/DurationField';
import { EmptyState } from '../../ui/EmptyState';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { PeriodNav } from '../../ui/PeriodNav';
import { ProjectPhasePicker } from '../../ui/ProjectPhasePicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { TextArea } from '../../ui/TextArea';
import { TimerPill } from '../../ui/TimerPill';
import { TimesheetGrid } from '../../ui/TimesheetGrid';
import { useToast } from '../../ui/Toast';
import { formatHours } from '../../ui/format';
import type { Status } from '../../ui/status-colors';

const LONG: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const projects = getProjectPhaseOptions();
const phaseInfo = (id: string | null) => projects.flatMap((p) => p.phases.map((ph) => ({ id: ph.id, name: ph.name, project: `${p.code} ${p.name}` }))).find((x) => x.id === id);

export function MyTimeScreen() {
  const { viewer } = useSession();
  const timer = useTimer();
  const toast = useToast();
  const { openLogTime } = useOverlays();
  const [offset, setOffset] = useState(0);
  const { state, data, retry } = useResource(() => getTimesheet(viewer.id, offset), [viewer.id, offset]);
  const [lines, setLines] = useState<TimesheetLineData[]>([]);
  const [status, setStatus] = useState<Status>('Not submitted');
  const [picking, setPicking] = useState<{ lineId: string | null } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [corrLine, setCorrLine] = useState<string | null>(null);
  const [corrMinutes, setCorrMinutes] = useState<number | null>(null);
  const [corrReason, setCorrReason] = useState('');
  const [tried, setTried] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => { if (data) { setLines(data.lines); setStatus(data.status); setShowErrors(false); } }, [data]);

  const days = useMemo(() => data?.days ?? [], [data]);
  const locked = lines.length > 0 && lines.every((l) => l.state === 'locked');
  const total = lines.reduce((s, l) => s + l.hours.reduce((a, h) => a + h, 0), 0);
  const scheduled = days.reduce((s, d) => s + d.scheduled, 0);
  const longDays = days.map((d, c) => ({ d, h: lines.reduce((s, l) => s + (l.hours[c] ?? 0), 0) })).filter((x) => x.h > 12);
  const returned = lines.filter((l) => l.state === 'returned');
  const unclassified = lines.filter((l) => l.state === 'unclassified');
  const blockers = returned.length + unclassified.length;

  const change = (id: string, c: number, h: number) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, hours: l.hours.map((v, i) => (i === c ? h : v)), state: l.state === 'returned' ? 'open' : l.state, reason: l.state === 'returned' ? undefined : l.reason } : l)));
  const submit = () => {
    if (blockers) { setShowErrors(true); return; }
    setLines((ls) => ls.map((l) => ({ ...l, state: 'locked' })));
    setStatus('Submitted');
    toast({ variant: 'success', message: `Week submitted with ${formatHours(total)}.${longDays.length ? ` ${longDays.length} exception goes to your approver.` : ''} Nothing is saved in this demo.` });
  };
  const savePick = () => {
    const info = phaseInfo(phase);
    if (!info) { setTried(true); return; }
    if (picking?.lineId) setLines((ls) => ls.map((l) => (l.id === picking.lineId ? { ...l, title: info.name, subtitle: info.project, state: 'open', reason: undefined } : l)));
    else setLines((ls) => [...ls, { id: `new-${ls.length}`, title: info.name, subtitle: info.project, hours: [0, 0, 0, 0, 0, 0, 0] }]);
    setPicking(null);
  };
  const saveCorrection = () => {
    if (!corrLine || !corrMinutes || !corrReason.trim()) { setTried(true); return; }
    toast({ variant: 'info', message: 'Correction sent to your approver. Nothing is saved in this demo.' });
    setCorrecting(false);
  };
  const openPicker = (lineId: string | null) => { setPhase(null); setTried(false); setPicking({ lineId }); };
  const readOnlyWeek = locked;
  const primary = readOnlyWeek
    ? <Button variant="primary" onClick={() => { setCorrLine(lines[0].id); setCorrMinutes(null); setCorrReason(''); setTried(false); setCorrecting(true); }}>Request correction</Button>
    : <Button variant="primary" disabled={!lines.length} onClick={submit}>Submit week</Button>;
  const effective = state !== 'ready' ? state : 'ready';
  return (
    <>
      <PageHeader
        title="My time"
        meta={<StatusChip size="sm" status={status} />}
        period={<PeriodNav range={data?.range ?? ''} onPrev={() => setOffset((o) => Math.max(-1, o - 1))} onNext={() => setOffset((o) => Math.min(1, o + 1))} onToday={() => setOffset(0)} />}
        secondaryActions={<Button onClick={() => openLogTime()}>Log time</Button>}
        primaryAction={primary}
      />
      <div className="toolbar">
        <TimerPill state={timer.running ? 'running' : 'idle'} elapsedSeconds={timer.elapsed} context={timer.context} onStart={() => timer.start()} onStop={timer.stop} />
        {timer.running && <span className="t-body-sm ink-2">Concept option B, courtyard</span>}
      </div>
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="This timesheet" rows={6} onRetry={retry} capability="view this timesheet" empty={{ message: 'No time has been logged this week.', action: <Button variant="primary" onClick={() => openPicker(null)}>Add line</Button> }} />
        : lines.length === 0
          ? <div className="solid-panel"><EmptyState message="No time has been logged this week." action={<Button variant="primary" onClick={() => openPicker(null)}>Add line</Button>} /></div>
          : (
            <>
              <TimesheetGrid label={`Timesheet, ${data?.range}`} days={days} lines={lines} onChange={change} onAddLine={readOnlyWeek ? undefined : () => openPicker(null)} />
              <div className="stack-rows">
                {longDays.map(({ d, h }) => <InlineAlert key={d.key} variant="warn" title={`${LONG[d.label]} has ${formatHours(h)}`}>Days over 12 h go to your approver as an exception.</InlineAlert>)}
                {returned.map((l) => <InlineAlert key={l.id} variant={showErrors ? 'danger' : 'warn'} title={`${l.title} was returned`}>{l.reason}. Change its hours or move them to fix it.</InlineAlert>)}
                {unclassified.map((l) => (
                  <div key={l.id} className="stack-rows">
                    <InlineAlert variant="danger" title={`${l.title} is unclassified`}>{l.reason}.</InlineAlert>
                    <span><Button size="dense" onClick={() => openPicker(l.id)}>Choose project and phase</Button></span>
                  </div>
                ))}
                {showErrors && blockers > 0 && <p className="form__summary" role="status">Fix {blockers} {blockers === 1 ? 'line' : 'lines'} before you submit.</p>}
                <p className="t-body-sm">Week total <span className="t-numeric">{formatHours(total)}</span> of <span className="t-numeric">{formatHours(scheduled)}</span> scheduled</p>
              </div>
            </>
          )}
      <Sheet
        open={!!picking} onClose={() => setPicking(null)} title={picking?.lineId ? 'Choose project and phase' : 'Add line'}
        footer={<><Button variant="ghost" onClick={() => setPicking(null)}>Cancel</Button><Button variant="primary" onClick={savePick}>{picking?.lineId ? 'Save' : 'Add line'}</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); savePick(); }}>
          <FormSection><ProjectPhasePicker label="Project and phase" projects={projects} recent={['p1-concept', 'p1-wd']} value={phase} onChange={setPhase} error={tried && !phase ? 'Choose a project and phase' : undefined} /></FormSection>
        </Form>
      </Sheet>
      <Sheet
        open={correcting} onClose={() => setCorrecting(false)} title="Request correction" description={data?.range} dirty={corrReason !== ''}
        footer={<><Button variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button><Button variant="primary" onClick={saveCorrection}>Send request</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); saveCorrection(); }}>
          <FormSection>
            <Select label="Line" options={lines.map((l) => ({ value: l.id, label: l.title }))} value={corrLine} onChange={setCorrLine} />
            <DurationField label="Correct duration (h:mm)" minutes={corrMinutes} onChange={setCorrMinutes} error={tried && !corrMinutes ? 'Enter the correct time' : undefined} />
            <TextArea label="Reason" rows={3} value={corrReason} onChange={(e) => setCorrReason(e.target.value)} error={tried && !corrReason.trim() ? 'Say what changed' : undefined} />
          </FormSection>
        </Form>
      </Sheet>
    </>
  );
}
