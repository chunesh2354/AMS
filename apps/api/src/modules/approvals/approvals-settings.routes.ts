import { ApiError, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize } from '../../auth/authorize';
import { isUuid } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { canApproveTime } from './approvals.routes';

type Person = { id: string; ref_code: string; name: string; job_title: string | null };

/** Everyone the studio may name as its fallback approver: active, enabled and holding time.approve. */
async function candidates(tx: Tx): Promise<Person[]> {
  const people = (await tx.query(
    `select id, ref_code, name, job_title from person where login_state = 'Enabled' and employment_state = 'Active' order by name`,
  )).rows as Person[];
  const out: Person[] = [];
  // One transaction client: one query at a time.
  for (const p of people) if (await canApproveTime(tx, p.id)) out.push(p);
  return out;
}

async function current(tx: Tx) {
  const firm = (await tx.query('select fallback_approver_id, allow_self_approval from firm')).rows[0];
  const fallback = firm?.fallback_approver_id
    ? (await tx.query('select id, ref_code, name, job_title from person where id = $1', [firm.fallback_approver_id])).rows[0] ?? null
    : null;
  return { fallback, allowSelf: !!firm?.allow_self_approval };
}

/**
 * Settings, Approvals: who approves when routing finds nobody else (a PM's own time on a project they also lead,
 * someone with no manager). Without one, the studio's other principals are tried; a sole principal approves their own.
 */
export function approvalSettingsRoutes({ get, put }: Api) {
  get('/firm/approvals-settings', async ({ tx, actor }) => {
    authorize(actor, 'firm.settings.manage');
    const { fallback, allowSelf } = await current(tx);
    const people = await candidates(tx);
    return {
      fallback_approver: fallback,
      // A stored fallback who has since left or lost time.approve is skipped by routing; say so rather than hide it.
      fallback_approver_eligible: fallback ? people.some((p) => p.id === fallback.id) : null,
      allow_self_approval: allowSelf,
      candidates: people,
    };
  });

  /** Body: { fallback_approver_id: uuid | null }. null clears it. */
  put('/firm/approvals-settings', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'firm.settings.manage');
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'fallback_approver_id')) {
      throw new ApiError(400, 'VALIDATION', 'Some required fields are missing.', [{ field: 'fallback_approver_id', code: 'required' }]);
    }
    const next = body.fallback_approver_id as unknown;
    if (next !== null && !isUuid(next)) {
      throw new ApiError(400, 'VALIDATION', 'fallback_approver_id must be a person id or null.', [{ field: 'fallback_approver_id', code: 'uuid' }]);
    }
    if (next !== null && !(await canApproveTime(tx, next as string))) {
      throw ruleError('FALLBACK_APPROVER_ELIGIBLE', 'The fallback approver must be an active person who can approve time.', [{ field: 'fallback_approver_id', code: 'not_eligible' }]);
    }
    const before = await current(tx);
    await tx.query('update firm set fallback_approver_id = $1', [next]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'firm', recordId: firmId, action: 'approvals_settings.update',
      previous: { fallback_approver_id: before.fallback?.id ?? null }, next: { fallback_approver_id: next },
    });
    const after = await current(tx);
    return { fallback_approver: after.fallback, fallback_approver_eligible: after.fallback ? true : null, allow_self_approval: after.allowSelf, audit_event_id };
  });
}
