import { capabilityMap, strongest, type Level, type PermissionSetKey } from '@ams/domain';
import type { Tx } from '../db/pool';

export type Actor = {
  id: string;
  firmId: string;
  refCode: string;
  name: string;
  sets: PermissionSetKey[];
  caps: Record<string, Level>;
  /** Project ids where the person is PM or lead: the scope of an S capability. */
  ledProjects: string[];
  /** Project ids where the person is any member. */
  memberProjects: string[];
  /** Capabilities granted for specific projects. */
  scopedGrants: Record<string, string[]>;
  sessionId: string;
};

export async function loadActor(tx: Tx, personId: string, firmId: string, sessionId: string): Promise<Actor> {
  const p = (await tx.query('select id, ref_code, name from person where id = $1', [personId])).rows[0];
  const grants = (await tx.query(
    `select g.capability, g.scope_type, g.scope_id, s.key from permission_grant g left join permission_set s on s.id = g.permission_set_id where g.person_id = $1`,
    [personId],
  )).rows;
  const sets = grants.filter((g) => g.key).map((g) => g.key as PermissionSetKey);
  const caps: Record<string, Level> = capabilityMap(sets);
  const scopedGrants: Record<string, string[]> = {};
  for (const g of grants.filter((x) => x.capability)) {
    if (g.scope_type === 'firm') caps[g.capability] = strongest(caps[g.capability] ?? null, 'firm')!;
    else {
      caps[g.capability] = strongest(caps[g.capability] ?? null, 'scoped')!;
      (scopedGrants[g.capability] ??= []).push(g.scope_id);
    }
  }
  const members = (await tx.query('select project_id, project_role from project_membership where person_id = $1', [personId])).rows;
  return {
    id: personId, firmId, refCode: p.ref_code, name: p.name, sets, caps, sessionId, scopedGrants,
    ledProjects: members.filter((m) => m.project_role === 'pm' || m.project_role === 'lead').map((m) => m.project_id),
    memberProjects: members.map((m) => m.project_id),
  };
}
