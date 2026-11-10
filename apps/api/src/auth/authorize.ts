import { ApiError } from '../http/errors';
import type { Actor } from './actor';

export const hasFirmCap = (a: Actor, cap: string) => a.caps[cap] === 'firm';

/** Section 3.2 rule 2: every operation asks this, in the service. Throws 403 naming the capability. */
export function authorize(actor: Actor, capability: string, scope: { projectId?: string; ownerId?: string; read?: boolean } = {}) {
  if (!can(actor, capability, scope)) {
    throw new ApiError(403, 'FORBIDDEN_CAPABILITY', `You need ${capability} for this.`, [], { capability });
  }
}
export function can(actor: Actor, capability: string, scope: { projectId?: string; ownerId?: string; read?: boolean } = {}) {
  const level = actor.caps[capability];
  if (level === 'firm') return true;
  if (level === 'view') return !!scope.read;
  if (level === 'scoped') {
    if (!scope.projectId) return false;
    return actor.ledProjects.includes(scope.projectId) || !!actor.scopedGrants[capability]?.includes(scope.projectId);
  }
  if (level === 'own') return !!scope.ownerId && scope.ownerId === actor.id;
  return false;
}

/** Project ids a viewer may see, or 'all'. Membership gates the workspace (AC-F06-4). */
export function visibleProjects(actor: Actor): 'all' | string[] {
  if (['firm', 'view'].includes(actor.caps['projects.plan'] ?? '') || actor.caps['budgets.hours.view'] === 'firm') return 'all';
  return actor.memberProjects;
}
export function assertProjectVisible(actor: Actor, projectId: string) {
  const v = visibleProjects(actor);
  if (v !== 'all' && !v.includes(projectId)) {
    throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You are not a member of this project.', [], { capability: 'projects.plan' });
  }
}
