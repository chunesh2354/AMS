import { ApiError, conflict, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import { assertProjectVisible, authorize } from '../../auth/authorize';
import { list } from '../../http/responses';
import { isUuid, required } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { findProject } from './projects.routes';

/** Roles a team member can hold. 'pm' is set by the project itself, never through these routes. */
export const MEMBER_ROLES = ['lead', 'contributor', 'reviewer', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Every id must be a person in this firm (RLS hides other firms, so a foreign id reads as unknown). 400 names the field. */
export async function assertPeopleExist(tx: Tx, ids: string[], field: string) {
  if (!ids.length) return;
  if (ids.some((x) => !isUuid(x))) throw new ApiError(400, 'VALIDATION', 'Choose a person from this studio.', [{ field, code: 'unknown' }]);
  const found = (await tx.query('select id from person where id = any($1::uuid[])', [ids])).rows.map((r) => r.id as string);
  const missing = ids.filter((x) => !found.includes(x));
  if (missing.length) throw new ApiError(400, 'VALIDATION', 'Choose a person from this studio.', [{ field, code: 'unknown' }]);
}

const roleOf = (body: any): MemberRole => {
  const role = body.role ?? 'contributor';
  if (!MEMBER_ROLES.includes(role)) throw new ApiError(400, 'VALIDATION', `A team role is one of ${MEMBER_ROLES.join(', ')}.`, [{ field: 'role', code: 'enum' }]);
  return role;
};

async function membersOf(tx: Tx, projectId: string) {
  return (await tx.query(
    `select m.person_id, m.project_role, p.ref_code, p.name, p.job_title from project_membership m join person p on p.id = m.person_id
     where m.project_id = $1 order by case m.project_role when 'pm' then 0 when 'lead' then 1 else 2 end, p.ref_code`, [projectId],
  )).rows.map((r) => ({ person: { id: r.person_id, ref_code: r.ref_code, name: r.name, job_title: r.job_title }, role: r.project_role, is_pm: r.project_role === 'pm' }));
}

/** The project team: membership is what lets staff see a project and log time on it (AC-F06-4). */
export function memberRoutes({ get, post, del }: Api) {
  get('/projects/:code/members', async ({ tx, actor, params, req }) => {
    const p = await findProject(tx, params.code);
    assertProjectVisible(actor, p.id);
    return list(req, await membersOf(tx, p.id));
  });

  // Adds a person, or changes the role of someone already on the team. The PM's own row is fixed.
  post('/projects/:code/members', async ({ tx, actor, firmId, params, body }) => {
    const p = await findProject(tx, params.code);
    authorize(actor, 'projects.plan', { projectId: p.id });
    required(body, ['person_id']);
    const role = roleOf(body);
    await assertPeopleExist(tx, [body.person_id], 'person_id');
    if (body.person_id === p.pm_id) throw conflict('IS_PM', 'This person is the project manager already.');
    const prev = (await tx.query('select id, project_role from project_membership where project_id = $1 and person_id = $2', [p.id, body.person_id])).rows[0];
    if (prev) {
      await tx.query('update project_membership set project_role = $2, updated_by = $3, updated_at = now() where id = $1', [prev.id, role, actor.id]);
    } else {
      await tx.query(
        'insert into project_membership (firm_id, project_id, person_id, project_role, created_by) values ($1,$2,$3,$4,$5)',
        [firmId, p.id, body.person_id, role, actor.id],
      );
    }
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'project_membership', recordId: p.id, action: prev ? 'change_role' : 'add',
      previous: prev ? { person_id: body.person_id, role: prev.project_role } : undefined, next: { person_id: body.person_id, role },
    });
    return { members: await membersOf(tx, p.id), audit_event_id };
  });

  del('/projects/:code/members/:personId', async ({ tx, actor, firmId, params }) => {
    const p = await findProject(tx, params.code);
    authorize(actor, 'projects.plan', { projectId: p.id });
    if (!isUuid(params.personId)) throw notFound('Team member');
    if (params.personId === p.pm_id) throw conflict('IS_PM', 'The project manager cannot be removed. Change the PM first.');
    const prev = (await tx.query('delete from project_membership where project_id = $1 and person_id = $2 returning project_role', [p.id, params.personId])).rows[0];
    if (!prev) throw notFound('Team member');
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'project_membership', recordId: p.id, action: 'remove', previous: { person_id: params.personId, role: prev.project_role },
    });
    return { members: await membersOf(tx, p.id), audit_event_id };
  });
}
