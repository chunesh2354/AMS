import { CHANGES, COSTS, FILES, PROJECT_ACTIVITY, PROJECT_TIME, TASKS } from '../mock/work';
import { PROJECTS } from '../mock/studio-meridian';
import { reply } from './access';
import type { ActivityEvent, ChangeRequest, Cost, FileDoc, Task, TimeRow } from './types';

export const getTasks = (project: string): Promise<Task[]> => reply(TASKS.filter((t) => t.project === project));
export const getMyTasks = (viewerId: string): Promise<Task[]> => reply(TASKS.filter((t) => t.ownerId === viewerId));
export const getProjectTime = (project: string): Promise<TimeRow[]> => reply(PROJECT_TIME.filter((t) => t.project === project));
export const getCosts = (project: string): Promise<Cost[]> => reply(COSTS.filter((c) => c.project === project));
export const getChanges = (project: string): Promise<ChangeRequest[]> => reply(CHANGES.filter((c) => c.project === project));
export const getFiles = (project: string): Promise<FileDoc[]> => reply(FILES.filter((f) => f.project === project));
export const getProjectActivity = (project: string): Promise<ActivityEvent[]> => reply(PROJECT_ACTIVITY[project] ?? []);

export const getProjectPhaseOptions = () => PROJECTS.map((p) => ({ code: p.code, name: p.name, phases: p.phases.map((x) => ({ id: x.id, name: x.name })) }));
