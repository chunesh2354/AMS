import { useMemo, useState, type ReactNode } from 'react';
import { ApiFailure, failureMessage } from '../../api/live';
import type { LiveProjectView } from '../../api/live/projects';
import type { DirectoryPerson } from '../../api/live/setup';
import {
  createAllocation, dayMonth, dayMonthYear, deleteAllocation, fmtH, num, publishPlan, ruleOf, updateAllocation,
  type Allocation, type AllocationInput, type Week, type Workload,
} from '../../api/live/planning';
import { useSession } from '../../app/session';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { ConflictBanner } from '../../ui/ConflictBanner';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { NumberField } from '../../ui/NumberField';
import { PlannerGrid, type PlannerAllocation, type PlannerColumn, type PlannerMark, type PlannerRow } from '../../ui/PlannerGrid';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { TextArea } from '../../ui/TextArea';
import { useToast } from '../../ui/Toast';
import { mayPlanProject } from './project/staffing';

export const PUBLISHED_ONLY_NOTE = "Draft plan. Only published allocations appear on people's schedules; until then your changes are visible to you and other planners only.";
export const READ_ONLY_NOTE = 'You can see the plan. Changing it needs projects.plan on the project.';

export type GroupBy = 'project' | 'phase' | 'person';
type RowSpec = PlannerRow & { personId: string | null; projectId?: string; phaseId?: string | null };

/** Week columns: "9 Nov", with "This week" or the studio holidays under it. */
export function weekColumns(data: Workload): PlannerColumn[] {
  const holidays = (ws: string) => [...new Set(data.people.flatMap((p) => p.weeks.find((w) => w.week_start === ws)?.holidays.map((h) => h.name) ?? []))];
  return data.weeks.map((ws) => {
    const today = data.today >= ws && data.today <= addSix(ws);
    return { key: ws, label: dayMonth(ws), today, note: today ? 'This week' : holidays(ws).join(', ') || undefined };
  });
}
const addSix = (ws: string) => new Date(Date.parse(`${ws}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);

/** What a hatched cell says: the holiday names, then the leave labels ("On leave" unless the viewer may see the type). */
export function offLabel(w: Week): string | null {
  const parts = [...w.holidays.map((h) => (h.half_day ? `${h.name} (half day)` : h.name)), ...w.leave.filter((l) => l.status === 'Approved').map((l) => l.leave_type?.name ?? l.label)];
  if (!parts.length && !w.on_leave && num(w.holiday_hours) <= 0) return null;
  return [...new Set(parts)].join(', ') || 'On leave';
}

const changeNote = (a: Allocation) => (!a.unpublished_change ? undefined : a.published ? 'Edited, not yet published' : 'New, not yet published');

function buildRows(data: Workload, groupBy: GroupBy) {
  const specs: RowSpec[] = [{ id: 'un', label: 'Unassigned demand', sublabel: 'Needs a person', pinned: true, personId: null }];
  const cards: { a: Allocation; rowId: string }[] = [];
  data.unassigned.forEach((d) => d.weeks.forEach((w) => w.allocations.forEach((a) => cards.push({ a, rowId: 'un' }))));
  const seen = new Set<string>();
  const groupRows: RowSpec[] = [];
  const idle: RowSpec[] = [];
  data.people.forEach((p) => {
    const sub = p.inactive ? 'Left the studio' : p.person.job_title ?? undefined;
    const mine = p.weeks.flatMap((w) => w.allocations);
    if (groupBy === 'person') {
      groupRows.push({ id: `p|${p.person.id}`, label: p.person.name, sublabel: sub, avatar: true, personId: p.person.id });
      mine.forEach((a) => cards.push({ a, rowId: `p|${p.person.id}` }));
      return;
    }
    if (!mine.length) { idle.push({ id: `none|${p.person.id}`, label: p.person.name, sublabel: sub, avatar: true, group: 'No allocations in these weeks', personId: p.person.id }); return; }
    mine.forEach((a) => {
      const key = groupBy === 'phase' ? (a.phase?.id ?? 'none') : a.project.id;
      const id = `${key}|${p.person.id}`;
      const group = groupBy === 'phase' ? (a.phase ? `${a.phase.code} ${a.phase.name}` : 'No phase') : `${a.project.code} ${a.project.name}`;
      if (!seen.has(id)) {
        seen.add(id);
        groupRows.push({
          id, label: p.person.name, sublabel: sub, avatar: true, group, groupStatus: groupBy === 'project' && a.on_hold ? 'On hold' : undefined,
          personId: p.person.id, projectId: a.project.id, phaseId: groupBy === 'phase' ? a.phase?.id ?? null : undefined,
        });
      }
      cards.push({ a, rowId: id });
    });
  });
  // Rows of one group sit together: PlannerGrid starts a new group heading whenever the group changes.
  const order = [...new Set(groupRows.map((r) => r.group ?? ''))];
  groupRows.sort((x, y) => order.indexOf(x.group ?? '') - order.indexOf(y.group ?? '') || x.label.localeCompare(y.label));
  specs.push(...groupRows, ...idle);
  return { specs, cards };
}

type Draft = {
  allocation: Allocation | null;
  person: string; project: string; phase: string; week: string; hours: string; state: 'tentative' | 'confirmed'; note: string;
  reason: string; addToTeam: boolean;
  /** Set when the server asked: the rule and its message. */
  ask: { rule: 'PERSON_ON_TEAM' | 'OVERALLOCATION'; message: string; over?: number; detail?: string } | null;
};

export type LivePlannerProps = {
  data: Workload;
  reload: () => void;
  projects: LiveProjectView[];
  people: DirectoryPerson[];
  /** The project tab's code: rows are that project's, publish is scoped to it, new allocations go on it. */
  projectCode?: string | null;
  groupBy?: GroupBy;
  /** Rendered above the grid, beside the publish and add actions. */
  tools?: ReactNode;
  label?: string;
};

/** The live planner on PlannerGrid: GET /workload for the rows, /allocations for the writes, /allocations/publish. */
export function LivePlanner({ data, reload, projects, people, projectCode = null, groupBy = 'project', tools, label = 'Resource planner' }: LivePlannerProps) {
  const { viewer } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState('');

  const columns = useMemo(() => weekColumns(data), [data]);
  const { specs, cards } = useMemo(() => buildRows(data, groupBy), [data, groupBy]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.a.id, c.a])), [cards]);
  const weekOf = (personId: string | null, ws: string) => data.people.find((p) => p.person.id === personId)?.weeks.find((w) => w.week_start === ws);
  const specOf = (rowId: string) => specs.find((s) => s.id === rowId);
  const canPlan = data.can_plan;
  const changes = data.pending_changes;

  const gridAllocations: PlannerAllocation[] = cards.map(({ a, rowId }): PlannerAllocation => {
    const w = weekOf(a.person?.id ?? null, a.week_start);
    const conflict = !!w?.conflict && a.state === 'confirmed';
    return {
      id: a.id, rowId, column: data.weeks.indexOf(a.week_start), hours: num(a.hours),
      kind: a.on_hold ? 'hold' : a.state, published: a.published && !a.unpublished_change,
      code: rowId === 'un' || groupBy !== 'project' ? (projectCode ? undefined : a.project.code) : undefined,
      label: rowId === 'un' && projectCode ? a.phase?.name ?? 'No phase' : a.phase?.name ?? (rowId === 'un' ? a.project.name : 'No phase'),
      note: changeNote(a) ?? (a.note || undefined),
      conflict, reason: conflict ? (a.overallocation_reason ? `Why: ${a.overallocation_reason}` : `Over by ${fmtH(num(w!.over_hours))} h`) : undefined,
      locked: !a.can_edit,
    };
  }).filter((g) => g.column >= 0);

  const off: PlannerMark[] = specs.flatMap((r) => columns.flatMap((_, c) => {
    const ws = data.weeks[c];
    const w = r.personId ? weekOf(r.personId, ws) : data.people[0]?.weeks.find((x) => x.week_start === ws);
    if (!w) return [];
    const text = r.personId ? offLabel(w) : w.holidays.map((h) => h.name).join(', ') || null;
    return text ? [{ rowId: r.id, column: c, label: text }] : [];
  }));

  const over = (rowId: string, column: number) => {
    const spec = specOf(rowId);
    if (!spec?.personId) return 0;
    const w = weekOf(spec.personId, data.weeks[column]);
    if (!w?.conflict) return 0;
    return gridAllocations.some((g) => g.rowId === rowId && g.column === column) ? num(w.over_hours) : 0;
  };

  const plannable = projects.filter((p) => p.status !== 'Archived' && mayPlanProject(viewer, p.live.id));
  const projectByKey = (key: string) => projects.find((p) => p.live.id === key || p.code === key);
  const fixedProject = projectCode ? projectByKey(projectCode) ?? null : null;

  const blank = (over: Partial<Draft> = {}): Draft => ({
    allocation: null, person: '', project: fixedProject?.live.id ?? data.project?.id ?? '', phase: '', week: data.weeks[0] ?? '', hours: '', state: 'confirmed', note: '',
    reason: '', addToTeam: false, ask: null, ...over,
  });
  const fromAllocation = (a: Allocation, patch: Partial<Draft> = {}): Draft => ({
    allocation: a, person: a.person?.id ?? '', project: a.project.id, phase: a.phase?.id ?? '', week: a.week_start, hours: fmtH(num(a.hours)),
    state: a.state, note: a.note ?? '', reason: a.overallocation_reason ?? '', addToTeam: false, ask: null, ...patch,
  });
  const open = (d: Draft) => { setTried(false); setError(null); setDraft(d); };

  /** Turns a refused quick change (drag, resize) into the sheet, with the server's question in it. */
  const askFrom = (e: unknown): Draft['ask'] => {
    const rule = ruleOf(e);
    if (rule !== 'PERSON_ON_TEAM' && rule !== 'OVERALLOCATION') return null;
    const d = (e as ApiFailure).details.find((x) => typeof x === 'object' && x !== null && 'over_hours' in x) as { over_hours?: string; available?: string; confirmed_allocations?: string } | undefined;
    return {
      rule, message: (e as ApiFailure).message,
      over: d?.over_hours != null ? num(d.over_hours) : undefined,
      detail: d ? `${fmtH(num(d.available))} h available, ${fmtH(num(d.confirmed_allocations))} h confirmed with this change.` : undefined,
    };
  };

  const quick = async (a: Allocation, body: AllocationInput, patch: Partial<Draft>, message: string) => {
    setBusy(a.id);
    try {
      await updateAllocation(a.id, body);
      toast({ variant: 'info', message });
      reload();
    } catch (e) {
      const ask = askFrom(e);
      if (ask) open(fromAllocation(a, { ...patch, ask }));
      else toast({ variant: 'danger', message: failureMessage(e) });
    } finally { setBusy(null); }
  };

  const onMove = (id: string, rowId: string, column: number) => {
    const a = byId.get(id);
    const spec = specOf(rowId);
    const week = data.weeks[column];
    if (!a || !spec || !week) return;
    if (!a.can_edit) { toast({ variant: 'warn', message: `You cannot change allocations on ${a.project.code}.` }); return; }
    if (spec.projectId && spec.projectId !== a.project.id) {
      toast({ variant: 'warn', message: `An allocation stays on its project. Add a new one for ${projects.find((p) => p.live.id === spec.projectId)?.code ?? 'that project'} instead.` });
      return;
    }
    const body: AllocationInput = {};
    if (week !== a.week_start) body.week_start = week;
    if ((spec.personId ?? null) !== (a.person?.id ?? null)) body.person_id = spec.personId;
    if (spec.phaseId !== undefined && spec.phaseId !== (a.phase?.id ?? null)) body.phase_id = spec.phaseId;
    if (!Object.keys(body).length) return;
    void quick(a, body, { week, person: spec.personId ?? '', phase: spec.phaseId !== undefined ? spec.phaseId ?? '' : a.phase?.id ?? '' },
      `${fmtH(num(a.hours))} h moved to ${spec.personId ? spec.label : 'unassigned demand'}, week of ${dayMonth(week)}. Publish to tell the team.`);
  };
  const onResize = (id: string, hours: number) => {
    const a = byId.get(id);
    if (!a) return;
    if (!a.can_edit) { toast({ variant: 'warn', message: `You cannot change allocations on ${a.project.code}.` }); return; }
    void quick(a, { hours }, { hours: String(hours) }, `Allocation changed to ${fmtH(hours)} h. Publish to tell the team.`);
  };
  const onCellClick = (rowId: string, column: number) => {
    if (!canPlan) return;
    const spec = specOf(rowId);
    if (!spec) return;
    const rowProject = spec.projectId ?? fixedProject?.live.id ?? data.project?.id ?? '';
    // A PM may plan their own projects only: a row on someone else's project opens the sheet with no project chosen,
    // so the choice is among the projects they may plan (the API would refuse the other one).
    const project = rowProject && mayPlanProject(viewer, rowProject) ? rowProject : '';
    open(blank({ person: spec.personId ?? '', project, phase: project ? spec.phaseId ?? '' : '', week: data.weeks[column] }));
  };
  const onCardClick = (card: PlannerAllocation) => {
    const a = byId.get(card.id);
    if (a) open(fromAllocation(a));
  };

  // ---------- The sheet ----------
  const project = draft ? projectByKey(draft.project) ?? null : null;
  const phases = project?.phases ?? [];
  const readOnly = !!draft?.allocation && !draft.allocation.can_edit;
  const hoursOk = (h: string) => Number(h) > 0 && Number(h) <= 168;
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? data.people.find((p) => p.person.id === id)?.person.name ?? 'This person';

  const save = async () => {
    if (!draft) return;
    if (!draft.project || !hoursOk(draft.hours) || !draft.week || (draft.ask?.rule === 'OVERALLOCATION' && !draft.reason.trim())) { setTried(true); return; }
    setBusy('save'); setError(null);
    const body: AllocationInput = {
      week_start: draft.week, hours: Number(draft.hours), phase_id: draft.phase || null, person_id: draft.person || null, state: draft.state, note: draft.note.trim() || null,
      ...(draft.reason.trim() ? { overallocation_reason: draft.reason.trim() } : {}),
      ...(draft.addToTeam ? { add_to_team: true } : {}),
    };
    try {
      const saved = draft.allocation ? await updateAllocation(draft.allocation.id, body) : await createAllocation({ ...body, project_id: draft.project });
      setDraft(null);
      toast({ variant: 'success', message: `Allocation saved${saved.added_to_team ? ` and ${saved.person?.name ?? 'the person'} added to the team` : ''}. Publish to tell the team.` });
      reload();
    } catch (e) {
      const ask = askFrom(e);
      if (ask) { setDraft({ ...draft, ask }); setTried(false); } else setError(failureMessage(e));
    } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!draft?.allocation) return;
    setBusy('remove'); setError(null);
    try {
      const r = await deleteAllocation(draft.allocation.id);
      setDraft(null);
      toast({ variant: 'info', message: r.removed_on_publish ? 'Allocation removed. It stays on schedules until the plan is published.' : 'Allocation removed.' });
      reload();
    } catch (e) { setError(failureMessage(e)); } finally { setBusy(null); }
  };

  const publish = async () => {
    setBusy('publish');
    try {
      const code = projectCode ?? data.project?.code ?? undefined;
      const r = await publishPlan({ ...(code ? { project: code } : {}), ...(publishNote.trim() ? { note: publishNote.trim() } : {}) });
      setPublishing(false); setPublishNote('');
      const n = r.revision.change_count;
      toast({
        variant: r.conflicts.length ? 'warn' : 'success',
        message: `Plan revision ${r.revision.revision_no} published: ${n} ${n === 1 ? 'change' : 'changes'}, ${r.notified.length} ${r.notified.length === 1 ? 'person' : 'people'} notified.${r.conflicts.length ? ` ${r.conflicts.length} ${r.conflicts.length === 1 ? 'week is' : 'weeks are'} still over capacity.` : ''}`,
      });
      reload();
    } catch (e) {
      setPublishing(false);
      if (e instanceof ApiFailure && e.code === 'NOTHING_TO_PUBLISH') { toast({ variant: 'info', message: e.message }); reload(); } else toast({ variant: 'danger', message: failureMessage(e) });
    } finally { setBusy(null); }
  };

  const conflicts = data.conflicts;
  const publishLabel = `Publish plan (${changes} ${changes === 1 ? 'change' : 'changes'})`;
  const weekOptions = [...new Set([...(draft?.week && !data.weeks.includes(draft.week) ? [draft.week] : []), ...data.weeks])].map((w) => ({ value: w, label: `Week of ${dayMonthYear(w)}` }));
  const peopleOptions = [{ value: '', label: 'Unassigned demand' }, ...people.map((p) => ({ value: p.id, label: p.name }))];
  if (draft?.person && !people.some((p) => p.id === draft.person)) peopleOptions.push({ value: draft.person, label: personName(draft.person) });
  const projectOptions = (draft?.allocation || fixedProject ? projects.filter((p) => p.live.id === draft?.project || p.code === projectCode) : plannable)
    .map((p) => ({ value: p.live.id, label: `${p.code} ${p.name}` }));
  if (draft?.allocation && !projectOptions.length) projectOptions.push({ value: draft.allocation.project.id, label: `${draft.allocation.project.code} ${draft.allocation.project.name}` });
  const phaseOptions = [{ value: '', label: 'No phase' }, ...phases.map((p) => ({ value: p.id, label: p.name }))];
  if (draft?.allocation?.phase && !phases.some((p) => p.id === draft.allocation!.phase!.id)) phaseOptions.push({ value: draft.allocation.phase.id, label: draft.allocation.phase.name });

  return (
    <div className="stack-4">
      <div className="toolbar toolbar--between">
        <p className="t-caption ink-2" style={{ margin: 0, maxWidth: 720 }}>{canPlan ? PUBLISHED_ONLY_NOTE : READ_ONLY_NOTE}</p>
        <div className="toolbar">
          {tools}
          {canPlan && <Button onClick={() => open(blank())}>Add allocation</Button>}
          {canPlan && <Button variant="primary" disabled={!changes} onClick={() => setPublishing(true)}>{publishLabel}</Button>}
        </div>
      </div>
      {conflicts.length > 0 && (
        <div className="wl-conflicts" role="group" aria-labelledby="wl-conflicts-title">
          <p id="wl-conflicts-title" className="wl-conflicts__t"><span className="heat-mk heat-mk--red" aria-hidden />{conflicts.length} {conflicts.length === 1 ? 'week is' : 'weeks are'} over capacity</p>
          <ul className="wl-conflicts__list">
            {conflicts.map((k) => (
              <li key={`${k.person.id}-${k.week_start}`}>
                {k.person.name}, week of {dayMonth(k.week_start)}: {fmtH(num(k.confirmed_allocations))} h confirmed against {fmtH(num(k.available))} h available, {fmtH(num(k.over_hours))} h over.
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="planner-page__grid planner-page__grid--fit">
        <PlannerGrid
          label={label} columns={columns} rows={specs} allocations={gridAllocations} off={off} over={over} readOnly={!canPlan || !!busy}
          rowHeader={groupBy === 'person' ? 'Person' : groupBy === 'phase' ? 'Phase and person' : 'Project and person'}
          onMove={onMove} onResize={onResize} onCellClick={onCellClick} onCardClick={onCardClick}
        />
      </div>
      <div className="plan-legend">
        <span><i className="plan-legend__sw pcard--confirmed" />Confirmed</span>
        <span><i className="plan-legend__sw pcard--tentative" />Tentative</span>
        <span><i className="plan-legend__sw pcard--hold" />On hold</span>
        <span><i className="plan-legend__sw pcard--conflict" />Conflict, reason in the block</span>
        <span><i className="plan-legend__sw plan__c--off" />Leave or studio holiday</span>
        <span>New, Edited: not yet published</span>
        {canPlan && <span className="plan-legend__hint">Drag a block to another week or person. Drag its right edge, or press + and -, to change hours.</span>}
      </div>

      <Sheet
        open={!!draft} onClose={() => setDraft(null)} title={readOnly ? 'Allocation' : draft?.allocation ? 'Edit allocation' : 'Add allocation'}
        description={draft ? `${draft.person ? personName(draft.person) : 'Unassigned demand'} · week of ${draft.week ? dayMonthYear(draft.week) : ''}` : undefined}
        footer={readOnly ? <Button onClick={() => setDraft(null)}>Close</Button> : (
          <>
            {draft?.allocation && <Button variant="ghost" loading={busy === 'remove'} onClick={() => void remove()}>Remove</Button>}
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>Save allocation</Button>
          </>
        )}
      >
        {draft && (readOnly && draft.allocation ? (
          <dl className="stack-4" style={{ margin: 0 }}>
            <div><dt className="t-caption ink-2">Project</dt><dd style={{ margin: 0 }}>{draft.allocation.project.code} {draft.allocation.project.name}</dd></div>
            <div><dt className="t-caption ink-2">Phase</dt><dd style={{ margin: 0 }}>{draft.allocation.phase?.name ?? 'No phase'}</dd></div>
            <div><dt className="t-caption ink-2">Hours</dt><dd style={{ margin: 0 }} className="t-numeric">{fmtH(num(draft.allocation.hours))} h, {draft.allocation.state === 'confirmed' ? 'confirmed' : 'tentative'}</dd></div>
            <p className="t-caption ink-2" style={{ margin: 0 }}>Only a planner of {draft.allocation.project.code} can change this.</p>
          </dl>
        ) : (
          <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <FormSection>
              {error && <InlineAlert variant="danger" title={error} />}
              {draft.ask?.rule === 'OVERALLOCATION' && (
                <ConflictBanner
                  kind="overallocated" hoursOver={draft.ask.over ?? 0} detail={draft.ask.detail ?? draft.ask.message}
                  reason={draft.reason} onReasonChange={(v) => setDraft({ ...draft, reason: v })} reasonError={tried && !draft.reason.trim() ? 'Say why this goes ahead' : undefined}
                />
              )}
              {draft.ask?.rule === 'PERSON_ON_TEAM' && (
                <InlineAlert variant="warn" title={draft.ask.message}>
                  <Checkbox label={`Add ${personName(draft.person)} to the team as a contributor`} checked={draft.addToTeam} onChange={(e) => setDraft({ ...draft, addToTeam: e.target.checked })} />
                </InlineAlert>
              )}
              <Select label="Person" options={peopleOptions} value={draft.person} searchable onChange={(v) => setDraft({ ...draft, person: v, ask: null, addToTeam: false })} helper="Leave as unassigned demand to plan the hours before choosing someone." />
              <Select
                label="Project" options={projectOptions} value={draft.project || null} disabled={!!draft.allocation || !!fixedProject}
                onChange={(v) => setDraft({ ...draft, project: v, phase: '', ask: null })} error={tried && !draft.project ? 'Choose a project' : undefined}
                helper={draft.allocation ? 'An allocation stays on its project.' : undefined}
              />
              <Select label="Phase" options={phaseOptions} value={draft.phase} onChange={(v) => setDraft({ ...draft, phase: v })} />
              <Select label="Week starting" options={weekOptions} value={draft.week} onChange={(v) => setDraft({ ...draft, week: v, ask: null })} />
              <NumberField
                label="Hours" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value, ask: draft.ask?.rule === 'OVERALLOCATION' ? null : draft.ask })}
                helper="For the whole week." error={tried && !hoursOk(draft.hours) ? 'Enter hours above 0 and at most 168' : undefined}
              />
              <Segmented label="Status" value={draft.state} onChange={(v) => setDraft({ ...draft, state: v, ask: draft.ask?.rule === 'OVERALLOCATION' ? null : draft.ask })} options={[{ value: 'tentative', label: 'Tentative' }, { value: 'confirmed', label: 'Confirmed' }]} />
              <p className="t-caption ink-2" style={{ margin: 0 }}>Tentative hours count in the load but never need a reason when they go over.</p>
              <TextArea label="Note" rows={2} maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </FormSection>
          </Form>
        ))}
      </Sheet>

      <Sheet
        open={publishing} onClose={() => setPublishing(false)} title="Publish plan"
        description={`${changes} ${changes === 1 ? 'change' : 'changes'}${projectCode ?? data.project?.code ? ` on ${projectCode ?? data.project?.code}` : ''}`}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPublishing(false)}>Cancel</Button>
            <Button variant="primary" loading={busy === 'publish'} onClick={() => void publish()}>Publish</Button>
          </>
        )}
      >
        <div className="stack-4">
          <p style={{ margin: 0 }}>Publishing puts these allocations on people&apos;s schedules and tells each person affected what changed. The previous plan is kept as a revision.</p>
          <TextArea label="Note for the revision (optional)" rows={3} maxLength={1000} value={publishNote} onChange={(e) => setPublishNote(e.target.value)} />
        </div>
      </Sheet>
    </div>
  );
}
