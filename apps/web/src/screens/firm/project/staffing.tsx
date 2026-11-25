import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { failureMessage, isLive } from '../../../api/live';
import { listDirectory, type DirectoryPerson } from '../../../api/live/setup';
import { addProjectMember, getProjectTab, isForbidden, listProjectMembers, removeProjectMember, type ProjectMember } from '../../../api/live/project-tabs';
import { useSession, type Viewer } from '../../../app/session';
import { PlannerLayout } from '../../../layouts/PlannerLayout';
import { Button } from '../../../ui/Button';
import { DataTable, type Column } from '../../../ui/DataTable';
import { InlineAlert } from '../../../ui/InlineAlert';
import { ListStateBlock } from '../../../ui/ListState';
import { PersonPicker } from '../../../ui/PersonPicker';
import { PlannerLegend } from '../../../ui/PlannerGrid';
import { NotAvailable } from '../../../ui/NotAvailable';
import { Select } from '../../../ui/Select';
import { Skeleton } from '../../../ui/Skeleton';
import { useToast } from '../../../ui/Toast';
import { PLANNER_HINT, usePlanner } from '../../shared/use-planner';
import { GoTo } from '../../shared/go-to';
import { PeriodNav } from '../../../ui/PeriodNav';
import { Segmented } from '../../../ui/Segmented';
import { addDays, dayMonthYear } from '../../../api/live/planning';
import { useWorkload, usePlanningOptions } from '../workload-data';
import { LivePlanner } from '../workload-planner';

export function ProjectStaffingScreen() {
  const { id = '' } = useParams();
  if (isLive) {
    return (
      <>
        <ProjectTeamPanel code={id} />
        <LiveStaffingPlan code={id} />
      </>
    );
  }
  return <MockStaffingPlanner id={id} />;
}

export const STAFFING_DETAIL = 'Weekly hours booked for each person on this project, against their capacity.';

/**
 * Live mode: the workload planner filtered to this project (GET /workload?project=CODE), grouped by phase or person.
 * Its failures stay inside this section, so the Team panel above keeps working.
 */
function LiveStaffingPlan({ code }: { code: string }) {
  const [from, setFrom] = useState<string | undefined>();
  const [groupBy, setGroupBy] = useState<'phase' | 'person'>('phase');
  const { data, state, message, reload } = useWorkload({ from, project: code, projectTab: true });
  const { projects, people } = usePlanningOptions();
  const range = data ? `${dayMonthYear(data.from)} to ${dayMonthYear(data.to)}` : '';
  return (
    <section className="stack-4" aria-labelledby="staffing-plan-title">
      <h2 id="staffing-plan-title" className="t-h2">Staffing plan</h2>
      {state === 'missing'
        ? <div className="solid-panel"><NotAvailable detail={STAFFING_DETAIL} /></div>
        : state === 'denied' || state === 'error'
          ? <ListStateBlock state={state} label="Staffing" errorMessage={message} onRetry={reload} capability="view project staffing (capacity.manage)" />
          : !data
            ? <Skeleton kind="planner" />
            : (
              <LivePlanner
                data={data} reload={reload} projects={projects} people={people} projectCode={code} groupBy={groupBy} label={`${code} staffing`}
                tools={(
                  <>
                    <PeriodNav range={range} onPrev={() => setFrom(addDays(data.from, -7))} onNext={() => setFrom(addDays(data.from, 7))} onToday={() => setFrom(undefined)} />
                    <Segmented label="Group by" value={groupBy} onChange={setGroupBy} options={[{ value: 'phase', label: 'By phase' }, { value: 'person', label: 'By person' }]} />
                  </>
                )}
              />
            )}
    </section>
  );
}

/** The mock build's staffing planner. Live mode uses LiveStaffingPlan instead. */
function MockStaffingPlanner({ id }: { id: string }) {
  const planner = usePlanner(id);
  if (planner.state === 'loading') return <Skeleton kind="planner" />;
  if (planner.state !== 'ready') {
    return <ListStateBlock state={planner.state} label="Staffing" onRetry={planner.retry} capability="view project staffing" empty={{ message: 'Nobody is allocated to this project yet.', action: <GoTo to="/firm/workload">Open Workload</GoTo> }} />;
  }
  return (
    <>
      <PlannerLayout
        tools={<>{planner.period}{planner.zoomControl}<span style={{ marginLeft: 'auto' }}>{planner.publishButton}</span></>}
        grid={planner.grid} foot={<PlannerLegend hint={PLANNER_HINT} />}
      />
      {planner.sheets}
    </>
  );
}

const ROLES = [
  { value: 'contributor', label: 'Contributor' },
  { value: 'lead', label: 'Lead' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'viewer', label: 'Viewer' },
];
const roleLabel = (r: string) => (r === 'pm' ? 'Project manager' : ROLES.find((x) => x.value === r)?.label ?? r);

/** Same rule as the server's projects.plan: firm-wide, or scoped to a project the viewer leads. */
export function mayPlanProject(viewer: Viewer, projectId: string | null) {
  const level = viewer.capabilities?.['projects.plan'];
  if (level === 'firm') return true;
  return level === 'scoped' && !!projectId && !!viewer.ledProjects?.includes(projectId);
}

/**
 * Live mode: who is on the project. Membership is what lets staff see the project and log time on it.
 * Holders of projects.plan add people and remove them; the PM stays.
 */
export function ProjectTeamPanel({ code }: { code: string }) {
  const { viewer } = useSession();
  const toast = useToast();
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [role, setRole] = useState('contributor');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    listProjectMembers(code).then(
      (m) => { if (live) { setMembers(m); setState('ready'); } },
      (e: unknown) => { if (live) setState(isForbidden(e) ? 'denied' : 'error'); },
    );
    getProjectTab(code).then((p) => { if (live) setProjectId(p?.live.id ?? null); }, () => {});
    listDirectory().then((p) => { if (live) setPeople(p); }, () => {});
    return () => { live = false; };
  }, [code, attempt]);

  const canPlan = mayPlanProject(viewer, projectId);
  const onTeam = new Set((members ?? []).map((m) => m.person.id));
  const candidates = people
    .filter((p) => p.employment_state === 'Active' && p.login_state !== 'Revoked' && !onTeam.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, title: p.job_title ?? undefined }));

  const add = async () => {
    if (!pick) { setError('Choose a person to add'); return; }
    setBusy('add'); setError(null);
    try {
      const name = people.find((p) => p.id === pick)?.name ?? 'Person';
      const r = await addProjectMember(code, pick, role);
      setMembers(r.members); setPick(null); setRole('contributor');
      toast({ variant: 'success', message: `${name} added to the team.` });
    } catch (e) {
      setError(failureMessage(e));
    } finally { setBusy(null); }
  };
  const remove = async (m: ProjectMember) => {
    setBusy(m.person.id); setError(null);
    try {
      const r = await removeProjectMember(code, m.person.id);
      setMembers(r.members);
      toast({ variant: 'success', message: `${m.person.name} removed from the team.` });
    } catch (e) {
      setError(failureMessage(e));
    } finally { setBusy(null); }
  };

  const columns: Column<ProjectMember>[] = [
    { key: 'person', header: 'Person', type: 'person', value: (m) => m.person.name },
    { key: 'title', header: 'Title', value: (m) => m.person.job_title ?? '' },
    { key: 'role', header: 'Role', value: (m) => roleLabel(m.role) },
    ...(canPlan ? [{
      key: 'actions', header: '', value: () => '',
      render: (m: ProjectMember) => (m.is_pm ? <span className="t-caption ink-2">Stays on the team</span>
        : <Button variant="ghost" size="dense" loading={busy === m.person.id} aria-label={`Remove ${m.person.name}`} onClick={() => void remove(m)}>Remove</Button>),
    }] : []),
  ];
  return (
    <section className="card solid-panel stack-4" aria-labelledby="team-title">
      <div className="toolbar toolbar--between">
        <h2 id="team-title" className="t-h3">Team</h2>
        <span className="t-caption ink-2">Team members can see this project and log time on it.</span>
      </div>
      {error && <InlineAlert variant="danger" title={error} />}
      <DataTable
        label="Team members" columns={columns} rows={members ?? []} rowKey={(m) => m.person.id} density="dense"
        state={state === 'ready' && !members?.length ? 'empty' : state} onRetry={() => setAttempt((a) => a + 1)} capability="view project staffing"
        empty={{ message: 'Nobody is on this project yet.' }}
      />
      {canPlan && state === 'ready' && (
        <div className="toolbar">
          <PersonPicker label="Add a person" people={candidates} value={pick} onChange={setPick} dense />
          <Select label="Role" options={ROLES} value={role} onChange={setRole} dense />
          <Button variant="primary" loading={busy === 'add'} onClick={() => void add()}>Add to team</Button>
        </div>
      )}
    </section>
  );
}
