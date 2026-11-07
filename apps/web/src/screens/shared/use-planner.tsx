import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fullWeekLeave, getPeople, getPlan, getProjectPhaseOptions, personName, weekBreakdown, weekCapacity, type Allocation, type Person } from '../../api';
import { useResource } from '../../api/useResource';
import { PROJECTS } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { ConflictBanner } from '../../ui/ConflictBanner';
import { Form, FormSection } from '../../ui/Form';
import { NumberField } from '../../ui/NumberField';
import { PeriodNav } from '../../ui/PeriodNav';
import { PlannerGrid, type PlannerAllocation, type PlannerColumn, type PlannerMark, type PlannerRow } from '../../ui/PlannerGrid';
import { ProjectPhasePicker } from '../../ui/ProjectPhasePicker';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { formatHours } from '../../ui/format';

const projects = getProjectPhaseOptions();
const phaseById = (id: string | null) => {
  for (const p of projects) { const ph = p.phases.find((x) => x.id === id); if (ph) return { project: p.code, phaseId: ph.id, phaseName: ph.name }; }
  return null;
};
const HOLIDAY_WEEK = 7;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayLabel = (week: number, d: number) => {
  const date = new Date(2026, 10, 2 + week * 7 + d);
  return `${DOW[d]} ${String(date.getDate()).padStart(2, '0')}`;
};

type RowSpec = PlannerRow & { personId: string | null; project?: string; phaseId?: string };

const rowOfAlloc = (a: Allocation, project?: string) => (project ? `${a.phaseId}:${a.personId ?? 'un'}` : a.personId ? `${a.project}:${a.personId}` : 'un');

function firmRows(allocations: Allocation[], people: Person[], params: URLSearchParams): RowSpec[] {
  const rows: RowSpec[] = [{ id: 'un', label: 'Unassigned demand', pinned: true, personId: null }];
  const projectFilter = params.get('project');
  const team = params.get('team');
  const skill = params.get('skill');
  const keep = (p: Person) => (!team || p.managerId === team) && (!skill || p.skills.includes(skill));
  PROJECTS.filter((prj) => !projectFilter || prj.code === projectFilter).forEach((prj) => {
    const ids = [...new Set(allocations.filter((a) => a.project === prj.code && a.personId).map((a) => a.personId!))];
    ids.sort().forEach((id) => {
      const person = people.find((p) => p.id === id);
      if (person && keep(person)) rows.push({ id: `${prj.code}:${id}`, label: person.name, avatar: true, group: `${prj.code} ${prj.name}`, groupStatus: prj.status === 'On hold' ? 'On hold' : undefined, personId: id, project: prj.code });
    });
  });
  if (!projectFilter) {
    people.filter((p) => !allocations.some((a) => a.personId === p.id) && p.projects.length === 0 && keep(p))
      .forEach((p) => rows.push({ id: `none:${p.id}`, label: p.name, avatar: true, group: 'Not on a project', personId: p.id }));
  }
  return rows;
}

function projectRows(allocations: Allocation[], code: string): RowSpec[] {
  const prj = PROJECTS.find((p) => p.code === code);
  if (!prj) return [];
  const rows: RowSpec[] = [];
  prj.phases.forEach((ph) => {
    const list = allocations.filter((a) => a.project === code && a.phaseId === ph.id);
    if (!list.length) return;
    if (list.some((a) => !a.personId)) rows.push({ id: `${ph.id}:un`, label: 'Unassigned demand', pinned: true, personId: null, phaseId: ph.id, project: code });
    [...new Set(list.filter((a) => a.personId).map((a) => a.personId!))].sort().forEach((id) => {
      rows.push({ id: `${ph.id}:${id}`, label: personName(id), avatar: true, group: ph.name, personId: id, phaseId: ph.id, project: code });
    });
  });
  return rows;
}

type Edit = { allocation: Allocation | null; rowId: string; week: number; personId: string | null; phase: string | null; hours: string };
type Pending = { next: Allocation[]; personId: string; week: number; over: number; note: string };

/** Everything the Resource planner and Project Staffing share. Allocation changes live in this view only. */
export function usePlanner(project?: string) {
  const [params] = useSearchParams();
  const toast = useToast();
  const { state, data, retry } = useResource(getPlan, []);
  const people = useResource(getPeople, []);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const [offset, setOffset] = useState(0);
  const [zoom, setZoom] = useState<'week' | 'day'>('week');
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => { if (data) setAllocations(data.allocations); }, [data]);

  const weeks = data?.weeks ?? [];
  const span = narrow ? 4 : 8;
  const maxOffset = Math.max(0, weeks.length - span);
  const scoped = useMemo(() => (project ? allocations.filter((a) => a.project === project) : allocations), [allocations, project]);
  const specs = useMemo(() => (project ? projectRows(allocations, project) : firmRows(allocations, people.data ?? [], params)), [allocations, people.data, params, project]);
  const changes = scoped.filter((a) => !a.published).length;

  const load = (list: Allocation[], personId: string, week: number) => list.filter((a) => a.personId === personId && a.week === week).reduce((s, a) => s + a.hours, 0);
  const overBy = (list: Allocation[], personId: string | null, week: number) => (personId ? Math.max(0, load(list, personId, week) - weekCapacity(personId, week)) : 0);

  const columns: PlannerColumn[] = zoom === 'week'
    ? weeks.slice(offset, offset + span).map((label, i) => ({ key: label, label, today: i + offset === 0, note: i + offset === 0 ? 'Today' : undefined }))
    : DOW.map((_, d) => ({ key: String(d), label: dayLabel(offset, d), today: offset === 0 && d === 4, note: offset === 0 && d === 4 ? 'Today' : undefined }));

  const toGrid = (a: Allocation, column: number, hours: number): PlannerAllocation => ({
    id: zoom === 'week' ? a.id : `${a.id}-${column}`, rowId: rowOfAlloc(a, project), column, hours, kind: a.kind, published: a.published,
    label: project ? a.phaseName : a.personId ? a.phaseName : `${a.project} ${a.phaseName}`,
  });
  const gridAllocations = zoom === 'week'
    ? scoped.filter((a) => a.week >= offset && a.week < offset + span).map((a) => toGrid(a, a.week - offset, a.hours))
    : scoped.filter((a) => a.week === offset).flatMap((a) => [0, 1, 2, 3, 4].map((d) => toGrid(a, d, Math.round((a.hours / 5) * 10) / 10)));

  const off: PlannerMark[] = specs.flatMap((r) => (zoom === 'week'
    ? columns.flatMap((_, c) => {
        const w = c + offset;
        if (r.personId && fullWeekLeave(r.personId, w)) return [{ rowId: r.id, column: c, label: 'Leave' }];
        if (w === HOLIDAY_WEEK) return [{ rowId: r.id, column: c, label: 'Holiday 25 Dec' }];
        return [];
      })
    : [5, 6].map((d) => ({ rowId: r.id, column: d, label: 'Weekend' }))));

  const specOf = (rowId: string) => specs.find((r) => r.id === rowId);
  const applyOrAsk = (next: Allocation[], personId: string | null, week: number, message: string) => {
    if (personId && overBy(next, personId, week) > overBy(allocations, personId, week)) {
      const over = overBy(next, personId, week);
      const b = weekBreakdown(personId, week);
      setReason(''); setTried(false);
      setPending({ next, personId, week, over, note: `${personName(personId)}, week of ${weeks[week]}. ${b.scheduled} h scheduled, ${b.holiday} holiday, ${b.leave} leave, ${b.commitments} commitment, ${load(next, personId, week)} allocated.` });
      return;
    }
    setAllocations(next);
    toast({ variant: 'info', message });
  };

  const onMove = (id: string, rowId: string, column: number) => {
    const a = allocations.find((x) => x.id === id);
    const spec = specOf(rowId);
    if (!a || !spec) return;
    const week = column + offset;
    const code = spec.project ?? a.project;
    const phase = spec.phaseId ?? (code === a.project ? a.phaseId : PROJECTS.find((p) => p.code === code)?.phases[0].id ?? a.phaseId);
    const info = phaseById(phase);
    const next = allocations.map((x) => (x.id === id ? { ...x, week, personId: spec.personId, project: code, phaseId: phase, phaseName: info?.phaseName ?? x.phaseName, published: false } : x));
    applyOrAsk(next, spec.personId, week, `${spec.label}, ${a.hours} h moved to ${weeks[week]}.`);
  };
  const onResize = (id: string, hours: number) => {
    const a = allocations.find((x) => x.id === id);
    if (!a) return;
    const next = allocations.map((x) => (x.id === id ? { ...x, hours, published: false } : x));
    applyOrAsk(next, a.personId, a.week, `Allocation changed to ${hours} h.`);
  };
  const openNew = (rowId: string, column: number) => {
    const spec = specOf(rowId);
    if (!spec || zoom === 'day') return;
    setReason(''); setTried(false);
    setEdit({ allocation: null, rowId, week: column + offset, personId: spec.personId, phase: spec.phaseId ?? (spec.project ? PROJECTS.find((p) => p.code === spec.project)?.phases[0].id ?? null : null), hours: '' });
  };
  const openCard = (card: PlannerAllocation) => {
    const a = allocations.find((x) => x.id === card.id.split('-')[0]);
    if (!a) return;
    setReason(''); setTried(false);
    setEdit({ allocation: a, rowId: card.rowId, week: a.week, personId: a.personId, phase: a.phaseId, hours: String(a.hours) });
  };

  // The conflict the open sheet would leave behind.
  const editNext = (e: Edit): Allocation[] => {
    const hours = Number(e.hours) || 0;
    const info = phaseById(e.phase);
    if (e.allocation) return allocations.map((x) => (x.id === e.allocation!.id ? { ...x, hours, ...(info ?? {}) } : x));
    return info ? [...allocations, { id: `new-${allocations.length}`, personId: e.personId, week: e.week, hours, kind: 'confirmed', published: false, ...info }] : allocations;
  };
  const editOver = edit ? overBy(editNext(edit), edit.personId, edit.week) : 0;
  const saveEdit = () => {
    if (!edit) return;
    const bad = !(Number(edit.hours) > 0) || !edit.phase || (editOver > 0 && !reason.trim());
    if (bad) { setTried(true); return; }
    setAllocations(editNext(edit).map((x) => (x.id === edit.allocation?.id ? { ...x, published: false } : x)));
    setEdit(null);
    toast({ variant: 'success', message: 'Allocation saved in this view. Publish to tell the team.' });
  };
  const removeEdit = () => {
    if (!edit?.allocation) return;
    setAllocations((l) => l.filter((x) => x.id !== edit.allocation!.id));
    setEdit(null);
    toast({ variant: 'info', message: 'Allocation removed in this view.' });
  };
  const publish = () => {
    const n = changes;
    setAllocations((l) => l.map((a) => (!project || a.project === project ? { ...a, published: true } : a)));
    toast({ variant: 'success', message: `Plan published. ${n} ${n === 1 ? 'change' : 'changes'} sent to the team in this demo.` });
  };

  const range = zoom === 'week' ? `${columns[0]?.label ?? ''} to ${columns[columns.length - 1]?.label ?? ''}` : `Week of ${weeks[offset] ?? ''}`;
  const period = <PeriodNav range={range} onPrev={() => setOffset((o) => Math.max(0, o - 1))} onNext={() => setOffset((o) => Math.min(zoom === 'week' ? maxOffset : weeks.length - 1, o + 1))} onToday={() => setOffset(0)} />;
  const zoomControl = <Segmented label="Zoom" value={zoom} onChange={(z) => setZoom(z)} options={[{ value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />;
  const publishButton = <Button variant="primary" disabled={!changes} onClick={publish}>Publish plan ({changes} {changes === 1 ? 'change' : 'changes'})</Button>;
  const grid = (
    <PlannerGrid
      label={project ? `${project} staffing` : 'Resource planner'} columns={columns} rows={specs} allocations={gridAllocations} off={off} readOnly={zoom === 'day'}
      over={zoom === 'week' ? (rowId, column) => {
        const spec = specOf(rowId);
        const week = column + offset;
        if (!spec?.personId) return 0;
        const here = scoped.some((a) => rowOfAlloc(a, project) === rowId && a.week === week);
        return here ? overBy(allocations, spec.personId, week) : 0;
      } : undefined}
      onMove={onMove} onResize={onResize} onCellClick={openNew} onCardClick={openCard}
    />
  );
  const sheets = (
    <>
      <Sheet
        open={!!edit} onClose={() => setEdit(null)} title="Allocation"
        description={edit ? `${edit.personId ? personName(edit.personId) : 'Unassigned demand'} · week of ${weeks[edit.week]}` : undefined}
        footer={(
          <>
            {edit?.allocation && <Button variant="ghost" onClick={removeEdit}>Remove</Button>}
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save allocation</Button>
          </>
        )}
      >
        {edit && (
          <Form onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
            <FormSection>
              {editOver > 0 && edit.personId && (() => {
                const b = weekBreakdown(edit.personId, edit.week);
                return (
                  <ConflictBanner
                    kind="overallocated" hoursOver={editOver}
                    detail={`${b.scheduled} h scheduled, ${b.holiday} holiday, ${b.leave} leave, ${b.commitments} commitment, ${load(editNext(edit), edit.personId, edit.week)} allocated.`}
                    reason={reason} onReasonChange={setReason} reasonError={tried && !reason.trim() ? 'Say why this goes ahead' : undefined}
                  />
                );
              })()}
              <NumberField label="Planned hours" value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} error={tried && !(Number(edit.hours) > 0) ? 'Enter hours above zero' : undefined} />
              <ProjectPhasePicker label="Project and phase" projects={project ? projects.filter((p) => p.code === project) : projects} value={edit.phase} onChange={(v) => setEdit({ ...edit, phase: v })} error={tried && !edit.phase ? 'Choose a project and phase' : undefined} />
            </FormSection>
          </Form>
        )}
      </Sheet>
      <Sheet
        open={!!pending} onClose={() => setPending(null)} title="This goes over capacity" description={pending ? personName(pending.personId) : undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancel move</Button>
            <Button variant="danger" onClick={() => {
              if (!reason.trim()) { setTried(true); return; }
              if (pending) setAllocations(pending.next);
              setPending(null);
              toast({ variant: 'warn', message: 'Allocation saved over capacity, with your reason.' });
            }}>Keep over capacity</Button>
          </>
        )}
      >
        {pending && <ConflictBanner kind="overallocated" hoursOver={pending.over} detail={pending.note} reason={reason} onReasonChange={setReason} reasonError={tried && !reason.trim() ? 'Say why this goes ahead' : undefined} />}
      </Sheet>
    </>
  );
  const summary = `${formatHours(scoped.reduce((s, a) => s + a.hours, 0))} planned`;
  return { state: state === 'ready' && !specs.length ? ('empty' as const) : state, retry, period, zoomControl, publishButton, grid, sheets, summary, changes };
}

export const PLANNER_HINT = 'Arrow keys move. Enter opens. Shift + arrow moves an allocation. + and − change hours.';
