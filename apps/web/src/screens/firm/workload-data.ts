import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, isLive } from '../../api/live';
import { getLiveProjects, type LiveProjectView } from '../../api/live/projects';
import { listDirectory, type DirectoryPerson } from '../../api/live/setup';
import { getWorkload, planningMissing, type Workload } from '../../api/live/planning';

export type WorkloadState = 'loading' | 'ready' | 'error' | 'denied' | 'missing';

/**
 * One GET /workload feeds both the heatmap and the planner: it nests the allocations, the unassigned demand,
 * the conflicts, can_plan and pending_changes. Every write reloads it rather than patching locally.
 */
export function useWorkload(opts: { from?: string; project?: string | null; /** The project tab: its project exists, so a 404 can only mean no planning API. */ projectTab?: boolean }) {
  const [data, setData] = useState<Workload | null>(null);
  const [state, setState] = useState<WorkloadState>('loading');
  const [message, setMessage] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const { from, project, projectTab = false } = opts;

  useEffect(() => {
    if (!isLive) return undefined;
    let live = true;
    setState((s) => (s === 'ready' ? s : 'loading'));
    getWorkload({ from, weeks: 8, project }).then(
      (w) => { if (live) { setData(w); setState('ready'); } },
      (e: unknown) => {
        if (!live) return;
        setMessage(e instanceof ApiFailure ? e.message : undefined);
        setState(e instanceof ApiFailure && e.status === 403 ? 'denied' : planningMissing(e) && (!project || projectTab) ? 'missing' : 'error');
      },
    );
    return () => { live = false; };
  }, [from, project, projectTab, attempt]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { data, state, message, reload };
}

/** Projects (with phases) and active people, for the filter and the allocation sheet. Failures leave the lists empty. */
export function usePlanningOptions() {
  const [projects, setProjects] = useState<LiveProjectView[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  useEffect(() => {
    if (!isLive) return undefined;
    let live = true;
    getLiveProjects().then((p) => { if (live) setProjects(p); }, () => {});
    listDirectory().then((p) => { if (live) setPeople(p.filter((x) => x.employment_state === 'Active' && x.login_state !== 'Revoked')); }, () => {});
    return () => { live = false; };
  }, []);
  return { projects, people };
}
