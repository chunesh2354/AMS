import { useEffect, useMemo, useState } from 'react';
import { getProjectPhaseOptions, getTimesheet, type TimesheetLineData } from '../../api';
import { useResource } from '../../api/useResource';
import { apiFetch, failureMessage, isLive } from '../../api/live';
import { cellDate, classification, correctEntry, getMyTime, getPhaseOptions, putCell, startTimer, stopTimer, submitWeek, type LiveLineMeta, type LiveTimesheet } from '../../api/live/time';
import type { ProjectPhaseOption } from '../../ui/ProjectPhasePicker';
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
const mockProjects = getProjectPhaseOptions();
const phaseInfoIn = (projects: ProjectPhaseOption[], id: string | null) => projects.flatMap((p) => p.phases.map((ph) => ({ id: ph.id, name: ph.name, project: `${p.code} ${p.name}` }))).find((x) => x.id === id);

export function MyTimeScreen() {
  const { viewer } = useSession();
  const timer = useTimer();
  const toast = useToast();
  const { openLogTime } = useOverlays();
  const [offset, setOffset] = useState(0);
  const { state, data, retry } = useResource(() => (isLive ? getMyTime(offset) : getTimesheet(viewer.id, offset)), [viewer.id, offset]);
  const live = isLive ? (data as LiveTimesheet | null) : null;
  const [projects, setProjects] = useState<ProjectPhaseOption[]>(isLive ? [] : mockProjects);
  const [extraMeta, setExtraMeta] = useState<Record<string, LiveLineMeta>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => { if (isLive) getPhaseOptions().then(setProjects, (e) => toast({ variant: 'danger', message: failureMessage(e) })); }, [toast]);
  const metaOf = (id: string) => live?.meta[id] ?? extraMeta[id];
  const phaseInfo = (id: string | null) => phaseInfoIn(projects, id);
  const clsOf = (m: LiveLineMeta | undefined) => (m?.phaseId ? { phase_id: m.phaseId } : m?.internalCategoryId ? { internal_category_id: m.internalCategoryId } : null);
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
  useEffect(() => { if (data) { setLines(data.lines); setStatus(data.status); setShowErrors(false); setServerError(null); } }, [data]);

  const days = useMemo(() => data?.days ?? [], [data]);
  const locked = lines.length > 0 && lines.every((l) => l.state === 'locked');
  const total = lines.reduce((s, l) => s + l.hours.reduce((a, h) => a + h, 0), 0);
  const scheduled = days.reduce((s, d) => s + d.scheduled, 0);
  const longDays = live
    ? live.overDays.map((f) => ({ d: days.find((d) => d.date === f.date.slice(8, 10)) ?? days[0], h: f.hours ?? 0 }))
    : days.map((d, c) => ({ d, h: lines.reduce((s, l) => s + (l.hours[c] ?? 0), 0) })).filter((x) => x.h > 12);
  const returned = lines.filter((l) => l.state === 'returned');
  const unclassified = lines.filter((l) => l.state === 'unclassified');
  const blockers = returned.length + unclassified.length;

  const change = (id: string, c: number, h: number) => {
    if (live) {
      const m = metaOf(id);
      const cls = clsOf(m);
      const body = cls ?? { entry_id: m?.entries.find((e) => e.service_date.slice(0, 10) === cellDate(live.period, c))?.id };
      putCell({ service_date: cellDate(live.period, c), duration_hours: h, ...body }).then(retry, (e) => toast({ variant: 'danger', message: failureMessage(e) }));
      return;
    }
    mockChange(id, c, h);
  };
  const mockChange = (id: string, c: number, h: number) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, hours: l.hours.map((v, i) => (i === c ? h : v)), state: l.state === 'returned' ? 'open' : l.state, reason: l.state === 'returned' ? undefined : l.reason } : l)));
  const submit = () => {
    if (blockers) { setShowErrors(true); return; }
    if (live) {
      setServerError(null);
      submitWeek(live.period).then(
        (r) => { toast({ variant: 'success', message: `Week submitted with ${formatHours(total)}. ${r.approval_request_ids.length} approval ${r.approval_request_ids.length === 1 ? 'request' : 'requests'} sent.` }); retry(); },
        (e) => { const d = (e as { details?: unknown[] }).details ?? []; setServerError(`${failureMessage(e)}${d.length ? ` (${d.length} ${d.length === 1 ? 'entry' : 'entries'})` : ''}`); },
      );
      return;
    }
    setLines((ls) => ls.map((l) => ({ ...l, state: 'locked' })));
    setStatus('Submitted');
    toast({ variant: 'success', message: `Week submitted with ${formatHours(total)}.${longDays.length ? ` ${longDays.length} exception goes to your approver.` : ''} Nothing is saved in this demo.` });
  };
  const savePick = () => {
    const info = phaseInfo(phase);
    if (!info) { setTried(true); return; }
    if (live && phase) {
      const cls = classification(phase);
      if (picking?.lineId) {
        const m = metaOf(picking.lineId);
        Promise.all((m?.entries ?? []).map((e) => apiFetch(`/time-entries/${e.id}`, { method: 'PUT', body: cls }))).then(retry, (e) => toast({ variant: 'danger', message: failureMessage(e) }));
      } else {
        const id = `new:${phase}`;
        setExtraMeta((x) => ({ ...x, [id]: { phaseId: cls.phase_id ?? null, internalCategoryId: cls.internal_category_id ?? null, entries: [] } }));
        setLines((ls) => [...ls, { id, title: info.name, subtitle: info.project, hours: [0, 0, 0, 0, 0, 0, 0] }]);
      }
      setPicking(null);
      return;
    }
    if (picking?.lineId) setLines((ls) => ls.map((l) => (l.id === picking.lineId ? { ...l, title: info.name, subtitle: info.project, state: 'open', reason: undefined } : l)));
    else setLines((ls) => [...ls, { id: `new-${ls.length}`, title: info.name, subtitle: info.project, hours: [0, 0, 0, 0, 0, 0, 0] }]);
    setPicking(null);
  };
  const saveCorrection = () => {
    if (!corrLine || !corrMinutes || !corrReason.trim()) { setTried(true); return; }
    if (live) {
      correctEntry(corrLine, { duration_hours: Number((corrMinutes / 60).toFixed(2)), reason: corrReason.trim() }).then(
        () => { toast({ variant: 'success', message: 'Correction sent to your approver.' }); setCorrecting(false); retry(); },
        (e) => toast({ variant: 'danger', message: failureMessage(e) }),
      );
      return;
    }
    toast({ variant: 'info', message: 'Correction sent to your approver. Nothing is saved in this demo.' });
    setCorrecting(false);
  };
  const openPicker = (lineId: string | null) => { setPhase(null); setTried(false); setPicking({ lineId }); };
  const readOnlyWeek = locked;
  const corrOptions = live
    ? lines.flatMap((l) => (metaOf(l.id)?.entries ?? []).filter((e) => e.approval_state === 'Submitted' || e.approval_state === 'Approved').map((e) => ({ value: e.id, label: `${l.title}, ${e.service_date.slice(0, 10)}` })))
    : lines.map((l) => ({ value: l.id, label: l.title }));
  const timerStart = () => {
    if (!live) { timer.start(); return; }
    const l = lines.find((x) => clsOf(metaOf(x.id)) && x.state !== 'locked');
    const cls = l ? clsOf(metaOf(l.id)) : null;
    if (!l || !cls) { toast({ variant: 'warn', message: 'Add a project line before starting a timer.' }); return; }
    startTimer(cls).then(() => timer.start(`${l.subtitle ?? ''} · ${l.title}`), (e) => toast({ variant: 'danger', message: failureMessage(e) }));
  };
  const timerStop = () => {
    if (!live) { timer.stop(); return; }
    stopTimer().then(() => { timer.stop(); retry(); }, (e) => toast({ variant: 'danger', message: failureMessage(e) }));
  };
  const primary = readOnlyWeek
    ? <Button variant="primary" onClick={() => { setCorrLine(corrOptions[0]?.value ?? null); setCorrMinutes(null); setCorrReason(''); setTried(false); setCorrecting(true); }}>Request correction</Button>
    : <Button variant="primary" disabled={!lines.length} onClick={submit}>Submit week</Button>;
  const effective = state !== 'ready' ? state : 'ready';
  return (
    <>
      <PageHeader
        title="My time"
        meta={<StatusChip size="sm" status={status} />}
        period={<PeriodNav range={data?.range ?? ''} onPrev={() => setOffset((o) => (isLive ? o - 1 : Math.max(-1, o - 1)))} onNext={() => setOffset((o) => (isLive ? o + 1 : Math.min(1, o + 1)))} onToday={() => setOffset(0)} />}
        secondaryActions={<Button onClick={() => openLogTime()}>Log time</Button>}
        primaryAction={primary}
      />
      <div className="toolbar">
        <TimerPill state={timer.running ? 'running' : 'idle'} elapsedSeconds={timer.elapsed} context={timer.context} onStart={timerStart} onStop={timerStop} />
        {timer.running && !isLive && <span className="t-body-sm ink-2">Concept option B, courtyard</span>}
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
                {serverError && <p className="form__summary" role="alert">{serverError}</p>}
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
          <FormSection><ProjectPhasePicker label="Project and phase" projects={projects} recent={isLive ? [] : ['p1-concept', 'p1-wd']} value={phase} onChange={setPhase} error={tried && !phase ? 'Choose a project and phase' : undefined} /></FormSection>
        </Form>
      </Sheet>
      <Sheet
        open={correcting} onClose={() => setCorrecting(false)} title="Request correction" description={data?.range} dirty={corrReason !== ''}
        footer={<><Button variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button><Button variant="primary" onClick={saveCorrection}>Send request</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); saveCorrection(); }}>
          <FormSection>
            <Select label={isLive ? 'Entry' : 'Line'} options={corrOptions} value={corrLine} onChange={setCorrLine} />
            <DurationField label="Correct duration (h:mm)" minutes={corrMinutes} onChange={setCorrMinutes} error={tried && !corrMinutes ? 'Enter the correct time' : undefined} />
            <TextArea label="Reason" rows={3} value={corrReason} onChange={(e) => setCorrReason(e.target.value)} error={tried && !corrReason.trim() ? 'Say what changed' : undefined} />
          </FormSection>
        </Form>
      </Sheet>
    </>
  );
}
