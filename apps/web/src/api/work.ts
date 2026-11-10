import { CHANGES, COSTS, FILES, PROJECT_ACTIVITY, PROJECT_TIME, TASKS } from '../mock/work';
import { PROJECTS } from '../mock/studio-meridian';
import { sample, sampleSync } from './access';
import type { ActivityEvent, ChangeRequest, Cost, FileDoc, Task, TimeRow } from './types';

export const getTasks = (project: string): Promise<Task[]> => sample(() => TASKS.filter((t) => t.project === project), []);
export const getMyTasks = (viewerId: string): Promise<Task[]> => sample(() => TASKS.filter((t) => t.ownerId === viewerId), []);
export const getProjectTime = (project: string): Promise<TimeRow[]> => sample(() => PROJECT_TIME.filter((t) => t.project === project), []);
export const getCosts = (project: string): Promise<Cost[]> => sample(() => COSTS.filter((c) => c.project === project), []);
export const getChanges = (project: string): Promise<ChangeRequest[]> => sample(() => CHANGES.filter((c) => c.project === project), []);
export const getFiles = (project: string): Promise<FileDoc[]> => sample(() => FILES.filter((f) => f.project === project), []);
export const getProjectActivity = (project: string): Promise<ActivityEvent[]> => sample(() => PROJECT_ACTIVITY[project] ?? [], []);

export const getProjectPhaseOptions = () => sampleSync(() => PROJECTS.map((p) => ({ code: p.code, name: p.name, phases: p.phases.map((x) => ({ id: x.id, name: x.name })) })), []);
